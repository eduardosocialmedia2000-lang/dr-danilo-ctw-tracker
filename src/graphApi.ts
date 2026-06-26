import https from 'https';

export interface DatasetAndPage {
  dataset: string;
  pageId: string;
}

function findDatasetAndPage(obj: unknown): DatasetAndPage | null {
  if (!obj || typeof obj !== 'object') return null;

  let dataset: string | null = null;
  let pageId: string | null = null;

  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach(traverse);
      return;
    }

    const o = node as Record<string, unknown>;

    // dataset pode aparecer como "dataset" ou "fb_pixel" (campo real da API)
    const datasetRaw = o.dataset ?? o.fb_pixel;
    if (datasetRaw && !dataset) {
      if (Array.isArray(datasetRaw) && datasetRaw.length > 0) {
        dataset = String(datasetRaw[0]);
      } else if (typeof datasetRaw === 'string') {
        dataset = datasetRaw;
      }
    }

    // page_id aparece como "page" ou "post.wall"
    const pageRaw = o.page ?? o['post.wall'];
    if (pageRaw && !pageId) {
      if (Array.isArray(pageRaw) && pageRaw.length > 0) {
        pageId = String(pageRaw[0]);
      } else if (typeof pageRaw === 'string') {
        pageId = pageRaw;
      }
    }

    Object.values(o).forEach(traverse);
  }

  traverse(obj);

  if (dataset && pageId) return { dataset, pageId };
  return null;
}

function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error('Graph API: resposta não é JSON válido'));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

export async function getDatasetAndPage(
  sourceId: string,
  accessToken: string,
  apiVersion = 'v24.0'
): Promise<DatasetAndPage> {
  const url =
    `https://graph.facebook.com/${apiVersion}/${sourceId}` +
    `?fields=tracking_specs&access_token=${encodeURIComponent(accessToken)}`;

  const data = await httpsGet(url);

  const result = findDatasetAndPage(data);
  if (!result) {
    throw new Error(
      `Graph API: não foi possível extrair dataset/page_id para sourceId=${sourceId}. ` +
        `Resposta: ${JSON.stringify(data)}`
    );
  }

  return result;
}
