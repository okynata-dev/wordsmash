import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { freshDb, A } from "./helpers.js";
import {
  handleTransfer,
  handleWordClaimed,
} from "../src/handlers.js";
import {
  verifySigned,
  AuthError,
  HttpError,
  updateProfile,
  getProfile,
  postComment,
  listComments,
  toggleWatchlist,
  getWatchlist,
  search,
  resolveUsername,
  uploadAvatar,
} from "../src/social.js";
import {
  profileUpdateMessage,
  avatarUploadMessage,
  sha256Hex,
  commentMessage,
  watchlistMessage,
  SIG_TTL_MS,
} from "../../shared/src/social.js";
import type { Db } from "../src/db.js";

// Two well-known test keys (anvil accounts #1 and #2).
const KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const KEY2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const acct1 = privateKeyToAccount(KEY1);
const acct2 = privateKeyToAccount(KEY2);
const ADDR1 = acct1.address.toLowerCase();
const ADDR2 = acct2.address.toLowerCase();

async function sign(account: typeof acct1, message: string): Promise<`0x${string}`> {
  return account.signMessage({ message });
}

describe("verifySigned", () => {
  it("accepts a good signature within TTL", async () => {
    const ts = Date.now();
    const msg = avatarUploadMessage(ADDR1, ts, "deadbeef");
    const sig = await sign(acct1, msg);
    await expect(verifySigned(msg, ADDR1, sig, ts)).resolves.toBeUndefined();
  });

  it("rejects a signature from the wrong signer", async () => {
    const ts = Date.now();
    const msg = avatarUploadMessage(ADDR1, ts, "deadbeef");
    const sig = await sign(acct2, msg); // signed by acct2, claims acct1
    await expect(verifySigned(msg, ADDR1, sig, ts)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects an expired timestamp", async () => {
    const ts = Date.now() - SIG_TTL_MS - 1000;
    const msg = avatarUploadMessage(ADDR1, ts, "deadbeef");
    const sig = await sign(acct1, msg);
    await expect(verifySigned(msg, ADDR1, sig, ts)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("profile update", () => {
  async function doUpdate(
    db: Db,
    account: typeof acct1,
    addr: string,
    fields: { username?: string | null; bio?: string | null; twitterHandle?: string | null; website?: string | null },
  ) {
    const ts = Date.now();
    // Build the message with the SAME normalized values the server will derive.
    const message = profileUpdateMessage(
      addr,
      {
        username: fields.username == null ? null : fields.username.trim().toLowerCase() || null,
        bio: fields.bio == null ? null : fields.bio.replace(/\s+/g, " ").trim().slice(0, 280) || null,
        twitterHandle: fields.twitterHandle == null ? null : fields.twitterHandle.replace(/^@+/, "") || null,
        website: fields.website == null ? null : fields.website,
      },
      ts,
    );
    const signature = await sign(account, message);
    return updateProfile(db, addr, { ...fields, timestamp: ts, signature });
  }

  it("upserts a profile and returns the meta", async () => {
    const db = await freshDb();
    const meta = await doUpdate(db, acct1, ADDR1, { username: "alice", bio: "hi there" });
    expect(meta.username).toBe("alice");
    expect(meta.bio).toBe("hi there");
    expect(meta.twitterVerified).toBe(false);
    expect(meta.updatedAt).toBeGreaterThan(0);

    const p = await getProfile(db, ADDR1);
    expect(p.meta.username).toBe("alice");
  });

  it("rejects username taken by another address (409)", async () => {
    const db = await freshDb();
    await doUpdate(db, acct1, ADDR1, { username: "shared" });
    await expect(doUpdate(db, acct2, ADDR2, { username: "shared" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("lets the same address re-set its own username", async () => {
    const db = await freshDb();
    await doUpdate(db, acct1, ADDR1, { username: "same" });
    const meta = await doUpdate(db, acct1, ADDR1, { username: "same", bio: "updated" });
    expect(meta.username).toBe("same");
    expect(meta.bio).toBe("updated");
  });

  it("rejects an update signed by someone else", async () => {
    const db = await freshDb();
    const ts = Date.now();
    const message = profileUpdateMessage(ADDR1, { username: "x" + "yz" }, ts);
    const signature = await sign(acct2, message); // wrong signer
    await expect(
      updateProfile(db, ADDR1, { username: "xyz", timestamp: ts, signature }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("comments", () => {
  it("posts a comment and lists it newest-first with authorMeta", async () => {
    const db = await freshDb();

    // Give acct1 a profile so authorMeta is populated.
    const tsP = Date.now();
    const pmsg = profileUpdateMessage(ADDR1, { username: "poster" }, tsP);
    await updateProfile(db, ADDR1, {
      username: "poster",
      timestamp: tsP,
      signature: await sign(acct1, pmsg),
    });

    const word = "bread";
    const ts1 = Date.now();
    const m1 = commentMessage(ADDR1, word, "first!", ts1);
    const c1 = await postComment(db, ADDR1, word, {
      body: "first!",
      timestamp: ts1,
      signature: await sign(acct1, m1),
    });
    expect(c1.body).toBe("first!");
    expect(c1.word).toBe("bread");
    expect(c1.authorMeta?.username).toBe("poster");

    const ts2 = Date.now() + 1;
    // The client signs the NORMALIZED word; the path param may be any casing.
    const m2 = commentMessage(ADDR2, "bread", "second", ts2);
    await postComment(db, ADDR2, "BREAD", {
      body: "second",
      timestamp: ts2,
      signature: await sign(acct2, m2),
    });

    const page = await listComments(db, "bread", null);
    expect(page.items.length).toBe(2);
    expect(page.items[0].body).toBe("second"); // newest first
    expect(page.items[1].body).toBe("first!");
  });

  it("rejects empty body and bad signature", async () => {
    const db = await freshDb();
    const ts = Date.now();
    const msg = commentMessage(ADDR1, "milk", "", ts);
    await expect(
      postComment(db, ADDR1, "milk", { body: "   ", timestamp: ts, signature: await sign(acct1, msg) }),
    ).rejects.toBeInstanceOf(HttpError);

    const ts2 = Date.now();
    const good = commentMessage(ADDR1, "milk", "hello", ts2);
    await expect(
      postComment(db, ADDR1, "milk", {
        body: "hello",
        timestamp: ts2,
        signature: await sign(acct2, good), // wrong signer
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a replayed (re-submitted) signed comment", async () => {
    const db = await freshDb();
    const ts = Date.now();
    const msg = commentMessage(ADDR1, "milk", "gm", ts);
    const payload = { body: "gm", timestamp: ts, signature: await sign(acct1, msg) };
    // first submission succeeds...
    await postComment(db, ADDR1, "milk", payload);
    // ...the EXACT same signed payload cannot be replayed.
    await expect(postComment(db, ADDR1, "milk", payload)).rejects.toBeInstanceOf(AuthError);
    // and only one comment exists.
    const page = await listComments(db, "milk", null);
    expect(page.items.length).toBe(1);
  });
});

describe("watchlist", () => {
  it("toggles a token on then off", async () => {
    const db = await freshDb();
    // Seed a word so the join returns a row.
    await handleTransfer(db, { from: A.zero, to: ADDR1, tokenId: 5n }, { tx: "0x1", logIndex: 0, ts: 1 });
    await handleWordClaimed(db, { word: "watched", tokenId: 5n, owner: ADDR1 }, { tx: "0x1", logIndex: 1, ts: 1 });

    const tsOn = Date.now();
    const mOn = watchlistMessage(ADDR1, "5", true, tsOn);
    const r1 = await toggleWatchlist(db, ADDR1, {
      tokenId: "5",
      on: true,
      timestamp: tsOn,
      signature: await sign(acct1, mOn),
    });
    expect(r1.on).toBe(true);

    let list = await getWatchlist(db, ADDR1);
    expect(list.map((w) => w.word)).toEqual(["watched"]);

    const tsOff = Date.now() + 1;
    const mOff = watchlistMessage(ADDR1, "5", false, tsOff);
    const r2 = await toggleWatchlist(db, ADDR1, {
      tokenId: "5",
      on: false,
      timestamp: tsOff,
      signature: await sign(acct1, mOff),
    });
    expect(r2.on).toBe(false);

    list = await getWatchlist(db, ADDR1);
    expect(list.length).toBe(0);
  });

  it("rejects a watchlist toggle with a forged signature", async () => {
    const db = await freshDb();
    const ts = Date.now();
    const msg = watchlistMessage(ADDR1, "9", true, ts);
    await expect(
      toggleWatchlist(db, ADDR1, { tokenId: "9", on: true, timestamp: ts, signature: await sign(acct2, msg) }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("search", () => {
  it("prefix-matches words and usernames", async () => {
    const db = await freshDb();
    await handleTransfer(db, { from: A.zero, to: ADDR1, tokenId: 1n }, { tx: "0x1", logIndex: 0, ts: 1 });
    await handleWordClaimed(db, { word: "bread", tokenId: 1n, owner: ADDR1 }, { tx: "0x1", logIndex: 1, ts: 1 });
    await handleTransfer(db, { from: A.zero, to: ADDR2, tokenId: 2n }, { tx: "0x2", logIndex: 0, ts: 2 });
    await handleWordClaimed(db, { word: "breeze", tokenId: 2n, owner: ADDR2 }, { tx: "0x2", logIndex: 1, ts: 2 });

    const tsP = Date.now();
    const pmsg = profileUpdateMessage(ADDR1, { username: "breadlover" }, tsP);
    await updateProfile(db, ADDR1, { username: "breadlover", timestamp: tsP, signature: await sign(acct1, pmsg) });

    const r = await search(db, "bre");
    expect(r.words.map((w) => w.word).sort()).toEqual(["bread", "breeze"]);
    expect(r.users.map((u) => u.username)).toEqual(["breadlover"]);

    const empty = await search(db, "");
    expect(empty.words).toEqual([]);
    expect(empty.users).toEqual([]);
  });
});

describe("username resolution", () => {
  it("resolves /u/:username to a checksummed address", async () => {
    const db = await freshDb();
    const ts = Date.now();
    const pmsg = profileUpdateMessage(ADDR1, { username: "neo" }, ts);
    await updateProfile(db, ADDR1, { username: "neo", timestamp: ts, signature: await sign(acct1, pmsg) });

    const r = await resolveUsername(db, "NEO");
    expect(r?.address.toLowerCase()).toBe(ADDR1);
    expect(await resolveUsername(db, "nobody")).toBeNull();
  });
});

describe("avatar (local-dev fallback)", () => {
  it("stores the data URL inline when no R2 binding is present", async () => {
    const db = await freshDb();
    const ts = Date.now();
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const msg = avatarUploadMessage(ADDR1, ts, await sha256Hex(dataUrl));
    const res = await uploadAvatar(db, ADDR1, { dataUrl, timestamp: ts, signature: await sign(acct1, msg) }, {});
    expect(res.avatarUrl).toBe(dataUrl);
    const p = await getProfile(db, ADDR1);
    expect(p.meta.avatarUrl).toBe(dataUrl);
  });
});

// ── referrals ────────────────────────────────────────────────────────────────
import { setReferrer, getReferrals, toggleCommentLike } from "../src/social.js";
import { referralMessage, commentLikeMessage } from "../../shared/src/social.js";

describe("referrals", () => {
  async function makeOwner(db: Awaited<ReturnType<typeof freshDb>>, addr: string, word: string, tokenId: bigint) {
    await handleTransfer(db, { from: A.zero, to: addr, tokenId }, { tx: "0x" + word, logIndex: 0, ts: 10 });
    await handleWordClaimed(db, { word, tokenId, owner: addr }, { tx: "0x" + word, logIndex: 1, ts: 10 });
  }

  it("records a referrer once; blocks self and non-users; dashboard aggregates", async () => {
    const db = await freshDb();
    await makeOwner(db, ADDR1, "acct", 1n); // referrer must own a word

    const ts = Date.now();
    const msg = referralMessage(ADDR2, ADDR1, ts);
    const res = await setReferrer(db, ADDR2, { referrer: ADDR1, timestamp: ts, signature: await sign(acct2, msg) });
    expect(res.referrer.toLowerCase()).toBe(ADDR1);

    // set-once
    const ts2 = Date.now() + 1;
    await expect(
      setReferrer(db, ADDR2, { referrer: ADDR1, timestamp: ts2, signature: await sign(acct2, referralMessage(ADDR2, ADDR1, ts2)) }),
    ).rejects.toMatchObject({ status: 409 });

    // cannot refer yourself
    const ts3 = Date.now() + 2;
    await expect(
      setReferrer(db, ADDR1, { referrer: ADDR1, timestamp: ts3, signature: await sign(acct1, referralMessage(ADDR1, ADDR1, ts3)) }),
    ).rejects.toMatchObject({ status: 400 });

    const dash = await getReferrals(db, ADDR1);
    expect(dash.totals.count).toBe(1);
    expect(dash.invited[0].address.toLowerCase()).toBe(ADDR2);
    const mine = await getReferrals(db, ADDR2);
    expect(mine.referrer?.toLowerCase()).toBe(ADDR1);
  });

  it("rejects a referrer who isn't a keepney user", async () => {
    const db = await freshDb();
    const ts = Date.now();
    await expect(
      setReferrer(db, ADDR2, { referrer: ADDR1, timestamp: ts, signature: await sign(acct2, referralMessage(ADDR2, ADDR1, ts)) }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ── comment likes + replies ──────────────────────────────────────────────────
describe("comment likes + replies", () => {
  it("likes/unlikes with a count, and threads one level of replies", async () => {
    const db = await freshDb();
    const ts0 = Date.now();
    const c1 = await postComment(db, ADDR1, "bread", {
      body: "top", timestamp: ts0, signature: await sign(acct1, commentMessage(ADDR1, "bread", "top", ts0)),
    });

    // acct2 likes it
    const lt = Date.now() + 1;
    const like = await toggleCommentLike(db, ADDR2, c1.id, {
      on: true, timestamp: lt, signature: await sign(acct2, commentLikeMessage(ADDR2, String(c1.id), true, lt)),
    });
    expect(like).toEqual({ likes: 1, liked: true });

    // acct2 replies
    const rt = Date.now() + 2;
    await postComment(db, ADDR2, "bread", {
      body: "a reply", parentId: c1.id, timestamp: rt, signature: await sign(acct2, commentMessage(ADDR2, "bread", "a reply", rt)),
    });

    // list from acct2's viewpoint: top-level shows like + likedByMe + the reply
    const page = await listComments(db, "bread", null, ADDR2);
    expect(page.items.length).toBe(1); // only the top-level
    expect(page.items[0].likes).toBe(1);
    expect(page.items[0].likedByMe).toBe(true);
    expect(page.items[0].replies?.length).toBe(1);
    expect(page.items[0].replies?.[0].body).toBe("a reply");

    // unlike
    const ut = Date.now() + 3;
    const un = await toggleCommentLike(db, ADDR2, c1.id, {
      on: false, timestamp: ut, signature: await sign(acct2, commentLikeMessage(ADDR2, String(c1.id), false, ut)),
    });
    expect(un.likes).toBe(0);
  });

  it("rejects a reply deeper than one level", async () => {
    const db = await freshDb();
    const t0 = Date.now();
    const c1 = await postComment(db, ADDR1, "bread", { body: "top", timestamp: t0, signature: await sign(acct1, commentMessage(ADDR1, "bread", "top", t0)) });
    const t1 = Date.now() + 1;
    const r1 = await postComment(db, ADDR2, "bread", { body: "reply", parentId: c1.id, timestamp: t1, signature: await sign(acct2, commentMessage(ADDR2, "bread", "reply", t1)) });
    const t2 = Date.now() + 2;
    await expect(
      postComment(db, ADDR1, "bread", { body: "nested", parentId: r1.id, timestamp: t2, signature: await sign(acct1, commentMessage(ADDR1, "bread", "nested", t2)) }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
