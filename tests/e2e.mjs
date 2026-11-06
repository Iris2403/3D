// End-to-end + accessibility checks against the local theme preview.
//   npm run preview   (in another terminal)
//   npm run test:e2e
// Uses playwright-core with the system Chromium; axe-core for WCAG 2.2 AA rules.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let passed = 0;
let failed = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}\n      ${String(e.message).split('\n')[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let executablePath;
try {
  executablePath = require('playwright').chromium.executablePath();
} catch {
  executablePath = EXEC;
}
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && page.errors.push(m.text()));
  // Failed sub-resources (the intentional 404 *document* is excluded).
  page.on('response', (r) => r.status() >= 400 && r.request().resourceType() !== 'document' && page.errors.push(`${r.status()} ${r.url()}`));
  return page;
}

const PAGES = ['/', '/pages/menu', '/pages/gallery', '/pages/contact', '/pages/careers', '/does-not-exist'];

// ---------------------------------------------------------------- functionality
await test('every page renders without JS errors or horizontal overflow (desktop + mobile)', async () => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 740 }]) {
    const page = await newPage({ viewport: vp });
    for (const path of PAGES) {
      const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
      assert(res.status() === (path === '/does-not-exist' ? 404 : 200), `${path} status ${res.status()}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 0, `${path} @${vp.width}px overflows by ${overflow}px`);
    }
    assert(page.errors.length === 0, `console errors: ${page.errors.join(' | ')}`);
    await page.context().close();
  }
});

await test('all internal links resolve (no 404s) and external links open safely', async () => {
  const page = await newPage();
  const internal = new Set();
  for (const path of PAGES.slice(0, 5)) {
    await page.goto(BASE + path);
    const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
    for (const l of links) {
      if (l.href.startsWith('/') || l.href.startsWith('#')) internal.add(l.href.startsWith('#') ? path + l.href : l.href);
      if (l.target === '_blank') assert(/noopener/.test(l.rel), `${l.href} target=_blank without rel=noopener`);
      assert(!l.href.startsWith('http://'), `insecure link ${l.href}`);
    }
  }
  for (const href of internal) {
    const [p, hash] = href.split('#');
    const res = await page.goto(BASE + (p || '/'));
    assert(res.status() === 200, `${href} → ${res.status()}`);
    if (hash) assert(await page.$(`#${hash}`), `${href}: anchor #${hash} missing`);
  }
  await page.context().close();
});

await test('order CTAs point to the configured order destination', async () => {
  const page = await newPage();
  await page.goto(BASE + '/');
  const hrefs = await page.$$eval('a', (as) => as.filter((a) => /order/i.test(a.textContent)).map((a) => a.href));
  assert(hrefs.length >= 4, `only ${hrefs.length} order links`);
  assert(hrefs.every((h) => h === 'https://www.instagram.com/kuki.ath/'), `unexpected order link ${hrefs.find((h) => !h.includes('instagram'))}`);
  await page.context().close();
});

await test('product card opens an accessible dialog; Esc closes and focus returns', async () => {
  const page = await newPage();
  await page.goto(BASE + '/');
  const card = page.locator('#lineup [data-product]').first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  const dialog = page.locator('#product-dialog');
  await dialog.waitFor({ state: 'visible' });
  assert((await page.locator('[data-pd-name]').textContent()) === 'Classic Kuki', 'wrong product name');
  assert((await page.locator('[data-pd-price]').textContent()) === '€3.60', 'wrong price');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert(await card.evaluate((el) => el === document.activeElement), 'focus not returned to card');
  await page.context().close();
});

