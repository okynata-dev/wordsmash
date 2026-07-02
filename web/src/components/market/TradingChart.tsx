// The real trading chart — candles + volume via lightweight-charts (TradingView's
// OSS engine). Loaded as a SEPARATE CHUNK (React.lazy in WordMarketPanel) so the
// library never weighs down the main bundle. Colors come from the theme tokens
// and follow the light/dark toggle live.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
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

/** wei string -> ETH as a plain number (display only — precision loss is fine). */
function weiToNum(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

/** Axis/crosshair price labels — curve prices live around 1e-9 ETH. */
function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.001) return v.toFixed(5);
  return v.toExponential(2);
}

/** Theme token -> canvas-safe rgba() (canvas needs concrete colors, not vars). */
function cssColor(varName: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
    .split(/\s+/)
    .join(",");
  return `rgba(${raw},${alpha})`;
}

function readColors() {
  return {
    text: cssColor("--c-faint"),
    grid: cssColor("--c-border", 0.5),
    up: cssColor("--c-positive"),
    down: cssColor("--c-negative"),
    upSoft: cssColor("--c-positive", 0.35),
    downSoft: cssColor("--c-negative", 0.35),
  };
}

export default function TradingChart({ word }: { word: string }) {
  const [res, setRes] = useState<number>(300);
  const query = useQuery({
    // Prefixed by ["chart", word] so the existing post-trade sync invalidation
    // (TradeBox) refreshes candles too; the poll covers other people's trades.
    queryKey: ["chart", word, res],
    queryFn: () => api.candles(word, res),
    retry: 1,
    refetchInterval: 15_000,
  });
  const candles = query.data ?? [];

  return (
    <Card className="fade-up p-3" style={{ animationDelay: "60ms" }}>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted">Price</span>
        <div role="radiogroup" aria-label="Candle interval" className="flex gap-1">
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
      </div>
      {query.isLoading ? (
        <Skeleton className="h-[280px] w-full rounded-lg" />
      ) : candles.length === 0 ? (
        <div className="grid h-[280px] place-items-center text-sm text-muted">
          No trades yet — the chart starts with the first one.
        </div>
      ) : (
        // Keyed by interval: switching remounts and re-fits the visible range.
        <Candles key={res} candles={candles} />
      )}
    </Card>
  );
}

function Candles({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const dataRef = useRef<Candle[]>(candles);
  const fittedRef = useRef(false);
  dataRef.current = candles;

  function setData(price: ISeriesApi<"Candlestick">, vol: ISeriesApi<"Histogram">) {
    const colors = readColors();
    const rows = dataRef.current;
    price.setData(
      rows.map((c) => ({
        time: c.t as UTCTimestamp,
        open: weiToNum(c.o),
        high: weiToNum(c.h),
        low: weiToNum(c.l),
        close: weiToNum(c.c),
      })),
    );
    vol.setData(
      rows.map((c) => ({
        time: c.t as UTCTimestamp,
        value: weiToNum(c.v),
        color: weiToNum(c.c) >= weiToNum(c.o) ? colors.upSoft : colors.downSoft,
      })),
    );
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const colors = readColors();
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: colors.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: fmtPrice },
    });
    const price = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderVisible: false,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceFormat: { type: "custom", formatter: fmtPrice, minMove: 1e-12 },
    });
    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", // overlay scale — no second axis
      priceFormat: { type: "custom", formatter: fmtPrice, minMove: 1e-12 },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    priceRef.current = price;
    volRef.current = vol;

    // Follow the light/dark toggle live (canvas colors are baked, not CSS vars).
    const mo = new MutationObserver(() => {
      const c = readColors();
      chart.applyOptions({
        layout: { textColor: c.text },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      });
      price.applyOptions({
        upColor: c.up,
        downColor: c.down,
        wickUpColor: c.up,
        wickDownColor: c.down,
      });
      setData(price, vol); // re-bake per-bar volume colors
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      mo.disconnect();
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const price = priceRef.current;
    const vol = volRef.current;
    const chart = chartRef.current;
    if (!price || !vol || !chart) return;
    setData(price, vol);
    // Fit once on first data; later refreshes must not yank the user's zoom.
    // autoSize measures the container async — fit again next frame so the very
    // first fit isn't computed against a zero/stale width (candles would end up
    // squeezed at the right edge).
    if (!fittedRef.current) {
      fittedRef.current = true;
      chart.timeScale().fitContent();
      requestAnimationFrame(() => chartRef.current?.timeScale().fitContent());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  return <div ref={containerRef} className="h-[280px] w-full" />;
}
