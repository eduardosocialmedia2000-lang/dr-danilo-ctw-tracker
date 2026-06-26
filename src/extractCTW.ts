/**
 * Extrai parâmetros CTW (Click-to-WhatsApp) de payloads de diferentes APIs de WhatsApp.
 * Suporta: Kommo webhook, Evolution API, Z-API.
 */

export interface CTWData {
  ctwaClid: string;
  sourceId: string;
  sourceUrl: string;
  phone: string;
  pushName?: string;
  timestamp: number;
}

/**
 * Normaliza número de telefone para formato E.164 sem o "+" inicial.
 * Ex: "+55 11 99999-9999" → "5511999999999"
 *     "5521967442811@s.whatsapp.net" → "5521967442811"
 */
export function normalizePhone(raw: string): string {
  // Remove sufixo de JID do WhatsApp (ex: @s.whatsapp.net)
  const stripped = raw.split('@')[0];
  // Remove tudo que não for dígito
  return stripped.replace(/\D/g, '');
}

/**
 * Busca recursivamente um campo em qualquer nível do objeto.
 * Retorna o primeiro valor encontrado.
 */
function deepFind<T>(obj: unknown, key: string): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (key in o) return o[key] as T;
  for (const v of Object.values(o)) {
    const found = deepFind<T>(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Tenta extrair o bloco externalAdReply do payload, independente do formato.
 * Retorna null se não for uma mensagem de anúncio CTW.
 */
function extractAdReply(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;

  // Busca o campo externalAdReply em qualquer lugar do payload
  const adReply = deepFind<Record<string, unknown>>(body, 'externalAdReply');
  if (!adReply) return null;

  // Confirma que é um anúncio CTW (sourceType = "ad")
  const sourceType = adReply.sourceType ?? adReply.source_type;
  if (sourceType !== 'ad' && sourceType !== 1) return null;

  return adReply;
}

/**
 * Extrai o telefone do payload dependendo do formato da API.
 */
function extractPhone(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  // Z-API: body.phone
  if (typeof b.phone === 'string' && b.phone) return normalizePhone(b.phone);

  // Evolution API: body.data.key.remoteJid
  const data = b.data as Record<string, unknown> | undefined;
  if (data) {
    const key = data.key as Record<string, unknown> | undefined;
    if (key && typeof key.remoteJid === 'string') return normalizePhone(key.remoteJid);
  }

  // Kommo: body.contacts[0].phones[0].phone ou body.leads[0]._embedded.contacts[0]
  // O Kommo pode enviar o telefone em diferentes caminhos — busca genérica
  const phone = deepFind<string>(body, 'phone') ?? deepFind<string>(body, 'remoteJid');
  if (phone) return normalizePhone(phone);

  return null;
}

/**
 * Extrai o nome do lead (pushName) do payload.
 */
function extractPushName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;

  // Z-API: body.senderName ou body.chatName
  if (typeof b.senderName === 'string') return b.senderName;
  if (typeof b.chatName === 'string') return b.chatName;

  // Evolution API: body.data.pushName
  return deepFind<string>(body, 'pushName');
}

/**
 * Função principal: extrai todos os dados CTW do payload.
 * Retorna null se o payload não for de uma mensagem de anúncio CTW.
 */
export function extractCTW(body: unknown): CTWData | null {
  const adReply = extractAdReply(body);
  if (!adReply) return null;

  // ctwaClid pode aparecer como ctwaClid ou ctwa_clid
  const ctwaClid = (adReply.ctwaClid ?? adReply.ctwa_clid) as string | undefined;
  if (!ctwaClid) return null;

  // sourceId pode aparecer como sourceId ou source_id
  const sourceId = (adReply.sourceId ?? adReply.source_id) as string | undefined;
  if (!sourceId) return null;

  // sourceUrl pode aparecer como sourceUrl ou source_url
  const sourceUrl = ((adReply.sourceUrl ?? adReply.source_url) as string | undefined) ?? '';

  const phone = extractPhone(body);
  if (!phone) return null;

  // Timestamp: tenta extrair do payload, senão usa now
  let timestamp = Math.floor(Date.now() / 1000);
  const rawTs = deepFind<number>(body, 'messageTimestamp') ?? deepFind<number>(body, 'momment');
  if (rawTs) {
    // momment da Z-API vem em ms, messageTimestamp da Evolution vem em segundos
    timestamp = rawTs > 1e10 ? Math.floor(rawTs / 1000) : rawTs;
  }

  return {
    ctwaClid,
    sourceId,
    sourceUrl,
    phone,
    pushName: extractPushName(body),
    timestamp,
  };
}
