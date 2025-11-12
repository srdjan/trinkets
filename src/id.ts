const ALPH = "abcdefghijklmnopqrstuvwxyz234567";
function toBase32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}
export async function newIssueId(
  seed: string,
  existing: Set<string>,
): Promise<string> {
  const data = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const base = toBase32(new Uint8Array(digest));
  for (let len = 4; len <= 8; len++) {
    const id = `bd-${base.slice(0, len)}`;
    if (!existing.has(id)) return id;
  }
  return `bd-${base.slice(0, 8)}${Date.now().toString(36).slice(-2)}`;
}
