export * from "./normalize.js";
export * from "./types.js";
export * from "./social.js";
export * as abis from "./abis.js";

import { keccak256, toBytes, encodePacked } from "viem";
import { normalizeWord } from "./normalize.js";

/**
 * tokenId for a word = uint256(keccak256(normalizedWord)).
 * Returns null if the word is not valid under canonical normalization.
 */
export function wordToTokenId(input: string): bigint | null {
  const { ok, normalized } = normalizeWord(input);
  if (!ok) return null;
  return BigInt(keccak256(toBytes(normalized)));
}

/** Merkle leaf for the whitelist = keccak256(abi.encodePacked(address)). Matches the contract. */
export function whitelistLeaf(address: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(["address"], [address]));
}
