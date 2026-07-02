import { Button } from "./ui";
import { shareUrl } from "../api";
import { useToast } from "./Toast";

/**
 * Growth flywheel: share a word.
 * - Mobile: Web Share API (navigator.share).
 * - Desktop: open a tweet intent; the URL points at the indexer /share/:word page
 *   which carries OG meta so it unfurls with an image.
 * - Fallback: copy link to clipboard.
 */
export function ShareButton({
  word,
  label = "Share",
  variant = "outline",
}: {
  word: string;
  label?: string;
  variant?: "primary" | "outline" | "ghost";
}) {
  const toast = useToast();
  const url = shareUrl(word);
  const text = `I kept "${word}" on keepney — it has its own token now.`;

  async function onShare() {
    // Prefer the native share sheet on supporting (mobile) browsers.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: `keepney: ${word}`, text, url });
        return;
      } catch {
        // user cancelled or unsupported payload -> fall through
      }
    }

    // Desktop: tweet intent.
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      text,
    )}&url=${encodeURIComponent(url)}`;
    const win = window.open(intent, "_blank", "noopener,noreferrer");
    if (win) return;

    // Last resort: copy link.
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Couldn't share. Copy the URL manually.");
    }
  }

  return (
    <Button variant={variant} onClick={onShare}>
      {label}
    </Button>
  );
}
