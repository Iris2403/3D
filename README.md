# KUKI Flagship — Shopify theme

A full redesign of [kukiworld.com](https://kukiworld.com/) as a Shopify Online Store 2.0 theme, featuring
an interactive 3D hero: the sage KUKI box opens and a real Classic Kuki rises out of it. Brand palette: **sage, chocolate brown and butter yellow**
(tokens at the top of `src/styles/kuki.css`).

The existing site already runs on Shopify, with a custom Framer-exported theme. The redesign **keeps
that stack**. Shopify continues to host the site and to handle every form, with server-side validation,
spam/bot protection and rate limiting. All ordering links still go to the destination that works today.
Nothing is mocked.

```
theme/            ← the Shopify theme (this is what gets uploaded)
  layout/         theme.liquid (head, fonts, meta, global dialogs)
  sections/       hero, marquee, story, lineup, about, process, testimonials, locations,
                  gallery, cta-band, faq, newsletter, page-hero, menu, contact-form, careers, …
  snippets/       responsive picture, icons, product card/dialog, lightbox, meta tags, JSON-LD
  templates/      JSON templates (index, page.menu, page.gallery, page.contact, page.careers, …)
  config/ locales/ assets/
src/              ← TypeScript + CSS sources (built into theme/assets)
  main.ts         core bundle (6 KB gzip): header, dialogs, reveals, carousel, menu filter,
                  process track, store finder, lightbox, forms, videos, hero loader
  modules/hero3d.ts   lazy chunk: the WebGL box + cookie (three.js)
  styles/kuki.css     design system
scripts/          build-assets.mjs (images/fonts/videos), gen-templates.py (verified content)
preview/          local Liquid renderer used for QA (not deployed)
tests/e2e.mjs     Playwright + axe-core test suite
source-assets/    original images & videos downloaded from the current theme
```

## GitHub Pages preview

Every push to `main` publishes a static preview to **https://iris2403.github.io/3D/** via
`.github/workflows/pages.yml`. The workflow builds the theme and runs `scripts/export-static.mjs`.
Pages can't run Shopify, so the forms validate as normal and then show a "preview only" note.
Everything else (3D hero, menu, gallery, store finder, dialogs) works as it will on the store.
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Commands

```bash
npm install
npm run build          # CSS + JS → theme/assets
npm run preview        # http://localhost:4173 — renders the real Liquid locally
npm run test:e2e       # 20 functional + accessibility checks (needs the preview running)
npm run assets         # re-generate optimised images/fonts/videos from source-assets/
npm run templates      # re-generate templates/*.json from scripts/gen-templates.py
```

## Deploying to the KUKI store

1. `npm run build`
2. Upload the theme **unpublished**, then preview it before publishing. Either:
   - Shopify CLI: `shopify theme push --path theme --unpublished`, or
   - Admin → Online Store → Themes → Add theme → Upload zip (`dist/kuki-theme.zip`).
3. Make sure the four pages exist with these handles and **templates**. The current store already has
   `careers`, `contact` and `gallery`; create `menu`:
   | Page | Handle | Template |
   |---|---|---|
   | Menu | `menu` | `page.menu` |
   | Gallery | `gallery` | `page.gallery` |
   | Contact | `contact` | `page.contact` |
   | Careers | `careers` | `page.careers` |
4. Preview → Publish.

## Required / recommended configuration (no code changes needed)

| What | Where | Why |
|---|---|---|
| **Order link** | Theme settings → Ordering | Every ORDER button uses it. It currently points to Instagram (@kuki.ath), the same as the old site. Paste a Wolt/efood/shop link here when one exists. |
| Bot protection | Admin → Online Store → Preferences → *Spam protection*: enable hCaptcha on contact & sign-up forms | Server-side spam/abuse protection for all three forms. |
| Contact email | Admin → Settings → Store details → Sender email | Franchise and careers submissions are emailed here. |
| Privacy policy | Admin → Settings → Policies | Linked from every form's consent/privacy notice (`/policies/privacy-policy`). |
| Newsletter subscribers | Admin → Customers (tag `newsletter`) | Native Shopify email-marketing consent; connect Shopify Email or another tool to send. |
| Page SEO titles/descriptions | Each page's *Search engine listing* | Optional: the theme has good defaults. |
| Store coordinates | Theme editor → Locations → each store | The "nearest store" sort uses **approximate** coordinates; replace them with exact ones if you want. The live Google Map and directions always use the exact address. |
| Reviews | Theme editor → Testimonials → add blocks | Add more genuine reviews, verbatim, with an optional link to the source. |
| Images | Theme editor → any image block | Every image can be replaced with an upload; Shopify's CDN then serves responsive AVIF/WebP automatically. |

## Content decisions (please review)

- **Testimonials:** the old theme showed two wine-tour reviews ("Venikos Wine Window", "Nemea") that
  are template placeholders, not KUKI reviews. **Removed.** The one genuine KUKI review is kept
  verbatim and attributed to *George A., Google Reviews*. The old layout made that attribution ambiguous,
  so please confirm it.
- **Menu descriptions:** several items reused another product's description (e.g. Lemon Kuki had the
  hazelnut text, and Strawberry Cloud, Fistiki Jam and Dough Cheesecake had the tiramisu text). Those
  descriptions were **removed rather than guessed**: Lemon Kuki, Kuki Dough Cheesecake, Fistiki Jam Kuki,
  Strawberry Cloud, Brookie & Cream, Espresso, Cappuccino Latte, Espresso Macchiato, Freddo Cappuccino and
  the four Kuki Rolls. Add the real ones in Theme editor → Menu.
