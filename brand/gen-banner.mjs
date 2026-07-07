// Coinbase-style dot-matrix X/Twitter banner (1500x500) for keepney.
// Technique: real bold "keepney" text used as an SVG mask; a dense grid of white
// ASCII glyphs is clipped to the letter shapes (so the word is always legible and
// made of characters), over a sparse faint glyph field on the brand blue gradient.
import { writeFileSync } from "node:fs";

const W = 1500, H = 500;

let seed = 20260706;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const esc = (g) => (g === "&" ? "&amp;" : g === "<" ? "&lt;" : g === ">" ? "&gt;" : g);

const p = [];
p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="keepney">`);
p.push(`<defs>`);
p.push(`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`);
p.push(`<stop offset="0" stop-color="#3b6cff"/><stop offset="0.55" stop-color="#1230ff"/><stop offset="1" stop-color="#0000ee"/>`);
p.push(`</linearGradient>`);
// Mask: the orbit mark (orb + ring + satellite) plus the wordmark — white on
// black, so the dense glyph grid renders only inside logo and letters.
p.push(`<mask id="wm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">`);
p.push(`<rect width="${W}" height="${H}" fill="#000"/>`);
p.push(`<circle cx="360" cy="250" r="112" fill="#fff"/>`);
p.push(`<circle cx="360" cy="250" r="178" fill="none" stroke="#fff" stroke-width="17"/>`);
p.push(`<circle cx="496" cy="136" r="27" fill="#fff"/>`);
p.push(`<text x="1010" y="330" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="230" letter-spacing="-5">keepney</text>`);
p.push(`</mask>`);
p.push(`</defs>`);

p.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);

// --- sparse background glyph field (the Coinbase "sea of dots") ---
p.push(`<g font-family="'SFMono-Regular',Menlo,Consolas,monospace" fill="#ffffff">`);
const faint = ["·", "·", "+", "%", "-", "*", ">", "<", "/"];
const step = 15;
for (let x = step; x < W; x += step) {
  for (let y = step; y < H; y += step) {
    if (rnd() > 0.5) continue;
    const g = pick(faint);
    const sz = 8 + Math.floor(rnd() * 5);
    const op = (0.2 + rnd() * 0.28).toFixed(2);
    const jx = (rnd() * 6 - 3).toFixed(0);
    const jy = (rnd() * 6 - 3).toFixed(0);
    p.push(`<text x="${+x + +jx}" y="${+y + +jy}" font-size="${sz}" opacity="${op}">${esc(g)}</text>`);
  }
}
p.push(`</g>`);

// --- dense glyph grid clipped to the wordmark ---
p.push(`<g mask="url(#wm)" font-family="'SFMono-Regular',Menlo,Consolas,monospace" fill="#ffffff" text-anchor="middle">`);
const bold = ["+", "+", "+", "#", "#", "%", "&", "*"];
const cs = 13; // grid pitch inside the mark/letters (tighter = denser, bolder fill)
for (let x = 0; x < W; x += cs) {
  for (let y = 40; y < 460; y += cs) {
    const g = pick(bold);
    const sz = 15 + Math.floor(rnd() * 3);
    p.push(`<text x="${x + cs / 2}" y="${y + cs * 0.9}" font-size="${sz}">${esc(g)}</text>`);
  }
}
p.push(`</g>`);

p.push(`</svg>`);
writeFileSync(new URL("./banner-keepney.svg", import.meta.url), p.join("\n"));
console.log("wrote banner-keepney.svg");
