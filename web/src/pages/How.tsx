import { formatEther } from "viem";
import { Card } from "../components/ui";
import { useClaimFee } from "../hooks/useRegistry";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { WORD_REGISTRY, DEED_MARKETPLACE } from "../config";
import { activeChain } from "../wagmi";

/**
 * The forwardable explainer: the money loop in three steps, then the exact
 * economics and the on-chain receipts. Written for a reviewer (e.g. the Base
 * team) as much as for a new user: every number here is verifiable on-chain.
 */
export function How() {
  useDocumentTitle("How it works");
  const { data: claimFee } = useClaimFee();
  const fee = claimFee !== undefined ? `${formatEther(claimFee)} ETH` : "a small fee";
  const explorer = activeChain.blockExplorers?.default?.url;

  return (
    <div className="mx-auto max-w-[720px]">
      <h1 className="font-display text-3xl font-semibold tracking-tight">How it works</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Keep a word and it instantly gets its own live market. Because you own the word,
        you earn a cut of every trade in it — for as long as you hold it. That&rsquo;s the
        whole loop.
      </p>

      <section className="mt-10 space-y-6">
        <Step n="1" title="Keep a word">
          Type a word. If it&rsquo;s free, it&rsquo;s yours for {fee}. One transaction
          mints its deed (an NFT that proves you own the word) and deploys the
          word&rsquo;s own token market. No setup, no liquidity to provide.
        </Step>

        <Step n="2" title="Its market trades on a curve">
          Each word&rsquo;s token trades on a bonding curve: the price starts near zero
          and moves with demand. No order book, always tradable. When a market reaches
          its graduation threshold, buying freezes while selling stays open, so no one
          is ever locked in. DEX migration for graduated markets is on the roadmap.
        </Step>

        <Step n="3" title="The deed earns on every trade">
          Every buy and sell pays a 1% fee, split three ways: 0.4% to the deed holder,
          0.5% to the protocol, 0.1% retained in the curve as liquidity. Hold the deed
          of a busy word and you earn on every single trade. Deeds themselves can be
          listed and resold on the marketplace (a 10% marketplace fee comes out of the
          sale price), so the earning right has a price too.
        </Step>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Under the hood
        </h2>
        <Card className="mt-3 divide-y divide-border text-sm">
          <Row k="Network">
            {activeChain.name}
            {activeChain.testnet ? " (testnet, no real funds)" : ""}
          </Row>
          <Row k="Word registry">
            <AddrLink addr={WORD_REGISTRY} explorer={explorer} />
          </Row>
          <Row k="Deed marketplace">
            <AddrLink addr={DEED_MARKETPLACE} explorer={explorer} />
          </Row>
          <Row k="Trade fee">1% per trade: 0.4% deed holder / 0.5% protocol / 0.1% liquidity</Row>
          <Row k="Deed sale fee">10% of the sale price, deducted from the seller&rsquo;s proceeds</Row>
          <Row k="Keep fee">{fee}, set on-chain and readable by anyone</Row>
        </Card>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          The curve&rsquo;s solvency is covered by fuzzed invariant tests, and there is
          no admin path to user funds in a market. A professional security audit comes
          before any mainnet deployment. Experimental software: token prices can move
          fast and go to zero.
        </p>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
        style={{ backgroundColor: "rgb(var(--c-volt))" }}
      >
        {n}
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

function AddrLink({ addr, explorer }: { addr?: string; explorer?: string }) {
  if (!addr) return <span className="text-faint">not deployed</span>;
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  if (!explorer) return <span className="font-mono text-xs">{short}</span>;
  return (
    <a
      href={`${explorer}/address/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs underline decoration-border underline-offset-2 hover:text-fg"
    >
      {short} ↗
    </a>
  );
}
