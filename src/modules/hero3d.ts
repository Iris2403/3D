/**
 * KUKI hero — a procedurally generated, freshly baked (and freshly bitten) chocolate chunk cookie.
 *
 * Why procedural: no model download, no texture files. The whole scene is ~20 KB of code on top
 * of three.js, deterministic (seeded), and its detail scales with device capability.
 *
 * Cost control
 *  - 1 cookie mesh (~5–9k verts, vertex colours + one 256/512px procedural bump map)
 *  - 3 instanced meshes (chocolate chunks, crumbs, salt flakes) + 1 point cloud → ~6 draw calls
 *  - no real-time shadows (soft contact shadow is a textured quad), no post-processing
 *  - renders only while the hero is on screen and the tab is visible; pixel ratio capped and
 *    lowered automatically if frames are slow; falls back to the photo if still too slow
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  NoToneMapping,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface HeroOptions {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  quality: 'high' | 'low';
  /** Top-down texture of the real cookie (scripts/build-cookie-texture.py). Optional: without it the cookie is fully procedural. */
  texture?: string;
}

/** The real cookie photo: the image (for the material) plus a CPU sampler for surface relief. */
interface Photo {
  image: HTMLImageElement;
  /** Returns luminance (0..1) and "chocolate-ness" (0..1, dark brown pixels) at uv. */
  sample: (u: number, v: number) => { lum: number; choc: number };
}

async function loadPhoto(url: string): Promise<Photo> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.filter = 'blur(1px)';
  ctx.drawImage(image, 0, 0, 512, 512, 0, 0, N, N); // top-view region of the atlas only
  const data = ctx.getImageData(0, 0, N, N).data;
  const sample = (u: number, v: number) => {
    const x = Math.min(N - 1, Math.max(0, Math.round(u * (N - 1))));
    const y = Math.min(N - 1, Math.max(0, Math.round((1 - v) * (N - 1))));
    const i = (y * N + x) * 4;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return { lum, choc: smoothstep(0.36, 0.2, lum) };
  };
  return { image, sample };
}

// Where the real photo is mapped on the top face (uv radius of the cookie in the texture).
const UV_R = 0.485;
// Share of the photo's radius used by the flat top; the outer ring (real crust edge) wraps the rim.
const TOP_SHARE = 0.92;
// A plain-dough patch of the photo, used for the soft interior exposed by the bite.
const DOUGH_UV: [number, number] = [0.43, 0.41];
// Texture atlas (scripts/build-cookie-texture.py): 512×576 — top view in rows 0–511, real side-wall
// strip in rows 512–575. Three's v axis runs bottom-up, so the strip occupies v ∈ [0, 64/576].
const ATLAS_STRIP = 64 / 576;
const topUV = (u: number, v: number): [number, number] => [u, ATLAS_STRIP + v * (1 - ATLAS_STRIP)];
// Keep a texel of margin so filtering never bleeds across the two regions.
const stripV = (t: number) => ATLAS_STRIP * (0.94 - 0.88 * t);
const STRIP_REPEAT = 3; // the side strip wraps the cookie 3× (it is mirrored, so it tiles seamlessly)

// ---------------------------------------------------------------------------------------------
// Deterministic noise helpers
// ---------------------------------------------------------------------------------------------
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq);
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum / norm; // 0..1
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/**
 * Cooperative scheduling: heavy generation work calls `await tick()` often; it only actually
 * yields to the main thread once ~8 ms have passed, so input stays responsive (no long tasks).
 */
