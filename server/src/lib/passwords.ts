import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// OWASP-recommended scrypt parameters (N=2^15 ≈ 64 MiB would be ideal but
// N=2^14, r=8 keeps login latency reasonable on small hosts).
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');
  const actual = scryptSync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return timingSafeEqual(actual, expected);
}
