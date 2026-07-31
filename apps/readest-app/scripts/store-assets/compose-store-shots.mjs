/**
 * Compose Google Play listing images from the raw captures produced by
 * `pnpm store:capture` (see e2e/store/store-capture.spec.ts).
 *
 * Style: flat brand-colored background, a short benefit caption, and the app
 * capture inside a rounded dark device frame with a soft shadow that bleeds
 * off the canvas edge — all done with CSS in a code-built HTML page that
 * Playwright Chromium screenshots at exactly the target size. No image
 * libraries. (Adapted from Bookbinder's compose-screenshot.mjs.)
 *
 * Usage (from apps/readest-app):
 *   node scripts/store-assets/compose-store-shots.mjs --config scripts/store-assets/store-shots.config.json
 *     [--only <substring of scene capture/out name>]   e.g. --only 01
 *     [--canvas <phone|tablet7|tablet10>]              one form factor only
 *     [--skip-feature]
 *
 * Each scene in the config renders once per canvas (phone → phoneScreenshots,
 * tablet7 → sevenInchScreenshots, tablet10 → tenInchScreenshots), plus the
 * 1024×500 feature graphic (JPEG — Play rejects alpha). Every output is
 * dimension-checked (and the feature graphic alpha-checked) before exit.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

// ── arg parsing ──────────────────────────────────────────────────────────────
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
  const abs = resolve(p);
  if (!existsSync(abs)) throw new Error(`Image not found: ${abs} — run \`pnpm store:capture\` first`);
  const mime = MIME[extname(abs).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const FONT_STACK = `Inter,-apple-system,'Segoe UI',system-ui,sans-serif`;
const FRAME_SHADOW = '0 40px 90px rgba(0,0,0,.35), 0 8px 24px rgba(0,0,0,.18)';

const htmlShell = (W, H, bodyCss, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  .stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:${FONT_STACK}}
  ${bodyCss}
</style></head><body><div class="stage">${body}</div></body></html>`;

const captionHtml = (caption, sub) =>
  caption
    ? `<div class="caption"><h1>${escapeHtml(caption)}</h1>${sub ? `<p>${escapeHtml(sub)}</p>` : ''}</div>`
    : '';

/**
 * Portrait canvas (phone 1080×1920, tablet7 1080×1920): caption top, device
 * below. Normally the device is wide and bleeds off the bottom edge; a `fit`
 * shot (used where the bottom of the screen matters, e.g. the audiobook player)
 * is sized to sit fully on-canvas so nothing is cropped.
 */
function buildPortraitHtml({ captureUri, bg, text, accent, caption, sub, W, H, deviceWidth, top }) {
  const css = `
    .stage{background:${bg}}
    .caption{position:absolute;top:110px;left:96px;right:96px;text-align:center}
    .caption h1{color:${accent};font-size:64px;font-weight:800;line-height:1.12;letter-spacing:-0.02em}
    .caption p{color:${text};margin-top:20px;font-size:32px;font-weight:400;opacity:.88;line-height:1.4}
    .device{position:absolute;top:${top}px;left:50%;transform:translateX(-50%);width:${deviceWidth}px;
      padding:16px;background:#161d1a;border-radius:56px;box-shadow:${FRAME_SHADOW}}
    .device img{display:block;width:100%;height:auto;border-radius:42px}`;
  return htmlShell(W, H, css, `${captionHtml(caption, sub)}<div class="device"><img src="${captureUri}"></div>`);
}

/** Landscape canvas (tablet10 1920×1080): caption left, frame bleeding off the right edge. */
function buildLandscapeHtml({ captureUri, bg, text, accent, caption, sub, W, H }) {
  const css = `
    .stage{background:${bg}}
    .caption{position:absolute;left:110px;top:50%;transform:translateY(-50%);width:500px}
    .caption h1{color:${accent};font-size:56px;font-weight:800;line-height:1.12;letter-spacing:-0.02em}
    .caption p{color:${text};margin-top:20px;font-size:28px;font-weight:400;opacity:.88;line-height:1.4}
    .device{position:absolute;left:700px;top:120px;width:1400px;
      padding:16px;background:#161d1a;border-radius:40px;box-shadow:${FRAME_SHADOW}}
    .device img{display:block;width:100%;height:auto;border-radius:28px}`;
  return htmlShell(W, H, css, `${captionHtml(caption, sub)}<div class="device"><img src="${captureUri}"></div>`);
}

/** Feature graphic 1024×500: brand mark + tagline left, phone standing on the right. */
function buildFeatureHtml({ captureUri, iconUri, name, tagline, W, H }) {
  const css = `
    .stage{background:linear-gradient(140deg,#2a322e,#161d1a)}
    .left{position:absolute;left:64px;top:50%;transform:translateY(-50%);width:540px;color:#fef9f6}
    .mark{display:flex;align-items:center;gap:22px}
    .mark img{width:92px;height:92px;border-radius:22px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
    .mark span{font-size:60px;font-weight:800;letter-spacing:-0.02em}
    /* balance keeps the tagline from dropping a single orphaned word to its own line */
    .left p{margin-top:20px;font-size:27px;font-weight:400;opacity:.9;line-height:1.35;text-wrap:balance}
    /* Top fully visible with rounded corners; only the bottom bleeds off — a
       "standing phone", not a shot cropped on both edges. */
    .phone{position:absolute;right:74px;top:54px;width:312px;
      padding:10px;background:#0f1412;border-radius:44px;box-shadow:0 30px 70px rgba(0,0,0,.45)}
    .phone img{display:block;width:100%;height:auto;border-radius:34px}`;
  const body = `
    <div class="left">
      <div class="mark"><img src="${iconUri}"><span>${escapeHtml(name)}</span></div>
      <p>${escapeHtml(tagline)}</p>
    </div>
    <div class="phone"><img src="${captureUri}"></div>`;
  return htmlShell(W, H, css, body);
}