type Tick = () => Promise<void>;
function makeTick(budgetMs = 8): Tick {
  let sliceStart = performance.now();
  const sched = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return async () => {
    if (performance.now() - sliceStart < budgetMs) return;
    await (sched?.yield ? sched.yield() : new Promise<void>((r) => setTimeout(r, 0)));
    sliceStart = performance.now();
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Cookie shape
// ---------------------------------------------------------------------------------------------
const R = 1; // outer radius
const H_TOP = 0.25; // dome height at the centre
const Y_BOT = -0.13; // flat base
const yTopProfile = (s: number) => H_TOP * (1 - 0.25 * s * s);
const RIM = (yTopProfile(1) - Y_BOT) / 2; // rounded edge radius
const RIM_CY = (yTopProfile(1) + Y_BOT) / 2;
const INNER = R - RIM;

interface Bite {
  x: number;
  z: number;
  r: number;
}
// A bite = union of overlapping circles (tooth scallops) cutting in from the front-right edge.
const BITE_ANGLE = -0.55;
const BITES: Bite[] = [
  [0, 1.13, 0.37],
  [0.36, 1.17, 0.31],
  [-0.34, 1.17, 0.29],
].map(([da, d, r]) => ({ x: Math.cos(BITE_ANGLE + da) * d, z: Math.sin(BITE_ANGLE + da) * d, r }));

/** Distance along the ray at angle (cos, sin) where it first enters the bite, or Infinity. */
function biteLimit(c: number, s: number): number {
  let limit = Infinity;
  for (const b of BITES) {
    const uc = c * b.x + s * b.z;
    const disc = uc * uc - (b.x * b.x + b.z * b.z - b.r * b.r);
    if (disc > 0) {
      const t1 = uc - Math.sqrt(disc);
      if (t1 > 0 && t1 < limit) limit = t1;
    }
  }
  return limit;
}
const edgeWobble = (theta: number) =>
  1 + 0.045 * (fbm(Math.cos(theta) * 1.6 + 5, Math.sin(theta) * 1.6 + 5, 3) - 0.5) * 2 + 0.012 * Math.sin(7 * theta + 1.3);

/** Height of the cookie's top surface at (x, z), used for both the mesh and chunk placement. */
function topHeight(x: number, z: number, s: number): { y: number; crack: number } {
  const ridge = 1 - Math.abs(2 * fbm(x * 2.1 + 3.1, z * 2.1 + 7.7, 4) - 1);
  const crack = smoothstep(0.76, 0.93, ridge) * smoothstep(0.98, 0.65, s);
  const lumps = (fbm(x * 1.35 + 11, z * 1.35 - 4, 3) - 0.5) * 0.15;
  const grain = (fbm(x * 9 + 1, z * 9 + 2, 2) - 0.5) * 0.018;
  return { y: yTopProfile(s) + lumps + grain - crack * 0.055, crack };
}

/** Welds shading across duplicated vertices (texture seams): coincident vertices share one normal. */
function weldNormals(geometry: BufferGeometry): void {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  groups.forEach((ids) => {
    if (ids.length < 2) return;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const i of ids) {
      x += nor.getX(i);
      y += nor.getY(i);
      z += nor.getZ(i);
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of ids) nor.setXYZ(i, x / l, y / l, z / l);
  });
  nor.needsUpdate = true;
}

async function buildCookie(segments: number, topRings: number, tick: Tick, photo?: Photo): Promise<{ geometry: BufferGeometry; surface: (x: number, z: number) => number }> {
  // 2D profile from the top centre, over the rounded rim, to the bottom centre.
  // `seam` marks a duplicated row (same positions as the previous row, different texture
  // coordinates) so the top-view and side-strip regions of the atlas never blend.
  type P = { r: number; y: number; region: 0 | 1 | 2; s: number; seam?: boolean };
  const profile: P[] = [];
  for (let i = 0; i <= topRings; i++) {
    const s = i / topRings;
    profile.push({ r: s * INNER, y: yTopProfile(s), region: 0, s });
  }
  const rimSteps = 14;
  if (photo) profile.push({ r: INNER, y: yTopProfile(1), region: 1, s: 1, seam: true });
  for (let i = 1; i < rimSteps; i++) {
    const phi = Math.PI / 2 - (i / rimSteps) * Math.PI;
    profile.push({ r: INNER + RIM * Math.cos(phi), y: RIM_CY + RIM * Math.sin(phi), region: 1, s: 1 });
  }
  const bottomRings = Math.round(topRings * 0.45);
  for (let i = bottomRings; i >= 0; i--) {
    const s = i / bottomRings;
    profile.push({ r: s * INNER, y: Y_BOT, region: 2, s });
  }

  const cTop = new Color('#c88a45');
  const cToast = new Color('#985624');
  const cEdge = new Color('#84481c');
  const cCrack = new Color('#efcf9c');
  const cBottom = new Color('#7e4720');
  const cInside = new Color('#ddb072');
  const cInsideDark = new Color('#b98346');
  const tmp = new Color();

  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const M = segments;
  const ROW = M + 1; // one extra column so the texture wraps without a seam
  for (let pi = 0; pi < profile.length; pi++) {
    await tick();
    const p = profile[pi];
    const rowStart = positions.length;
    for (let j = 0; j <= M; j++) {
      const theta = (j / M) * Math.PI * 2;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);

      if (j === M || p.seam) {
        // Duplicate vertex: copy the exact position (wrap column, or the row above for a seam).
        const src = j === M ? rowStart : rowStart - ROW * 3 + j * 3;
        positions.push(positions[src], positions[src + 1], positions[src + 2]);
      } else {
        const wobble = edgeWobble(theta);
        let r = p.r * wobble;
        let y = p.y;
        let crack = 0;
        if (p.region === 0 && photo) {
          // Real cookie: gentle dome + relief read from the photo (chocolate stands proud).
          const ph = photo.sample(0.5 + c * p.s * TOP_SHARE * UV_R, 0.5 - sn * p.s * TOP_SHARE * UV_R);
          y = yTopProfile(p.s) + (fbm(c * r * 1.3 + 11, sn * r * 1.3 - 4, 3) - 0.5) * 0.05 + ph.choc * 0.05 + (ph.lum - 0.5) * 0.02;
        } else if (p.region === 0) {
          const h = topHeight(c * r, sn * r, p.s);
          y = h.y;
          crack = h.crack;
        } else if (p.region === 1) {
          r += (fbm(c * 3 + 5, sn * 3 + y * 9 + 3, 3) - 0.5) * 0.04;
          y += (fbm(c * 4 + 9, sn * 4 + 2, 2) - 0.5) * 0.02;
        } else {
          y += (fbm(c * 4 * r, sn * 4 * r, 2) - 0.5) * 0.008;
        }
        // The bite: everything beyond the bite boundary collapses onto it, forming a crumbly wall.
        const limit = biteLimit(c, sn);
        if (r > limit - 0.01) {
          const crumble = (fbm(c * 9 + 2, sn * 9 + y * 26 + 4, 3) - 0.5) * 0.06;
          r = Math.max(0.02, limit + crumble);
          y += (fbm(c * 7 + sn * 5, y * 30, 2) - 0.5) * 0.03;
        }
        positions.push(c * r, y, sn * r);
        if (!photo) {
          // Procedural colouring (fallback): golden top, toasted spots, caramelised edge, cracks, soft bite.
          const bitten = r < limit + 0.05 && r <= limit + 0.04 && p.r * wobble > limit - 0.01;
          const x = c * r;
          const z = sn * r;
          if (bitten) tmp.copy(cInside).lerp(cInsideDark, fbm(x * 18, y * 18 + z * 6, 2));
          else if (p.region === 0) {
            tmp.copy(cTop).lerp(cToast, smoothstep(0.45, 0.8, fbm(x * 2.4 - 3, z * 2.4 + 1, 3)) * 0.8);
            tmp.lerp(cEdge, smoothstep(0.7, 1, p.s) * 0.65);
            tmp.lerp(cCrack, crack * 0.85);
          } else if (p.region === 1) tmp.copy(cEdge).lerp(cToast, fbm(c * 4 + y * 10, sn * 4, 2) * 0.6);
          else tmp.copy(cBottom);
          colors.push(tmp.r, tmp.g, tmp.b);
          uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
          continue;
        }
      }

      if (!photo) {
        // Wrap column in procedural mode: copy colour + uv of column 0.
        const ci = (rowStart / 3) * 3;
        colors.push(colors[ci], colors[ci + 1], colors[ci + 2]);
        const ui = (rowStart / 3) * 2;
        uvs.push(uvs[ui], uvs[ui + 1]);
        continue;
      }

      // ---- Photo atlas mapping
      const vi = positions.length - 3;
      const x = positions[vi];
      const y = positions[vi + 1];
      const z = positions[vi + 2];
      const bitten = Math.hypot(x, z) < biteLimit(c, sn) + 0.035 && Number.isFinite(biteLimit(c, sn)) && p.r * edgeWobble(theta) > biteLimit(c, sn) - 0.01;
      if (bitten) {
        // Soft interior exposed by the bite: a plain-dough patch of the photo.
        const [du, dv] = topUV(DOUGH_UV[0] + (fbm(c * 9 + y * 5, sn * 9, 2) - 0.5) * 0.08, DOUGH_UV[1] + (fbm(y * 9 + 4, c * 7 + sn * 3, 2) - 0.5) * 0.08);
        uvs.push(du, dv);
        const k = 0.92 + fbm(x * 18, y * 18 + z * 6, 2) * 0.12;
        colors.push(k, k * 0.98, k * 0.94);
      } else if (p.region === 0) {
        const [u, v] = topUV(0.5 + c * p.s * TOP_SHARE * UV_R, 0.5 - sn * p.s * TOP_SHARE * UV_R);
        uvs.push(u, v);
        colors.push(1, 1, 1);
      } else {
        // Rim + underside: the real side-wall strip (u = angle, v = down the side).
        const t = p.region === 1 ? Math.min(1, Math.max(0, (RIM_CY + RIM - y) / (2 * RIM))) : 1;
        uvs.push((j / M) * STRIP_REPEAT, stripV(t));
        const shade = p.region === 1 ? 1 - 0.22 * t : 0.7;
        colors.push(shade, shade * 0.98, shade * 0.95);
      }
    }
  }

  const index: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    if (profile[i + 1].seam) continue; // the seam row coincides with the row above: no triangles
    for (let j = 0; j < M; j++) {
      const a = i * ROW + j;
      const b = i * ROW + j + 1;
      const c = (i + 1) * ROW + j;
      const d = (i + 1) * ROW + j + 1;
      index.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Make sure faces point outwards (top normals must point up).
  const normals = geometry.getAttribute('normal');
  if (normals.getY(ROW * 2 + 1) < 0) {
    for (let k = 0; k < index.length; k += 3) {
      const t = index[k + 1];
      index[k + 1] = index[k + 2];
      index[k + 2] = t;
    }
    geometry.setIndex(index);
    geometry.computeVertexNormals();
  }
  weldNormals(geometry);
  geometry.computeBoundingSphere();

  const surface = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    const s = Math.min(1, r / INNER);
    if (photo) {
      const k = (TOP_SHARE * UV_R) / INNER;
      const ph = photo.sample(0.5 + x * k, 0.5 - z * k);
      return yTopProfile(s) + ph.choc * 0.05;
    }
    return topHeight(x, z, s).y;
  };
  return { geometry, surface };
}

