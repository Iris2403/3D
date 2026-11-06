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
import { COOKIE } from './cookie-data';

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
  ctx.drawImage(image, 0, 0, 1024, 1024, 0, 0, N, N); // top-view region of the atlas only
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
const UV_R: number = COOKIE.uvRadius;
// Share of the photo's radius used by the flat top; the outer ring (real crust edge) wraps the rim.
const TOP_SHARE = 0.9;
// A plain-dough patch of the photo, used for the soft interior exposed by the bite.
const DOUGH_UV: [number, number] = [COOKIE.dough[0], COOKIE.dough[1]];
// Texture (scripts/build-cookie-texture.py): 1024×1024 top-down view of the real cookie.
const topUV = (u: number, v: number): [number, number] => [u, v];

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
const H_TOP = 0.17; // dome height at the centre
const Y_BOT = -0.1; // flat base
const yTopProfile = (s: number) => H_TOP * (1 - 0.25 * s * s);
const RIM = (yTopProfile(1) - Y_BOT) / 2; // rounded edge radius
const RIM_CY = (yTopProfile(1) + Y_BOT) / 2;
const INNER = R - RIM;

interface Bite {
  x: number;
  z: number;
  r: number;
}
// A bite = union of overlapping circles (tooth scallops) cutting in from the front-right edge
// (a chip-free stretch of the real cookie).
const BITE_ANGLE = 0.6;
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

/** Welds shading across duplicated vertices: coincident vertices share one normal. */
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

/** Top surface of the real cookie: soft dome + gentle lumps + fine relief from the photo's shading. */
const photoTop = (x: number, z: number, s: number, lum: number) =>
  yTopProfile(s) + (fbm(x * 1.3 + 11, z * 1.3 - 4, 3) - 0.5) * 0.045 + (lum - 0.3) * 0.05;

/**
 * Real 3D chocolate, placed exactly where it is in the photo (src/modules/cookie-data.ts):
 * bevelled discs for the chips and a crisp slab for the square. Tops are textured with the
 * photo's own pixels; the slab's front sides use the side faces visible in the photo.
 */