// ── output post-checks (header parsing only — no image libraries) ────────────
function pngInfo(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let p = 2;
  while (p < buf.length - 9) {
    if (buf[p] !== 0xff) throw new Error('bad JPEG marker stream');
    const marker = buf[p + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
    }
    p += 2 + buf.readUInt16BE(p + 2);
  }
  throw new Error('no JPEG SOF marker found');
}

function checkOutput(path, expected) {
  const buf = readFileSync(path);
  const isJpeg = /\.jpe?g$/i.test(path);
  const info = isJpeg ? jpegInfo(buf) : pngInfo(buf);
  if (info.width !== expected.width || info.height !== expected.height) {
    throw new Error(`${path}: ${info.width}×${info.height}, expected ${expected.width}×${expected.height}`);
  }
  // Play rejects transparency in the feature graphic; JPEG has no alpha by
  // construction, and PNG color types 4/6 carry an alpha channel.
  if (!isJpeg && expected.opaque && (info.colorType === 4 || info.colorType === 6)) {
    throw new Error(`${path}: PNG has an alpha channel but must be opaque`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
if (!args.config) {
  console.error('Usage: node compose-store-shots.mjs --config <store-shots.config.json> [--only <substr>] [--canvas <name>] [--skip-feature]');
  process.exit(1);
}
const cfgDir = dirname(resolve(args.config));
const cfg = JSON.parse(readFileSync(resolve(args.config), 'utf8'));
// All config paths are relative to the app root (the directory the npm
// script runs from); the config file itself lives inside scripts/store-assets.
const appRoot = resolve(cfgDir, '../..');
const capturesDir = resolve(appRoot, cfg.capturesDir);
const outRoot = resolve(appRoot, cfg.outRoot);

const jobs = [];
for (const [canvasKey, canvas] of Object.entries(cfg.canvases)) {
  if (args.canvas && args.canvas !== canvasKey) continue;
  for (const scene of cfg.scenes) {
    if (args.only && !scene.capture.includes(args.only) && !scene.out.includes(args.only)) continue;
    jobs.push({ canvasKey, canvas, scene });
  }
}

const browser = await chromium.launch();
const rendered = [];
try {
  for (const { canvasKey, canvas, scene } of jobs) {
    const W = canvas.width;
    const H = canvas.height;
    const capturePath = resolve(capturesDir, canvasKey, scene.capture);
    const isLandscape = canvas.orientation === 'landscape';

    // Default portrait framing: wide device anchored near the top, bleeding off
    // the bottom edge. A `fit` shot instead sizes the device so the whole
    // screen (e.g. the audiobook player docked at the bottom) stays on-canvas.
    let deviceWidth = canvas.deviceWidth;
    let top = 440;
    if (scene.fit && !isLandscape) {
      const { width: iw, height: ih } = pngInfo(readFileSync(capturePath));
      const captionBottom = 420;
      const bottomMargin = 70;
      const framePad = 32; // 16px padding on each side of the screen image
      const availH = H - captionBottom - bottomMargin;
      deviceWidth = Math.min(canvas.deviceWidth, Math.round(((availH - framePad) * iw) / ih));
      const deviceH = Math.round((deviceWidth * ih) / iw) + framePad;
      top = Math.round(captionBottom + (availH - deviceH) / 2);
    }

    const params = {
      captureUri: dataUri(capturePath),
      bg: scene.bg || cfg.brand.bg,
      text: scene.text || cfg.brand.text,
      accent: scene.accent || cfg.brand.accent,
      caption: scene.caption || '',
      sub: scene.subcaption || '',
      W,
      H,
      deviceWidth,
      top,
    };
    const html = isLandscape ? buildLandscapeHtml(params) : buildPortraitHtml(params);
    const outAbs = resolve(outRoot, canvas.outDir, scene.out);
    mkdirSync(dirname(outAbs), { recursive: true });
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outAbs, clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    rendered.push({ path: outAbs, width: W, height: H });
    console.log(`✓ ${canvas.outDir}/${scene.out} (${W}×${H})`);
  }

  if (cfg.feature && args['skip-feature'] !== 'true' && !args.only && !args.canvas) {
    const W = 1024;
    const H = 500;
    const html = buildFeatureHtml({
      captureUri: dataUri(resolve(capturesDir, cfg.feature.capture)),
      iconUri: dataUri(resolve(appRoot, cfg.brand.icon)),
      name: cfg.brand.name,
      tagline: cfg.brand.tagline,
      W,
      H,
    });
    const outAbs = resolve(outRoot, cfg.feature.out);
    mkdirSync(dirname(outAbs), { recursive: true });
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outAbs, type: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    rendered.push({ path: outAbs, width: W, height: H, opaque: true });
    console.log(`✓ ${cfg.feature.out} (${W}×${H} JPEG)`);
  }
} finally {
  await browser.close();
}

if (!rendered.length) {
  console.error('No shots matched the filters.');
  process.exit(1);
}
for (const out of rendered) checkOutput(out.path, out);
console.log(`All ${rendered.length} outputs verified.`);
