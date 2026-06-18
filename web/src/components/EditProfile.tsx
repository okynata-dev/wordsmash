import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
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
  throw new Error("Image too large after compression — try a smaller picture.");
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

  const [username, setUsername] = useState(meta.username ?? "");
  const [bio, setBio] = useState(meta.bio ?? "");
  const [twitter, setTwitter] = useState(meta.twitterHandle ?? "");
  const [website, setWebsite] = useState(meta.website ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameError = (() => {
    const u = normalizeUsername(username);
    return validateUsername(u);
  })();

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !connected) return;
    setUploadingAvatar(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const timestamp = Date.now();
      const message = avatarUploadMessage(connected, timestamp);
      const signature = await signMessageAsync({ message });
      await api.uploadAvatar(connected, { dataUrl, timestamp, signature });
      await qc.invalidateQueries({ queryKey: profileKey(address) });
      toast.success("Avatar updated");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setUploadingAvatar(false);
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
        setError("That username is already taken — pick another.");
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

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Username" htmlFor={ids.username} hint="3–20 chars · a–z, 0–9, _">
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

        <Field label="X / Twitter" htmlFor={ids.twitter} hint="handle without @">
          <div className="flex items-center rounded-lg border border-border bg-surface px-3 focus-within:border-fg/40">
            <span className="text-sm text-faint">x.com/</span>
            <input
              id={ids.twitter}
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="handle"
              className="w-full bg-transparent py-2 pl-1 text-sm outline-none"
            />
          </div>
        </Field>

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
