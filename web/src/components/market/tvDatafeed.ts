// TradingView Advanced Charts datafeed (JS API) backed by our /candles endpoint.
// Loaded only by TVChart, which itself only activates when the (license-gated,
// self-hosted) charting_library bundle is present in /public/charting_library.
import { api } from "../../api";
import type { Candle } from "@shared/types";

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

const RES_TO_SECONDS: Record<string, number> = {
  "1": 60,
  "5": 300,
  "15": 900,
  "60": 3_600,
  "240": 14_400,
  "1D": 86_400,
  D: 86_400,
};
const SUPPORTED = ["1", "5", "15", "60", "240", "1D"];

function weiToNum(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

function toBar(c: Candle): Bar {
  return {
    time: c.t * 1000,
    open: weiToNum(c.o),
    high: weiToNum(c.h),
    low: weiToNum(c.l),
    close: weiToNum(c.c),
    volume: weiToNum(c.v),
  };
}

/** One datafeed per word. Prices sit around 1e-9 ETH, hence the deep pricescale. */
export function makeDatafeed(word: string, symbol: string | null | undefined) {
  const subs = new Map<string, number>(); // subscriberUID -> interval id

  return {
    onReady(cb: (cfg: unknown) => void) {
      setTimeout(() => cb({ supported_resolutions: SUPPORTED, supports_marks: false }), 0);
    },

    searchSymbols() {
      /* single-symbol chart — no search */
    },

    resolveSymbol(_name: string, onResolve: (info: unknown) => void) {
      setTimeout(
        () =>
          onResolve({
            name: symbol ? `$${symbol}` : word,
            ticker: word,
            description: `${word} · keepney`,
            type: "crypto",
            session: "24x7",
            timezone: "Etc/UTC",
            exchange: "keepney",
            listed_exchange: "keepney",
            format: "price",
            minmov: 1,
            pricescale: 10 ** 13, // curve prices ~1e-9 ETH need deep decimals
            has_intraday: true,
            has_seconds: false,
            supported_resolutions: SUPPORTED,
            volume_precision: 6,
            data_status: "streaming",
          }),
        0,
      );
    },

    async getBars(
      _info: unknown,
      resolution: string,
      period: { from: number; to: number; firstDataRequest: boolean },
      onResult: (bars: Bar[], meta: { noData: boolean }) => void,
      onError: (e: string) => void,
    ) {
      try {
        const res = RES_TO_SECONDS[resolution] ?? 300;
        const candles = await api.candles(word, res);
        const bars = candles
          .map(toBar)
          .filter((b) => b.time / 1000 >= period.from && b.time / 1000 <= period.to);
        // On the first request return everything we have — a young market's history
        // is short and TV renders it fine; noData stops further paging.
        if (period.firstDataRequest && bars.length === 0 && candles.length > 0) {
          onResult(candles.map(toBar), { noData: false });
          return;
        }
        onResult(bars, { noData: bars.length === 0 });
      } catch (e) {
        onError(String(e));
      }
    },

    subscribeBars(
      _info: unknown,
      resolution: string,
      onTick: (bar: Bar) => void,
      subscriberUID: string,
    ) {
      const res = RES_TO_SECONDS[resolution] ?? 300;
      const id = window.setInterval(async () => {
        try {
          const candles = await api.candles(word, res);
          if (candles.length > 0) onTick(toBar(candles[candles.length - 1]));
        } catch {
          /* transient — next poll retries */
        }
      }, 15_000);
      subs.set(subscriberUID, id);
    },

    unsubscribeBars(subscriberUID: string) {
      const id = subs.get(subscriberUID);
      if (id !== undefined) {
        window.clearInterval(id);
        subs.delete(subscriberUID);
      }
    },
  };
}
