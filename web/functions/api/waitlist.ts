// Cloudflare Pages Function — same-origin waitlist API (GET count, POST signup).
// Bound to the WAITLIST_DB D1 (see web/wrangler.toml). Written without
// @cloudflare/workers-types so it bundles cleanly; esbuild strips the annotations.

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** Same normalization as the claim flow: a–z0–9, max 30. */
function normalizeWord(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function count(db: any): Promise<number> {
  try {
    const row = await db.prepare("SELECT COUNT(*) AS c FROM signups").first();
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

// GET /api/waitlist -> { count } (social proof)
export async function onRequestGet(context: any): Promise<Response> {
  return json({ count: await count(context.env.WAITLIST_DB) });
}

// POST /api/waitlist { word, contact? } -> { ok, count }
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const db = env.WAITLIST_DB;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  const word = normalizeWord(body.word);
  if (!word) return json({ error: "invalid word" }, 400);

  let contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 120) : "";
  // Keep only plausible email / @handle; otherwise drop it (still record the word).
  const looksEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact);
  const looksHandle = /^@?[a-zA-Z0-9_]{1,30}$/.test(contact);
  if (contact && !looksEmail && !looksHandle) contact = "";

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = ip ? await sha256Hex(ip) : "";

  // Light abuse guard: cap signups per IP so the table can't be flooded.
  if (ipHash) {
    try {
      const r = await db
        .prepare("SELECT COUNT(*) AS c FROM signups WHERE ip_hash = ?")
        .bind(ipHash)
        .first();
      if (Number(r?.c ?? 0) >= 25) return json({ ok: true, count: await count(db) });
    } catch {
      /* fall through */
    }
  }

  try {
    await db
      .prepare("INSERT INTO signups (word, contact, created_at, ip_hash) VALUES (?, ?, ?, ?)")
      .bind(word, contact || null, Date.now(), ipHash || null)
      .run();
  } catch {
    // Never block the UX on a write error.
  }

  return json({ ok: true, count: await count(db) });
}
