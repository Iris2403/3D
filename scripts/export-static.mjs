// Static export of the theme for GitHub Pages (a visual preview — Pages cannot run Shopify).
// Renders every route with the local Liquid preview server, rewrites root-relative URLs for a
// project site base path (e.g. /3D), and copies theme/assets.
//
//   BASE_PATH=/3D SITE_URL=https://user.github.io/3D node scripts/export-static.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'site');
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const PORT = 4199;
const ORIGIN = `http://localhost:${PORT}`;

const ROUTES = {
  '/': 'index.html',
  '/pages/menu': 'pages/menu/index.html',
  '/pages/gallery': 'pages/gallery/index.html',
  '/pages/contact': 'pages/contact/index.html',
  '/pages/careers': 'pages/careers/index.html',
  '/policies/privacy-policy': 'policies/privacy-policy/index.html',
  '/404': '404.html',
};

// On Pages there is no Shopify backend: forms validate as usual, then explain instead of POSTing.
const PAGES_NOTICE = `<script>
document.addEventListener('submit', function (e) {
  if (e.defaultPrevented) return;
  e.preventDefault();
  var f = e.target, n = f.querySelector('.pages-note');
  if (!n) { n = document.createElement('p'); n.className = 'form-status form-status--ok pages-note'; n.setAttribute('role', 'status'); f.prepend(n); }
  n.textContent = 'Preview only: this form is sent through Shopify once the theme is installed on the store.';
  var b = f.querySelector('[type=submit]'); if (b) { b.disabled = false; b.removeAttribute('aria-busy'); }
}, false);
</script>`;

function rewrite(html) {
  if (SITE_URL) html = html.split(ORIGIN).join(SITE_URL);
  // Root-relative URLs in attributes (href, src, srcset, action, poster, imagesrcset, content) and CSS url().
  html = html.replace(/(\s(?:href|src|action|poster|content|data-texture)=")\/(?!\/)/g, `$1${BASE}/`);
  html = html.replace(/((?:srcset|imagesrcset)=")([^"]*)"/g, (_, a, v) => `${a}${v.replace(/(^|,\s*)\/(?!\/)/g, `$1${BASE}/`)}"`);
  html = html.replace(/url\(\/(?!\/)/g, `url(${BASE}/`);
  return html.replace('</body>', `${PAGES_NOTICE}\n</body>`);
}

const server = spawn(process.execPath, [join(root, 'preview', 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('preview') && resolve()));

try {
  rmSync(OUT, { recursive: true, force: true });
  for (const [route, file] of Object.entries(ROUTES)) {
    const res = await fetch(ORIGIN + route, { headers: { host: `localhost:${PORT}` } });
    const html = await res.text();
    if (!html.includes('</html>')) throw new Error(`render failed for ${route}`);
    const dest = join(OUT, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, rewrite(html));
    console.log(`${route} → site/${file}`);
  }
  cpSync(join(root, 'theme', 'assets'), join(OUT, 'assets'), { recursive: true });
  writeFileSync(join(OUT, '.nojekyll'), '');
  console.log(`static site ready in site/ (base path "${BASE || '/'}")`);
} finally {
  server.kill();
}
