// Builds optimised theme assets from the original KUKI images in /source-assets.
//  - every image -> <name>-sm / <name>-lg in AVIF + WebP (capped at original width)
//  - generates snippets/kuki-asset-dims.liquid so Liquid can emit width/height (no CLS)
//  - subsets/instances the variable fonts
//  - re-encodes the brand videos (H.264, faststart, no audio) + poster frames
// Run: npm run assets
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'source-assets');
const OUT = join(root, 'theme', 'assets');
const SNIPPETS = join(root, 'theme', 'snippets');
mkdirSync(OUT, { recursive: true });

// name -> [source file, sm width, lg width]
const images = {
  // ---- Menu: Kuki's & Cream
  'm-belgian-brookie-cream': 'dbYxrCMe3GxIdHc2bnnMcVGeDjI',
  'm-pistachio-brookie-cream': 'nFbL5rLrKjI294BHMO2xH31nYQ8',
  'm-hazelnut-brookie-cream': 'EL8GHlrGt0Py1oNMRbNLydwBJM',
  'm-caramel-brookie-cream': 'sTL2EJ21wZQKJU167KtMGSNlD8',
  'm-kuki-doh': 'wXkt8I5AFwZbshJYqdSjlZZbzD4',
  'm-brookie-cream': '13V7LE3AOgYS31LQ7AUlpWkAvOU',
  // ---- Menu: Cookies
  'm-classic-kuki': 'vTHBrIvzTNtXtNMxky0HnI0j3GA',
  'm-double-chocolate-kuki': 'HRAZqQhkxx4uFCf9VuZFRX7j4',
  'm-belgian-kuki': 'XFBGQW69jqGX0fmX0XybDdHqEw',
  'm-hazelnut-kuki': 'x84p0JqGrVFAeMotcNzEUNgZgfQ',
  'm-lemon-kuki': 'w2e4PVgOn4wEupJ4OfScEqyr4fE',
  'm-tiramisu-kuki': 'TOsTfMyfcU1DM3f1qszxj9dgQBc',
  'm-kuki-dough-cheesecake': '1N5JE8zOU9N77H5Uz7qKz2HyqA',
  'm-fistiki-jam-kuki': 'AqhHKjbCV7MXL161QTDbOmQ9iFg',
  'm-strawberry-cloud': 'reT1tLVfvRrxUyzIVfBwwTJv70',
  'm-brookie': 'TjXsbi5XZDT5IAx8EeNFpxzoPg',
  // ---- Menu: Coffee / Hot chocolate
  'm-freddo-espresso': '0bbHiRr0Z1yu6cR3gUyQINMPF08',
  'm-cappuccino': 'OAm7X3GnzZUKx2nHrws4g3O57I',
  'm-flat-white': 'PLEgiwRiyTKyQMqrKXzXUM8Z4',
  'm-espresso': 'DuBMuIjhcfd2tGGc514CBmecaG0',
  'm-cappuccino-latte': 'LL1QPa4momkmiHJTiXFKI74W3Y',
  'm-espresso-macchiato': 'GktTM3FVLO3nsbpORHaCeU8FCs',
  'm-freddo-cappuccino': 'LWdvsOMyddNDQQAVcjSHBQLVrs',
  'm-salted-caramel-hot-chocolate': 'anA0ma5iCEWQ2xv92qJh47w0VDU',
  // ---- Menu: Kuki Rolls
  'm-kuki-roll': 'cedT40O9eyK8SARfbsTFhWDI7gQ',
  'm-kuki-roll-salted-caramel': 'E3PKktRGulmiTHP0FuAIDDJpU',
  'm-kuki-roll-belgian': '9BXGXfYZPgcUOC6uJE7O9jplOA',
  'm-kuki-roll-fistiki': 'cjWRFgtRAYby5uDbJKFD1Wd5LyQ',
  // ---- Hero: first frame of the 3D cookie (scripts/render-hero-fallback.mjs), transparent PNG
  'c-hero-cookie': 'hero-cookie-render.png',
  'c-hero-box-open': 'hero-box-open-render.png',
  // ---- Transparent cut-outs
  'c-cookie-1': 'Q84IqwlizS458fY1jVkYtX9wLso',
  'c-cookie-2': 'TUvQ5AiLhFtleEHZBYem2oSs7g',
  'c-cookie-3': 'SP58UKWcxOKthYynLnjpqmPar0',
  'c-cookie-4': 'CelVwx9iyClBAcpyjLGWaHyyWXw',
  'c-cookie-5': 'fyCULEvT4sZWrjErN99wAiNCsbQ',
  'c-cookie-6': 'c9gx5TCm1jB0ww682B4no2us0E',
  'c-cookie-7': 'WT88YZg9bhrZt0zTECNqx2MXwqs',
  'c-cookie-8': 'T2NYvDnjVop7rN6byBMOOBXWH4',
  // ---- Lifestyle / gallery
  'g-flatlay': '89s36C4daYLnsMpjDTN8yzt6s',
  'g-assortment': 'NJfB3awvaE4nskvMskOsbkfiYwY',
  'g-counter': 'wDAJhczdLRPfzKnFtqcGQSTUoNM',
  'g-box-flatlay': 'RFliy4ar2Tb9OX0hfUaR2hEgxFI',
  'g-selection': 'DljGAjMpDWFWo0WZPiudkJTU6Q',
  'g-mix': 'icSp7VFtK2GfrfqF4lxjKZfsE',
  'g-coffee-flatlay': 'wJqVng7ufnyfs0VtoWKi4mBtk',
  'g-cup-hand': '5jIz0ac1X82oUXWk6Ii1RipfAkw',
  'g-cup-caramel': '84EeyJX4H3lcaeuRmFIwSZFgyo4',
  'g-cups-counter': 'UNa6laL6ZZCZVvcNntAHPi1oSdU',
  'g-cups-store': 'bif3PYQX02g5wqYJmDolY3AY',
  'g-cup-held': 'vbRkRsv3psIiT4eEZDOZpbxP4EA',
  'g-box-hazelnut': 'dLpu2mHLCupBFSOJt2OntL3xiY',
  'g-box-pistachio': 'T96y2AjkxvQw4jbFSFYhfVn9Yc',
  'g-brownie-box': 'la6AsMuMHq83FA3O4SHbaC81fQc',
  'g-brookie-box': 'B6GSCeDj5LCHdL4IeUhOUnoTyI',
  'g-brookie-lotus': 'BG2iuPrGonD9XwDj8BaRab0fSI',
  'g-brookie-pistachio': 'BGmuvCulRkWv3XUJDi1dCpIGw',
  'g-brookie-crumble': 'M1BeVg5wqTxwyR1I4yJTi9Nl8',
  'g-cookie-box': 'Kbxqod2f77bbSwpDqBrviNFY',
  'g-dark-cookie-box': '8wXLO1FWElqV4OrpDFBF3W4srA',
  'g-lotus-box': 'DLRkum44LQ97XwmyN6hNLTX2L8',
  'g-swirl-box': 'TSr9VXgEnWaNjp85Sz6pAzItpTw',
  'g-pink-box': 'ScZyDAZTQ55nUJ3NSTnXCqveU',
  // ---- Mascot illustrations (white bg -> multiplied onto cream in CSS)
  'i-mascot-wave': 'LzPnbnQK3TUqFu6cQXWqzpENc',
  'i-mascot-thumbs': 'lz9ZVLoh8BPENBRsJZUTf63uu2U',
  'i-mascot-cookie': 'XaY06HkHuUOuTjdcLfSPiaSoKtM',
  'i-mascot-milk': '8wEH8UCKXx4UXJ0B6ziNZfn44M',
  'i-mascot-drink': 'qUMvAY536HwXv4Hmf8nw3dzuuc',
  'i-mascot-ball': 'mi9PYZt8rmRZpDWBUHwVZjOWuY',
  'i-mascot-face': 'wkIvtfTUFMe5TnP0iYlj1qX8I',
  'i-mascot-crowd': 'zqQMbKEUns1RQHnpF2Uxor1KBg',
};
const SM = 480;
const LG = 1200;

