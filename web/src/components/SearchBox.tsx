import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Avatar } from "./Avatar";
import { Spinner } from "./ui";
import { shortAddr, normAddr } from "../lib/format";

type Item =
  | { kind: "word"; word: string }
  | { kind: "user"; address: string; username: string | null };

/**
 * Debounced search with a keyboard-accessible results dropdown.
 * Combobox pattern: input + aria-controls listbox, arrow keys to move, Enter to go,
 * Esc to close. Words and users both surfaced; click/Enter navigates.
 */
export function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced.toLowerCase()],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 1,
    retry: 0,
    staleTime: 10_000,
  });

  const words = Array.isArray(data?.words) ? data!.words : [];
  const users = Array.isArray(data?.users) ? data!.users : [];
  const items: Item[] = [
    ...words.map((w) => ({ kind: "word", word: w.word }) as const),
    ...users.map((u) => ({ kind: "user", address: u.address, username: u.username }) as const),
  ];

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => setActive(-1), [debounced]);

  function go(item: Item) {
    if (item.kind === "word") navigate(`/word/${encodeURIComponent(item.word)}`);
    else navigate(`/profile/${normAddr(item.address)}`);
    setOpen(false);
    setQ("");
    onNavigate?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (active >= 0 && items[active]) {
        e.preventDefault();
        go(items[active]);
      }
    }
  }

  const showDropdown = open && debounced.length >= 1;

  return (
    <div ref={rootRef} className="relative w-full">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search words and users
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-fg/40">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-faint"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          id={`${listId}-input`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search words or users"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
        {isFetching && <Spinner className="text-faint" />}
      </div>

      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {items.length === 0 && !isFetching ? (
            <li className="px-3 py-2 text-sm text-muted">No matches.</li>
          ) : (
            items.map((item, i) => (
              <li
                key={item.kind === "word" ? `w-${item.word}` : `u-${item.address}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={active === i}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(item);
                }}
                className={[
                  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm",
                  active === i ? "bg-surface-2" : "",
                ].join(" ")}
              >
                {item.kind === "word" ? (
                  <>
                    <span className="text-faint">#</span>
                    <span className="word-display text-base">{item.word}</span>
                  </>
                ) : (
                  <>
                    <Avatar address={item.address} size={22} />
                    <span className="truncate">
                      {item.username ? `@${item.username}` : shortAddr(item.address)}
                    </span>
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
