// Closed-beta whitelist proof lookup.
// proofs.json maps lowercased address -> { proof: string[] }.
import proofsData from "@shared-root/whitelist/proofs.json";
import type { Address } from "viem";

interface ProofsFile {
  root: string;
  proofs: Record<string, { proof: string[] }>;
}

const data = proofsData as ProofsFile;

export const whitelistRoot = data.root;

/** Returns the Merkle proof for an address, or null if it isn't on the allowlist. */
export function proofFor(address?: Address | null): `0x${string}`[] | null {
  if (!address) return null;
  const entry = data.proofs[address.toLowerCase()];
  if (!entry) return null;
  return entry.proof as `0x${string}`[];
}