function buildChocolate(surface: (x: number, z: number) => number): BufferGeometry {
  const k = (TOP_SHARE * UV_R) / INNER; // uv units per cookie unit
  const toWorld = (u: number, v: number): [number, number] => [(u - 0.5) / k, -(v - 0.5) / k];
  const toUV = (x: number, z: number): [number, number] => topUV(0.5 + x * k, 0.5 - z * k);
  const pos: number[] = [];
  const uv: number[] = [];
  const tri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) => {
    pos.push(...a, ...b, ...c);
    uv.push(...ua, ...ub, ...uc);
  };
  const N = 40;

  for (const chip of COOKIE.chips) {
    let [cx, cz] = toWorld(chip.uv[0], chip.uv[1]);
    const r = chip.r / k;
    // A chip near the photo's edge would overhang the rounded rim: nudge it inward onto the top.
    const maxR = INNER * 0.98 - r * 0.55;
    const d = Math.hypot(cx, cz);
    if (d > maxR) {
      cx *= maxR / d;
      cz *= maxR / d;
    }
    let base = surface(cx, cz);
    for (let i = 0; i < 8; i++) base = Math.min(base, surface(cx + Math.cos(i) * r, cz + Math.sin(i) * r));
    base -= 0.01;
    const top = Math.max(surface(cx, cz), base + 0.01) + chip.h;
    // Rings: centre (slightly domed) → flat top → rounded bevel → base.
    const rings: Array<[number, number]> = [
      [0, top + chip.h * 0.18],
      [0.78, top],
      [0.95, top - chip.h * 0.25],
      [1.0, top - chip.h * 0.6],
      [1.01, base],
    ];
    const ring = (ri: number, j: number) => {
      const [f, y] = rings[ri];
      const a = (j / N) * Math.PI * 2;
      return [cx + Math.cos(a) * r * f, y, cz + Math.sin(a) * r * f];
    };
    for (let ri = 0; ri < rings.length - 1; ri++) {
      for (let j = 0; j < N; j++) {
        const a = ring(ri, j);
        const b = ring(ri, j + 1);
        const c = ring(ri + 1, j);
        const d = ring(ri + 1, j + 1);
        // Side band below the bevel: sample the chip's dark edge rather than the dough beyond it.
        const uvOf = (p: number[], rr: number) => (rr >= 1 ? toUV(cx + (p[0] - cx) * 0.94, cz + (p[2] - cz) * 0.94) : toUV(p[0], p[2]));
        const fa = rings[ri][0];
        const fc = rings[ri + 1][0];
        tri(a, c, b, uvOf(a, fa), uvOf(c, fc), uvOf(b, fa));
        tri(b, c, d, uvOf(b, fa), uvOf(c, fc), uvOf(d, fc));
      }
    }
  }

  // The chocolate square: top face (fan), bevel, and four sides.
  const sq = COOKIE.square;
  const corners = sq.corners.map(([u, v]) => toWorld(u, v));
  const cxs = corners.reduce((s, c) => s + c[0], 0) / 4;
  const czs = corners.reduce((s, c) => s + c[1], 0) / 4;
  let base = Infinity;
  corners.forEach(([x, z]) => (base = Math.min(base, surface(x, z))));
  base = Math.min(base, surface(cxs, czs)) - 0.012;
  const topY = Math.max(...corners.map(([x, z]) => surface(x, z))) + sq.h;
  const inset = (f: number) => corners.map(([x, z]) => [cxs + (x - cxs) * f, czs + (z - czs) * f]);
  const topRing = inset(0.96).map(([x, z]) => [x, topY, z]);
  const edgeRing = corners.map(([x, z]) => [x, topY - 0.018, z]);
  const baseRing = inset(1.01).map(([x, z]) => [x, base, z]);
  const centre = [cxs, topY + 0.004, czs];
  // In the photo the front faces hang below the top face by roughly this much (texture units).
  const faceDrop = 0.075;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(centre, topRing[j], topRing[i], toUV(centre[0], centre[2]), toUV(topRing[j][0], topRing[j][2]), toUV(topRing[i][0], topRing[i][2]));
    tri(topRing[i], topRing[j], edgeRing[i], toUV(topRing[i][0], topRing[i][2]), toUV(topRing[j][0], topRing[j][2]), toUV(edgeRing[i][0], edgeRing[i][2]));
    tri(topRing[j], edgeRing[j], edgeRing[i], toUV(topRing[j][0], topRing[j][2]), toUV(edgeRing[j][0], edgeRing[j][2]), toUV(edgeRing[i][0], edgeRing[i][2]));
    const uE = (p: number[]) => toUV(p[0], p[2]);
    const uB = (p: number[]) => {
      const [u, v] = toUV(p[0], p[2]);
      return [u, v - faceDrop];
    };
    tri(edgeRing[i], edgeRing[j], baseRing[i], uE(edgeRing[i]), uE(edgeRing[j]), uB(baseRing[i]));
    tri(edgeRing[j], baseRing[j], baseRing[i], uE(edgeRing[j]), uB(baseRing[j]), uB(baseRing[i]));
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); // non-indexed: crisp slab faces
  // Chips should look rounded: smooth their normals by welding coincident vertices.
  weldNormals(g);
  // …but keep the square's faces crisp: recompute flat normals for its triangles.
  const chipVerts = COOKIE.chips.length * (CHIP_RINGS - 1) * N * 6;
  const nor = g.getAttribute('normal');
  const p = g.getAttribute('position');
  for (let t = chipVerts; t < p.count; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const ux = p.getX(t + 1) - ax, uy = p.getY(t + 1) - ay, uz = p.getZ(t + 1) - az;
    const vx = p.getX(t + 2) - ax, vy = p.getY(t + 2) - ay, vz = p.getZ(t + 2) - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let q = 0; q < 3; q++) nor.setXYZ(t + q, nx, ny, nz);
  }
  return g;
}
const CHIP_RINGS = 5; // rings per chip in buildChocolate (centre, top, bevel ×2, base)

