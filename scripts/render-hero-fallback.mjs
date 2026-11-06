// Renders the 3D cookie's first frame to source-assets/hero-cookie-render.png (transparent), so the
// static hero image shown before / instead of WebGL is pixel-identical to the 3D cookie.
// Needs the preview running (npm run preview). Then run: npm run assets
//   node scripts/render-hero-fallback.mjs
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
let executablePath;
try {
  executablePath = require('playwright').chromium.executablePath();
} catch {
  executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'source-assets', 'hero-cookie-render.png');

const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(process.env.BASE_URL || 'http://localhost:4173/', { waitUntil: 'networkidle' });
// Isolate the canvas on a transparent page.
await page.addStyleTag({
  content: `html, body, .hero { background: transparent !important; }
    body > :not(main), .hero__copy, .hero__fallback, .hero__mascot, .hero__scroll, .hero__shadow,
    main > :not(:first-child) { visibility: hidden !important; }
    .hero__canvas { -webkit-mask-image: none !important; mask-image: none !important; }`,
});
await page.keyboard.press('Shift'); // first interaction → loads the 3D (no pointer tilt)
await page.waitForSelector('.hero.is-3d', { timeout: 30000 });
await page.waitForTimeout(1800); // fade-in complete
const canvas = page.locator('[data-hero-canvas]');
await canvas.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log('wrote', out);
