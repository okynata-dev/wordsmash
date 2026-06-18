import { useEffect, useRef, useState } from "react";

/**
 * Animate a number from its previous value up (or down) to `target` over
 * `durationMs`, using requestAnimationFrame and an ease-out curve. Re-runs
 * whenever `target` changes, so it ticks up live as a query refetches.
 *
 * Respects prefers-reduced-motion: snaps straight to the value, no animation.
 * Returns `null` while the target is undefined so callers can render a placeholder.
 */
export function useCountUp(target: number | undefined, durationMs = 700): number | null {
  const [value, setValue] = useState<number | null>(target ?? null);
  const fromRef = useRef<number>(target ?? 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === undefined) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const from = fromRef.current;
    const to = target;

    if (reduce || from === to) {
      fromRef.current = to;
      setValue(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setValue(to);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // Remember where we landed so the next target animates from here.
      fromRef.current = to;
    };
  }, [target, durationMs]);

  return value;
}
