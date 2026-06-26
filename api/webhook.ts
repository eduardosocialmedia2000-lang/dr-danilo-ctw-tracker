import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractCTW } from '../src/extractCTW';
import { getDatasetAndPage } from '../src/graphApi';
import { sendLeadSubmitted, sendPurchase } from '../src/metaCapi';
import { upsertCTWLead, getCTWLead, markPurchaseSent, updateKommoLeadValor, updateKommoLeadUtm } from '../src/supabase';

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN ?? '';
const META_API_VERSION = process.env.META_API_VERSION ?? 'v24.0';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE ?? '';

// CM2 — Consulta Agendada: pipeline 13597443, stage 104924215
const CM2_PIPELINE_ID = 13597443;
const CM2_CONSULTA_AGENDADA_STAGE_ID = 104924215;
// Valor da consulta para o evento Purchase (em BRL)
const CONSULTA_VALUE = Number(process.env.CONSULTA_VALUE ?? '0');
const CONSULTA_CURRENCY = 'BRL';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, service: 'ctw-tracker' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Valida secret — aceita via header ou query string (Kommo não suporta headers customizados)
  const secret = (req.headers['x-webhook-secret'] as string) || (req.query.secret as string);
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // ── FLUXO 1: lead avançou para "Consulta Agendada" no CM2 ──────────────────
  // O Kommo dispara update_lead com leads.update contendo pipeline_id e status_id
  const updatedLeads = (body?.leads as Record<string, unknown>)?.update as unknown[];
  if (Array.isArray(updatedLeads) && updatedLeads.length > 0) {
    for (const lead of updatedLeads) {
      const l = lead as Record<string, unknown>;
      const leadId = Number(l.id);
      const pipelineId = Number(l.pipeline_id);
      const stageId = Number(l.status_id);

      if (pipelineId === CM2_PIPELINE_ID && stageId === CM2_CONSULTA_AGENDADA_STAGE_ID) {
        console.log('[ctw-tracker] Consulta Agendada detectada, lead_id:', leadId);

        const stored = await getCTWLead(leadId);
        if (!stored) {
          console.log('[ctw-tracker] Sem ctwaClid para lead_id:', leadId, '— skipping Purchase');
          res.status(200).json({ ok: true, skipped: true, reason: 'no_ctwa_clid_stored' });
          return;
        }

        if (stored.purchase_event_sent_at) {
          console.log('[ctw-tracker] Purchase já enviado para lead_id:', leadId);
          res.status(200).json({ ok: true, skipped: true, reason: 'purchase_already_sent' });
          return;
        }

        // Usa o price do lead vindo do Kommo; fallback para CONSULTA_VALUE se vier zerado
        const leadPrice = Number(l.price ?? 0);
        const purchaseValue = leadPrice > 0 ? leadPrice : CONSULTA_VALUE;

        try {
          const capiResp = await sendPurchase(
            {
              ctwaClid: stored.ctwa_clid,
              phone: stored.phone ?? '',
              dataset: stored.dataset_id ?? '',
              pageId: stored.page_id ?? '',
              value: purchaseValue,
              currency: CONSULTA_CURRENCY,
              timestamp: Math.floor(Date.now() / 1000),
              testEventCode: META_TEST_EVENT_CODE || undefined,
            },
            META_ACCESS_TOKEN,
            META_API_VERSION
          );
          await markPurchaseSent(leadId);
          // Atualiza kommo_leads.valor_fechado para refletir na vw_roas_unificado do dashboard
          if (purchaseValue > 0) {
            try {
              await updateKommoLeadValor(leadId, purchaseValue);
            } catch (err) {
              console.warn('[ctw-tracker] Erro ao atualizar valor_fechado:', err);
            }
          }
          console.log('[ctw-tracker] Purchase enviado para lead_id:', leadId, 'value:', purchaseValue);
          res.status(200).json({ ok: true, event: 'Purchase', leadId, value: purchaseValue, capi: capiResp });
        } catch (err) {
          console.error('[ctw-tracker] Erro ao enviar Purchase:', err);
          res.status(502).json({ error: 'purchase_capi_error', detail: String(err) });
        }
        return;
      }
    }
  }

  // ── FLUXO 2: nova mensagem ou novo lead com ctwaClid ───────────────────────
  const ctw = extractCTW(body);
  if (!ctw) {
    res.status(200).json({ ok: true, skipped: true, reason: 'not_ctw' });
    return;
  }

  // Extrai lead_id do payload (Kommo inclui em leads.add ou leads.update)
  const addedLeads = (body?.leads as Record<string, unknown>)?.add as unknown[];
  const leadId = Array.isArray(addedLeads) && addedLeads.length > 0
    ? Number((addedLeads[0] as Record<string, unknown>).id)
    : 0;

  console.log('[ctw-tracker] CTW detectado', { leadId, phone: ctw.phone, sourceId: ctw.sourceId });

  let dataset: string;
  let pageId: string;

  try {
    const result = await getDatasetAndPage(ctw.sourceId, META_ACCESS_TOKEN, META_API_VERSION);
    dataset = result.dataset;
    pageId = result.pageId;
  } catch (err) {
    console.error('[ctw-tracker] Erro na Graph API:', err);
    res.status(502).json({ error: 'graph_api_error', detail: String(err) });
    return;
  }

  // Salva no Supabase para associar o ctwaClid ao lead_id
  if (leadId) {
    try {
      await upsertCTWLead({
        lead_id: leadId,
        ctwa_clid: ctw.ctwaClid,
        source_id: ctw.sourceId,
        source_url: ctw.sourceUrl,
        phone: ctw.phone,
        dataset_id: dataset,
        page_id: pageId,
      });
      // Grava sourceId em utm_content para atribuição de ROAS por anúncio no dashboard
      if (ctw.sourceId) {
        try {
          await updateKommoLeadUtm(leadId, ctw.sourceId);
        } catch (err) {
          console.warn('[ctw-tracker] Erro ao atualizar utm_content:', err);
        }
      }
    } catch (err) {
      // Log mas não falha — CAPI ainda deve ser enviada
      console.warn('[ctw-tracker] Erro ao salvar no Supabase:', err);
    }
  }

  // Envia LeadSubmitted para Meta CAPI
  let capiResponse: unknown;
  try {
    capiResponse = await sendLeadSubmitted(
      {
        ctwaClid: ctw.ctwaClid,
        phone: ctw.phone,
        dataset,
        pageId,
        timestamp: ctw.timestamp,
        testEventCode: META_TEST_EVENT_CODE || undefined,
      },
      META_ACCESS_TOKEN,
      META_API_VERSION
    );
  } catch (err) {
    console.error('[ctw-tracker] Erro na CAPI:', err);
    res.status(502).json({ error: 'capi_error', detail: String(err) });
    return;
  }

  console.log('[ctw-tracker] LeadSubmitted enviado', { dataset, pageId });

  res.status(200).json({ ok: true, event: 'LeadSubmitted', leadId, dataset, pageId, capi: capiResponse });
}
