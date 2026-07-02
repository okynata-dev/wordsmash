import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Word } from "./pages/Word";
import { Profile } from "./pages/Profile";
import { Market } from "./pages/Market";
import { Top } from "./pages/Top";
import { Activity } from "./pages/Activity";
import { Watchlist } from "./pages/Watchlist";
import { Legal } from "./pages/Legal";
import { How } from "./pages/How";
import { UserRoute } from "./pages/UserRoute";
import { AddressGate } from "./components/AddressGate";
import { ADDRESSES_READY } from "./config";

export function App() {
  // The prod pre-launch landing is handled in main.tsx (before the web3
  // providers load); here, !ADDRESSES_READY only happens in dev → show the
  // AddressGate with env instructions.
  return (
    <Routes>
      <Route element={<Layout />}>
        {ADDRESSES_READY ? (
          <>
            <Route index element={<Home />} />
            <Route path="word/:word" element={<Word />} />
            <Route path="profile/:address" element={<Profile />} />
            <Route path="u/:username" element={<UserRoute />} />
            <Route path="market" element={<Market />} />
            <Route path="top" element={<Top />} />
            <Route path="activity" element={<Activity />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="how" element={<How />} />
            <Route path="legal" element={<Legal />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="*" element={<AddressGate />} />
        )}
      </Route>
    </Routes>
  );
}
