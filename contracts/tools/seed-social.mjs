#!/usr/bin/env node
// Seed demo SOCIAL data (profiles, comments, watchlist) via the indexer API, so the local app
// looks like a real product. Signs requests with the default anvil keys (LOCAL ONLY).
//
// Run AFTER the chain is deployed/seeded and the indexer is running:
//   node contracts/tools/seed-social.mjs            (API default http://localhost:8787)
//
// Message formats below MUST match shared/src/social.ts exactly.
import { privateKeyToAccount } from "viem/accounts";

const API = process.env.API_URL ?? "http://localhost:8787";

const ACCT = {
  acc0: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"),
  acc1: privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"),
};

const profileUpdateMessage = (address, p, ts) =>
  [
    "wordsmash: update profile",
    `address: ${address.toLowerCase()}`,
    `username: ${JSON.stringify(p.username ?? null)}`,
    `bio: ${JSON.stringify(p.bio ?? null)}`,
    `twitter: ${JSON.stringify(p.twitterHandle ?? null)}`,
    `website: ${JSON.stringify(p.website ?? null)}`,
    `issued: ${ts}`,
  ].join("\n");

const commentMessage = (address, word, body, ts) =>
  [
    "wordsmash: post comment",
    `address: ${address.toLowerCase()}`,
    `word: ${word}`,
    `body: ${JSON.stringify(body)}`,
    `issued: ${ts}`,
  ].join("\n");

const watchlistMessage = (address, tokenId, on, ts) =>
  [
    "wordsmash: toggle watchlist",
    `address: ${address.toLowerCase()}`,
    `token: ${tokenId}`,
    `on: ${on}`,
    `issued: ${ts}`,
  ].join("\n");

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${text}`);
  return text;
}

async function get(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function setProfile(account, p) {
  const ts = Date.now();
  const signature = await account.signMessage({ message: profileUpdateMessage(account.address, p, ts) });
  await post(`/profile/${account.address}`, { ...p, timestamp: ts, signature });
  console.log(`profile set: ${p.username} (${account.address})`);
}

async function comment(account, word, body) {
  const ts = Date.now();
  const signature = await account.signMessage({ message: commentMessage(account.address, word, body, ts) });
  await post(`/word/${word}/comments`, { address: account.address, body, timestamp: ts, signature });
  console.log(`comment by ${account.address.slice(0, 8)} on ${word}`);
}

async function watch(account, tokenId, on = true) {
  const ts = Date.now();
  const signature = await account.signMessage({ message: watchlistMessage(account.address, tokenId, on, ts) });
  await post(`/watchlist/${account.address}`, { tokenId, on, timestamp: ts, signature });
  console.log(`watchlist ${on ? "+" : "-"} ${tokenId.slice(0, 10)} for ${account.address.slice(0, 8)}`);
}

async function main() {
  await setProfile(ACCT.acc0, {
    username: "satoshi",
    bio: "Collector of rare words. genesis was mine before it was cool.",
    twitterHandle: "wordsmash",
    website: "https://wordsmash.xyz/", // pre-normalized (URL canonical form)
  });
  await setProfile(ACCT.acc1, {
    username: "vitalik",
    bio: "Bought base. gm.",
    twitterHandle: null,
    website: null,
  });

  await comment(ACCT.acc1, "base", "snagged this one. lfg");
  await comment(ACCT.acc0, "base", "good word. should've kept it");
  await comment(ACCT.acc0, "genesis", "the first. only one will ever exist.");

  // Watch a word (tokenId = keccak of "genesis"); fetch it from the API to avoid hashing here.
  const detail = await get(`/word/genesis`).catch(() => null);
  if (detail?.tokenId) await watch(ACCT.acc1, detail.tokenId, true);

  console.log("\nsocial seed complete.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
