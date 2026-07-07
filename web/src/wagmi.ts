import { createConfig, http } from "wagmi";
import { createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { ANVIL_CHAIN_ID, ANVIL_RPC, BASE_SEPOLIA_RPC, USE_ANVIL, PRIVY_ENABLED } from "./config";

// Local anvil chain for dev (id 31337).
export const anvil = defineChain({
  id: ANVIL_CHAIN_ID,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ANVIL_RPC] },
    public: { http: [ANVIL_RPC] },
  },
  testnet: true,
});

// The chain this build targets (one active chain at a time, chosen by env flag).
export const activeChain = USE_ANVIL ? anvil : baseSepolia;

const chains = USE_ANVIL ? ([anvil] as const) : ([baseSepolia] as const);
const transports = {
  [anvil.id]: http(ANVIL_RPC),
  [baseSepolia.id]: http(BASE_SEPOLIA_RPC),
};

// With Privy enabled, Privy owns the connectors (injected + embedded wallet) and
// syncs the active wallet into wagmi — so we build the config via Privy's createConfig
// (no connectors of our own). Without an app id we fall back to the injected-only
// stack. WalletConnect stays out of the bundle either way (its Web3Modal graph is
// ~420kB); re-add it later via a dynamic import + VITE_WALLETCONNECT_PROJECT_ID.
export const wagmiConfig = PRIVY_ENABLED
  ? createPrivyConfig({ chains, transports })
  : createConfig({ chains, connectors: [injected()], transports });

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