await test('carousel next/prev buttons scroll the line-up', async () => {
  const page = await newPage();
  await page.goto(BASE + '/');
  const track = page.locator('[data-carousel-track]');
  await track.scrollIntoViewIfNeeded();
  const before = await track.evaluate((el) => el.scrollLeft);
  await page.click('[data-carousel-next]');
  // Wait for the outcome rather than a fixed delay (the click may also start the 3D hero).
  await page.waitForFunction((b) => document.querySelector('[data-carousel-track]').scrollLeft > b, before, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[data-carousel-prev]').disabled, null, { timeout: 8000 });
  await page.context().close();
});

await test('mobile menu: opens as modal, traps focus, closes with Esc', async () => {
  const page = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto(BASE + '/');
  await page.click('[data-menu-open]');
  const menu = page.locator('#mobile-menu');
  await menu.waitFor({ state: 'visible' });
  assert((await page.getAttribute('[data-menu-open]', 'aria-expanded')) === 'true', 'aria-expanded not set');
  for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.getElementById('mobile-menu').contains(document.activeElement)), 'focus escaped the menu');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  await page.context().close();
});

await test('menu filter shows one category and announces it', async () => {
  const page = await newPage();
  await page.goto(BASE + '/pages/menu');
  await page.click('[data-filter="coffee"]');
  const visible = await page.$$eval('[data-group]', (gs) => gs.filter((g) => !g.hidden).map((g) => g.dataset.group));
  assert(visible.length === 1 && visible[0] === 'coffee', `visible groups: ${visible}`);
  assert(/Coffee: 7 items/.test(await page.textContent('[data-menu-status]')), 'status not announced');
  await page.context().close();
});

await test('gallery lightbox: opens, arrow keys navigate, Esc closes', async () => {
  const page = await newPage();
  await page.goto(BASE + '/pages/gallery');
  await page.click('[data-gallery-item] >> nth=0');
  await page.locator('#lightbox').waitFor({ state: 'visible' });
  assert(/^Image 1 of 24$/.test(await page.textContent('[data-lb-count]')), 'counter wrong');
  await page.keyboard.press('ArrowRight');
  assert(/^Image 2 of 24$/.test(await page.textContent('[data-lb-count]')), 'arrow nav failed');
  assert((await page.getAttribute('[data-lb-img]', 'alt')).length > 5, 'missing alt in viewer');
  await page.keyboard.press('Escape');
  await page.locator('#lightbox').waitFor({ state: 'hidden' });
  await page.context().close();
});

await test('locations: live Google map follows the selected store; nearest store via geolocation', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 37.87, longitude: 23.755 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  const mapQuery = async () => decodeURIComponent((await page.getAttribute('[data-map-frame]', 'src')).replace(/\+/g, ' '));
  const first = await mapQuery();
  assert(first.startsWith('https://www.google.com/maps?q=') && first.includes('Κωλέττη 11'), 'map not shown from the start: ' + first);
  await page.click('[data-store][data-index="3"] [data-store-select]');
  assert((await page.getAttribute('[data-store][data-index="3"] [data-store-select]', 'aria-pressed')) === 'true', 'store not selected');
  const src = await mapQuery();
  assert(src.includes('Βούλγαρη 134'), 'map did not follow selection: ' + src);
  await page.click('[data-locate]');
  await page.waitForFunction(() => /Glyfada/.test(document.querySelector('[data-locate-status]').textContent));
  assert((await mapQuery()).includes('Μαραγκού 8'), 'map did not move to nearest store');
  const dir = await page.getAttribute('[data-store][data-index="6"] a', 'href');
  assert(dir.startsWith('https://www.google.com/maps/dir/?api=1&destination='), 'directions link wrong');
  await ctx.close();
});