const dims = [];
for (const [name, file] of Object.entries(images)) {
  const input = join(SRC, file.includes('.') ? file : `${file}.webp`);
  const meta = await sharp(input).metadata();
  const lgW = Math.min(LG, meta.width);
  const smW = Math.min(SM, meta.width);
  const lgH = Math.round((meta.height * lgW) / meta.width);
  for (const [suffix, w] of [['sm', smW], ['lg', lgW]]) {
    const base = sharp(input).resize({ width: w, withoutEnlargement: true });
    const avif = join(OUT, `${name}-${suffix}.avif`);
    const webp = join(OUT, `${name}-${suffix}.webp`);
    if (!existsSync(avif)) await base.clone().avif({ quality: 52, effort: 6 }).toFile(avif);
    if (!existsSync(webp)) await base.clone().webp({ quality: 74, effort: 5 }).toFile(webp);
  }
  dims.push([name, lgW, lgH, smW]);
}

// Liquid lookup: outputs "lgW lgH smW" for a given asset name.
let liquid = `{%- comment -%}\n  GENERATED by scripts/build-assets.mjs — do not edit by hand.\n  Returns "<lg width> <lg height> <sm width>" for an image asset base name.\n{%- endcomment -%}\n{%- case name -%}\n`;
for (const [n, w, h, s] of dims) liquid += `{%- when '${n}' -%}${w} ${h} ${s}\n`;
liquid += `{%- else -%}1200 900 480\n{%- endcase -%}\n`;
writeFileSync(join(SNIPPETS, 'kuki-asset-dims.liquid'), liquid);

