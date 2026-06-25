import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { ANVIL_CHAIN_ID, ANVIL_RPC, BASE_SEPOLIA_RPC, USE_ANVIL } from "./config";

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

// Injected-only (MetaMask/Coinbase/Rabby/etc.). WalletConnect is intentionally NOT
// statically imported — its Web3Modal graph is ~420kB and ships even when disabled.
// To re-enable mobile/QR later: set VITE_WALLETCONNECT_PROJECT_ID and add the connector
// via a dynamic `import("wagmi/connectors")` so the heavy code only loads when used.
const connectors = [injected()];

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
