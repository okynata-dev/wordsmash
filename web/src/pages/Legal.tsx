import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/**
 * Terms & risk — a single, intentional legal surface (not scattered small-print).
 * Plain-language risk disclosure appropriate for an experimental, testnet launchpad.
 * NB (operator): have counsel review and finalize before any mainnet / real-funds launch.
 */
const SECTIONS: { h: string; body: string }[] = [
  {
    h: "Experimental software, provided “as is”",
    body:
      "Keepney is experimental, unaudited-by-third-parties software offered without warranty of any kind. It may contain bugs, fail, or behave unexpectedly. You use it entirely at your own risk.",
  },
  {
    h: "This is a testnet",
    body:
      "Keepney currently runs on the Base Sepolia test network. Test tokens and test ETH have no monetary value and are for evaluation only. Nothing here is a live financial product.",
  },
  {
    h: "Not financial advice",
    body:
      "Nothing on Keepney is investment, financial, legal, or tax advice, nor an offer or solicitation to buy or sell any asset. Do your own research and consult a qualified professional before making decisions.",
  },
  {
    h: "Risk of total loss",
    body:
      "Digital assets are highly volatile. The price of a word’s token can move sharply and can go to zero. On a future mainnet you could lose some or all of the value you put in. Never commit more than you can afford to lose.",
  },
  {
    h: "Smart-contract risk",
    body:
      "The contracts are immutable code on a public blockchain. Despite testing, code can contain vulnerabilities. A professional audit is planned before mainnet; until then, treat every interaction as experimental.",
  },
  {
    h: "Non-custodial. You control your keys",
    body:
      "Keepney never holds your funds or private keys. You alone are responsible for your wallet and its security. On-chain transactions are final and cannot be reversed, cancelled, or refunded by anyone.",
  },
  {
    h: "Words & ownership",
    body:
      "Claiming a word mints an on-chain deed (an NFT) recording on-chain ownership of that string. It does not grant trademark, copyright, or any real-world or legal right to the word. Reserved, infringing, or unlawful words may be restricted.",
  },
  {
    h: "Eligibility",
    body:
      "By using Keepney you confirm you are at least 18, that doing so is legal where you live, and that you are not a sanctioned person or located in a restricted jurisdiction.",
  },
  {
    h: "Privacy",
    body:
      "Blockchain activity (addresses, claims, trades) is inherently public and permanent. If you join a waitlist you provide a contact handle voluntarily; we use it only to reach you about Keepney.",
  },
  {
    h: "Changes",
    body:
      "These terms may be updated as the product evolves. Continued use after a change means you accept the updated terms.",
  },
];

export function Legal() {
  useDocumentTitle("Terms & risk");
  return (
    <div className="mx-auto max-w-[680px]">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Terms &amp; risk</h1>
      <p className="mt-2 text-sm text-muted">Read this before you claim or trade.</p>

      <div className="mt-8 space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="font-display text-base font-medium">{s.h}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
          </section>
        ))}
      </div>

      <p className="mt-10 border-t border-border pt-5 text-xs text-faint">
        By using Keepney you acknowledge you have read and understood the above. This page is a
        good-faith risk disclosure, not legal advice.{" "}
        <Link to="/" className="underline hover:text-fg">
          Back to Keepney
        </Link>
      </p>
    </div>
  );
}
