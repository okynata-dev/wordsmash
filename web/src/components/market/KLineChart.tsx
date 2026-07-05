// Pro trading chart (KLineCharts, Apache-2.0): candles + volume, toggleable
// indicators (MA/EMA/BOLL on the main pane; VOL/MACD/RSI sub-panes), crosshair
// with OHLC tooltip — the pump.fun-class chart, fully open-source. Ships in its
// own lazy chunk; TVChart still upgrades to TradingView Advanced Charts when the
// license-gated library is installed.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { init, dispose, type Chart } from "klinecharts";
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

// Main-pane overlays vs. sub-pane oscillators (VOL is on by default).
const MAIN_INDICATORS = ["MA", "EMA", "BOLL"] as const;
const SUB_INDICATORS = ["MACD", "RSI"] as const;

function weiToNum(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

function toKBar(c: Candle) {
  return {
    timestamp: c.t * 1000,
    open: weiToNum(c.o),
    high: weiToNum(c.h),
    low: weiToNum(c.l),
    close: weiToNum(c.c),
    volume: weiToNum(c.v),
  };
}

function cssRgb(varName: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
    .split(/\s+/)
    .join(",");
  return `rgba(${raw},${alpha})`;
}

/** Theme-token styles for the chart canvas (re-baked when the theme flips). */
function themedStyles() {
  const up = cssRgb("--c-positive");
  const down = cssRgb("--c-negative");
  const grid = cssRgb("--c-border", 0.4);
  const text = cssRgb("--c-faint");
  return {
    grid: {
      horizontal: { color: grid },
      vertical: { color: grid },
    },
    candle: {
      bar: { upColor: up, downColor: down, upBorderColor: up, downBorderColor: down, upWickColor: up, downWickColor: down },
      priceMark: {
        last: { upColor: up, downColor: down },
      },
      tooltip: { text: { color: text } },
    },
    indicator: {
      tooltip: { text: { color: text } },
      bars: [{ upColor: cssRgb("--c-positive", 0.5), downColor: cssRgb("--c-negative", 0.5), noChangeColor: grid }],
    },
    xAxis: { tickText: { color: text }, axisLine: { color: grid } },
    yAxis: { tickText: { color: text }, axisLine: { color: grid } },
    crosshair: {
      horizontal: { line: { color: text }, text: { backgroundColor: cssRgb("--c-fg", 0.8) } },
      vertical: { line: { color: text }, text: { backgroundColor: cssRgb("--c-fg", 0.8) } },
    },
    separator: { color: grid },
  };
}

export default function KLineChart({ word }: { word: string }) {
  const [res, setRes] = useState<number>(300);
  const [mainInd, setMainInd] = useState<string | null>("MA");
  const [subInds, setSubInds] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["chart", word, res],
    queryFn: () => api.candles(word, res),
    retry: 1,
    refetchInterval: 15_000,
  });
  const candles = query.data ?? [];

  return (
    <Card className="fade-up p-3" style={{ animationDelay: "60ms" }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
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
        <div className="flex gap-1" role="group" aria-label="Indicators">
          {MAIN_INDICATORS.map((n) => (
            <button
              key={n}
              onClick={() => setMainInd((cur) => (cur === n ? null : n))}
              className={`rounded-md px-2 py-0.5 text-xs transition ${
                mainInd === n ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {n}
            </button>
          ))}
          <span className="mx-0.5 text-border">·</span>
          {SUB_INDICATORS.map((n) => (
            <button
              key={n}
              onClick={() =>
                setSubInds((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]))
              }
              className={`rounded-md px-2 py-0.5 text-xs transition ${
                subInds.includes(n) ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-[320px] w-full rounded-lg" />
      ) : query.isError ? (
        <div className="grid h-[320px] place-items-center text-sm text-muted">
          Couldn’t load the chart — retrying…
        </div>
      ) : candles.length === 0 ? (
        <div className="grid h-[320px] place-items-center text-sm text-muted">
          No trades yet — the chart starts with the first one.
        </div>
      ) : (
        <Candles key={res} candles={candles} mainInd={mainInd} subInds={subInds} />
      )}
    </Card>
  );
}

function Candles({
  candles,
  mainInd,
  subInds,
}: {
  candles: Candle[];
  mainInd: string | null;
  subInds: string[];
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const mainPaneIndRef = useRef<string | null>(null);
  const subPaneIdsRef = useRef<Map<string, string>>(new Map());

  // Create once per mount (interval switches remount via key).
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = init(el);
    if (!chart) return;
    chartRef.current = chart;
    chart.setPriceVolumePrecision(12, 4);
    chart.setStyles(themedStyles() as never);
    chart.createIndicator("VOL"); // volume sub-pane on by default

    const mo = new MutationObserver(() => chart.setStyles(themedStyles() as never));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      mo.disconnect();
      ro.disconnect();
      chartRef.current = null;
      dispose(el);
    };
  }, []);

  // Data (poll-refreshed by the parent query).
  useEffect(() => {
    chartRef.current?.applyNewData(candles.map(toKBar));
  }, [candles]);

  // Main-pane overlay indicator.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (mainPaneIndRef.current) {
      chart.removeIndicator("candle_pane", mainPaneIndRef.current);
      mainPaneIndRef.current = null;
    }
    if (mainInd) {
      chart.createIndicator(mainInd, true, { id: "candle_pane" });
      mainPaneIndRef.current = mainInd;
    }
  }, [mainInd]);

  // Sub-pane oscillators.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = subPaneIdsRef.current;
    for (const [name, paneId] of [...current]) {
      if (!subInds.includes(name)) {
        chart.removeIndicator(paneId, name);
        current.delete(name);
      }
    }
    for (const name of subInds) {
      if (!current.has(name)) {
        const paneId = chart.createIndicator(name);
        if (paneId) current.set(name, paneId);
      }
    }
  }, [subInds]);

  return <div ref={elRef} className="h-[360px] w-full" />;
}
