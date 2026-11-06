// Local preview of the Shopify theme — renders the real Liquid templates with liquidjs and stubs
// only Shopify's globals (shop, request, routes, form handling). It exists so the theme can be
// QA'd (Playwright, Lighthouse, axe) without store credentials. Not used in production.
//
//   npm run preview            → http://localhost:4173
//   PORT=5000 npm run preview
import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Liquid, Tag, Hash } from 'liquidjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'theme');
const PORT = Number(process.env.PORT || 4173);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const locale = JSON.parse(read('locales/en.default.json'));

// ---------- settings: schema defaults + settings_data
function themeSettings() {
  const out = {};
  for (const group of JSON.parse(read('config/settings_schema.json'))) for (const s of group.settings || []) if (s.id && 'default' in s) out[s.id] = s.default;
  const data = JSON.parse(read('config/settings_data.json'));
  const cur = typeof data.current === 'string' ? data.presets[data.current] : data.current;
  return { ...out, ...cur };
}

// ---------- section schema defaults
const schemaCache = new Map();
function sectionSchema(type) {
  if (!schemaCache.has(type) || process.env.NO_CACHE !== '0') {
    const src = read(`sections/${type}.liquid`);
    const m = src.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
    schemaCache.set(type, m ? JSON.parse(m[1]) : { settings: [] });
  }
  return schemaCache.get(type);
}
const defaults = (list = []) => Object.fromEntries(list.filter((s) => s.id && 'default' in s).map((s) => [s.id, s.default]));
function buildSection(id, cfg) {
  const schema = sectionSchema(cfg.type);
  const blockTypes = Object.fromEntries((schema.blocks || []).map((b) => [b.type, b]));
  let blocks;
  if (cfg.blocks) {
    blocks = (cfg.block_order || Object.keys(cfg.blocks)).map((bid) => {
      const b = cfg.blocks[bid];
      return { id: bid, type: b.type, settings: { ...defaults(blockTypes[b.type]?.settings), ...b.settings }, shopify_attributes: '' };
    });
  } else {
    blocks = (schema.default?.blocks || []).map((b, i) => ({ id: `d${i}`, type: b.type, settings: { ...defaults(blockTypes[b.type]?.settings), ...b.settings }, shopify_attributes: '' }));
  }
  return { id, type: cfg.type, settings: { ...defaults(schema.settings), ...cfg.settings }, blocks };
}

// ---------- engine
const engine = new Liquid({ root: [join(ROOT, 'sections'), join(ROOT, 'snippets')], extname: '.liquid', cache: false, strictFilters: true });

