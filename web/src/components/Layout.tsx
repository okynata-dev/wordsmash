import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";
import { WalletButton } from "./WalletButton";
import { SearchBox } from "./SearchBox";
import { ErrorBoundary } from "./ErrorBoundary";
import { activeChain } from "../wagmi";
import { normAddr } from "../lib/format";

const navItems = [
  { to: "/", label: "Claim", end: true },
  { to: "/market", label: "Market" },
  { to: "/top", label: "Top" },
  { to: "/activity", label: "Activity" },
  { to: "/watchlist", label: "Watchlist" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              "rounded-md px-3 py-2 text-sm transition",
              isActive ? "text-fg font-medium" : "text-muted hover:text-fg",
            ].join(" ")
          }
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export function Layout() {
  const { address, isConnected } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close the mobile menu on route change.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Esc + outside-click close for the mobile menu.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  return (
    <div className="flex min-h-full flex-col">
      <header
        ref={menuRef}
        className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur"
      >
        <div className="mx-auto flex max-w-[1120px] items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <span className="font-display text-lg font-semibold tracking-tight">wordsmash</span>
            <span className="hidden rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted lg:inline">
              {activeChain.name}
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <NavLinks />
            {isConnected && address && (
              <NavLink
                to={`/profile/${normAddr(address)}`}
                className={({ isActive }) =>
                  [
                    "rounded-md px-3 py-2 text-sm transition",
                    isActive ? "text-fg font-medium" : "text-muted hover:text-fg",
                  ].join(" ")
                }
              >
                Profile
              </NavLink>
            )}
          </nav>

          {/* Search grows to fill available space. */}
          <div className="hidden min-w-0 flex-1 sm:block sm:max-w-xs">
            <SearchBox />
          </div>

          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <div className="hidden sm:block">
              <WalletButton />
            </div>
            <button
              className="rounded-md p-2 text-muted hover:bg-surface-2 md:hidden"
              aria-label="Menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <div id={menuId} className="border-t border-border px-4 py-2 md:hidden">
            <div className="mb-2 sm:hidden">
              <SearchBox onNavigate={() => setMenuOpen(false)} />
            </div>
            <div className="flex flex-col gap-1">
              <NavLinks onNavigate={() => setMenuOpen(false)} />
              {isConnected && address && (
                <NavLink
                  to={`/profile/${normAddr(address)}`}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-muted hover:text-fg"
                >
                  Profile
                </NavLink>
              )}
              <div className="px-1 py-2">
                <WalletButton />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6">
        {/* Route-level recoverable boundary: keyed on the path so navigating away clears a crash. */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-[1120px] px-4 py-6 text-xs text-faint sm:px-6">
          wordsmash · one word, one owner
        </div>
      </footer>
    </div>
  );
}
