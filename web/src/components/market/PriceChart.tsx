import { useId, useMemo } from "react";
import type { PricePoint } from "@shared/types";
import { ethLabel, toWei, timeAgo } from "../../lib/format";

/**
 * Hand-rolled SVG area/line chart of a token's price history. No chart lib — it's
 * a single path over a normalized viewBox, on-brand with the monochrome aesthetic.
 *
 * Degenerate inputs are handled deliberately: 0 points -> a quiet empty note;
 * 1 point (or an all-equal series) -> a flat baseline so a brand-new market still
 * reads as "trading at the seed price" rather than rendering nothing.
 */
export function PriceChart({
  points,
  height = 120,
  className = "",
}: {
  points: PricePoint[];
  height?: number;
  className?: string;
}) {
  const gradId = useId();

  const model = useMemo(() => {
    const W = 600;
    const H = height;
    const padY = 8;
    const clean = points
      .map((p) => ({ ts: p.ts, v: toWei(p.priceWei) ?? 0n }))
      .filter((p) => p.ts > 0);

    if (clean.length === 0) return null;

    // Work in numbers for layout only (geometry, never money display).
    const vals = clean.map((p) => Number(p.v));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1; // flat series -> avoid /0, render a baseline

    const n = clean.length;
    const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v: number) =>
      // higher price -> nearer the top; flat series sits mid-height
      max === min ? H / 2 : padY + (1 - (v - min) / span) * (H - padY * 2);

    const linePts = vals.map((v, i) => `${x(i)},${y(v)}`);
    const linePath =
      n === 1
        ? `M0,${y(vals[0])} L${W},${y(vals[0])}` // single point -> flat line
        : `M${linePts.join(" L")}`;
    const areaPath =
      n === 1
        ? `M0,${y(vals[0])} L${W},${y(vals[0])} L${W},${H} L0,${H} Z`
        : `M${linePts.join(" L")} L${W},${H} L0,${H} Z`;

    const first = clean[0];
    const last = clean[clean.length - 1];
    const up = last.v >= first.v;

    return { W, H, linePath, areaPath, up, first, last };
  }, [points, height]);

  if (!model) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-border bg-surface text-xs text-muted ${className}`}
        style={{ height }}
      >
        No price history yet.
      </div>
    );
  }

  const stroke = model.up ? "rgb(var(--c-positive))" : "rgb(var(--c-negative))";

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${model.W} ${model.H}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`Price history from ${ethLabel(model.first.v)} to ${ethLabel(model.last.v)}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={model.areaPath} fill={`url(#${gradId})`} />
        <path
          d={model.linePath}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 flex items-center justify-between text-[11px] text-faint">
        <span>{timeAgo(model.first.ts)}</span>
        <span>now</span>
      </figcaption>
    </figure>
  );
}
