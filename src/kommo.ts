import https from 'https';

const KOMMO_TOKEN = process.env.KOMMO_TOKEN ?? '';
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN ?? 'danilomatsunaga';

// ID da tag "meta-ads-ctwa" no Kommo (Dr. Danilo)
const META_ADS_TAG_ID = 3143080;
const META_ADS_TAG_NAME = 'meta-ads-ctwa';

// IDs dos custom fields de tracking no Kommo (Dr. Danilo)
const UTM_FIELD_IDS = {
  utm_source:   3320132,
  utm_medium:   3320128,
  utm_campaign: 3320130,
  utm_content:  3320126,
  utm_term:     3320134,
  referrer:     3320138,
  fbclid:       3320144,
  gclid:        3320142,
};

export interface UtmData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  referrer?: string;
  fbclid?: string;
  gclid?: string;
}

/**
 * Parseia a mensagem pré-preenchida do botão WhatsApp do site e extrai UTMs.
 * Suporta o formato: "Vim do site... [src:instagram/social] #meta [ref:instagram||bio|]"
 * e também "?utm_source=X&utm_medium=Y&utm_campaign=Z" embutido na mensagem.
 */
export function parseMessageUtm(message: string): UtmData | null {
  if (!message) return null;
  const result: UtmData = {};

  // Formato [src:SOURCE/MEDIUM] — ex: [src:instagram/social], [src:meta_ads/cpc]
  const srcMatch = message.match(/\[src:([^/\]]+)(?:\/([^\]]+))?\]/i);
  if (srcMatch) {
    result.utm_source = srcMatch[1].trim().toLowerCase();
    if (srcMatch[2]) result.utm_medium = srcMatch[2].trim().toLowerCase();
  }

  // Formato [ref:SOURCE||PLACEMENT|] — ex: [ref:instagram||bio|]
  const refMatch = message.match(/\[ref:([^|]+)\|+([^|]*)\|/i);
  if (refMatch && refMatch[1]) {
    if (!result.utm_source) result.utm_source = refMatch[1].trim().toLowerCase();
    if (refMatch[2]) result.utm_content = refMatch[2].trim().toLowerCase();
  }

  // Hashtag como canal — ex: #meta, #google
  const hashMatch = message.match(/#(meta|google|instagram|youtube|tiktok)\b/i);
  if (hashMatch && !result.utm_medium) {
    const chan = hashMatch[1].toLowerCase();
    if (chan === 'meta') result.utm_medium = 'cpc';
    else if (chan === 'google') { result.utm_medium = 'cpc'; if (!result.utm_source) result.utm_source = 'google_ads'; }
  }

  // Parâmetros UTM na URL embutidos na mensagem (ex: "?utm_source=google_ads&utm_campaign=X")
  const urlMatch = message.match(/[?&](utm_\w+=[^&\s]+)/g);
  if (urlMatch) {
    const params = new URLSearchParams(urlMatch.map(s => s.replace(/^[?&]/, '')).join('&'));
    for (const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'] as const) {
      const val = params.get(key);
      if (val && !result[key]) result[key] = val;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function kommoPatch(path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      `https://${KOMMO_SUBDOMAIN}.kommo.com${path}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${KOMMO_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          try { resolve(JSON.parse(text)); } catch { resolve({ raw: text, status: res.statusCode }); }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Aplica a tag "meta-ads-ctwa" no lead do Kommo */
export async function applyMetaAdsTag(leadId: number): Promise<void> {
  if (!KOMMO_TOKEN || !leadId) return;
  await kommoPatch(`/api/v4/leads/${leadId}`, {
    _embedded: {
      tags: [{ id: META_ADS_TAG_ID, name: META_ADS_TAG_NAME }],
    },
  });
}

/** Grava UTMs nos campos nativos de tracking do Kommo */
export async function applyUtmFields(leadId: number, utms: UtmData): Promise<void> {
  if (!KOMMO_TOKEN || !leadId) return;

  const custom_fields_values = Object.entries(utms)
    .filter(([, v]) => v)
    .map(([key, value]) => {
      const fieldId = UTM_FIELD_IDS[key as keyof typeof UTM_FIELD_IDS];
      if (!fieldId) return null;
      return { field_id: fieldId, values: [{ value }] };
    })
    .filter(Boolean);

  if (custom_fields_values.length === 0) return;

  await kommoPatch(`/api/v4/leads/${leadId}`, {
    custom_fields_values,
  });
}