/**
 * Irregular lump. smooth=true → welded vertices + low-frequency noise = soft, melty chocolate chunk;
 * smooth=false → faceted shard (crumbs, salt).
 */
function chunkGeometry(detail: number, amount: number, seed: number, smooth = false): BufferGeometry {
  let g: BufferGeometry = new IcosahedronGeometry(1, detail);
  if (smooth) {
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
  }
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = smooth
      ? fbm(x * 1.3 + seed, y * 1.3 + z * 0.9 + seed * 0.37, 3)
      : hash2(Math.round(x * 1000) + seed, Math.round(y * 1000) * 7 + Math.round(z * 1000) * 13);
    const f = 1 + (k - 0.5) * amount;
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}

async function bumpTexture(size: number, tick: Tick): Promise<CanvasTexture> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    await tick();
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 9, y / 9, 3) * 0.6 + hash2(x, y) * 0.4; // soft dough + sugar grain
      const v = Math.round(n * 255);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function radialTexture(inner: string, outer: string, size = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------
export async function mountHero({ hero, canvas, stage, quality, texture }: HeroOptions): Promise<{ destroy: () => void }> {
  const tick = makeTick();
  const high = quality === 'high';
  const rand = mulberry32(20261106);

  // The real cookie photo (falls back to the procedural cookie if it can't be loaded).
  let photo: Photo | undefined;
  if (texture) {
    try {
      photo = await loadPhoto(texture);
    } catch {
      photo = undefined;
    }
  }

  const renderer = new WebGLRenderer({ canvas, antialias: high, alpha: true, powerPreference: high ? 'high-performance' : 'low-power' });
  let dpr = Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.35);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  // A photographic texture should keep its true colours: no filmic curve when using the photo.
  renderer.toneMapping = photo ? NoToneMapping : ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.25, 6.2);
  camera.lookAt(0, 0, 0);

  // Lights: warm key, soft sky/ground fill, caramel rim. No shadow maps.
  // (The photo already contains studio lighting, so it gets a softer, flatter rig.)
  scene.add(new HemisphereLight(0xfff4e2, 0x6b4430, photo ? 1.0 : 1.15));
  scene.add(new AmbientLight(0xffffff, photo ? 0.55 : 0.18));
  const key = new DirectionalLight(0xffe3bd, photo ? 1.35 : 2.6);
  key.position.set(-2.2, 3.2, 3.2);
  scene.add(key);
  const rim = new DirectionalLight(0xffc77a, photo ? 0.9 : 1.7);
  rim.position.set(3, 1.5, -2.5);
  scene.add(rim);

  // --- Cookie
  const root = new Group(); // scroll + float
  const tilt = new Group(); // pointer tilt
  const spin = new Group(); // slow self-rotation
  scene.add(root);
  root.add(tilt);
  tilt.add(spin);

  const { geometry: cookieGeo, surface } = await buildCookie(high ? 200 : 128, high ? 36 : 24, tick, photo);
  let cookieMat: MeshStandardMaterial;
  if (photo) {
    const map = new Texture(photo.image);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = RepeatWrapping; // the side strip tiles around the cookie
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    map.needsUpdate = true;
    cookieMat = new MeshStandardMaterial({ map, vertexColors: true, roughness: 0.78, metalness: 0, bumpMap: map, bumpScale: 1.4 });
  } else {
    const bump = await bumpTexture(256, tick);
    cookieMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, bumpMap: bump, bumpScale: 2.2 });
  }
  const cookie = new Mesh(cookieGeo, cookieMat);
  spin.add(cookie);
  spin.rotation.y = -1.15; // start with the bite facing the viewer

  // --- Chocolate chunks (on top, on the rim, and melting out of the bite)
  const chocMat = new MeshStandardMaterial({ color: 0x3b1d0f, roughness: 0.32, metalness: 0.04 });
  await tick();
  const chunkGeo = chunkGeometry(high ? 3 : 2, 1.1, 7, true);
  await tick();
  const dummy = new Object3D();
  const onCookie: Array<[number, number, number, number]> = []; // x, y, z, scale
  const inBite = (x: number, z: number, pad: number) => BITES.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + pad);
  let guard = 0;
  // The real photo already has its chocolate; procedural chunks only for the fallback cookie.
  while (!photo && onCookie.length < (high ? 17 : 13) && guard++ < 400) {
    const r = Math.sqrt(rand()) * 0.8;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inBite(x, z, 0.1) || onCookie.some(([cx, , cz]) => Math.hypot(cx - x, cz - z) < 0.2)) continue;
    const sc = 0.08 + rand() * 0.06;
    onCookie.push([x, surface(x, z) - sc * 0.08, z, sc]);
  }
  // Chunks exposed in the bite wall
  for (const da of [-0.2, 0.15, 0.32]) {
    const a = BITE_ANGLE + da;
    const lim = biteLimit(Math.cos(a), Math.sin(a));
    if (Number.isFinite(lim)) onCookie.push([Math.cos(a) * (lim - 0.015), 0.02 + rand() * 0.05, Math.sin(a) * (lim - 0.015), 0.07]);
  }
  const floatCount = high ? 9 : 6;
  const chunks = new InstancedMesh(chunkGeo, chocMat, onCookie.length);
  onCookie.forEach(([x, y, z, sc], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set((rand() - 0.5) * 0.5, rand() * 6, (rand() - 0.5) * 0.5);
    dummy.scale.set(sc * (1 + rand() * 0.45), sc * 0.5, sc * (0.85 + rand() * 0.3));
    dummy.updateMatrix();
    chunks.setMatrixAt(i, dummy.matrix);
  });
  spin.add(chunks);

  // Sea-salt flakes ("a touch of fleur de sel")
  const saltCount = photo ? 0 : high ? 26 : 16;
  const salt = new InstancedMesh(chunkGeometry(0, 0.4, 3), new MeshStandardMaterial({ color: 0xfffaf2, roughness: 0.25 }), saltCount);
  for (let i = 0; i < saltCount; i++) {
    const r = Math.sqrt(rand()) * 0.78;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inBite(x, z, 0.05)) {
      dummy.scale.set(0, 0, 0);
    } else {
      const sc = 0.012 + rand() * 0.012;
      dummy.position.set(x, surface(x, z) + 0.006, z);
      dummy.rotation.set(rand() * 0.6, rand() * 6, rand() * 0.6);
      dummy.scale.set(sc, sc * 0.35, sc * 1.2);
    }
    dummy.updateMatrix();
    salt.setMatrixAt(i, dummy.matrix);
  }
  spin.add(salt);

  // --- Floating chocolate pieces & crumbs (world space, around the cookie)
  const floaters = new Group();
  scene.add(floaters);
  type Floater = { base: [number, number, number]; rot: [number, number, number]; speed: number; phase: number; scale: number };
  const makeFloaters = (n: number, minR: number, maxR: number, minS: number, maxS: number, biasToBite: number): Floater[] =>
    Array.from({ length: n }, (_, i) => {
      const a = i < n * biasToBite ? -0.4 + (rand() - 0.5) * 1.1 : rand() * Math.PI * 2;
      const r = minR + rand() * (maxR - minR);
      return {
        base: [Math.cos(a) * r, (rand() - 0.5) * 1.7, Math.sin(a) * r * 0.55 + 0.25],
        rot: [rand() * 6, rand() * 6, rand() * 6],
        speed: 0.25 + rand() * 0.5,
        phase: rand() * Math.PI * 2,
        scale: minS + rand() * (maxS - minS),
      };
    });
  const chocFloat = makeFloaters(floatCount, 1.45, 2.05, 0.08, 0.12, 0);
  const crumbData = makeFloaters(high ? 34 : 20, 1.05, 1.8, 0.018, 0.045, 0.6);
  const shardGeo = chunkGeometry(1, 0.3, 5); // faceted = freshly broken chocolate
  const chocFloatMesh = new InstancedMesh(shardGeo, chocMat, chocFloat.length);
  const crumbMesh = new InstancedMesh(chunkGeometry(0, 0.7, 11), new MeshStandardMaterial({ color: 0xb8773a, roughness: 0.9 }), crumbData.length);
  floaters.add(chocFloatMesh, crumbMesh);

  // --- Cocoa / flour dust
  const dustCount = high ? 340 : 140;
  const dustPos = new Float32Array(dustCount * 3);
  const dustCol = new Float32Array(dustCount * 3);
  const cocoa = new Color('#6b4430');
  const flour = new Color('#fff3df');
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (rand() - 0.5) * 6;
    dustPos[i * 3 + 1] = (rand() - 0.5) * 4;
    dustPos[i * 3 + 2] = (rand() - 0.5) * 2.5;
    const col = rand() < 0.65 ? cocoa : flour;
    dustCol.set([col.r, col.g, col.b], i * 3);
  }
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute('position', new Float32BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('color', new Float32BufferAttribute(dustCol, 3));
  const dustMat = new PointsMaterial({
    size: high ? 0.035 : 0.045,
    map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64),
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const dust = new Points(dustGeo, dustMat);
  scene.add(dust);

  // --- Soft contact shadow
  const shadowMat = new MeshBasicMaterial({ map: radialTexture('rgba(58,34,22,0.5)', 'rgba(58,34,22,0)'), transparent: true, depthWrite: false });
  const shadow = new Mesh(new PlaneGeometry(2.3, 2.3), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.95;
  scene.add(shadow);

  // ---------------------------------------------------------------------------------------------
  // Interaction state
  // ---------------------------------------------------------------------------------------------
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let dragVel = 0;
  let scrollP = 0;

  // Idle management: the scene animates while the visitor is active, then eases to rest and
  // stops rendering entirely. Any input wakes it.
  const IDLE_MS = 6000;
  let lastInput = performance.now();
  let activity = 1; // 1 = fully animated, 0 = at rest
  let ready = false; // set once shaders are compiled and the first frame is drawn
  const wake = () => {
    lastInput = performance.now();
    if (ready) start();
  };

  const onPointer = (e: PointerEvent) => {
    wake();
    if (e.pointerType !== 'mouse') return;
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // Touch: a horizontal swipe on the cookie spins it; vertical scrolling is untouched (touch-action: pan-y).
  let touchX: number | null = null;
  const onTouchStart = (e: PointerEvent) => {
    wake();
    if (e.pointerType === 'touch') touchX = e.clientX;
  };
  const onTouchMove = (e: PointerEvent) => {
    if (touchX === null || e.pointerType !== 'touch') return;
    dragVel += (e.clientX - touchX) * 0.0025;
    touchX = e.clientX;
  };
  const onTouchEnd = () => (touchX = null);
  stage.addEventListener('pointerdown', onTouchStart);
  stage.addEventListener('pointermove', onTouchMove, { passive: true });
  window.addEventListener('pointerup', onTouchEnd);
  window.addEventListener('pointercancel', onTouchEnd);

  const updateScroll = () => {
    const r = hero.getBoundingClientRect();
    scrollP = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
    wake();
  };
  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();

  // Size
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // ---------------------------------------------------------------------------------------------
  // Loop — only while visible
  // ---------------------------------------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let elapsed = 0;
  let onScreen = true;
  let frames = 0;
  let slowFrames = 0;
  let degraded = false;
  let destroyed = false;

  const minFrameMs = high ? 0 : 1000 / 31; // 30 fps on lower-powered devices
  const frame = (now: number) => {
    raf = 0;
    if (now - last < minFrameMs) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt * Math.max(activity, 0.02);

    // Adaptive quality: measure, then drop resolution, then bail out to the photo.
    frames++;
    if (frames > 20 && dt > 0.034) slowFrames++;
    if (frames === 120) {
      if (slowFrames > 45 && !degraded) {
        degraded = true;
        dpr = 1;
        renderer.setPixelRatio(dpr);
        resize();
        dust.visible = false;
        frames = 0;
        slowFrames = 0;
      } else if (slowFrames > 60 && degraded) {
        destroy();
        return;
      }
    }

    const ease = 1 - Math.pow(0.0015, dt); // frame-rate independent smoothing
    current.x += (target.x - current.x) * ease;
    current.y += (target.y - current.y) * ease;
    dragVel *= Math.pow(0.04, dt);

    const p = scrollP;
    const pe = p * p * (3 - 2 * p);

    const idleFor = now - lastInput;
    activity += ((idleFor > IDLE_MS ? 0 : 1) - activity) * Math.min(1, dt * 2.5);
    spin.rotation.y += dt * 0.11 * activity + dragVel;
    tilt.rotation.x = 0.62 + current.y * 0.2 + pe * 0.7;
    tilt.rotation.z = -current.x * 0.22 + Math.sin(elapsed * 0.45) * 0.05;
    tilt.rotation.y = current.x * 0.18;
    root.position.set(current.x * 0.12, Math.sin(elapsed * 0.9) * 0.06 * activity - pe * 1.5, 0);
    root.scale.setScalar(1 - pe * 0.28);

    key.position.set(-2.2 + current.x * 1.6, 3.2 - current.y * 1.2, 3.2);
    shadow.position.y = -0.95 - pe * 1.2;
    shadowMat.opacity = (1 - pe) * (0.7 - Math.sin(elapsed * 0.9) * 0.08);
    shadow.scale.setScalar(1 - pe * 0.3);

    // Floating chocolate + crumbs: gentle bob, spreading out as you scroll away.
    const spread = 1 + pe * 0.7;
    const place = (mesh: InstancedMesh, data: Floater[], fall: number) => {
      data.forEach((f, i) => {
        const tt = elapsed * f.speed + f.phase;
        let y = f.base[1] + Math.sin(tt) * 0.08;
        if (fall) y = ((f.base[1] + 0.9 - elapsed * 0.05 * f.speed * fall + 50) % 1.8) - 0.9; // slow-falling crumbs
        dummy.position.set(f.base[0] * spread + current.x * 0.25 * f.speed, y - pe * 0.6, f.base[2]);
        dummy.rotation.set(f.rot[0] + tt * 0.4, f.rot[1] + tt * 0.3, f.rot[2]);
        // Chocolate pieces are flat broken shards; crumbs stay chunky.
        if (fall) dummy.scale.setScalar(f.scale);
        else dummy.scale.set(f.scale * 1.25, f.scale * 0.42, f.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(chocFloatMesh, chocFloat, 0);
    place(crumbMesh, crumbData, 1);
    floaters.rotation.y = current.x * 0.12;
    floaters.position.y = -pe * 0.8;

    if (dust.visible) {
      dust.rotation.y = elapsed * 0.02 + current.x * 0.08;
      dust.position.y = ((elapsed * 0.03) % 1) * 0.4 - pe;
      dustMat.opacity = 0.55 * (1 - pe * 0.6);
    }

    renderer.render(scene, camera);
    const settled =
      idleFor > IDLE_MS && activity < 0.02 && Math.abs(target.x - current.x) + Math.abs(target.y - current.y) < 0.001 && Math.abs(dragVel) < 1e-4;
    // At rest: stop the loop (no frames while idle).
    if (onScreen && !document.hidden && !destroyed && !settled) raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (ready && !raf && !destroyed && onScreen && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const io = new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    if (onScreen) start();
    else stop();
  });
  io.observe(hero);
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  const onLost = (e: Event) => {
    e.preventDefault();
    destroy();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  // Compile shaders without blocking (KHR_parallel_shader_compile where available), then first frame.
  await tick();
  await renderer.compileAsync(scene, camera);
  if (destroyed) return { destroy };
  await tick();
  renderer.render(scene, camera);
  ready = true;
  lastInput = performance.now();
  requestAnimationFrame(() => hero.classList.add('is-3d'));
  start();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    hero.classList.remove('is-3d');
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('scroll', updateScroll);
    window.removeEventListener('pointerup', onTouchEnd);
    window.removeEventListener('pointercancel', onTouchEnd);
    stage.removeEventListener('pointerdown', onTouchStart);
    stage.removeEventListener('pointermove', onTouchMove);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onLost);
    scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((mm) => {
        mm.map?.dispose();
        mm.bumpMap?.dispose();
        mm.dispose();
      });
    });
    renderer.dispose();
  }

  return { destroy };
}
