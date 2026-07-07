// TradingView Lightweight Charts (Apache-2.0, by TradingView): candlesticks + a
// volume histogram, theme-reactive, fed by our own /candles data. This is the
// genuine TradingView look for a per-word bonding-curve token — no license, no
// vendor folder, no external symbol feed. Ships in its own lazy chunk.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
} from "lightweight-charts";
import type { Candle } from "@shared/types";
import { api } from "../../api";
import { Card, Skeleton } from "../ui";

const INTERVALS = [
  { label: "1m", res: 60 },
  { label: "5m", res: 300 },
  { label: "15m", res: 900 },
  { label: "1h", res: 3_600 },
  { label: "4h", res: 14_400 },
  { label: "1D", res: 86_400 },
] as const;

function weiToNum(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

/** Read a `--c-*` theme token as an rgba() string (tokens are stored as "r g b"). */
function cssRgb(varName: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
    .split(/\s+/)
    .join(",");
  return `rgba(${raw},${alpha})`;
}

export default function TVLightweightChart({ word }: { word: string }) {
  const [res, setRes] = useState<number>(300);
  const query = useQuery({
    queryKey: ["chart", word, res],
    queryFn: () => api.candles(word, res),
    retry: 1,
    refetchInterval: 15_000,
  });
  const candles = query.data ?? [];

  return (
    <Card className="fade-up p-3" style={{ animationDelay: "60ms" }}>
      <div className="mb-2 flex items-center gap-1 px-1" role="radiogroup" aria-label="Candle interval">
        {INTERVALS.map((i) => (
          <button
            key={i.res}
            role="radio"
            aria-checked={res === i.res}
            onClick={() => setRes(i.res)}
            className={`rounded-md px-2 py-0.5 text-xs tabular-nums transition ${
              res === i.res ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <Skeleton className="h-[360px] w-full rounded-lg" />
      ) : query.isError ? (
        <div className="grid h-[360px] place-items-center text-sm text-muted">
          Couldn’t load the chart — retrying…
        </div>
      ) : candles.length === 0 ? (
        <div className="grid h-[360px] place-items-center text-sm text-muted">
          No trades yet — the chart starts with the first one.
        </div>
      ) : (
        <ChartCanvas candles={candles} />
      )}
    </Card>
  );
}

function ChartCanvas({ candles }: { candles: Candle[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // (Re)apply theme tokens — called on mount and whenever the .dark class flips.
  function applyTheme(chart: IChartApi) {
    const text = cssRgb("--c-faint");
    const grid = cssRgb("--c-border", 0.4);
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: text,
        fontSize: 11,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
  }

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const up = cssRgb("--c-positive");
    const down = cssRgb("--c-negative");

    const chart = createChart(el, { autoSize: true, height: 360 });
    chartRef.current = chart;
    applyTheme(chart);

    const price = chart.addCandlestickSeries({
      upColor: up,
      downColor: down,
      borderVisible: false,
      wickUpColor: up,
      wickDownColor: down,
      // Token prices are tiny (wei / 1e18) — quote with fine precision.
      priceFormat: { type: "price", precision: 12, minMove: 0.000000000001 },
    });
    priceRef.current = price;

    // Volume in its own scale, pinned to the bottom ~18% of the pane.
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volRef.current = vol;

    const mo = new MutationObserver(() => applyTheme(chart));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      mo.disconnect();
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volRef.current = null;
    };
  }, []);

  // Data (poll-refreshed by the parent query). Lightweight Charts requires
  // strictly-ascending, unique timestamps — sort + dedupe defensively.
  useEffect(() => {
    const price = priceRef.current;
    const vol = volRef.current;
    if (!price || !vol) return;

    const upVol = cssRgb("--c-positive", 0.5);
    const downVol = cssRgb("--c-negative", 0.5);
    const sorted = [...candles].sort((a, b) => a.t - b.t);
    const seen = new Set<number>();
    const bars: CandlestickData[] = [];
    const vols: HistogramData[] = [];
    for (const c of sorted) {
      if (seen.has(c.t)) continue;
      seen.add(c.t);
      const o = weiToNum(c.o);
      const cl = weiToNum(c.c);
      const t = c.t as UTCTimestamp;
      bars.push({ time: t, open: o, high: weiToNum(c.h), low: weiToNum(c.l), close: cl });
      vols.push({ time: t, value: weiToNum(c.v), color: cl >= o ? upVol : downVol });
    }
    price.setData(bars);
    vol.setData(vols);
  }, [candles]);

  return <div ref={elRef} className="h-[360px] w-full" />;
}
