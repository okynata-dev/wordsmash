import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { commentMessage, commentLikeMessage, COMMENT_MAX } from "@shared/social";
import type { Comment } from "@shared/social";
import { api } from "../api";
import { Avatar } from "./Avatar";
import { UserBadge } from "./UserBadge";
import { Button, Card, Spinner, ErrorState } from "./ui";
import { useToast } from "./Toast";
import { friendlyError, timeAgo, shortAddr } from "../lib/format";

function commentsKey(word: string, viewer?: string) {
  return ["comments", word, viewer ?? ""] as const;
}

/**
 * pump.fun-style comment thread for a word: top-level comments with like counts
 * and one level of replies. Anyone can read; connected + whitelisted wallets can
 * post/reply/like (each signed via the shared message builders).
 */
export function Comments({ word, canPost }: { word: string; canPost: boolean }) {
  const qc = useQueryClient();
  const { address } = useAccount();
  const toast = useToast();
  const inputId = useId();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signMessageAsync } = useSignMessage();

  const key = commentsKey(word, address);
  const {
    data: comments,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: key,
    queryFn: () => api.comments(word, address),
    retry: 1,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: key });

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
      await refresh();
      toast.success("Comment posted");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  const total = comments
    ? comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0)
    : null;
  const remaining = COMMENT_MAX - body.length;

  return (
    <section className="mt-12" aria-label="Comments">
      <h2 className="mb-3 text-sm font-medium text-muted">
        Comments {total !== null ? <span className="text-faint">· {total}</span> : null}
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
            <span className={`text-xs ${remaining < 0 ? "text-negative" : "text-faint"}`} aria-live="polite">
              {remaining} left
            </span>
            <Button onClick={submit} disabled={submitting || body.trim() === "" || remaining < 0}>
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
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentItem comment={c} word={word} canPost={canPost} onChanged={refresh} />
              {c.replies && c.replies.length > 0 && (
                <ul className="mt-3 space-y-3 border-l border-border pl-4">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentItem comment={r} word={word} canPost={canPost} onChanged={refresh} reply />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentItem({
  comment: c,
  word,
  canPost,
  onChanged,
  reply = false,
}: {
  comment: Comment;
  word: string;
  canPost: boolean;
  onChanged: () => void;
  reply?: boolean;
}) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const [liking, setLiking] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);

  // Optimistic local like state layered over the server value.
  const [likeDelta, setLikeDelta] = useState(0);
  const [likedOverride, setLikedOverride] = useState<boolean | null>(null);
  const liked = likedOverride ?? Boolean(c.likedByMe);
  const likes = Math.max(0, (c.likes ?? 0) + likeDelta);

  async function toggleLike() {
    if (!address || liking) return;
    setLiking(true);
    const on = !liked;
    setLikedOverride(on);
    setLikeDelta((d) => d + (on ? 1 : -1));
    try {
      const timestamp = Date.now();
      const message = commentLikeMessage(address, String(c.id), on, timestamp);
      const signature = await signMessageAsync({ message });
      await api.likeComment(address, c.id, { on, timestamp, signature });
    } catch (e) {
      // Roll back the optimistic change.
      setLikedOverride(!on);
      setLikeDelta((d) => d - (on ? 1 : -1));
      toast.error(friendlyError(e));
    } finally {
      setLiking(false);
    }
  }

  async function sendReply() {
    const trimmed = replyBody.trim();
    if (!trimmed || !address) return;
    setSending(true);
    try {
      const timestamp = Date.now();
      const message = commentMessage(address, word, trimmed, timestamp);
      const signature = await signMessageAsync({ message });
      await api.postComment(word, { address, body: trimmed, parentId: c.id, timestamp, signature });
      setReplyBody("");
      setReplyOpen(false);
      onChanged();
      toast.success("Reply posted");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex gap-3">
      <Avatar address={c.author} size={reply ? 26 : 32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <UserBadge address={c.author} showAvatar={false} textClassName="font-medium" />
          <span className="text-xs text-faint" title={shortAddr(c.author)}>
            {timeAgo(Math.floor(c.ts / 1000))}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg/90">{c.body}</p>

        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted">
          <button
            onClick={toggleLike}
            disabled={!canPost || liking}
            className={`inline-flex items-center gap-1 transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-60 ${
              liked ? "text-[rgb(var(--c-volt))]" : ""
            }`}
            aria-pressed={liked}
            aria-label={liked ? "Unlike" : "Like"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
            </svg>
            {likes > 0 && <span className="tabular-nums">{likes}</span>}
          </button>
          {canPost && !reply && (
            <button onClick={() => setReplyOpen((o) => !o)} className="transition hover:text-fg">
              Reply
            </button>
          )}
        </div>

        {replyOpen && (
          <div className="mt-2 space-y-2">
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value.slice(0, COMMENT_MAX))}
              rows={2}
              placeholder={`Reply to ${shortAddr(c.author)}…`}
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-fg/40"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReplyOpen(false)} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={sendReply} disabled={sending || replyBody.trim() === ""}>
                {sending ? (
                  <>
                    <Spinner /> Replying…
                  </>
                ) : (
                  "Reply"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
