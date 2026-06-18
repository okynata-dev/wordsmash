/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WORD_REGISTRY?: string;
  readonly VITE_DEED_MARKETPLACE?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_USE_ANVIL?: string;
  readonly VITE_ANVIL_RPC?: string;
  readonly VITE_BASE_SEPOLIA_RPC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