- **Prices, names, addresses, FAQ, careers copy:** copied verbatim from the live site (Nov 2026).
- Pillar 04 was titled "Sustainable", but its text is about baking daily, so it's now titled **"Baked Daily"**.
- Careers → Kifisia said "No open roles today" but carried a "Hiring now" badge. The badge is turned off.
- No opening hours, phone numbers, ratings or dietary labels are shown, because the current site
  doesn't publish them. None were invented, in the page or in structured data.

## Architecture notes

**3D hero** (`src/modules/hero3d.ts`)
- The cookie is a **real 3D model of the Classic Kuki**: `theme/assets/kuki-cookie.glb` (glTF 2.0,
  511 KB, ~17.8k vertices, validated with the Khronos glTF validator: 0 errors, 0 warnings).
  It is reconstructed from the product render `source-assets/kuki-cookie-render.webp`:
  `scripts/build-cookie-maps.py` unwarps the 3/4 shot into a top-down colour map, unwraps the
  visible side wall, and derives a relief map (melted chocolate, crumble and salt stand proud), a
  normal map (crust detail) and the cookie's real outline; `scripts/build-cookie-glb.mjs` builds
  the mesh (domed relief top, puffy rim, side wall, base) with MikkTSpace tangents and writes the GLB
  (meshopt-compressed geometry, WebP textures). The underside, never visible in the photo, is
  synthesised from the side crust. To use a different model (e.g. a photogrammetry scan), upload it
  in Settings → Files and paste its URL in the hero section's "3D model URL" setting.
- **The box:** KUKI's sage packaging, built in code (no extra download). It has "Kuki" on the lid and,
  inside the lid, the four-step print from the real box ("Step 1 … Step 4: Smile & Repeat"), drawn with
  the brand's own mascot illustrations. On load the closed box gives a little hop, the lid swings open
  and the cookie rises out and turns towards you, with a few sea-salt flakes. Scrolling away lowers
  the cookie back towards the box. Drag or swipe sideways to spin the cookie.
- **Static images** are rendered from the 3D scene itself (`scripts/render-hero-fallback.mjs`).
  The closed box is shown until the 3D loads, so the opening plays from exactly that picture. The
  open box with the risen cookie is shown wherever the 3D never runs (reduced motion, no WebGL,
  Save-Data, no JavaScript, or *3D cookie → Off*). After changing the scene, re-run that script,
  delete `theme/assets/c-hero-*`, then run `npm run assets`.
- It loads only after the page has loaded **and** the visitor first interacts (move, scroll, touch,
  key). Until then the closed-box image floats with a compositor-only CSS animation.
- Initialisation is cooperative: it yields every ~8 ms and compiles shaders with `compileAsync`, so
  there are no long tasks. Rendering happens only while the hero is on screen and the tab is visible.
  After 6 s without input the cookie eases to rest and **stops rendering**; any input wakes it.
- Adaptive quality: 30 fps and lower detail on touch or low-core devices; the resolution drops
  automatically if frames are slow, and the scene falls back to the photo if they're still too slow.
- Mouse gives subtle 3D parallax and moves the key light. A horizontal swipe spins the cookie on
  touch screens; vertical scrolling is never blocked. Scrolling tilts, scales and lowers the cookie
  as the next section arrives, with no scroll hijacking.
