// Renders two stills of the 3D hero (transparent PNGs), so the static images are pixel-identical to it:
//  - source-assets/hero-cookie-render.png   the closed box = the 3D's first frame (shown until it loads)
//  - source-assets/hero-box-open-render.png the open box with the cookie risen (no-3D / reduced motion)
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
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'source-assets');

const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [file, at] of [['hero-cookie-render.png', 0], ['hero-box-open-render.png', 30]]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(process.env.BASE_URL || 'http://localhost:4173/', { waitUntil: 'networkidle' });
  // Isolate the canvas on a transparent page.
  await page.addStyleTag({
    content: `html, body, .hero { background: transparent !important; }
      body > :not(main), .hero__copy, .hero__fallback, .hero__mascot, .hero__scroll, .hero__shadow,
      main > :not(:first-child) { visibility: hidden !important; }
      .hero__canvas { -webkit-mask-image: none !important; mask-image: none !important; transition: none !important; }`,
  });
  await page.evaluate((t) => (document.querySelector('[data-hero]').dataset.introAt = String(t)), at);
  await page.keyboard.press('Shift'); // first interaction → loads the 3D (no pointer tilt)
  await page.waitForSelector('.hero.is-3d', { timeout: 60000 });
  await page.waitForTimeout(80); // the very first frame (no fade: transition disabled above)
  await page.locator('[data-hero-canvas]').screenshot({ path: join(SRC, file), omitBackground: true });
  await page.close();
  console.log('wrote', file);
}
await browser.close();
