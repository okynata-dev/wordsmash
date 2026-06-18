// Central runtime config, read from import.meta.env with clear fallbacks.
// See web/.env.example for the operator-supplied values.

import type { Address } from "viem";

function env(key: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[key];
  return v && v.length > 0 ? v : undefined;
}

function bool(key: string): boolean {
  const v = env(key);
  return v === "1" || v === "true" || v === "yes";
}

function asAddress(v: string | undefined): Address | undefined {
  if (!v) return undefined;
  return /^0x[a-fA-F0-9]{40}$/.test(v) ? (v as Address) : undefined;
}

export const API_URL = env("VITE_API_URL") ?? "http://localhost:8787";

export const WORD_REGISTRY = asAddress(env("VITE_WORD_REGISTRY"));
export const DEED_MARKETPLACE = asAddress(env("VITE_DEED_MARKETPLACE"));

export const WALLETCONNECT_PROJECT_ID = env("VITE_WALLETCONNECT_PROJECT_ID") ?? "";

// VITE_USE_ANVIL=1 selects the local anvil chain; otherwise Base Sepolia.
export const USE_ANVIL = bool("VITE_USE_ANVIL");

export const ANVIL_RPC = env("VITE_ANVIL_RPC") ?? "http://localhost:8545";
export const BASE_SEPOLIA_RPC = env("VITE_BASE_SEPOLIA_RPC") ?? "https://sepolia.base.org";

// True only when both contract addresses are present and valid.
export const ADDRESSES_READY = Boolean(WORD_REGISTRY && DEED_MARKETPLACE);

export const ANVIL_CHAIN_ID = 31337;
