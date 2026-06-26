import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractCTW } from '../src/extractCTW';
import { getDatasetAndPage } from '../src/graphApi';
import { sendLeadSubmitted } from '../src/metaCapi';

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN ?? '';
const META_API_VERSION = process.env.META_API_VERSION ?? 'v24.0';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Health check
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, service: 'ctw-tracker' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Valida secret
  const secret = req.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body as unknown;

  // Extrai dados CTW — retorna null se não for mensagem de anúncio CTW
  const ctw = extractCTW(body);
  if (!ctw) {
    // Não é CTW — aceita silenciosamente (200) para o Kommo não retentar
    res.status(200).json({ ok: true, skipped: true, reason: 'not_ctw' });
    return;
  }

  console.log('[ctw-tracker] CTW detectado', {
    phone: ctw.phone,
    sourceId: ctw.sourceId,
    ctwaClid: ctw.ctwaClid.slice(0, 20) + '…',
  });

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

  console.log('[ctw-tracker] LeadSubmitted enviado', { dataset, pageId, capiResponse });

  res.status(200).json({
    ok: true,
    dataset,
    pageId,
    capi: capiResponse,
  });
}
