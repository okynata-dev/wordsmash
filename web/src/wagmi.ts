import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";
import {
  ANVIL_CHAIN_ID,
  ANVIL_RPC,
  BASE_SEPOLIA_RPC,
  USE_ANVIL,
  WALLETCONNECT_PROJECT_ID,
} from "./config";

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

const connectors = [
  injected(),
  // walletConnect only when a project id is supplied (HUMAN TASK to provide one).
  ...(WALLETCONNECT_PROJECT_ID
    ? [
        walletConnect({
          projectId: WALLETCONNECT_PROJECT_ID,
          showQrModal: true,
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: USE_ANVIL ? [anvil] : [baseSepolia],
  connectors,
  transports: {
    [anvil.id]: http(ANVIL_RPC),
    [baseSepolia.id]: http(BASE_SEPOLIA_RPC),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
