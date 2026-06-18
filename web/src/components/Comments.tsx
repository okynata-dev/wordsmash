import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { commentMessage, COMMENT_MAX } from "@shared/social";
import { api } from "../api";
import { Avatar } from "./Avatar";
import { UserBadge } from "./UserBadge";
import { Button, Card, Spinner, ErrorState } from "./ui";
import { useToast } from "./Toast";
import { friendlyError, timeAgo, shortAddr } from "../lib/format";

function commentsKey(word: string) {
  return ["comments", word] as const;
}

/**
 * pump.fun-style comment thread for a word. Anyone can read; connected + whitelisted
 * wallets can post. Posting signs commentMessage (shared builder) and POSTs.
 */
export function Comments({
  word,
  canPost,
}: {
  word: string;
  /** Whether the connected wallet is allowed to post (connected + whitelisted). */
  canPost: boolean;
}) {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const inputId = useId();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const {
    data: comments,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: commentsKey(word),
    queryFn: () => api.comments(word),
    retry: 1,
  });

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || !address) return;
    setSubmitting(true);
    try {
      const timestamp = Date.now();
      const message = commentMessage(address, word, trimmed, timestamp);
      const signature = await signMessageAsync({ message });
      await api.postComment(word, { address, body: trimmed, timestamp, signature });
      setBody("");
      await qc.invalidateQueries({ queryKey: commentsKey(word) });
      toast.success("Comment posted");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = COMMENT_MAX - body.length;

  return (
    <section className="mt-12" aria-label="Comments">
      <h2 className="mb-3 text-sm font-medium text-muted">
        Comments {comments ? <span className="text-faint">· {comments.length}</span> : null}
      </h2>

      {canPost && (
        <Card className="mb-4 space-y-2 p-3">
          <label htmlFor={inputId} className="sr-only">
            Write a comment
          </label>
          <textarea
            id={inputId}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, COMMENT_MAX))}
            rows={2}
            placeholder="Say something…"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-fg/40"
          />
          <div className="flex items-center justify-between">
            <span
              className={`text-xs ${remaining < 0 ? "text-negative" : "text-faint"}`}
              aria-live="polite"
            >
              {remaining} left
            </span>
            <Button
              onClick={submit}
              disabled={submitting || body.trim() === "" || remaining < 0}
            >
              {submitting ? (
                <>
                  <Spinner /> Posting…
                </>
              ) : (
                "Post"
              )}
            </Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading comments…
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load comments." onRetry={() => void refetch()} />
      ) : !comments || comments.length === 0 ? (
        <Card className="p-5 text-sm text-muted">
          No comments yet. {canPost ? "Be the first to say something." : ""}
        </Card>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar address={c.author} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                  <UserBadge address={c.author} showAvatar={false} textClassName="font-medium" />
                  <span className="text-xs text-faint" title={shortAddr(c.author)}>
                    {timeAgo(Math.floor(c.ts / 1000))}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg/90">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
