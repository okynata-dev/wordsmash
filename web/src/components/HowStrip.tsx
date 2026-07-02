import { Link } from "react-router-dom";

const STEPS = [
  { n: "1", t: "Keep a word", d: "One tap mints its deed." },
  { n: "2", t: "Its market goes live", d: "Every word ships with its own token." },
  { n: "3", t: "You earn on every trade", d: "0.4% of all volume goes to the deed holder." },
];

/** The money loop in one glance, right under the hero. Links to the full page. */
export function HowStrip() {
  return (
    <section className="mb-10" aria-label="How it works">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                style={{ backgroundColor: "rgb(var(--c-volt))" }}
              >
                {s.n}
              </span>
              <h3 className="text-sm font-semibold tracking-tight">{s.t}</h3>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug text-muted">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right">
        <Link to="/how" className="text-xs text-muted transition hover:text-fg">
          How it works →
        </Link>
      </div>
    </section>
  );
}
