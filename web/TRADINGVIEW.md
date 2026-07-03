# Enabling TradingView Advanced Charts

The app ships with a self-contained candle chart (lightweight-charts) and **automatically
upgrades to full TradingView Advanced Charts** — indicators, drawing tools, the pump.fun
look — the moment the license-gated library is present. No code changes needed.

## One-time setup

1. Request access (free): https://www.tradingview.com/advanced-charts/ → **Get the library**.
   Site: `keepney.com`. Approval is usually 1–2 days and grants access to the private
   `tradingview/charting_library` GitHub repo.
2. From that repo, copy the **contents of its `charting_library/` folder** into
   `web/public/charting_library/` here (so `web/public/charting_library/charting_library.js`
   exists). The folder is gitignored — the library must not be committed (license).
3. Rebuild/redeploy the web app. Done: the market pages now render TradingView.

## How the switch works (no config)

`web/src/components/market/TVChart.tsx` HEAD-checks `/charting_library/charting_library.js`.
Present → it boots the TradingView widget fed by `tvDatafeed.ts` (our `/candles` endpoint,
15s live polling, theme-synced). Absent (or 404) → the panel silently falls back to the
lightweight-charts candles. So the repo builds and runs for anyone without the library,
and installing it is the only step to turn the full charts on.
