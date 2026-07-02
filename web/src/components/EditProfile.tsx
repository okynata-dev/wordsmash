import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useSignMessage } from "wagmi";
import { PRIVY_ENABLED } from "../config";
import {
  profileUpdateMessage,
  avatarUploadMessage,
  normalizeUsername,
  validateUsername,
  sanitizeBio,
  normalizeTwitter,
  normalizeWebsite,
  BIO_MAX,
} from "@shared/social";
import type { ProfileMeta } from "@shared/social";
import { api } from "../api";
import { Avatar } from "./Avatar";
import { Button, Card, Spinner } from "./ui";
import { useToast } from "./Toast";
import { friendlyError } from "../lib/format";
import { profileKey } from "../hooks/useProfile";

const AVATAR_MAX_BYTES = 200 * 1024;

/** Read an image File, downscale to <= 256px, and JPEG-encode under AVATAR_MAX_BYTES. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 256;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  // Step quality down until under the byte budget.
  for (let q = 0.9; q >= 0.4; q -= 0.1) {
    const url = canvas.toDataURL("image/jpeg", q);
    // base64 length * 3/4 ≈ byte size.
    const bytes = Math.ceil((url.length - url.indexOf(",") - 1) * 0.75);
    if (bytes <= AVATAR_MAX_BYTES) return url;
  }
  throw new Error("Image too large after compression. Try a smaller picture.");
}

/** Quick-pick avatars: a gradient + a glyph, so a fresh (email/social) account can
    grab a fun picture without uploading a file. Each renders to a JPEG data URL and
    goes through the same signed upload as a file. */
const AVATAR_PRESETS: { from: string; to: string; glyph: string }[] = [
  { from: "#0000FF", to: "#5b8cff", glyph: "📖" },
  { from: "#ff5e5e", to: "#ffb199", glyph: "🔥" },
  { from: "#8a2be2", to: "#ff6ad5", glyph: "🦄" },
  { from: "#11998e", to: "#38ef7d", glyph: "🍀" },
  { from: "#f7971e", to: "#ffd200", glyph: "👑" },
  { from: "#1f2937", to: "#4b5563", glyph: "💎" },
  { from: "#ff0080", to: "#7928ca", glyph: "⚡" },
  { from: "#2193b0", to: "#6dd5ed", glyph: "🌙" },
];

