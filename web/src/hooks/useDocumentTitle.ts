import { useEffect } from "react";

const BASE = "wordsmash";

/**
 * Sets `document.title` to "<title> · wordsmash" (or just "wordsmash" when empty),
 * and restores the base title on unmount so a stale per-page title never lingers
 * after navigating away. Improves browser tabs, bookmarks and link previews.
 */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE;
    return () => {
      document.title = BASE;
    };
  }, [title]);
}
