// Curated word collections — themed groups the app surfaces on /collections and
// as category chips on word pages. A word belongs to a collection when its
// normalized form is in that collection's list. This is a display/discovery
// layer only (no on-chain meaning); edit freely as the catalog grows.

export interface CollectionDef {
  key: string; // url slug
  title: string;
  emoji: string;
  blurb: string;
  words: string[]; // normalized (lowercase a–z0–9)
}

export const COLLECTIONS: CollectionDef[] = [
  {
    key: "crypto",
    title: "Crypto",
    emoji: "🪙",
    blurb: "The words the whole industry runs on.",
    words: ["degen", "wagmi", "gm", "onchain", "based", "alpha", "mint", "ape", "pump", "moon", "lfg", "ser", "frens", "hodl", "airdrop", "rekt"],
  },
  {
    key: "vibes",
    title: "Vibes",
    emoji: "✨",
    blurb: "Feelings, energy, and states of mind.",
    words: ["love", "hope", "peace", "dream", "chill", "hype", "joy", "calm", "bliss", "flow", "glow", "zen"],
  },
  {
    key: "power",
    title: "Power words",
    emoji: "⚡",
    blurb: "Big, brandable, high-voltage.",
    words: ["power", "king", "queen", "boss", "legend", "gold", "fire", "storm", "titan", "apex", "prime", "vault"],
  },
  {
    key: "money",
    title: "Money",
    emoji: "💸",
    blurb: "Wealth, markets, and the game of value.",
    words: ["money", "rich", "bag", "yield", "bank", "profit", "cash", "wealth", "fund", "market", "trade", "bull"],
  },
  {
    key: "tech",
    title: "Tech",
    emoji: "🤖",
    blurb: "Software, machines, and the future.",
    words: ["code", "data", "cloud", "ai", "robot", "cyber", "pixel", "byte", "node", "quantum", "neural", "logic"],
  },
];

const BY_WORD: Map<string, CollectionDef[]> = (() => {
  const m = new Map<string, CollectionDef[]>();
  for (const c of COLLECTIONS) {
    for (const w of c.words) {
      const arr = m.get(w) ?? [];
      arr.push(c);
      m.set(w, arr);
    }
  }
  return m;
})();

/** Collections a normalized word belongs to (may be empty). */
export function collectionsForWord(word: string): CollectionDef[] {
  return BY_WORD.get(word.trim().toLowerCase()) ?? [];
}

export function collectionByKey(key: string): CollectionDef | undefined {
  return COLLECTIONS.find((c) => c.key === key);
}
