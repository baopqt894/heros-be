import { createHash, randomBytes } from 'node:crypto';

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateDeviceActivationCode() {
  const value = [...randomBytes(20)].map((byte) => alphabet[byte % 32]).join('');
  return `HRS-${value.match(/.{4}/g)!.join('-')}`;
}

export function normalizeDeviceActivationCode(value: string) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  return /^HRS[0-9A-HJKMNP-TV-Z]{20}$/.test(normalized) ? normalized : null;
}

export function deviceActivationHash(normalized: string) {
  return createHash('sha256').update(normalized).digest('hex');
}