const lookup = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), locale);
engine.registerFilter('t', (key) => lookup(key) ?? `translation missing: en.${key}`);
engine.registerFilter('asset_url', (name) => `/assets/${name}?v=dev`);
engine.registerFilter('json', (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
engine.registerFilter('handle', (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
engine.registerFilter('image_url', (img) => img?.src || '');
engine.registerFilter('image_tag', (src) => `<img src="${src}" alt="">`);
engine.registerFilter('preload_tag', (url, ...args) => {
  const attrs = Object.fromEntries(args.filter(Array.isArray));
  return `<link rel="preload" href="${url}"${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>`;
});
engine.registerFilter('stylesheet_tag', (url) => `<link rel="stylesheet" href="${url}">`);
engine.registerFilter('default_errors', (errs) => (errs?.length ? `<ul>${errs.map((e) => `<li>${e === 'email' ? 'Email is invalid.' : e === 'body' ? 'Message can’t be blank.' : 'Please check your entry.'}</li>`).join('')}</ul>` : ''));

engine.registerTag('schema', class extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    while (remain.length) { const t = remain.shift(); if (t.name === 'endschema') return; }
  }
  * render() { return ''; }
});

engine.registerTag('section', class extends Tag {
  constructor(token, remain, liquid) { super(token, remain, liquid); this.name = token.args.trim().replace(/^['"]|['"]$/g, ''); }
  * render(ctx) {
    const data = JSON.parse(read('config/settings_data.json'));
    const cur = typeof data.current === 'string' ? data.presets[data.current] : data.current;
    const cfg = cur.sections?.[this.name] || { type: this.name, settings: {} };
    const section = buildSection(this.name, cfg);
    const tpl = engine.parse(read(`sections/${this.name}.liquid`));
    ctx.push({ section });
    const html = yield engine.renderer.renderTemplates(tpl, ctx);
    ctx.pop();
    return `<div id="shopify-section-${this.name}" class="shopify-section">${html}</div>`;
  }
});

// {% form 'contact', id: 'x', class: 'y', data-validate: '' %} … {% endform %}
engine.registerTag('form', class extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    const args = token.args;
    this.type = (args.match(/^\s*'([^']+)'/) || [])[1];
    this.attrs = [];
    const re = /([\w-]+)\s*:\s*('([^']*)'|"([^"]*)"|([\w.]+))/g;
    let m;
    while ((m = re.exec(args))) this.attrs.push({ key: m[1], literal: m[3] ?? m[4], variable: m[5] });
    this.tpls = [];
    const stream = this.liquid.parser.parseStream(remain).on('tag:endform', () => stream.stop()).on('template', (tpl) => this.tpls.push(tpl)).on('end', () => { throw new Error('form not closed'); });
    stream.start();
  }
  * render(ctx) {
    const attrs = {};
    for (const a of this.attrs) attrs[a.key] = a.variable ? yield this.liquid.evalValue(a.variable, ctx) : a.literal;
    const q = ctx.getSync(['__query']) || {};
    const id = attrs.id || `${this.type}_form`;
    const posted = q.posted_form === id;
    const form = {
      'posted_successfully?': posted && !q.form_errors,
      errors: posted && q.form_errors ? q.form_errors.split(',') : null,
    };
    ctx.push({ form });
    const body = yield this.liquid.renderer.renderTemplates(this.tpls, ctx);
    ctx.pop();
    const attrHtml = Object.entries(attrs).filter(([k]) => k !== 'id').map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`)).join('');
    return `<form method="post" action="/contact#${id}" id="${id}" accept-charset="UTF-8"${attrHtml}><input type="hidden" name="form_type" value="${this.type}"><input type="hidden" name="utf8" value="✓"><input type="hidden" name="form_id" value="${id}">${body}</form>`;
  }
});

// ---------- routes
const ROUTES = {
  '/': { template: 'index', name: 'index', suffix: null, title: 'KUKI', page_type: 'index' },
  '/pages/menu': { template: 'page.menu', name: 'page', suffix: 'menu', title: 'Menu', page_type: 'page' },
  '/pages/gallery': { template: 'page.gallery', name: 'page', suffix: 'gallery', title: 'Gallery', page_type: 'page' },
  '/pages/contact': { template: 'page.contact', name: 'page', suffix: 'contact', title: 'Contact', page_type: 'page' },
  '/pages/careers': { template: 'page.careers', name: 'page', suffix: 'careers', title: 'Careers', page_type: 'page' },
  '/policies/privacy-policy': { template: 'page', name: 'page', suffix: null, title: 'Privacy policy', page_type: 'page', content: '<p>(Privacy policy is managed in Shopify admin → Settings → Policies.)</p>' },
  '/search': { template: 'search', name: 'search', suffix: null, title: 'Search', page_type: 'search' },
};

async function renderPage(path, query, host) {
  const route = ROUTES[path] || { template: '404', name: '404', suffix: null, title: 'Page not found', page_type: '404', status: 404 };
  const tplJson = JSON.parse(read(`templates/${route.template}.json`));
  const settings = themeSettings();
  const base = `http://${host}`;
  const globals = {
    settings,
    shop: { name: 'KUKI', url: base, description: '', locale: 'en' },
    request: { locale: { iso_code: 'en' }, path, page_type: route.page_type, host },
    template: { name: route.name, suffix: route.suffix },
    routes: { root_url: '/', search_url: '/search' },
    canonical_url: base + path,
    page_title: route.title,
    page_description: '',
    page: { title: route.title, content: route.content || '' },
    search: { performed: false },
    content_for_header: '',
    __query: query,
  };
  let content = '';
  for (const id of tplJson.order) {
    const section = buildSection(id, tplJson.sections[id]);
    const html = await engine.parseAndRender(read(`sections/${section.type}.liquid`), { section }, { globals });
    content += `<div id="shopify-section-${id}" class="shopify-section">${html}</div>`;
  }
  const layout = await engine.parseAndRender(read('layout/theme.liquid'), { content_for_layout: content }, { globals });
  return { status: route.status || 200, html: layout };
}

// ---------- tiny form backend mirroring Shopify's server-side checks
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const rate = new Map();
function handleContact(body, referer) {
  const p = new URLSearchParams(body);
  const anchor = (referer.split('#')[1] || '').trim();
  const path = (referer.split('?')[0].split('#')[0] || '/').replace(/^https?:\/\/[^/]+/, '') || '/';
  const errors = [];
  if (!EMAIL.test(p.get('contact[email]') || '')) errors.push('email');
  if (p.get('form_type') === 'contact' && p.has('contact[body]') && p.get('contact[Source]') === 'Contact form' && !(p.get('contact[body]') || '').trim()) errors.push('body');
  const formId = p.get('form_id') || anchor;
  const qs = new URLSearchParams({ posted_form: formId, [`${p.get('form_type')}_posted`]: errors.length ? 'false' : 'true' });
  if (errors.length) qs.set('form_errors', errors.join(','));
  return `${path}?${qs}#${formId}`;
}

const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.avif': 'image/avif', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "block-all-mixed-content; frame-ancestors 'none'; upgrade-insecure-requests",
};

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/assets/')) {
        const file = join(ROOT, 'assets', url.pathname.slice(8));
        if (!file.startsWith(join(ROOT, 'assets')) || !existsSync(file)) { res.writeHead(404); return res.end(); }
        const ext = extname(file);
        const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', ...SECURITY };
        if (['.css', '.js'].includes(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
          const buf = gzipSync(readFileSync(file));
          res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length });
          return res.end(buf);
        }
        const size = statSync(file).size;
        const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Number(range[2]) : size - 1;
          res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          return createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
        return createReadStream(file).pipe(res);
      }
      if (req.method === 'POST' && url.pathname === '/contact') {
        const key = req.socket.remoteAddress;
        const now = Date.now();
        const hits = (rate.get(key) || []).filter((t) => now - t < 60000);
        hits.push(now);
        rate.set(key, hits);
        if (hits.length > 20) { res.writeHead(429); return res.end('Too many requests'); }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
        req.on('end', () => {
          const location = handleContact(body, req.headers.referer || '/');
          res.writeHead(303, { Location: location });
          res.end();
        });
        return;
      }
      const query = Object.fromEntries(url.searchParams);
      const { status, html } = await renderPage(url.pathname.replace(/\/$/, '') || '/', query, req.headers.host);
      const buf = /gzip/.test(req.headers['accept-encoding'] || '') ? gzipSync(html) : Buffer.from(html);
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...(buf.length !== Buffer.byteLength(html) ? { 'Content-Encoding': 'gzip' } : {}), 'Cache-Control': 'no-cache', ...SECURITY });
      res.end(buf);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Preview render error (see server log).');
    }
  })
  .listen(PORT, () => console.log(`KUKI theme preview → http://localhost:${PORT}`));
