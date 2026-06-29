import https from 'https';

const KOMMO_TOKEN = process.env.KOMMO_TOKEN ?? '';
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN ?? 'danilomatsunaga';

// ID da tag "meta-ads-ctwa" no Kommo (Dr. Danilo)
const META_ADS_TAG_ID = 3143080;
const META_ADS_TAG_NAME = 'meta-ads-ctwa';

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
