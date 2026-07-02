import React, { type ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig, activeChain } from "./wagmi";
import { PRIVY_APP_ID, PRIVY_ENABLED } from "./config";
import { ToastProvider } from "./components/Toast";
import { ConnectModalProvider } from "./components/ConnectModal";
import { WalletPanelProvider } from "./components/WalletPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

// Privy modal theming — dark, the brand volt-blue accent, the book logo.
const privyConfig: PrivyClientConfig = {
  appearance: {
    theme: "dark",
    accentColor: "#0000FF",
    logo: "https://keepney.com/icon-192.png",
    walletChainType: "ethereum-only",
  },
  // Email / Google / X first, then external wallets — pump-style ordering. The
  // dashboard is the source of truth for which are enabled; this just sets order.
  loginMethods: ["email", "google", "twitter", "wallet"],
  // A user who signs in with email/Google (no wallet) gets one created for them,
  // so they can claim a word immediately. showWalletUIs:false signs/sends silently
  // for the embedded wallet — our own UI is the confirmation (e.g. the Send review
  // step), and the off-chain profile signatures are free, so a popup each time is
  // just friction. External wallets (MetaMask) still show their own prompt.
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" },
    showWalletUIs: false,
  },
  defaultChain: activeChain,
  supportedChains: [activeChain],
};

/** Toast + connect-modal + router + app — shared by both provider stacks. */
function Inner() {
  return (
    <ToastProvider>
      <ConnectModalProvider>
        {/* App-level so the panel never renders inside the sticky header (its
            backdrop-filter would clip the fixed overlay) and survives menu closes. */}
        <WalletPanelProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletPanelProvider>
      </ConnectModalProvider>
    </ToastProvider>
  );
}

/** Privy stack: PrivyProvider → Query → Privy's WagmiProvider (keeps wagmi in sync). */
function PrivyStack({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>{children}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

/** Fallback stack (no Privy app id): the original injected-only wagmi setup.
    reconnectOnMount=false so a page load never probes the injected wallet. */
function PlainStack({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * The full application shell. Loaded via a dynamic import() from main.tsx so the
 * pre-launch coming-soon landing ships with zero web3/Privy dependencies.
 */
export function AppRoot() {
  const Stack = PRIVY_ENABLED ? PrivyStack : PlainStack;
  return (
    <React.StrictMode>
      <ErrorBoundary>
        <Stack>
          <Inner />
        </Stack>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
