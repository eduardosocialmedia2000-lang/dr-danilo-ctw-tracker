import https from 'https';
import { hashPhone } from './crypto';

export interface LeadSubmittedParams {
  ctwaClid: string;
  phone: string;
  dataset: string;
  pageId: string;
  timestamp: number;
  testEventCode?: string;
}

interface CapiPayload {
  data: CapiEvent[];
  test_event_code?: string;
}

interface CapiEvent {
  action_source: string;
  event_name: string;
  event_time: number;
  messaging_channel: string;
  user_data: {
    ph: string;
    ctwa_clid: string;
    page_id: string;
  };
}

function httpsPost(url: string, body: string, accessToken: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${accessToken}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve({ raw: text });
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function sendLeadSubmitted(
  params: LeadSubmittedParams,
  accessToken: string,
  apiVersion = 'v24.0'
): Promise<unknown> {
  const event: CapiEvent = {
    action_source: 'business_messaging',
    event_name: 'LeadSubmitted',
    event_time: params.timestamp,
    messaging_channel: 'whatsapp',
    user_data: {
      ph: hashPhone(params.phone),
      ctwa_clid: params.ctwaClid,
      page_id: params.pageId,
    },
  };

  const payload: CapiPayload = { data: [event] };
  if (params.testEventCode) {
    payload.test_event_code = params.testEventCode;
  }

  const url = `https://graph.facebook.com/${apiVersion}/${params.dataset}/events`;
  const body = JSON.stringify(payload);

  return httpsPost(url, body, accessToken);
}

export interface PurchaseParams {
  ctwaClid: string;
  phone: string;
  dataset: string;
  pageId: string;
  value: number;
  currency: string;
  timestamp: number;
  testEventCode?: string;
}

export async function sendPurchase(
  params: PurchaseParams,
  accessToken: string,
  apiVersion = 'v24.0'
): Promise<unknown> {
  const event: CapiEvent & { value?: number; currency?: string } = {
    action_source: 'business_messaging',
    event_name: 'Purchase',
    event_time: params.timestamp,
    messaging_channel: 'whatsapp',
    user_data: {
      ph: hashPhone(params.phone),
      ctwa_clid: params.ctwaClid,
      page_id: params.pageId,
    },
    value: params.value,
    currency: params.currency,
  };

  const payload: CapiPayload = { data: [event] };
  if (params.testEventCode) {
    payload.test_event_code = params.testEventCode;
  }

  const url = `https://graph.facebook.com/${apiVersion}/${params.dataset}/events`;
  return httpsPost(url, JSON.stringify(payload), accessToken);
}