// Favicon / touch icon / social share image
await sharp(join(SRC, 'kuki-favicon.png')).resize(64, 64, { fit: 'contain', background: '#FFFAEA' }).png().toFile(join(OUT, 'favicon-64.png'));
await sharp(join(SRC, 'kuki-favicon.png')).resize(180, 180, { fit: 'contain', background: '#FFFAEA' }).png().toFile(join(OUT, 'apple-touch-icon.png'));
await sharp(join(SRC, '89s36C4daYLnsMpjDTN8yzt6s.webp')).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 78, mozjpeg: true }).toFile(join(OUT, 'og-image.jpg'));

// ---- Fonts: pin Fraunces to its soft display cut, subset to Latin; Manrope Latin + Greek.
const fontDir = join(root, 'node_modules', '@fontsource-variable');
const py = (args) => execFileSync('python3', ['-I', '-m', ...args], { stdio: 'inherit' });
const unicodes = 'U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+20AC,U+2122';
for (const style of ['normal', 'italic']) {
  const src = join(fontDir, 'fraunces', 'files', `fraunces-latin-full-${style}.woff2`);
  const tmp = join(root, 'node_modules', `.fraunces-${style}.ttf`);
  py(['fontTools.varLib.instancer', src, 'opsz=144', 'SOFT=100', 'WONK=0', 'wght=400:800', '-o', tmp, '-q']);
  py(['fontTools.subset', tmp, `--unicodes=${unicodes}`, '--flavor=woff2', '--layout-features=kern,liga,calt', `--output-file=${join(OUT, `fraunces-soft-${style}.woff2`)}`]);
}
for (const sub of ['latin', 'greek']) {
  execFileSync('cp', [join(fontDir, 'manrope', 'files', `manrope-${sub}-wght-normal.woff2`), join(OUT, `manrope-${sub}.woff2`)]);
}

// ---- Videos: 720px wide H.264, CRF 28, no audio, faststart + webp poster.
const videos = { 'v-store-opening': 'bAYOQjlP4NKPzCR8k6SmpySV4', 'v-mascot': '04xgIh3HceHCoraNvHWST0bU', 'v-store-counter': 'qHFFdO8usQeK4AaqzElG648yzI0', 'v-cookie-character': '6NPzbgnqsNH1Xr4MdonXq1c79k' };
for (const [name, file] of Object.entries(videos)) {
  const out = join(OUT, `${name}.mp4`);
  if (!existsSync(out)) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(SRC, `${file}.mp4`), '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out]);
  }
  const poster = join(OUT, `${name}-poster.webp`);
  if (!existsSync(poster)) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '0.5', '-i', out, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '70', poster]);
  }
}

let total = 0;
for (const f of execFileSync('ls', [OUT]).toString().trim().split('\n')) total += statSync(join(OUT, f)).size;
console.log(`assets ready: ${dims.length} images, ${(total / 1024 / 1024).toFixed(1)} MB in theme/assets`);
