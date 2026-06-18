import { describe, it, expect } from "vitest";
import { normalizeWord, wordToTokenId } from "../src/index.js";
import vectorsJson from "../fixtures/normalization-vectors.json" assert { type: "json" };
import { keccak256, toBytes } from "viem";

const vectors = (vectorsJson as { vectors: Array<{ input: string; valid: boolean; normalized: string }> })
  .vectors;

describe("normalizeWord — fixture parity with Solidity", () => {
  for (const v of vectors) {
    it(`${JSON.stringify(v.input)} -> ${v.valid ? v.normalized : "INVALID"}`, () => {
      const r = normalizeWord(v.input);
      expect(r.ok).toBe(v.valid);
      if (v.valid) expect(r.normalized).toBe(v.normalized);
    });
  }
});

describe("collision correctness", () => {
  it("case + whitespace variants collide on the same tokenId", () => {
    const ids = ["bread", "BREAD", "Bread", "  bread "].map((w) => wordToTokenId(w));
    expect(new Set(ids.map(String)).size).toBe(1);
    expect(ids[0]).toBe(BigInt(keccak256(toBytes("bread"))));
  });

  it("distinct words do not collide", () => {
    expect(wordToTokenId("bread")).not.toBe(wordToTokenId("brhead"));
    expect(wordToTokenId("8read")).not.toBe(wordToTokenId("bread"));
  });

  it("invalid words have no tokenId", () => {
    expect(wordToTokenId("br ead")).toBeNull();
    expect(wordToTokenId("café")).toBeNull();
  });
});
