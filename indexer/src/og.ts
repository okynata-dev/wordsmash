// OG image (SVG) + server-rendered share page (OpenGraph/Twitter meta).
// No external fonts — system sans only.

import { normalizeWord, toTicker } from "../../shared/src/normalize.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Clean monochrome OG image. 1200x630, word large + tagline. */
export function ogSvg(rawWord: string): string {
  const norm = normalizeWord(rawWord);
  const word = norm.ok ? norm.normalized : rawWord.toLowerCase().slice(0, 30);
  const ticker = toTicker(word);
  // Scale font size down for long words so it always fits the 1200px canvas.
  const fontSize = Math.max(64, Math.min(220, Math.floor(1100 / Math.max(ticker.length, 1)) * 1.6));
  const display = escapeXml(`$${ticker}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#000000"/>
  <rect x="20" y="20" width="1160" height="590" fill="none" stroke="#ffffff" stroke-width="2"/>
  <text x="600" y="320" fill="#ffffff" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="800" text-anchor="middle" letter-spacing="-2">${display}</text>
  <text x="600" y="470" fill="#888888" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="30" letter-spacing="2" text-anchor="middle">only one will ever exist · keepney</text>
</svg>`;
}

/**
 * Minimal HTML page with OpenGraph + Twitter meta so links unfurl richly.
 * Crawlers don't run JS, so this server-rendered page is the flywheel.
 * `selfOrigin` is this worker's origin; `webAppBase` is where humans get redirected.
 */
export function shareHtml(rawWord: string, selfOrigin: string, webAppBase: string): string {
  const norm = normalizeWord(rawWord);
  const word = norm.ok ? norm.normalized : rawWord.toLowerCase().slice(0, 30);
  const ticker = toTicker(word);
  const title = escapeXml(`$${ticker} · keepney`);
  const desc = escapeXml(`${word} — only one will ever exist. Keep it on keepney.`);
  const ogImage = `${selfOrigin}/og/${encodeURIComponent(word)}`;
  const wordUrl = `${webAppBase.replace(/\/$/, "")}/word/${encodeURIComponent(word)}`;
  const safeWordUrl = escapeXml(wordUrl);
  const safeImg = escapeXml(ogImage);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:image" content="${safeImg}"/>
<meta property="og:url" content="${safeWordUrl}"/>
<meta property="og:site_name" content="keepney"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image" content="${safeImg}"/>
<link rel="canonical" href="${safeWordUrl}"/>
<meta http-equiv="refresh" content="0; url=${safeWordUrl}"/>
</head>
<body>
<p>Redirecting to <a href="${safeWordUrl}">$${escapeXml(ticker)} on keepney</a>…</p>
</body>
</html>`;
}
