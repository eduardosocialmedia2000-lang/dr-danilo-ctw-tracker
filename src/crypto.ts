import { createHash } from 'crypto';
import { normalizePhone } from './extractCTW';

export function hashPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  return createHash('sha256').update(normalized).digest('hex');
}