await test('FAQ accordion works with keyboard', async () => {
  const page = await newPage();
  await page.goto(BASE + '/');
  const summary = page.locator('#faq summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  assert(await page.locator('#faq details').first().evaluate((d) => d.open), 'did not open');
  await page.context().close();
});

await test('newsletter: client validation blocks bad email, valid email reaches server and shows success', async () => {
  const page = await newPage();
  await page.goto(BASE + '/');
  const email = page.locator('#newsletter input[type=email]');
  await email.fill('not-an-email');
  await page.click('#newsletter button[type=submit]');
  assert((await email.getAttribute('aria-invalid')) === 'true', 'invalid email not flagged');
  assert(await email.evaluate((el) => el === document.activeElement), 'focus not moved to invalid field');
  await email.fill('cookie.lover@example.com');
  await Promise.all([page.waitForNavigation(), page.click('#newsletter button[type=submit]')]);
  await page.locator('#newsletter .form-status--ok').waitFor();
  await page.context().close();
});

await test('newsletter: server rejects a bad email even when client validation is bypassed', async () => {
  const page = await newPage();
  await page.goto(BASE + '/');
  await page.evaluate(() => {
    const f = document.querySelector('#newsletter form');
    f.querySelector('input[type=email]').value = '<script>alert(1)</script>';
    HTMLFormElement.prototype.submit.call(f); // skips JS validation
  });
  await page.waitForLoadState('networkidle');
  await page.locator('#newsletter .form-status--err').waitFor();
  assert(!(await page.content()).includes('<script>alert(1)</script>'), 'payload reflected');
  await page.context().close();
});

await test('franchise contact form validates required fields and submits', async () => {
  const page = await newPage();
  await page.goto(BASE + '/pages/contact');
  await page.click('#kuki-contact-form button[type=submit]');
  const invalid = await page.$$eval('#kuki-contact-form [aria-invalid=true]', (els) => els.map((e) => e.id));
  assert(invalid.join() === 'cf-name,cf-email,cf-body', `invalid: ${invalid}`);
  await page.fill('#cf-name', 'Maria Papadopoulou');
  await page.fill('#cf-email', 'maria@example.com');
  await page.fill('#cf-city', 'Patras');
  await page.fill('#cf-body', 'I would love to open a KUKI store in Patras.');
  await Promise.all([page.waitForNavigation(), page.click('#kuki-contact-form button[type=submit]')]);
  await page.locator('#kuki-contact-form .form-status--ok').waitFor();
  await page.context().close();
});

await test('careers: "Apply here" pre-selects the store; consent is required', async () => {
  const page = await newPage();
  await page.goto(BASE + '/pages/careers');
  await page.click('[data-apply-store="Glyfada"]');
  assert((await page.inputValue('#ca-store')) === 'Glyfada', 'store not preselected');
  await page.fill('#ca-name', 'Nikos K.');
  await page.fill('#ca-email', 'nikos@example.com');
  await page.click('#kuki-careers-form button[type=submit]');
  assert((await page.getAttribute('#ca-consent', 'aria-invalid')) === 'true', 'consent not enforced');
  await page.check('#ca-consent');
  await Promise.all([page.waitForNavigation(), page.click('#kuki-careers-form button[type=submit]')]);
  await page.locator('#kuki-careers-form .form-status--ok').waitFor();
  await page.context().close();
});

await test('honeypot blocks bot submissions', async () => {
  const page = await newPage();
  await page.goto(BASE + '/pages/contact');
  await page.fill('#cf-name', 'Bot');
  await page.fill('#cf-email', 'bot@example.com');
  await page.fill('#cf-body', 'Buy cheap things now please');
  await page.evaluate(() => (document.querySelector('[data-honeypot]').value = 'http://spam'));
  await page.click('#kuki-contact-form button[type=submit]');
  await page.waitForTimeout(500);
  assert(!page.url().includes('posted'), 'bot form was submitted');
  await page.context().close();
});

await test('3D hero loads lazily on capable desktop and never on reduced-motion', async () => {
  const page = await newPage();
  const scripts = [];
  page.on('request', (r) => r.url().includes('hero3d') && scripts.push(r.url()));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  assert(scripts.length === 0, '3D chunk requested before load');
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  assert(scripts.length === 0, '3D chunk requested without any visitor interaction');
  await page.mouse.move(700, 400);
  await page.mouse.move(760, 420);
  await page.waitForSelector('.hero.is-3d', { timeout: 15000 });
  // Idle: ~6s after the last input the cookie eases to rest and the render loop stops.
  await page.waitForTimeout(11000);
  const frames = await page.evaluate(() => new Promise((res) => {
    const canvas = document.querySelector('[data-hero-canvas]');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    let n = 0; const orig = gl.drawElements.bind(gl);
    gl.drawElements = (...a) => { n++; return orig(...a); };
    setTimeout(() => res(n), 1000);
  }));
  assert(frames === 0, `still rendering while idle (${frames} draw calls/s)`);
  await page.context().close();

  const rm = await newPage({ reducedMotion: 'reduce' });
  const rmScripts = [];
  rm.on('request', (r) => r.url().includes('hero3d') && rmScripts.push(r.url()));
  await rm.goto(BASE + '/', { waitUntil: 'networkidle' });
  await rm.waitForTimeout(2500);
  assert(rmScripts.length === 0, '3D loaded despite reduced motion');
  assert(await rm.isVisible('.hero__fallback-open img'), 'open-box fallback image not visible');
  assert(!(await rm.isVisible('.hero__fallback-closed img')), 'closed-box image shown without 3D');
  await rm.context().close();
});

await test('site works without JavaScript (content, links and forms present)', async () => {
  const page = await newPage({ javaScriptEnabled: false });
  await page.goto(BASE + '/');
  assert(await page.isVisible('h1#hero-title'), 'hero hidden without JS');
  assert(await page.isVisible('#lineup [data-product] >> nth=0'), 'products hidden without JS');
  const opacity = await page.$eval('.pillar', (el) => getComputedStyle(el).opacity);
  assert(opacity === '1', 'reveal content invisible without JS');
  await page.goto(BASE + '/pages/menu');
  assert((await page.$$('[data-group]:not([hidden])')).length === 5, 'menu groups hidden without JS');
  await page.context().close();
});

// ---------------------------------------------------------------- accessibility
await test('axe-core: no WCAG 2.2 A/AA violations on any page (desktop + mobile)', async () => {
  const problems = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await newPage({ viewport: vp, reducedMotion: 'reduce' });
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async () =>
        // eslint-disable-next-line no-undef
        axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }),
      );
      for (const v of res.violations) problems.push(`${path}@${vp.width}: ${v.id} (${v.impact}) ×${v.nodes.length} – ${v.nodes[0].target.join(' ')}`);
    }
    await page.context().close();
  }
  assert(problems.length === 0, problems.join('\n      '));
});

