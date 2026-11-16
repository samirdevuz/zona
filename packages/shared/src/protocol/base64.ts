/** Environment-free base64 (no atob/Buffer) for the binary parts of the map blob. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s[len - 1] === '=') len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = LOOKUP[s.charCodeAt(i)]!;
    const b = LOOKUP[s.charCodeAt(i + 1)]!;
    const c = i + 2 < len ? LOOKUP[s.charCodeAt(i + 2)]! : 0;
    const d = i + 3 < len ? LOOKUP[s.charCodeAt(i + 3)]! : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Int16 array to little-endian base64. */
export function int16ToBase64(a: Int16Array): string {
  const bytes = new Uint8Array(a.length * 2);
  for (let i = 0; i < a.length; i++) {
    const v = a[i]! & 0xffff;
    bytes[i * 2] = v & 255;
    bytes[i * 2 + 1] = v >> 8;
  }
  return bytesToBase64(bytes);
}

export function base64ToInt16(s: string): Int16Array {
  const bytes = base64ToBytes(s);
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
    out[i] = v >= 0x8000 ? v - 0x10000 : v;
  }
  return out;
}
