/** Alphabet without characters that are easily confused (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomChars(length: number): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => ALPHABET[v % ALPHABET.length]).join('');
}

/** Client-side id for images and other transient objects. */
export function clientId(prefix = 'img'): string {
  return `${prefix}-${randomChars(10)}`;
}

/** A family-friendly reference code, for example MPMB-7Q4K-2AH. */
export function referenceCode(): string {
  return `MPMB-${randomChars(4)}-${randomChars(3)}`;
}