await test('heading hierarchy: one h1 per page, no skipped levels', async () => {
  const page = await newPage();
  for (const path of PAGES) {
    await page.goto(BASE + path);
    const levels = await page.$$eval('h1,h2,h3,h4', (hs) => hs.map((h) => +h.tagName[1]));
    assert(levels.filter((l) => l === 1).length === 1, `${path}: ${levels.filter((l) => l === 1).length} h1s`);
    for (let i = 1; i < levels.length; i++) assert(levels[i] - levels[i - 1] <= 1, `${path}: h${levels[i - 1]} → h${levels[i]}`);
  }
  await page.context().close();
});

await test('touch targets are at least 24×24px (WCAG 2.5.8) on mobile', async () => {
  const page = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const small = [];
  for (const path of PAGES.slice(0, 5)) {
    await page.goto(BASE + path);
    const s = await page.$$eval('a, button, input, select, textarea, summary', (els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const inlineInText = el.tagName === 'A' && !!el.closest('p') && !el.classList.contains('btn');
          return r.width > 0 && cs.visibility !== 'hidden' && !inlineInText && !el.closest('[hidden], dialog:not([open]), .hp, .visually-hidden, .skip-link') && (r.width < 24 || r.height < 24);
        })
        .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`),
    );
    small.push(...s.map((x) => `${path}: ${x}`));
  }
  assert(small.length === 0, small.slice(0, 6).join('\n      '));
  await page.context().close();
});

await browser.close();
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
