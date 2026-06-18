import type { Page } from "@playwright/test";

// Default anvil accounts (public dev keys; addresses only needed here — anvil holds the keys).
export const ACCOUNTS = {
  acc0: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  acc1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  acc2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  acc3: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
} as const;

/**
 * Inject a minimal EIP-1193 provider as window.ethereum BEFORE the app loads.
 * It forwards every JSON-RPC call to the local anvil node. Because anvil's dev accounts
 * are unlocked, eth_sendTransaction is signed by the node — so wagmi's injected connector
 * can drive real on-chain writes in a headless browser with no extension.
 */
export async function injectWallet(page: Page, account: string, rpc = "http://localhost:8545") {
  await page.addInitScript(
    ({ account, rpc }) => {
      const CHAIN_ID = "0x7a69"; // 31337
      const listeners: Record<string, Array<(arg: unknown) => void>> = {};
      async function rpcCall(method: string, params: unknown[]) {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        });
        const out = await res.json();
        if (out.error) throw Object.assign(new Error(out.error.message), { code: out.error.code });
        return out.result;
      }
      const provider = {
        isMetaMask: true,
        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [account];
            case "eth_chainId":
              return CHAIN_ID;
            case "net_version":
              return "31337";
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            default:
              return rpcCall(method, params);
          }
        },
        on(event: string, cb: (arg: unknown) => void) {
          (listeners[event] ||= []).push(cb);
          return provider;
        },
        removeListener() {
          return provider;
        },
      };
      (window as unknown as { ethereum: unknown }).ethereum = provider;
    },
    { account, rpc },
  );
}
