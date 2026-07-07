// Orbit content kit: X banners (1500x500) + a square post (1080), all around the
// orbit mark. Run: node gen-orbit-content.mjs && ./render (see bottom log).
import { writeFileSync } from "node:fs";

const W = 1500, H = 500;
const INK = "#14161f", MUTED = "#6b7080", RING = "#5b8cff", BLUE = "#0000ff", FAINT = "#cfdcff";

const orbGrad = (id) =>
  `<radialGradient id="${id}" cx="0.35" cy="0.3" r="1"><stop offset="0" stop-color="#8fb0ff"/><stop offset="0.6" stop-color="#1230ff"/><stop offset="1" stop-color="#0000d0"/></radialGradient>`;

// point on a ring; deg 0 = right, 90 = down (svg y-down), -90 = up
const at = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))];
};

// Text along a ring, one glyph at a time (librsvg lacks textPath support).
// Glyphs advance clockwise from startDeg; tops face outward, coin-style.
const ringText = (cx, cy, r, text, { fs = 42, startDeg, arcPerChar, fill = BLUE, weight = 700 }) => {
  let out = `<g font-family="Helvetica,Arial,sans-serif" font-weight="${weight}" font-size="${fs}" fill="${fill}" text-anchor="middle">`;
  for (let i = 0; i < text.length; i++) {
    const deg = startDeg + i * arcPerChar;
    const [x, y] = at(cx, cy, r, deg);
    out += `<text transform="translate(${x} ${y}) rotate(${(deg + 90).toFixed(1)})">${text[i]
      .replace("&", "&amp;")
      .replace("<", "&lt;")}</text>`;
  }
  return out + `</g>`;
};

const files = [];
const svg = (name, body, w = W, h = H) => {
  writeFileSync(
    new URL(`./${name}.svg`, import.meta.url),
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>`,
  );
  files.push([name, w, h]);
};

// The hero geometry the user asked for: a huge orbit whose CENTER sits at the
// banner's right edge, vertically centered — only a big arc slice is visible.
const QX = 1500, QY = 250;
const quarterOrbit = (id, { orbR = 380, ringR = 620, ringW = 36, satDeg = 185, satR = 44 } = {}) => {
  const [sx, sy] = at(QX, QY, ringR, satDeg);
  return `<defs>${orbGrad(id)}</defs>
  <circle cx="${QX}" cy="${QY}" r="${orbR}" fill="url(#${id})"/>
  <circle cx="${QX}" cy="${QY}" r="${ringR}" fill="none" stroke="${RING}" stroke-width="${ringW}"/>
  <circle cx="${sx}" cy="${sy}" r="${satR}" fill="${BLUE}"/>`;
};

const bg = (fill = "#ffffff") => `<rect width="${W}" height="${H}" fill="${fill}"/>`;
const F = `font-family="Helvetica,Arial,sans-serif"`;

// ── 01 · clean: just the cropped orbit, nothing else ──
svg("banner-orbit-01-clean", `${bg()}${quarterOrbit("g1")}`);

// ── 02 · name left ──
svg("banner-orbit-02-name", `${bg()}${quarterOrbit("g2")}
  <text x="90" y="292" ${F} font-weight="700" font-size="124" letter-spacing="-3" fill="${INK}">keepney<tspan fill="${BLUE}">.</tspan></text>`);

// ── 03 · name OVER the orbit (white halo keeps it readable across the rings) ──
svg("banner-orbit-03-name-over", `${bg()}${quarterOrbit("g3", { satDeg: 165 })}
  <text x="760" y="298" text-anchor="middle" ${F} font-weight="800" font-size="168" letter-spacing="-4"
    fill="${INK}" stroke="#ffffff" stroke-width="10" paint-order="stroke">keepney</text>`);

// ── 04 · the ring IS the name: text runs along the orbit ──
{
  const cx = 1500, cy = 250, orbR = 340, innerR = 450, textR = 560;
  const [sx, sy] = at(cx, cy, innerR, 160);
  // Only ~±26° of the text ring is inside the frame (r=560 around a right-edge
  // center) — one word, dead-center on the visible arc, is what fits and reads.
  const phrase = "KEEPNEY";
  const arcPerChar = 6.2;
  const startDeg = 180 - ((phrase.length - 1) * arcPerChar) / 2;
  svg("banner-orbit-04-text-ring", `${bg()}
  <defs>${orbGrad("g4")}</defs>
  <circle cx="${cx}" cy="${cy}" r="${orbR}" fill="url(#g4)"/>
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${RING}" stroke-width="12"/>
  <circle cx="${sx}" cy="${sy}" r="${32}" fill="${BLUE}"/>
  ${ringText(cx, cy, textR, phrase, { fs: 72, startDeg, arcPerChar })}`);
}

// ── 05 · dark mode ──
svg("banner-orbit-05-dark", `${bg("#0b0d14")}${quarterOrbit("g5")}
  <text x="90" y="270" ${F} font-weight="700" font-size="124" letter-spacing="-3" fill="#ffffff">keepney<tspan fill="${RING}">.</tspan></text>
  <text x="96" y="340" ${F} font-size="40" fill="#8a8f9e">Keep a word. Earn on every trade.</text>`);

// ── 06 · brand-blue field, white orbit ──
svg("banner-orbit-06-blue", `<defs><linearGradient id="bg6" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3b6cff"/><stop offset="1" stop-color="#0000ee"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg6)"/>
  <circle cx="${QX}" cy="${QY}" r="380" fill="#ffffff" opacity="0.96"/>
  <circle cx="${QX}" cy="${QY}" r="620" fill="none" stroke="#ffffff" stroke-width="30" opacity="0.85"/>
  <circle cx="${at(QX, QY, 620, 185)[0]}" cy="${at(QX, QY, 620, 185)[1]}" r="42" fill="#ffffff"/>
  <text x="90" y="270" ${F} font-weight="700" font-size="124" letter-spacing="-3" fill="#ffffff">keepney</text>
  <text x="96" y="340" ${F} font-size="40" fill="#ffffff" opacity="0.75">Keep a word. Earn on every trade.</text>`);

// ── 07 · centered lockup, corporate-clean ──
{
  const mx = 490, my = 240;
  const [sx, sy] = at(mx, my, 112, -40);
  svg("banner-orbit-07-center", `${bg()}
  <defs>${orbGrad("g7")}</defs>
  <circle cx="${mx}" cy="${my}" r="70" fill="url(#g7)"/>
  <circle cx="${mx}" cy="${my}" r="112" fill="none" stroke="${RING}" stroke-width="12"/>
  <circle cx="${sx}" cy="${sy}" r="17" fill="${BLUE}"/>
  <text x="650" y="288" ${F} font-weight="700" font-size="132" letter-spacing="-3" fill="${INK}">keepney</text>
  <text x="750" y="408" text-anchor="middle" ${F} font-size="36" fill="${MUTED}">Keep a word. Earn on every trade.</text>`);
}

// ── 08 · the system: words as satellites on their own orbits ──
{
  const cx = 1120, cy = 250;
  const rings = [
    { r: 210, deg: 205, word: "gm", dr: 15 },
    { r: 300, deg: -35, word: "doge", dr: 13 },
    { r: 390, deg: 155, word: "wagmi", dr: 11 },
  ];
  let ringsSvg = "";
  for (const { r, deg, word, dr } of rings) {
    const [x, y] = at(cx, cy, r, deg);
    ringsSvg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${FAINT}" stroke-width="3"/>
    <circle cx="${x}" cy="${y}" r="${dr}" fill="${BLUE}"/>
    <text x="${x + dr + 10}" y="${y + 8}" font-family="Menlo,monospace" font-size="26" fill="${MUTED}">${word}</text>`;
  }
  svg("banner-orbit-08-system", `${bg()}
  <defs>${orbGrad("g8")}</defs>
  ${ringsSvg}
  <circle cx="${cx}" cy="${cy}" r="120" fill="url(#g8)"/>
  <text x="90" y="262" ${F} font-weight="700" font-size="110" letter-spacing="-3" fill="${INK}">keepney<tspan fill="${BLUE}">.</tspan></text>
  <text x="96" y="330" ${F} font-size="38" fill="${MUTED}">Every word finds its orbit.</text>`);
}

