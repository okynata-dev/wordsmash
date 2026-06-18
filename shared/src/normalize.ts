// Canonical word normalization for wordsmash v1.
//
// This MUST stay byte-identical to contracts/src/libraries/WordNormalizer.sol.
// Both are exercised against the same fixture (shared/fixtures/normalization-vectors.json)
// to prove identical canonical output. If you change one, change the other and the fixture.
//
// v1 canonical form:
//   - trim surrounding ASCII whitespace (space, tab, LF, CR)
//   - lowercase ASCII A-Z -> a-z
//   - allow ONLY [a-z0-9] in the body (internal whitespace / punctuation rejected)
//   - length 1..30 after trimming
//   - any non-ASCII byte is rejected, which deliberately blocks Unicode homoglyphs.

export const MAX_WORD_LEN = 30;

export interface NormalizeResult {
  ok: boolean;
  normalized: string;
  reason: string;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

export function normalizeWord(input: string): NormalizeResult {
  if (typeof input !== "string") return { ok: false, normalized: "", reason: "empty" };

  // Operate on bytes, not code points, so behavior matches the Solidity byte loop exactly.
  const bytes = Array.from(new TextEncoder().encode(input));

  let start = 0;
  let end = bytes.length;
  while (start < end && isAsciiWhitespace(bytes[start])) start++;
  while (end > start && isAsciiWhitespace(bytes[end - 1])) end--;

  const n = end - start;
  if (n === 0) return { ok: false, normalized: "", reason: "empty" };
  if (n > MAX_WORD_LEN) return { ok: false, normalized: "", reason: `max ${MAX_WORD_LEN} chars` };

  const out: number[] = [];
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if (c >= 0x41 && c <= 0x5a) {
      out.push(c + 32); // A-Z -> a-z
    } else if ((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) {
      out.push(c); // a-z or 0-9
    } else {
      return { ok: false, normalized: "", reason: "only a-z and 0-9 allowed" };
    }
  }
  return { ok: true, normalized: String.fromCharCode(...out), reason: "" };
}

/** Uppercase ASCII version of an already-normalized word (used for the $TICKER display). */
export function toTicker(normalized: string): string {
  return normalized.toUpperCase();
}
