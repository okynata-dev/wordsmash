// Cloudflare Worker entrypoint: REST API + OG images + scheduled indexing.

import type { Db } from "./db.js";
import { runIndex, reconcile, type Env as IndexEnv } from "./indexer.js";
import {
  getWords,
  getWordDetail,
  getWordTrades,
  getWordChart,
  getWordCandles,
  getCheck,
  getStats,
  getMarket,
  chainMarketReader,
} from "./api.js";
import {
  AuthError,
  HttpError,
  requireAddress,
  getProfile,
  updateProfile,
  uploadAvatar,
  getAvatarUrl,
  generatedAvatarSvg,
  resolveUsername,
  listComments,
  postComment,
  search,
  globalActivity,
  getWatchlist,
  toggleWatchlist,
  type AvatarEnv,
} from "./social.js";
import { ogSvg, shareHtml } from "./og.js";

// Worker env: D1 binding + vars + optional R2 avatars bucket. D1Database
// satisfies the structural `Db` type.
export interface Env {
  DB: Db;
  RPC_URL: string;
  REGISTRY: string;
  MARKETPLACE: string;
  START_BLOCK: string;
  // Where /share redirects humans (the web app). Optional; defaults below.
  WEB_APP_BASE?: string;
  // C1: shared secret guarding /admin/*. TODO(operator): set as a wrangler secret.
  ADMIN_TOKEN?: string;
  // Public base URL of this worker, used to build R2-backed avatar URLs.
  PUBLIC_BASE?: string;
  // Optional R2 bucket for avatar bytes. When unbound we fall back to storing
  // the data URL inline (local dev).
  AVATARS?: {
    put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  };
}

// Spread into every response. CORS stays "*" on purpose: these are public read
// APIs, and the OG/avatar assets are fetched cross-origin by scrapers/other apps;
// social WRITES are authenticated by signature recovery + replay guard, not CORS
// (CORS is not an auth control). The security headers are safe on JSON, images,
// redirects and HTML alike — nosniff stops MIME confusion on the served SVG/HTML.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

function notFound(): Response {
  return json({ error: "not found" }, { status: 404 });
}

function indexEnv(env: Env): IndexEnv {
  return {
    DB: env.DB,
    RPC_URL: env.RPC_URL,
    REGISTRY: env.REGISTRY,
    MARKETPLACE: env.MARKETPLACE,
    START_BLOCK: env.START_BLOCK,
  };
}