// ── 09 · small lockup top-left + clean quarter orbit ──
{
  const [sx, sy] = at(110, 100, 32, -40);
  svg("banner-orbit-09-lockup", `${bg()}${quarterOrbit("g9")}
  <defs>${orbGrad("g9b")}</defs>
  <circle cx="110" cy="100" r="20" fill="url(#g9b)"/>
  <circle cx="110" cy="100" r="32" fill="none" stroke="${RING}" stroke-width="5"/>
  <circle cx="${sx}" cy="${sy}" r="7" fill="${BLUE}"/>
  <text x="160" y="118" ${F} font-weight="700" font-size="52" letter-spacing="-1" fill="${INK}">keepney</text>`);
}

// ── 10 · square post: full text-ring stamp ──
{
  const S = 1080, cx = 540, cy = 540, orbR = 210, innerR = 300, textR = 392;
  const [sx, sy] = at(cx, cy, innerR, -40);
  const phrase = "KEEPNEY · KEEP A WORD · EARN ON EVERY TRADE · ";
  const full = phrase.repeat(2); // 92 glyphs around the full circle
  svg("post-orbit-textring", `<rect width="${S}" height="${S}" fill="#ffffff"/>
  <defs>${orbGrad("g10")}</defs>
  <circle cx="${cx}" cy="${cy}" r="${orbR}" fill="url(#g10)"/>
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${RING}" stroke-width="10"/>
  <circle cx="${sx}" cy="${sy}" r="26" fill="${BLUE}"/>
  ${ringText(cx, cy, textR, full, { fs: 38, startDeg: -90, arcPerChar: 360 / full.length })}`, S, S);
}

console.log(files.map(([n, w, h]) => `${n}.svg ${w}x${h}`).join("\n"));
