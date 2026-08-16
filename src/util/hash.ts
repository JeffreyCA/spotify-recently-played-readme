/**
 * Non-cryptographic 64-bit-ish hash (two interleaved FNV-1a lanes) used only for
 * ETag generation. crypto.subtle would work but is async and costs CPU time we
 * would rather spend elsewhere; ETags need to be stable and well-distributed,
 * not collision-proof against an adversary.
 */
export function weakHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const a = (h1 >>> 0).toString(36);
  const b = (h2 >>> 0).toString(36);
  return `${a}${b}`;
}
