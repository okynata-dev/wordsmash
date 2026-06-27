import { useEffect } from "react";

const BASE = "Keepney";

/**
 * Sets `document.title` to "<title> · Keepney" (or just "Keepney" when empty),
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