- Skipped entirely for `prefers-reduced-motion`, Save-Data or 2G, under 2 GB device memory, without
  WebGL, or when the merchant sets *Hero → 3D cookie → Off*.

**Progressive enhancement:** every section works without JavaScript. Content, links, forms and
`<details>` FAQs are real HTML, and the menu groups render with headings. JS only adds motion,
dialogs, the carousel buttons, filtering and so on.

**Security**
- Forms are native Shopify `contact`/`customer` forms with the same field names as before.
  Validation happens on the server; the client adds accessible checks, a honeypot and
  double-submit protection.
- No `innerHTML` anywhere. Dynamic text uses `textContent`, all Liquid output of merchant text is
  `| escape`d, and JSON-LD goes through `| json`. An XSS payload test is part of the e2e suite.
- No API keys or secrets. The store map is Google's keyless embed (lazy-loaded), so no key is needed.
- Every `target=_blank` link has `rel=noopener`.
- Shopify already serves HSTS, `X-Frame-Options: DENY`, `nosniff` and a CSP with
  `frame-ancestors 'none'`. The theme adds `object-src 'none'; base-uri 'self'` and a strict
  referrer policy. A full `script-src` allowlist can't be set from a Shopify theme without breaking
  Shopify's own injected scripts. If that's ever required, it has to be done at the edge (e.g. a
  Cloudflare worker) or in a headless build.
- The GitHub Pages preview can't send response headers, so `scripts/export-static.mjs` gives it a strict
  `<meta>` CSP instead: scripts only from the site itself plus the page's exact inline scripts (by
  SHA-256 hash), and no plugins, foreign forms or foreign frames except the Google Map. Header-only
  protections (`X-Frame-Options`, `nosniff`, `Permissions-Policy`, `frame-ancestors`) can't be set on
  Pages. Header scanners such as securityheaders.com only read real headers, so they will still flag
  the preview. On the store, Shopify sends `X-Frame-Options: DENY`, `nosniff`, HSTS and a CSP with
  `frame-ancestors 'none'` (checked on kukiworld.com, Nov 2026). A `Permissions-Policy` header would need
  an edge proxy such as Cloudflare.
- Geolocation is requested only when the visitor clicks "Find my nearest Kuki", and the position
  never leaves the device.

**SEO:** semantic landmarks with one `h1` per page and no skipped heading levels; unique titles and
descriptions; canonical, Open Graph and Twitter tags; JSON-LD for Organization, WebSite, a Bakery
for each of the 7 stores (addresses only), FAQPage, and Menu (sections, items, EUR prices). Shopify
generates `sitemap.xml` and `robots.txt` automatically.

## QA results (local preview, headless Chromium)

See `lighthouse-results.txt`. Lighthouse 12, mobile = simulated slow 4G + 4× CPU:

| Page | Mobile perf | Desktop perf | A11y | Best practices | SEO | Mobile LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|---|
| Home | 99 | 100 | 100 | 100 | 100 | 2.0 s | 0 | 0 ms |
| Menu | 99 | 100 | 100 | 100 | 100 | 1.9 s | 0 | 0 ms |
| Gallery | 99 | 100 | 100 | 100 | 100 | 2.2 s | 0 | 0 ms |
| Contact | 100 | 100 | 100 | 100 | 100 | 1.7 s | 0 | 0 ms |
| Careers | 99 | 100 | 100 | 100 | 100 | 1.9 s | 0 | 0 ms |

- `npm run test:e2e`: 20/20 pass. This covers links, CTAs, the product dialog, carousel, mobile
  menu focus trap, menu filter, lightbox, store finder and geolocation, FAQ keyboard use,
  newsletter/contact/careers validation and submission, a server-side rejection test, the honeypot,
  3D lazy-load/idle-stop/reduced-motion, a no-JS render, axe-core WCAG 2.2 AA on all pages at both
  sizes, heading order, and touch-target sizes.
- `shopify theme check`: 49 files, 0 offenses.
- `npm audit`: 0 vulnerabilities.

**Not yet verified:** real Safari/iOS, Firefox and Android hardware. Only Chromium is available in
the build environment. The theme uses only well-supported features (`<dialog>`, `content-visibility`
with `@supports`, AVIF with WebP fallback), but run a quick pass on real devices after uploading.
Real-world Core Web Vitals (field data at p75) will appear in Shopify's Web Performance dashboard
about 28 days after launch.
