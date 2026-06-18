// Contract wiring: ABIs (from shared), resolved addresses, and the small
// keccak helpers (re-implemented from shared/src/index.ts because that barrel
// uses .js import specifiers that don't resolve under the bundler alias).

import { keccak256, toBytes, encodePacked, type Address } from "viem";
import { wordRegistryAbi, deedMarketplaceAbi } from "@shared/abis";
import { normalizeWord } from "@shared/normalize";
import { WORD_REGISTRY, DEED_MARKETPLACE } from "./config";

export { wordRegistryAbi, deedMarketplaceAbi };

export const registryAddress = WORD_REGISTRY as Address;
export const marketplaceAddress = DEED_MARKETPLACE as Address;

/** tokenId for a word = uint256(keccak256(normalizedWord)). Null if invalid. */
export function wordToTokenId(input: string): bigint | null {
  const { ok, normalized } = normalizeWord(input);
  if (!ok) return null;
  return BigInt(keccak256(toBytes(normalized)));
}

/** Merkle leaf for the whitelist = keccak256(abi.encodePacked(address)). */
export function whitelistLeaf(address: Address): `0x${string}` {
  return keccak256(encodePacked(["address"], [address]));
}