function presetAvatarDataUrl(p: { from: string; to: string; glyph: string }): string {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, p.from);
  g.addColorStop(1, p.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.font = "150px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.glyph, size / 2, size / 2 + 12);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function EditProfile({
  address,
  meta,
  onClose,
}: {
  address: string;
  meta: ProfileMeta;
  onClose: () => void;
}) {
  const { address: connected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const ids = {
    username: useId(),
    bio: useId(),
    twitter: useId(),
    website: useId(),
  };

  // Connect X (linkTwitter) is a full-page redirect: any unsaved fields would be
  // lost. They're stashed in sessionStorage right before the redirect and restored
  // (once) here when the user comes back.
  const draftKey = `keepney.profileDraft.${address.toLowerCase()}`;
  const [draft] = useState(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return null;
      sessionStorage.removeItem(draftKey);
      return JSON.parse(raw) as { username?: string; bio?: string; website?: string };
    } catch {
      return null;
    }
  });

  const [username, setUsername] = useState(draft?.username ?? meta.username ?? "");
  const [bio, setBio] = useState(draft?.bio ?? meta.bio ?? "");
  const [twitter, setTwitter] = useState(meta.twitterHandle ?? "");
  const [website, setWebsite] = useState(draft?.website ?? meta.website ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [presetBusy, setPresetBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usernameError = (() => {
    const u = normalizeUsername(username);
    return validateUsername(u);
  })();

  // Sign + upload a ready data URL (shared by file upload and preset picks).
  async function commitAvatar(dataUrl: string) {
    if (!connected) return;
    const timestamp = Date.now();
    const message = avatarUploadMessage(connected, timestamp);
    const signature = await signMessageAsync({ message });
    await api.uploadAvatar(connected, { dataUrl, timestamp, signature });
    await qc.invalidateQueries({ queryKey: profileKey(address) });
    toast.success("Avatar updated");
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !connected) return;
    setUploadingAvatar(true);
    try {
      await commitAvatar(await fileToAvatarDataUrl(file));
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function onPickPreset(i: number) {
    if (!connected || uploadingAvatar) return;
    setPresetBusy(i);
    setUploadingAvatar(true);
    try {
      await commitAvatar(presetAvatarDataUrl(AVATAR_PRESETS[i]));
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setUploadingAvatar(false);
      setPresetBusy(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!connected) return;
    if (usernameError) {
      setError(usernameError);
      return;
    }
    const payload = {
      username: normalizeUsername(username),
      bio: sanitizeBio(bio),
      twitterHandle: normalizeTwitter(twitter),
      website: normalizeWebsite(website),
    };
    setSaving(true);
    try {
      const timestamp = Date.now();
      const message = profileUpdateMessage(connected, payload, timestamp);
      const signature = await signMessageAsync({ message });
      await api.updateProfile(connected, { ...payload, timestamp, signature });
      await qc.invalidateQueries({ queryKey: profileKey(address) });
      toast.success("Profile updated");
      onClose();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        setError("That username is already taken. Pick another.");
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Edit profile</h2>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-muted hover:text-fg"
          aria-label="Close edit profile"
        >
          Cancel
        </button>
      </div>

      <div className="flex items-center gap-4">
        <Avatar address={address} size={64} />
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Upload avatar image"
            onChange={onPickAvatar}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploadingAvatar}
          >
            {uploadingAvatar ? (
              <>
                <Spinner /> Uploading…
              </>
            ) : (
              "Change avatar"
            )}
          </Button>
          <p className="mt-1 text-xs text-faint">PNG/JPG, downscaled automatically.</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted">Or pick one</p>
        <div className="flex flex-wrap gap-2">
          {AVATAR_PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPickPreset(i)}
              disabled={uploadingAvatar}
              aria-label={`Use ${p.glyph} avatar`}
              className="grid h-10 w-10 place-items-center rounded-full text-lg shadow-sm ring-1 ring-border transition hover:scale-105 hover:ring-[rgb(var(--c-volt))] disabled:opacity-50"
              style={{ backgroundImage: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
            >
              {presetBusy === i ? <Spinner /> : p.glyph}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Username" htmlFor={ids.username} hint="3-20 chars, a-z, 0-9, _">
          <div className="flex items-center rounded-lg border border-border bg-surface px-3 focus-within:border-fg/40">
            <span className="text-sm text-faint">@</span>
            <input
              id={ids.username}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="username"
              className="w-full bg-transparent py-2 pl-1 text-sm outline-none"
            />
          </div>
          {username.trim() !== "" && usernameError && (
            <p className="text-xs text-negative">{usernameError}</p>
          )}
        </Field>

        <Field label="Bio" htmlFor={ids.bio}>
          <textarea
            id={ids.bio}
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            rows={3}
            placeholder="A short bio"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-fg/40"
          />
          <p className="text-right text-xs text-faint" aria-live="polite">
            {BIO_MAX - bio.length} left
          </p>
        </Field>

        <TwitterField
          htmlFor={ids.twitter}
          value={twitter}
          onChange={setTwitter}
          onBeforeLink={() => {
            try {
              sessionStorage.setItem(draftKey, JSON.stringify({ username, bio, website }));
            } catch {
              /* private mode etc. — worst case the fields are lost, as before */
            }
          }}
        />

        <Field label="Website" htmlFor={ids.website}>
          <input
            id={ids.website}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://example.com"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-fg/40"
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || Boolean(usernameError)}>
            {saving ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function XGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

/** X / Twitter field: a verified Privy connect when available, else a free-text handle. */
function TwitterField({
  htmlFor,
  value,
  onChange,
  onBeforeLink,
}: {
  htmlFor: string;
  value: string;
  onChange: (v: string) => void;
  onBeforeLink?: () => void;
}) {
  if (PRIVY_ENABLED)
    return <TwitterConnect value={value} onChange={onChange} onBeforeLink={onBeforeLink} />;
  return (
    <Field label="X / Twitter" htmlFor={htmlFor} hint="handle without @">
      <div className="flex items-center rounded-lg border border-border bg-surface px-3 focus-within:border-fg/40">
        <span className="text-sm text-faint">x.com/</span>
        <input
          id={htmlFor}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="handle"
          className="w-full bg-transparent py-2 pl-1 text-sm outline-none"
        />
      </div>
    </Field>
  );
}

/** Connect the real X account via Privy OAuth — the handle can't be typed/faked,
    it comes from the verified link. Save persists it to the profile. */
function TwitterConnect({
  value,
  onChange,
  onBeforeLink,
}: {
  value: string;
  onChange: (v: string) => void;
  onBeforeLink?: () => void;
}) {
  const { user, linkTwitter, unlinkTwitter } = usePrivy();
  const toast = useToast();
  const linked = user?.twitter?.username ?? null;
  const subject = user?.twitter?.subject ?? null;

  // Once connected, lock the saved handle to the verified username.
  useEffect(() => {
    if (linked && linked !== value) onChange(linked);
  }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">X / Twitter</span>
        <span className="text-xs text-faint">verified by connecting</span>
      </div>
      {linked ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className="text-positive" aria-label="Verified">
              ✓
            </span>
            x.com/{linked}
          </span>
          <button
            type="button"
            onClick={async () => {
              if (!subject) return;
              try {
                await unlinkTwitter(subject);
                onChange("");
              } catch (e) {
                // Privy refuses to unlink a user's only login method — say so.
                toast.error(friendlyError(e));
              }
            }}
            className="text-xs text-muted hover:text-fg"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            onBeforeLink?.(); // full-page redirect follows — stash unsaved fields
            linkTwitter();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium transition hover:border-[rgb(var(--c-volt))]"
        >
          <XGlyph /> Connect X
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
