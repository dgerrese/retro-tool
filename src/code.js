const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VALID = /^[0-9A-HJKMNP-TV-Z]{16}$/;

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b & 31];
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

export function normalizeCode(input) {
  const raw = String(input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[OIL]/g, (c) => (c === 'O' ? '0' : '1'));
  if (!VALID.test(raw)) return null;
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}
