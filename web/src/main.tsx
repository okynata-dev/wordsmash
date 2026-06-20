import React from "react";
import ReactDOM from "react-dom/client";
import { ComingSoon } from "./components/ComingSoon";
import { ADDRESSES_READY } from "./config";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Pre-launch (deployed before contracts are wired): render the static landing
// directly, with NO web3 providers — so the coming-soon page ships a tiny
// bundle. The full app (wagmi/viem/walletconnect + routes) is dynamically
// imported only when it's actually needed (dev, or prod with contracts set).
if (import.meta.env.PROD && !ADDRESSES_READY) {
  root.render(
    <React.StrictMode>
      <ComingSoon />
    </React.StrictMode>,
  );
} else {
  void import("./AppRoot").then(({ AppRoot }) => root.render(<AppRoot />));
}
