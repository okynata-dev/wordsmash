// Full TradingView Advanced Charts (indicators + drawing tools, pump.fun-style).
// The library is license-gated and self-hosted: this component boots it only when
// /charting_library/charting_library.js is actually present, and otherwise renders
// our lightweight-charts fallback — so the app works with or without the library,
// and dropping the vendor folder in flips it on with zero further changes.
import { useEffect, useRef, useState } from "react";
import { makeDatafeed } from "./tvDatafeed";

const LIB_SRC = "/charting_library/charting_library.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global {
  interface Window {
    TradingView?: any;
    Datafeeds?: any;
    __tvLoad?: Promise<boolean>;
  }
}

/** Load the library script once, resolving false if it isn't installed. */
function loadLibrary(): Promise<boolean> {
  if (window.TradingView?.widget) return Promise.resolve(true);
  if (window.__tvLoad) return window.__tvLoad;
  window.__tvLoad = new Promise<boolean>((resolve) => {
    // HEAD first so a 404 (library not installed) fails fast without a script error.
    fetch(LIB_SRC, { method: "HEAD" })
      .then((r) => {
        if (!r.ok) return resolve(false);
        const s = document.createElement("script");
        s.src = LIB_SRC;
        s.async = true;
        s.onload = () => resolve(Boolean(window.TradingView?.widget));
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      })
      .catch(() => resolve(false));
  });
  return window.__tvLoad;
}

export function TVChart({
  word,
  symbol,
  onUnavailable,
}: {
  word: string;
  symbol?: string | null;
  /** Called when the library isn't installed, so the parent can show the fallback. */
  onUnavailable: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let widget: { remove?: () => void } | null = null;
    let cancelled = false;

    loadLibrary().then((ok) => {
      if (cancelled) return;
      if (!ok || !containerRef.current) {
        setFailed(true);
        onUnavailable();
        return;
      }
      const dark = document.documentElement.classList.contains("dark");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      widget = new (window.TradingView as any).widget({
        container: containerRef.current,
        datafeed: makeDatafeed(word, symbol),
        symbol: word,
        interval: "5",
        library_path: "/charting_library/",
        locale: "en",
        autosize: true,
        theme: dark ? "Dark" : "Light",
        timezone: "Etc/UTC",
        disabled_features: ["header_symbol_search", "symbol_search_hot_key", "header_compare"],
        enabled_features: ["hide_left_toolbar_by_default"],
        custom_css_url: "/charting_library/keepney.css",
        overrides: {
          "paneProperties.background": dark ? "#09090b" : "#ffffff",
          "paneProperties.backgroundType": "solid",
        },
      });
    });

    return () => {
      cancelled = true;
      try {
        widget?.remove?.();
      } catch {
        /* widget may not have mounted */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  if (failed) return null; // parent shows the fallback
  return <div ref={containerRef} className="h-[360px] w-full" />;
}
