import https from 'https';

const SB_URL = process.env.SUPABASE_URL ?? '';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

function sbFetch(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const req = https.request(
      `${SB_URL}/rest/v1${path}`,
      {
        method: options.method ?? 'GET',
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json',
          Prefer: options.method === 'POST' ? 'resolution=merge-duplicates,return=representation' : '',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          try { resolve(JSON.parse(text)); } catch { resolve({ raw: text }); }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export interface CTWLeadRow {
  lead_id: number;
  ctwa_clid: string;
  source_id?: string;
  source_url?: string;
  phone?: string;
  dataset_id?: string;
  page_id?: string;
}

/** Salva ou atualiza o ctwaClid vinculado ao lead_id */
export async function upsertCTWLead(row: CTWLeadRow): Promise<void> {
  await sbFetch('/ctw_leads', { method: 'POST', body: row });
}

/** Busca ctwaClid pelo lead_id */
export async function getCTWLead(leadId: number): Promise<CTWLeadRow | null> {
  const result = await sbFetch(`/ctw_leads?lead_id=eq.${leadId}&limit=1`) as CTWLeadRow[];
  return Array.isArray(result) && result.length > 0 ? result[0] : null;
}

/** Marca que o evento Purchase foi enviado */
export async function markPurchaseSent(leadId: number): Promise<void> {
  await sbFetch(`/ctw_leads?lead_id=eq.${leadId}`, {
    method: 'PATCH',
    body: { purchase_event_sent_at: new Date().toISOString() },
  });
}

/** Atualiza valor_fechado e data_fechamento em kommo_leads para refletir na vw_roas_unificado */
export async function updateKommoLeadValor(leadId: number, valor: number): Promise<void> {
  await sbFetch(`/kommo_leads?lead_id=eq.${leadId}`, {
    method: 'PATCH',
    body: {
      valor_fechado: valor,
      data_fechamento: new Date().toISOString().slice(0, 10),
    },
  });
}
