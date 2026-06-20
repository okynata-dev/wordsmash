import React from "react";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./wagmi";
import { ToastProvider } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

/**
 * The full application shell — wagmi/query/router providers + routes. Loaded via
 * a dynamic import() from main.tsx so the pre-launch coming-soon landing ships
 * with zero web3 dependencies (wagmi/viem/walletconnect stay in this chunk).
 */
export function AppRoot() {
  return (
    <React.StrictMode>
      <ErrorBoundary>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ToastProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