/** Constant-time string compare (avoids leaking length-prefix timing). */
function timingSafeEqual(a: string, b: string): boolean {
  // Always iterate over a fixed length so a mismatch in length doesn't short-circuit.
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// C1: require `Authorization: Bearer ${ADMIN_TOKEN}`. Returns a 401 Response on
// failure, or null when authorized.
function requireAdmin(request: Request, env: Env): Response | null {
  const expected = env.ADMIN_TOKEN ?? "";
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  const presented = header.startsWith(prefix) ? header.slice(prefix.length) : "";
  // If no token is configured, refuse rather than allowing open admin access.
  if (expected === "" || !timingSafeEqual(presented, expected)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json();
    return (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const parts = path.split("/").filter(Boolean);
    const db = env.DB;
    const avatarEnv: AvatarEnv = { AVATARS: env.AVATARS, PUBLIC_BASE: env.PUBLIC_BASE ?? url.origin };

    try {
      // ── Admin (POST) — manual/local triggers, behind ADMIN_TOKEN (C1). ──────
      if (request.method === "POST") {
        if (path === "/admin/index") {
          const unauth = requireAdmin(request, env);
          if (unauth) return unauth;
          const res = await runIndex(indexEnv(env));
          return json({ ok: true, ...res });
        }
        if (path === "/admin/reconcile") {
          const unauth = requireAdmin(request, env);
          if (unauth) return unauth;
          // Clamp n into [1, 50].
          const raw = Number(url.searchParams.get("n") ?? "10");
          const n = Math.min(Math.max(1, raw | 0), 50);
          const res = await reconcile(indexEnv(env), n);
          return json({ ok: true, ...res });
        }

        // ── Social writes (POST) ──────────────────────────────────────────────
        if (parts[0] === "profile" && parts[1] != null && parts[2] === "avatar") {
          const address = requireAddress(decodeURIComponent(parts[1]));
          const body = await readJson(request);
          const res = await uploadAvatar(db, address, body, avatarEnv);
          return json(res);
        }
        if (parts[0] === "profile" && parts[1] != null && parts.length === 2) {
          const address = requireAddress(decodeURIComponent(parts[1]));
          const body = await readJson(request);
          const meta = await updateProfile(db, address, body);
          return json(meta);
        }
        if (parts[0] === "word" && parts[1] != null && parts[2] === "comments") {
          // Author address comes from the body's recovered signer; we need it before
          // verifying. The signer is the address that POSTs — passed in the body.
          const word = decodeURIComponent(parts[1]);
          const body = await readJson(request);
          const address = requireAddress(String(body.address ?? ""));
          const comment = await postComment(db, address, word, body);
          return json(comment);
        }
        if (parts[0] === "watchlist" && parts[1] != null) {
          const address = requireAddress(decodeURIComponent(parts[1]));
          const body = await readJson(request);
          const res = await toggleWatchlist(db, address, body);
          return json(res);
        }
        return notFound();
      }

      if (request.method !== "GET") return notFound();

      // ── GET routes ──────────────────────────────────────────────────────────
      if (path === "/" || path === "/health") {
        return json({ ok: true, service: "wordsmash-indexer" });
      }

      if (path === "/words") {
        const sort = url.searchParams.get("sort") ?? "recent";
        const cursor = url.searchParams.get("cursor");
        return json(await getWords(db, sort, cursor));
      }

      // /word/:word/comments  (must precede the bare /word/:word match)
      if (parts[0] === "word" && parts[1] != null && parts[2] === "comments") {
        const word = decodeURIComponent(parts[1]);
        const cursor = url.searchParams.get("cursor");
        return json(await listComments(db, word, cursor));
      }

      // /word/:word/trades  (v2 token-market trade log, newest-first)
      if (parts[0] === "word" && parts[1] != null && parts[2] === "trades") {
        const word = decodeURIComponent(parts[1]);
        const cursor = url.searchParams.get("cursor");
        return json(await getWordTrades(db, word, cursor));
      }

      // /word/:word/chart  (v2 token-market price series)
      if (parts[0] === "word" && parts[1] != null && parts[2] === "chart") {
        const word = decodeURIComponent(parts[1]);
        return json(await getWordChart(db, word));
      }

      // /word/:word/candles?res=  (OHLC for the trading chart)
      if (parts[0] === "word" && parts[1] != null && parts[2] === "candles") {
        const word = decodeURIComponent(parts[1]);
        return json(await getWordCandles(db, word, url.searchParams.get("res")));
      }

      if (parts[0] === "word" && parts[1] != null) {
        // Live market reads (marketCap/deedFees/supply) via RPC; price/volume from D1.
        const reader = env.RPC_URL ? chainMarketReader(env.RPC_URL) : undefined;
        return json(await getWordDetail(db, decodeURIComponent(parts.slice(1).join("/")), reader));
      }

      // /avatar/file/:address  (R2 bytes) — must precede /avatar/:address
      if (parts[0] === "avatar" && parts[1] === "file" && parts[2] != null) {
        const address = requireAddress(decodeURIComponent(parts[2]));
        if (env.AVATARS) {
          const obj = await env.AVATARS.get(address);
          if (obj) {
            return new Response(obj.body, {
              headers: {
                "Content-Type": obj.httpMetadata?.contentType ?? "image/png",
                "Cache-Control": "public, max-age=3600",
                ...CORS_HEADERS,
              },
            });
          }
        }
        return notFound();
      }

      // /avatar/:address -> stored url (302) or generated SVG
      if (parts[0] === "avatar" && parts[1] != null) {
        const address = requireAddress(decodeURIComponent(parts[1]));
        const stored = await getAvatarUrl(db, address);
        if (stored) {
          return new Response(null, {
            status: 302,
            headers: { Location: stored, "Cache-Control": "public, max-age=3600", ...CORS_HEADERS },
          });
        }
        return new Response(generatedAvatarSvg(address), {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=3600",
            ...CORS_HEADERS,
          },
        });
      }

      if (parts[0] === "profile" && parts[1] != null) {
        const address = requireAddress(decodeURIComponent(parts[1]));
        return json(await getProfile(db, address));
      }

      if (parts[0] === "u" && parts[1] != null) {
        const res = await resolveUsername(db, decodeURIComponent(parts[1]));
        if (!res) return notFound();
        return json(res);
      }

      if (parts[0] === "watchlist" && parts[1] != null) {
        const address = requireAddress(decodeURIComponent(parts[1]));
        return json(await getWatchlist(db, address));
      }

      if (path === "/search") {
        return json(await search(db, url.searchParams.get("q") ?? ""));
      }

      if (path === "/activity") {
        return json(await globalActivity(db, url.searchParams.get("cursor")));
      }

      if (parts[0] === "check" && parts[1] != null) {
        return json(await getCheck(db, decodeURIComponent(parts.slice(1).join("/"))));
      }

      if (path === "/stats") {
        return json(await getStats(db), {
          headers: { "Cache-Control": "public, max-age=10" },
        });
      }

      if (path === "/market") {
        return json(await getMarket(db));
      }

      if (parts[0] === "og" && parts[1] != null) {
        const word = decodeURIComponent(parts.slice(1).join("/"));
        return new Response(ogSvg(word), {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=3600",
            ...CORS_HEADERS,
          },
        });
      }

      if (parts[0] === "share" && parts[1] != null) {
        const word = decodeURIComponent(parts.slice(1).join("/"));
        const webBase = env.WEB_APP_BASE ?? url.origin;
        return new Response(shareHtml(word, url.origin, webBase), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            ...CORS_HEADERS,
          },
        });
      }

      return notFound();
    } catch (err) {
      // Auth failures -> 401, validated client input -> its status, everything
      // else -> a generic 500 (M2/M5: never leak String(err) to the client).
      if (err instanceof AuthError) {
        return json({ error: "unauthorized" }, { status: 401 });
      }
      if (err instanceof HttpError) {
        return json({ error: err.message }, { status: err.status });
      }
      console.error("request error", err);
      return json({ error: "internal error" }, { status: 500 });
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const res = await runIndex(indexEnv(env));
          console.log(`indexed blocks ${res.from}..${res.to}`);
          const rec = await reconcile(indexEnv(env), 10);
          console.log(`reconciled ${rec.checked} words, corrected ${rec.corrected}`);
        } catch (err) {
          console.error("scheduled run failed", err);
        }
      })(),
    );
  },
};