async function buildCookie(segments: number, topRings: number, tick: Tick, photo?: Photo): Promise<{ geometry: BufferGeometry; surface: (x: number, z: number) => number }> {
  // 2D profile from the top centre, over the rounded rim, to the bottom centre.
  type P = { r: number; y: number; region: 0 | 1 | 2; s: number };
  const profile: P[] = [];
  for (let i = 0; i <= topRings; i++) {
    const s = i / topRings;
    profile.push({ r: s * INNER, y: yTopProfile(s), region: 0, s });
  }
  const rimSteps = 14;
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
  const ROW = M + 1; // closing column (duplicate of column 0; normals are welded)
  for (let pi = 0; pi < profile.length; pi++) {
    await tick();
    const p = profile[pi];
    const rowStart = positions.length;
    for (let j = 0; j <= M; j++) {
      const theta = (j / M) * Math.PI * 2;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);

      if (j === M) {
        // Closing column: copy the exact position of column 0.
        const src = rowStart;
        positions.push(positions[src], positions[src + 1], positions[src + 2]);
      } else {
        const wobble = edgeWobble(theta);
        let r = p.r * wobble;
        let y = p.y;
        let crack = 0;
        if (p.region === 0 && photo) {
          // Real cookie: gentle dome + relief read from the photo (chocolate stands proud).
          const ph = photo.sample(0.5 + c * p.s * TOP_SHARE * UV_R, 0.5 - sn * p.s * TOP_SHARE * UV_R);
          y = photoTop(c * r, sn * r, p.s, ph.lum);
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
        // Project the dough patch flat onto the wall (along the wall × height) → real crumb texture.
        const [du, dv] = topUV(DOUGH_UV[0] + (x - z) * 0.1, DOUGH_UV[1] + y * 0.4);
        uvs.push(du, dv);
        const k = 0.92 + fbm(x * 18, y * 18 + z * 6, 2) * 0.12;
        colors.push(k, k * 0.98, k * 0.94);
      } else if (p.region === 0) {
        const [u, v] = topUV(0.5 + c * p.s * TOP_SHARE * UV_R, 0.5 - sn * p.s * TOP_SHARE * UV_R);
        uvs.push(u, v);
        colors.push(1, 1, 1);
      } else if (p.region === 1) {
        // Rim: in the photo the outer ring of the top view (TOP_SHARE → 98% of the radius) *is* the
        // cookie's puffy, rounded crust edge seen from above, so it wraps the upper rim. The
        // underside half mirrors back across that crust, darkening as it turns away from the light.
        const t = Math.min(1, Math.max(0, (RIM_CY + RIM - y) / (2 * RIM)));
        const rr = t < 0.5 ? TOP_SHARE + (0.98 - TOP_SHARE) * (t / 0.5) : 0.98 - 0.16 * ((t - 0.5) / 0.5);
        const [u, v] = topUV(0.5 + c * rr * UV_R, 0.5 - sn * rr * UV_R);
        uvs.push(u, v);
        const shade = 1 - 0.3 * Math.max(0, t - 0.4);
        colors.push(shade, shade * 0.98, shade * 0.95);
      } else {
        // Underside (rarely seen): continue the crust ring inward, in shade.
        const [u, v] = topUV(0.5 + c * (0.82 - 0.1 * (1 - p.s)) * UV_R, 0.5 - sn * (0.82 - 0.1 * (1 - p.s)) * UV_R);
        uvs.push(u, v);
        colors.push(0.62, 0.6, 0.57);
      }
    }
  }

  const index: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
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
      return photoTop(x, z, s, ph.lum);
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
  scene.add(new HemisphereLight(0xfff4e2, 0x6b4430, photo ? 1.2 : 1.15));
  scene.add(new AmbientLight(0xffffff, photo ? 0.6 : 0.18));
  const key = new DirectionalLight(0xffe3bd, photo ? 1.7 : 2.6);
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
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    map.needsUpdate = true;
    cookieMat = new MeshStandardMaterial({ map, vertexColors: true, roughness: 0.78, metalness: 0, bumpMap: map, bumpScale: 1.4 });
  } else {
    const bump = await bumpTexture(256, tick);
    cookieMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, bumpMap: bump, bumpScale: 2.2 });
  }
  const cookie = new Mesh(cookieGeo, cookieMat);
  spin.add(cookie);
  spin.rotation.y = 0; // the photo's own front faces the viewer (bite at front-right)

  // --- Chocolate chunks (on top, on the rim, and melting out of the bite)
  const chocMat = new MeshStandardMaterial({ color: 0x2a1614, roughness: 0.34, metalness: 0.04 }); // matches the photo's dark chocolate
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
  for (const da of photo ? [] : [-0.2, 0.15, 0.32]) {
    const a = BITE_ANGLE + da;
    const lim = biteLimit(Math.cos(a), Math.sin(a));
    if (Number.isFinite(lim)) onCookie.push([Math.cos(a) * (lim - 0.015), 0.02 + rand() * 0.05, Math.sin(a) * (lim - 0.015), 0.07]);
  }
  // Real-cookie mode keeps it honest: no floating chocolate, just a few crumbs from the bite.
  const floatCount = photo ? 0 : high ? 9 : 6;
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

  // Real chocolate chips + square from the photo (photo mode only).
  if (photo) {
    const realChoc = new Mesh(
      buildChocolate(surface),
      new MeshStandardMaterial({ map: cookieMat.map, roughness: 0.42, metalness: 0, bumpMap: cookieMat.map, bumpScale: 0.4 }),
    );
    spin.add(realChoc);
  }

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
  const crumbData = photo ? makeFloaters(high ? 16 : 10, 1.0, 1.5, 0.012, 0.026, 0.85) : makeFloaters(high ? 34 : 20, 1.05, 1.8, 0.018, 0.045, 0.6);
  const shardGeo = chunkGeometry(1, 0.3, 5); // faceted = freshly broken chocolate
  const chocFloatMesh = new InstancedMesh(shardGeo, chocMat, chocFloat.length);
  const crumbMesh = new InstancedMesh(photo ? chunkGeometry(1, 0.8, 11, true) : chunkGeometry(0, 0.7, 11), new MeshStandardMaterial({ color: 0x8a6344, roughness: 0.95 }), crumbData.length);
  floaters.add(chocFloatMesh, crumbMesh);

  // --- Cocoa / flour dust
  const dustCount = photo ? (high ? 120 : 60) : high ? 340 : 140; // a light dusting of flour + cocoa
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
