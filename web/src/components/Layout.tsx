import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";
import { WalletButton } from "./WalletButton";
import { SearchBox } from "./SearchBox";
import { WelcomeModal } from "./WelcomeModal";
import { ErrorBoundary } from "./ErrorBoundary";
import { activeChain } from "../wagmi";
import { normAddr } from "../lib/format";
import { storedTheme, applyTheme, type Theme } from "../theme";

// ── icons (inline, 18px stroke; logo is a filled white book) ───────────────────
type IconProps = { className?: string };
const ICON = "h-[18px] w-[18px] shrink-0";
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

function HomeIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}
function MarketIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M4 4h2l2 12h10l2-8H7" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </svg>
  );
}
function TopIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M10 13.5V17h4v-3.5M9 21h6M12 17v4" />
    </svg>
  );
}
function ActivityIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M3 12h4l2-7 4 14 2-7h4" />
    </svg>
  );
}
function StatsIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M4 20V10M10 20V4M16 20v-6M21 20H3" />
    </svg>
  );
}
function WatchIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  );
}
function UserIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  );
}
function PlusIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function MenuIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function SunIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon({ className = "" }: IconProps) {
  return (
    <svg {...stroke} className={`${ICON} ${className}`}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/** Light/dark switch — light is the default; the choice persists per device.
    Icon-only in the sidebar footer; `labeled` for the roomier mobile menu. */
function ThemeToggle({ labeled = false }: { labeled?: boolean }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  // Two instances exist (sidebar + mobile menu). Track the <html> class so a
  // toggle in one never leaves the other showing a stale icon.
  useEffect(() => {
    const mo = new MutationObserver(() =>
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light"),
    );
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }
  const dark = theme === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  const icon = dark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />;
  if (labeled) {
    return (
      <button
        onClick={toggle}
        className="flex w-fit items-center gap-2 text-xs text-faint transition hover:text-fg"
        aria-label={label}
      >
        {icon}
        {dark ? "Light mode" : "Dark mode"}
      </button>
    );
  }
  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      className="-m-1.5 rounded-md p-1.5 text-faint transition hover:bg-surface-2 hover:text-fg"
    >
      {icon}
    </button>
  );
}

/** Quiet network status — a colored dot beats a shouting uppercase chip. */
function NetworkStatus() {
  const testnet = Boolean(activeChain.testnet);
  return (
    <span className="flex items-center gap-1.5 text-faint">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${testnet ? "bg-warning" : "bg-positive"}`}
        aria-hidden="true"
      />
      {activeChain.name}
      {testnet && " · testnet"}
    </span>
  );
}

/**
 * The wordmark. The book lives on a blue gradient tile (app-icon style) — a fixed
 * tile aligns optically with the text where a bare glyph never quite did, and it
 * carries the brand blue so the wordmark itself stays one clean color.
 */
function Logo() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2">
      <span
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] text-white"
        style={{
          background: "linear-gradient(135deg, #5b8cff 0%, rgb(var(--c-volt)) 100%)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.25), 0 1px 2px rgb(0 0 255 / 0.25)",
        }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <path d="M11.25 4.533A9.7 9.7 0 0 0 6 3a9.7 9.7 0 0 0-3.25.555.75.75 0 0 0-.5.707v13.5a.75.75 0 0 0 1 .707A8.2 8.2 0 0 1 6 18c1.99 0 3.82.706 5.25 1.885V4.533ZM12.75 19.885A8.2 8.2 0 0 1 18 18c.96 0 1.89.165 2.75.47a.75.75 0 0 0 1-.708v-13.5a.75.75 0 0 0-.5-.707A9.7 9.7 0 0 0 18 3a9.7 9.7 0 0 0-5.25 1.533v15.352Z" />
        </svg>
      </span>
      <span className="font-display text-[17px] font-semibold leading-none tracking-tight">
        keepney
      </span>
    </Link>
  );
}

const navItems = [
  { to: "/", label: "Home", end: true, Icon: HomeIcon },
  { to: "/market", label: "Market", Icon: MarketIcon },
  { to: "/top", label: "Top", Icon: TopIcon },
  { to: "/activity", label: "Activity", Icon: ActivityIcon },
  { to: "/stats", label: "Stats", Icon: StatsIcon },
  { to: "/watchlist", label: "Watchlist", Icon: WatchIcon },
];

function NavRow({
  to,
  end,
  label,
  Icon,
  onNavigate,
}: {
  to: string;
  end?: boolean;
  label: string;
  Icon: (p: IconProps) => JSX.Element;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition",
          isActive
            ? "bg-surface-2 font-medium text-fg"
            : "text-muted hover:bg-surface-2 hover:text-fg",
        ].join(" ")
      }
    >
      <Icon />
      {label}
    </NavLink>
  );
}

/** Soft-blue "Create" CTA — the front door to claiming (owning) a word. */
function CreateButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/"
      onClick={onNavigate}
      className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.99]"
      style={{ backgroundColor: "rgb(var(--c-volt))" }}
    >
      <PlusIcon className="h-4 w-4" />
      Create
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { address, isConnected } = useAccount();
  return (
    <>
      <CreateButton onNavigate={onNavigate} />
      <nav className="mt-3 flex flex-col gap-0.5">
        {navItems.map((item) => (
          <NavRow key={item.to} {...item} onNavigate={onNavigate} />
        ))}
        {isConnected && address && (
          <NavRow
            to={`/profile/${normAddr(address)}`}
            label="Profile"
            Icon={UserIcon}
            onNavigate={onNavigate}
          />
        )}
      </nav>
    </>
  );
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const barRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  // Lock background scroll while the mobile menu is open (it's an overlay, so the
  // page underneath must not scroll behind it). The scroll container here is the
  // documentElement (<html>), not <body> — locking body alone doesn't hold.
  useEffect(() => {
    if (!menuOpen) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = prev;
    };
  }, [menuOpen]);

  // The overlay is md:hidden — if the viewport crosses into desktop while the menu
  // is open, close it so the scroll lock doesn't linger on an invisible menu.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    function onChange() {
      if (mq.matches) setMenuOpen(false);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="flex min-h-full">
      {/* ── Left sidebar (desktop) ── */}
      <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-border px-3 py-4 md:flex">
        <div className="px-2">
          <Logo />
        </div>
        <div className="mt-6 flex flex-col">
          <SidebarNav />
        </div>
        <div className="mt-auto px-2">
          <div className="flex flex-col gap-2.5 border-t border-border pt-4 text-xs">
            <nav aria-label="Secondary" className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 text-muted">
                <Link to="/how" className="hover:text-fg">
                  How it works
                </Link>
                <Link to="/legal" className="hover:text-fg">
                  Terms
                </Link>
              </div>
              <ThemeToggle />
            </nav>
            <NetworkStatus />
          </div>
        </div>
      </aside>

      {/* ── Content column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          ref={barRef}
          className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur"
        >
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            {/* mobile: logo + menu */}
            <div className="md:hidden">
              <Logo />
            </div>
            <div className="hidden min-w-0 flex-1 sm:block sm:max-w-md">
              <SearchBox />
            </div>
            <div className="ml-auto flex items-center gap-2">
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
                <MenuIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {menuOpen && (
            // Overlay (absolute, out of flow) so opening the menu never pushes the
            // page content down. top-full hangs it right below the bar.
            <div
              id={menuId}
              className="absolute inset-x-0 top-full z-40 max-h-[85vh] overflow-y-auto border-b border-border bg-bg px-4 py-3 shadow-lg md:hidden"
            >
              <div className="mb-3 sm:hidden">
                <SearchBox onNavigate={() => setMenuOpen(false)} />
              </div>
              <div className="flex flex-col gap-2">
                <SidebarNav onNavigate={() => setMenuOpen(false)} />
                <div className="pt-1">
                  <WalletButton />
                </div>
                <div className="mt-1 flex flex-col gap-2.5 border-t border-border px-1 pb-2 pt-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-muted">
                      <Link to="/how" onClick={() => setMenuOpen(false)} className="hover:text-fg">
                        How it works
                      </Link>
                      <Link to="/legal" onClick={() => setMenuOpen(false)} className="hover:text-fg">
                        Terms
                      </Link>
                    </div>
                    <ThemeToggle />
                  </div>
                  <NetworkStatus />
                </div>
              </div>
            </div>
          )}
        </header>

        {/* Dimmed backdrop behind the mobile menu (below the header's z-30 so the bar
            and menu stay above it); tap to close. */}
        {menuOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            aria-hidden
            onClick={() => setMenuOpen(false)}
          />
        )}

        <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 pt-8 pb-24 sm:px-6 md:pb-8">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Hidden while the menu overlay is open: the tab bar would otherwise paint
          above the menu's bottom rows (both z-40, nav is a later sibling). */}
      {!menuOpen && <BottomNav />}
      <WelcomeModal />
    </div>
  );
}

/** Mobile bottom tab bar — the primary nav on phones (sidebar is desktop-only). */
function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-bg/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {navItems.map(({ to, end, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            [
              "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition",
              isActive ? "text-[rgb(var(--c-volt))]" : "text-muted",
            ].join(" ")
          }
        >
          <Icon className="h-[22px] w-[22px]" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
