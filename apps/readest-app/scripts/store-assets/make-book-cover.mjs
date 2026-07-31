/**
 * Bake a book title + author onto a painted cover image and write a JPEG —
 * so a demo book (e.g. the store screenshots' "The Lantern of Ash Hollow")
 * reads like a real published cover. Playwright renders the text over the art;
 * no image libraries.
 *
 *   node scripts/store-assets/make-book-cover.mjs \
 *     --src e2e/fixtures/books/store/lantern-cover-source.png \
 *     --title "The Lantern of Ash Hollow" \
 *     --author "Ava Thornbury" \
 *     --out e2e/fixtures/books/store/lantern-cover.jpg
 *
 * The source painting (lantern-cover-source.png) is committed alongside the
 * text-baked JPEG the fixture/claim shot consume, so the cover is reproducible.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function dataUri(p) {
  const abs = resolve(p.replace(/^~/, process.env.HOME ?? ''));
  if (!existsSync(abs)) throw new Error(`Image not found: ${abs}`);
  const mime = MIME[extname(abs).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const args = parseArgs(process.argv.slice(2));
if (!args.src || !args.title || !args.out) {
  console.error('Usage: --src <image> --title <t> [--author <a>] --out <jpg> [--width 800] [--height 1165]');
  process.exit(1);
}
const W = Number(args.width) || 800;
const H = Number(args.height) || 1165;
const title = args.title;
const author = args.author && args.author !== 'true' ? args.author : '';

// Title sits in the open sky at the top; author in the dark foreground at the
// bottom. Warm cream/gold to echo the lantern glow and the gold card border;
// a strong soft shadow keeps both legible over the painting.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  .cover{position:relative;width:${W}px;height:${H}px;overflow:hidden;
    font-family:Georgia,'Times New Roman',serif}
  .cover>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .title{position:absolute;top:8.5%;left:11%;right:11%;text-align:center;
    color:#efe4cf;font-size:52px;font-weight:700;line-height:1.14;letter-spacing:0.5px;
    text-shadow:0 2px 14px rgba(0,0,0,.92),0 0 46px rgba(0,0,0,.6);text-wrap:balance}
  .author{position:absolute;bottom:6.5%;left:11%;right:11%;text-align:center;
    color:#d8bd8c;font-size:30px;font-style:italic;letter-spacing:1px;
    text-shadow:0 2px 12px rgba(0,0,0,.95)}
</style></head><body>
  <div class="cover">
    <img src="${dataUri(args.src)}">
    <div class="title">${escapeHtml(title)}</div>
    ${author ? `<div class="author">${escapeHtml(author)}</div>` : ''}
  </div>
</body></html>`;

const outAbs = resolve(args.out);
mkdirSync(dirname(outAbs), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: outAbs, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: W, height: H } });
  await page.close();
  console.log(`✓ ${args.out} (${W}×${H})`);
} finally {
  await browser.close();
}
