/**
 * KUKI hero — a sea-salt chocolate chip cookie (design ported from the "Sea Salt Chocolate Chip
 * Cookie — 3D" study) with floating chocolate chips and salt flakes around it.
 *
 * The cookie
 *  - puffy, hand-shaped body (lathe-like profile with an irregular edge), displaced by noise along
 *    its normals, coloured by a real dough photo (theme/assets/cookie-dough.webp) + baked shading
 *  - lathe-turned chocolate discs and a bevelled chocolate chunk, laid out like the reference
 *    photo, in a glossy clear-coat chocolate material
 *  - Maldon-style salt (flat flakes + little pyramids) on the chunk and dough, and baked crumbs
 *  - contact shading baked around each piece of chocolate; soft real-time shadows on capable devices
 *
 * Cost control (unchanged from the rest of the site)
 *  - loaded only after the visitor's first interaction; generation yields to the main thread
 *    every ~8 ms and shaders compile asynchronously
 *  - renders only while visible; eases to rest and stops rendering after 6 s without input
 *  - adaptive pixel ratio, 30 fps + no shadow maps on lower-powered devices, photo fallback if slow
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  Euler,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderChunk,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface HeroOptions {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  quality: 'high' | 'low';
  /** Dough photo texture (theme asset). Optional: without it the cookie uses baked vertex colour. */
  texture?: string;
}

// ---------------------------------------------------------------------------------------------
// Utilities (same deterministic noise as the design study, so the cookie looks identical)
// ---------------------------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function h3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + 0.123) * 43758.5453123;
  return s - Math.floor(s);
}
function vn(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const a = lerp(lerp(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), lerp(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v);
  const b = lerp(lerp(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), lerp(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v);
  return lerp(a, b, w);
}
function fbm(x: number, y: number, z: number, o = 4): number {
  let a = 0.5;
  let s = 0;
  let f = 1;
  for (let i = 0; i < o; i++) {
    s += a * (vn(x * f, y * f, z * f) * 2 - 1);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
const ridge = (x: number, y: number, z: number) => 1 - Math.abs(vn(x, y, z) * 2 - 1);
function srgb(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, SRGBColorSpace);
}

/** Cooperative scheduling: `await tick()` yields to the main thread once ~8 ms have passed. */
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

async function loadTexture(url: string): Promise<Texture | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const t = new Texture(img);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  } catch {
    return null;
  }
}

// Mean linear colour of the dough texture (made from the real KUKI photo): lets the wall /
// underside vertex colours tint it towards a darker bake without losing its grain.
const DOUGH_M = [0.2093, 0.1117, 0.0663]; // printed by scripts/build-dough-texture.py
// Colour grade (linear multipliers) matching the reference render of the KUKI cookie: a warm,
// olive-brown top and a deeper baked crust on the edge — measured against the reference image.
const TOP_GRADE = [0.37, 0.27, 0.125];
const EDGE_GRADE = [0.2, 0.27, 0.33];

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------
export async function mountHero({ hero, canvas, stage, quality, texture }: HeroOptions): Promise<{ destroy: () => void }> {
  const tick = makeTick();
  const high = quality === 'high';
  const rnd = mulberry32(11);
  const R = (a: number, b: number) => a + (b - a) * rnd();
  const CFG = { segments: high ? 200 : 128, crumbs: high ? 200 : 110 };

  const TEX = texture ? await loadTexture(texture) : null;

  const renderer = new WebGLRenderer({ canvas, antialias: high, alpha: true, powerPreference: high ? 'high-performance' : 'low-power' });
  let dpr = Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.35);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  // Soft real-time shadows (chips shading the dough) only where the GPU can afford them.
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  await tick();

  const camera = new PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0.1, 6.4);
  camera.lookAt(0, 0, 0);

  // Hierarchy: root (scroll + float) → tilt (pointer; shows the top like a 32° camera) → spin.
  const root = new Group();
  const tilt = new Group();
  const spin = new Group();
  scene.add(root);
  root.add(tilt);
  tilt.add(spin);

  // Lights live in the tilt group so they keep the design's relation to the cookie.
  const key = new DirectionalLight(0xfff0dc, 2.3);
  key.position.set(-2.6, 4.2, 2.4);
  key.castShadow = high;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 12 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.005;
  key.shadow.radius = 5;
  tilt.add(key, key.target);
  const rim = new DirectionalLight(0xffe6c8, 0.9); // warm rim: keeps the browns rich, not grey
  rim.position.set(3, 2.2, -3.2);
  tilt.add(rim);
  scene.add(new HemisphereLight(0xfff3e0, 0x8a6a4a, 0.6));

  // ------------------------------------------------------------------- cookie body
  const S = CFG.segments;
  const T = 0.36;
  const topY = (r: number) => T * (0.8 + 0.14 * smooth(0.3, 0.88, r));
  const prof: Array<[number, number, number]> = []; // [rho, y, kind] 0 top/shoulder, 1 wall, 2 bottom
  for (let i = 0; i <= 36; i++) {
    const r = (0.88 * i) / 36;
    prof.push([r, topY(r), 0]);
  }
  const yt = topY(0.88);
  for (let i = 1; i <= 12; i++) {
    const p = ((i / 12) * Math.PI) / 2;
    prof.push([0.88 + 0.12 * Math.sin(p), 0.21 + (yt - 0.21) * Math.cos(p), 0]);
  }
  for (let i = 1; i <= 10; i++) {
    const p = ((i / 10) * Math.PI) / 2;
    prof.push([0.955 + 0.045 * Math.cos(p), 0.21 * (1 - Math.sin(p)), 1]);
  }
  for (let i = 1; i <= 12; i++) prof.push([0.955 * (1 - i / 12), 0, 2]);
  const N = prof.length;
  const pos = new Float32Array(N * S * 3);
  const uv = new Float32Array(N * S * 2);
  const col = new Float32Array(N * S * 3);
  const kinds = new Uint8Array(N * S);
  const edge = (c: number, s: number) => 1 + 0.05 * fbm(c * 1.1 + 3.3, s * 1.1 + 1.1, 0.7, 3) + 0.012 * fbm(c * 7, s * 7, 2.2, 2);
  for (let i = 0; i < N; i++) {
    await tick();
    const [rho, y, k] = prof[i];
    for (let j = 0; j < S; j++) {
      const th = (j / S) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const er = edge(c, s) * (1 + 0.03 * Math.cos(2 * th + 0.6));
      const id = i * S + j;
      pos[id * 3] = rho * er * c;
      pos[id * 3 + 1] = y;
      pos[id * 3 + 2] = rho * er * s;
      kinds[id] = k;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < S; j++) {
      const a = i * S + j;
      const b = i * S + ((j + 1) % S);
      const c = (i + 1) * S + j;
      const d = (i + 1) * S + ((j + 1) % S);
      idx.push(a, b, c, b, d, c);
    }
  }
  const body = new BufferGeometry();
  body.setAttribute('position', new BufferAttribute(pos, 3));
  body.setIndex(idx);
  const fixPoles = () => {
    body.computeVertexNormals();
    const n = body.attributes.normal;
    for (const ring of [0, N - 1]) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let j = 0; j < S; j++) {
        const id = ring * S + j;
        x += n.getX(id);
        y += n.getY(id);
        z += n.getZ(id);
      }
      const l = Math.hypot(x, y, z) || 1;
      for (let j = 0; j < S; j++) n.setXYZ(ring * S + j, x / l, y / l, z / l);
    }
  };
  fixPoles();
  await tick();
  // Displace along the normal: a baked, uneven top and a crumbly wall.
  const nrm = body.attributes.normal;
  for (let id = 0; id < N * S; id++) {
    if (id % 4000 === 0) await tick();
    const k = kinds[id];
    if (k === 2) continue;
    const x = pos[id * 3];
    const y = pos[id * 3 + 1];
    const z = pos[id * 3 + 2];
    const d =
      k === 0
        ? 0.024 * fbm(x * 2.2, y * 2.2, z * 2.2, 3) + 0.01 * fbm(x * 9 + 3, z * 9, y * 9, 3) + 0.016 * (ridge(x * 5, z * 5, 3.1) - 0.5)
        : 0.024 * fbm(x * 7, y * 7 + 9, z * 7, 3) + 0.01 * fbm(x * 18, y * 18, z * 18, 2);
    pos[id * 3] += nrm.getX(id) * d;
    pos[id * 3 + 1] = Math.max(0, y + nrm.getY(id) * d);
    pos[id * 3 + 2] += nrm.getZ(id) * d;
  }
  body.attributes.position.needsUpdate = true;
  fixPoles();
  // UVs + vertex colours: golden-brown, darker where the wall and rim bake.
  // Browns sampled from the KUKI photo (sRGB): baked dough → toasted → deep crust.
  const golden = [0.56, 0.41, 0.3];
  const mid = [0.45, 0.32, 0.22];
  const dark = [0.29, 0.19, 0.12];
  const under = [0.37, 0.26, 0.18];
  for (let id = 0; id < N * S; id++) {
    if (id % 4000 === 0) await tick();
    const x = pos[id * 3];
    const y = pos[id * 3 + 1];
    const z = pos[id * 3 + 2];
    const k = kinds[id];
    uv[id * 2] = x * 0.5 + 0.5;
    uv[id * 2 + 1] = z * 0.5 + 0.5;
    const r = Math.hypot(x, z);
    const m = fbm(x * 3.6 + 7, y * 3.6, z * 3.6, 3) * 0.5 + 0.5;
    let b: number;
    if (k === 2) b = 0.8;
    else if (k === 1) b = 0.55 + 0.3 * m;
    else b = 0.04 + 0.42 * m * m + 0.5 * smooth(0.8, 0.99, r) + 0.18 * clamp(ridge(x * 5, z * 5, 3.1) - 0.55, 0, 1);
    b = clamp(b, 0, 1);
    const base = k === 2 ? under : golden;
    const t = b < 0.5 ? b * 2 : (b - 0.5) * 2;
    const c0 = b < 0.5 ? base : mid;
    const c1 = b < 0.5 ? mid : dark;
    const sp = fbm(x * 40, y * 40, z * 40, 1) * 0.05;
    const lin = srgb(lerp(c0[0], c1[0], t) + sp, lerp(c0[1], c1[1], t) + sp, lerp(c0[2], c1[2], t) + sp);
    if (TEX && k === 0) {
      // The photo carries the colour; the vertex colour only bakes the rim darker.
      const e = clamp(0.45 * smooth(0.8, 0.99, r) + 0.12 * (1 - m), 0, 0.75);
      col[id * 3] = lerp(1, 0.55, e) * TOP_GRADE[0];
      col[id * 3 + 1] = lerp(1, 0.48, e) * TOP_GRADE[1];
      col[id * 3 + 2] = lerp(1, 0.4, e) * TOP_GRADE[2];
    } else if (TEX) {
      col[id * 3] = Math.min(2.5, lin.r / DOUGH_M[0]) * EDGE_GRADE[0];
      col[id * 3 + 1] = Math.min(2.5, lin.g / DOUGH_M[1]) * EDGE_GRADE[1];
      col[id * 3 + 2] = Math.min(2.5, lin.b / DOUGH_M[2]) * EDGE_GRADE[2];
    } else {
      col[id * 3] = lin.r;
      col[id * 3 + 1] = lin.g;
      col[id * 3 + 2] = lin.b;
    }
  }
  body.setAttribute('uv', new BufferAttribute(uv, 2));
  body.setAttribute('color', new BufferAttribute(col, 3));
  const baseCol = col.slice();
  const bump = new CanvasTexture(await noiseCanvas(512, rnd, tick));
  bump.wrapS = bump.wrapT = RepeatWrapping;
  bump.repeat.set(3, 3);
  bump.anisotropy = 4;
  const bodyMat = new MeshStandardMaterial({ vertexColors: true, map: TEX, roughness: 0.82, metalness: 0, bumpMap: bump, bumpScale: 2, envMapIntensity: 0.3 });
  if (TEX) TEX.wrapS = TEX.wrapT = RepeatWrapping;
  // Triplanar texturing: the dough photo and the bump detail are projected from the direction each
  // surface faces (top / front / side) and blended, so the rounded edge and the wall get real crust
  // texture at its natural scale — no stretching, no seams.
  bodyMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        vec2 triBumpUv() {
          vec3 n = abs(normalize(vObjNormal));
          vec3 p = vObjPos * 1.5;
          if (n.y > 0.55) return p.xz;
          return n.x > n.z ? p.zy : p.xy;
        }`,
      )
      .replace('#include <bumpmap_pars_fragment>', ShaderChunk.bumpmap_pars_fragment.replace(/vBumpMapUv/g, 'triBumpUv()'))
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 tw = pow(abs(normalize(vObjNormal)), vec3(4.0));
          tw /= (tw.x + tw.y + tw.z);
          vec4 tX = texture2D(map, vObjPos.zy * 0.5 + vec2(0.5, 0.3));
          vec4 tY = texture2D(map, vObjPos.xz * 0.5 + 0.5);
          vec4 tZ = texture2D(map, vObjPos.xy * 0.5 + vec2(0.5, 0.3));
          diffuseColor *= tX * tw.x + tY * tw.y + tZ * tw.z;
        #endif`,
      );
  };
  const cookie = new Mesh(body, bodyMat);
  cookie.castShadow = cookie.receiveShadow = true;
  spin.add(cookie);
  // Build-time placement casts rays in the cookie's own frame: keep all parents at identity
  // until everything is placed.
  scene.updateMatrixWorld(true);
  await tick();

  // ------------------------------------------------------------------- chocolate
  const chocMat = (hex: number, rough = 0.36) =>
    new MeshPhysicalMaterial({
      color: new Color().setHex(hex, SRGBColorSpace),
      roughness: rough,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.38,
      envMapIntensity: 1.1,
    });
  const discChipGeo = (r: number, h: number, seed: number) => {
    const pts = [[0, 0], [r * 0.9, 0], [r, h * 0.2], [r, h * 0.7], [r * 0.9, h * 0.96], [r * 0.45, h * 1.04], [0, h * 1.06]].map((p) => new Vector2(p[0], p[1]));
    const g = new LatheGeometry(pts, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.09 * fbm(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7, seed, 2) + 0.035 * Math.sin(a * 3 + seed * 2);
      p.setXYZ(i, x * k, y * (1 + 0.08 * fbm(x * 9 + seed, z * 9, 3, 2)), z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const chunkGeo = (w: number, t: number, d: number, seed: number) => {
    const g = new BoxGeometry(w, t, d, 10, 3, 10);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const hx = w / 2;
    const hy = t / 2;
    const hz = d / 2;
    const rr = Math.min(0.016, t * 0.3);
    const v = new Vector3();
    const inn = new Vector3();
    const nn = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      inn.set(clamp(v.x, -hx + rr, hx - rr), clamp(v.y, -hy + rr, hy - rr), clamp(v.z, -hz + rr, hz - rr));
      nn.subVectors(v, inn);
      if (nn.lengthSq() > 1e-10) {
        nn.normalize();
        v.copy(inn).addScaledVector(nn, rr);
        n.setXYZ(i, nn.x, nn.y, nn.z);
      }
      // Irregular quadrilateral: taper + shear + tiny unevenness.
      const tx = (v.x / hx + 1) / 2;
      v.z *= 1 - 0.2 * tx;
      v.x += v.z * 0.22;
      v.y += 0.005 * fbm(v.x * 14 + seed, v.z * 14, seed, 2);
      v.x += 0.004 * fbm(v.z * 20, seed, v.y * 20, 2);
      p.setXYZ(i, v.x, v.y + hy, v.z);
    }
    g.computeBoundingSphere();
    return g;
  };

  // Placement on the cookie surface (raycasts straight down).
  const rc = new Raycaster();
  const DOWN = new Vector3(0, -1, 0);
  const UP = new Vector3(0, 1, 0);
  const origin = new Vector3();
  const hit = (x: number, z: number, objs: Object3D[]) => {
    rc.set(origin.set(x, 3, z), DOWN);
    return rc.intersectObjects(objs, false)[0];
  };
  const fit = (x: number, z: number, r: number) => {
    const n = new Vector3();
    let y = 0;
    let c = 0;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const h = hit(x + dx * 0.7, z + dz * 0.7, [cookie]);
      if (!h || !h.face) continue;
      y += h.point.y;
      n.add(h.face.normal);
      c++;
    }
    if (!c) return null;
    return { p: new Vector3(x, y / c, z), n: n.normalize() };
  };
  const placed: Array<{ x: number; z: number; r: number }> = [];
  const settle = (mesh: Mesh, x: number, z: number, r: number, embed: number, tiltAmt: number, upBlend: number, yaw?: number) => {
    const f = fit(x, z, r);
    if (!f) return false;
    const n = f.n.lerp(UP, upBlend).normalize();
    mesh.position.copy(f.p).addScaledVector(n, -embed);
    mesh.quaternion
      .setFromUnitVectors(UP, n)
      .multiply(new Quaternion().setFromAxisAngle(UP, yaw === undefined ? R(0, 6.283) : yaw))
      .multiply(new Quaternion().setFromEuler(new Euler(R(-tiltAmt, tiltAmt), 0, R(-tiltAmt, tiltAmt))));
    mesh.castShadow = mesh.receiveShadow = true;
    spin.add(mesh);
    mesh.updateMatrixWorld(true);
    return true;
  };
  const chocolate: Mesh[] = [];
  // Layout copied from the reference photo (x right, z toward camera; cookie radius = 1).
  const LAYOUT = [
    { t: 'chunk', x: -0.38, z: 0.06, w: 0.5, th: 0.105, d: 0.5, yaw: 0.18, embed: 0.04, r: 0, h: 0 },
    { t: 'chip', x: 0.02, z: -0.75, r: 0.12, h: 0.064, embed: 0.016, w: 0, th: 0, d: 0, yaw: 0 },
    { t: 'chip', x: 0.46, z: -0.5, r: 0.125, h: 0.066, embed: 0.02, w: 0, th: 0, d: 0, yaw: 0 },
    { t: 'chip', x: 0.19, z: 0.0, r: 0.105, h: 0.062, embed: 0.03, w: 0, th: 0, d: 0, yaw: 0 },
    { t: 'chip', x: 0.28, z: 0.52, r: 0.135, h: 0.068, embed: 0.014, w: 0, th: 0, d: 0, yaw: 0 },
    { t: 'chip', x: 0.6, z: 0.23, r: 0.085, h: 0.056, embed: 0.035, w: 0, th: 0, d: 0, yaw: 0 },
  ];
  const chipColours = [0x35200f, 0x3a2312, 0x2f1b0e];
  for (const o of LAYOUT) {
    await tick();
    if (o.t === 'chunk') {
      const m = new Mesh(chunkGeo(o.w, o.th, o.d, 3.1), chocMat(0x3d2415, 0.34));
      const rad = Math.max(o.w, o.d) * 0.55;
      if (settle(m, o.x, o.z, rad, o.embed, 0.05, 0.55, o.yaw)) {
        placed.push({ x: o.x, z: o.z, r: rad });
        chocolate.push(m);
      }
    } else {
      const m = new Mesh(discChipGeo(o.r, o.h, R(0, 9)), chocMat(chipColours[chocolate.length % 3], R(0.3, 0.4)));
      if (settle(m, o.x, o.z, o.r, o.embed, 0.08, 0.55)) {
        placed.push({ x: o.x, z: o.z, r: o.r });
        chocolate.push(m);
      }
    }
  }

  // Contact occlusion: darken the dough around each piece of chocolate.
  {
    const c = body.attributes.color;
    for (let id = 0; id < kinds.length; id++) {
      if (kinds[id] !== 0) continue;
      const x = pos[id * 3];
      const z = pos[id * 3 + 2];
      let ao = 0;
      for (const q of placed) {
        const d = Math.hypot(x - q.x, z - q.z) / (q.r * 1.35);
        ao += Math.exp(-d * d * 1.6);
      }
      const f = 1 - clamp(ao, 0, 1) * 0.42;
      c.setXYZ(id, baseCol[id * 3] * f, baseCol[id * 3 + 1] * f, baseCol[id * 3 + 2] * f);
    }
    c.needsUpdate = true;
  }
  await tick();

  // ------------------------------------------------------------------- sea salt
  const jitterFlat = (g: BufferGeometry, amp: number, seed: number) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + amp * (h3(Math.round(x * 50) + seed, Math.round(y * 50), Math.round(z * 50)) * 2 - 1);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const flakeGeo = jitterFlat(new IcosahedronGeometry(1, 0).toNonIndexed(), 0.28, 1); // flat, irregular flake
  flakeGeo.scale(1, 0.26, 0.72);
  flakeGeo.translate(0, 0.12, 0);
  const pyrGeo = jitterFlat(new ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0).toNonIndexed(), 0.14, 5); // Maldon pyramid
  const saltMat = new MeshPhysicalMaterial({
    color: 0xe9e4d8,
    roughness: 0.14,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0.88,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    ior: 1.55,
    envMapIntensity: 1.3,
    specularIntensity: 1,
  });
  const flatIM = new InstancedMesh(flakeGeo, saltMat, 11);
  const pyrIM = new InstancedMesh(pyrGeo, saltMat, 7);
  flatIM.castShadow = pyrIM.castShadow = true;
  const saltTargets: Object3D[] = [cookie, ...chocolate];
  const dummy = new Object3D();
  const qa = new Quaternion();
  const SALT = [
    [-0.27, -0.12], [-0.5, -0.02], [-0.36, 0.1], [-0.22, 0.06], [-0.45, 0.22], [-0.3, 0.3],
    [0.2, 0.2], [0.06, 0.74], [-0.16, 0.5], [0.4, 0.3], [-0.05, -0.4], [0.52, -0.12],
    [0.3, -0.28], [-0.6, 0.4], [0.7, 0.0], [0, 0.25], [-0.2, -0.5], [0.15, 0.45],
  ];
  const scatterSalt = (im: InstancedMesh, count: number, sizeMin: number, sizeMax: number, squash: boolean, offset: number) => {
    let n = 0;
    for (let k = 0; n < count; k++) {
      if (k > 60) break;
      const base = SALT[(k + offset) % SALT.length];
      const j = k >= SALT.length - offset ? 0.06 : 0.012;
      const x = base[0] + R(-j, j);
      const z = base[1] + R(-j, j);
      const h = hit(x, z, saltTargets);
      if (!h || !h.face || h.point.y < 0.15) continue;
      const nn = h.face.normal.clone().transformDirection(h.object.matrixWorld).lerp(UP, 0.6).normalize();
      const s = R(sizeMin, sizeMax);
      dummy.position.copy(h.point).addScaledVector(nn, -s * 0.12);
      qa.setFromUnitVectors(UP, nn)
        .multiply(new Quaternion().setFromAxisAngle(UP, R(0, 6.283)))
        .multiply(new Quaternion().setFromEuler(new Euler(R(-0.35, 0.35), 0, R(-0.35, 0.35))));
      dummy.quaternion.copy(qa);
      dummy.scale.set(s, s * (squash ? R(0.8, 1.1) : R(0.6, 0.95)), s * R(0.8, 1.15));
      dummy.updateMatrix();
      im.setMatrixAt(n, dummy.matrix);
      const w = R(0.96, 1);
      im.setColorAt(n, new Color(w, w, R(0.93, 0.98)));
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  };
  scatterSalt(flatIM, 11, 0.045, 0.08, false, 0);
  await tick();
  scatterSalt(pyrIM, 7, 0.03, 0.05, true, 6);
  spin.add(flatIM, pyrIM);
  await tick();

  // ------------------------------------------------------------------- baked crumb bits
  {
    const g = jitterFlat(new DodecahedronGeometry(1, 0).toNonIndexed(), 0.25, 3);
    const m = new MeshStandardMaterial({ color: new Color().setHex(0x7a5a3e, SRGBColorSpace), roughness: 0.95, flatShading: true, envMapIntensity: 0.3 });
    const im = new InstancedMesh(g, m, CFG.crumbs);
    let k = 0;
    let guard = 0;
    while (k < CFG.crumbs && guard++ < 3000) {
      if (guard % 40 === 0) await tick();
      let x: number;
      let z: number;
      if (rnd() < 0.7 && placed.length) {
        const q = placed[rnd() < 0.5 ? 0 : Math.floor(rnd() * placed.length)];
        x = q.x + (rnd() - 0.5) * 0.6;
        z = q.z + (rnd() - 0.5) * 0.5;
      } else {
        const a = R(0, 6.283);
        const rho = Math.sqrt(rnd()) * 0.82;
        x = Math.cos(a) * rho;
        z = Math.sin(a) * rho;
      }
      if (Math.hypot(x, z) > 0.84) continue;
      const h = hit(x, z, [cookie]);
      if (!h || !h.face || h.point.y < 0.15) continue;
      const s = R(0.008, 0.021);
      dummy.position.copy(h.point).addScaledVector(h.face.normal, -s * 0.1);
      dummy.quaternion.setFromEuler(new Euler(R(0, 6), R(0, 6), R(0, 6)));
      dummy.scale.set(s, s * R(0.6, 0.9), s * R(0.8, 1.2));
      dummy.updateMatrix();
      im.setMatrixAt(k, dummy.matrix);
      const v = R(0.7, 1.15);
      im.setColorAt(k, new Color(v, v * R(0.92, 1), v * R(0.85, 0.95)));
      k++;
    }
    im.count = k;
    im.castShadow = im.receiveShadow = true;
    spin.add(im);
  }
  // Placement done: centre the cookie's mass on the tilt pivot.
  spin.position.y = -0.17;
  await tick();

  // ------------------------------------------------------------------- floating chocolate + salt
  // Around (not on) the cookie: lathe chips and small broken chunks in the same chocolate, plus
  // loose salt flakes catching the light. World space, so they drift independently of the cookie.
  const floaters = new Group();
  scene.add(floaters);
  type Floater = { base: [number, number, number]; rot: [number, number, number]; spinRate: [number, number]; speed: number; phase: number; scale: number };
  const ring = (n: number, minR: number, maxR: number, minS: number, maxS: number, ySpread: number): Floater[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + R(-0.35, 0.35);
      const r = R(minR, maxR);
      return {
        base: [Math.cos(a) * r, R(-ySpread, ySpread), Math.sin(a) * r * 0.5 + R(-0.2, 0.5)],
        rot: [R(0, 6), R(0, 6), R(0, 6)],
        spinRate: [R(-0.5, 0.5), R(-0.6, 0.6)],
        speed: R(0.35, 0.8),
        phase: R(0, 6.283),
        scale: R(minS, maxS),
      };
    });
  const floatChipGeo = discChipGeo(1, 0.52, 4.2);
  const floatChunkGeo = chunkGeo(1, 0.24, 0.8, 7.7);
  const chipFloats = ring(high ? 8 : 5, 1.45, 2.15, 0.07, 0.11, 1.0);
  const chunkFloats = ring(high ? 3 : 2, 1.6, 2.2, 0.16, 0.22, 0.9);
  const saltFloats = ring(high ? 16 : 9, 1.15, 2.0, 0.03, 0.055, 1.1);
  const chipIM = new InstancedMesh(floatChipGeo, chocMat(0x35200f, 0.34), chipFloats.length);
  const chunkIM = new InstancedMesh(floatChunkGeo, chocMat(0x3d2415, 0.34), chunkFloats.length);
  const saltIM = new InstancedMesh(flakeGeo, saltMat, saltFloats.length);
  floaters.add(chipIM, chunkIM, saltIM);
  await tick();

  // ------------------------------------------------------------------- soft ground shadow
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(40,28,12,.55)');
    gr.addColorStop(0.62, 'rgba(40,28,12,.28)');
    gr.addColorStop(1, 'rgba(40,28,12,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadow = new Mesh(new PlaneGeometry(2.6, 2.6), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.0;
  scene.add(shadow);

  // ------------------------------------------------------------------- interaction
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let dragVel = 0;
  let scrollP = 0;
  const IDLE_MS = 6000;
  let lastInput = performance.now();
  let activity = 1;
  let ready = false;
  let raf = 0;
  let destroyed = false;
  let onScreen = true;
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
  // Drag (mouse) or horizontal swipe (touch) on the cookie spins it; vertical page scroll is untouched.
  let dragX: number | null = null;
  const onDown = (e: PointerEvent) => {
    wake();
    dragX = e.clientX;
  };
  const onMove = (e: PointerEvent) => {
    if (dragX === null) return;
    dragVel += (e.clientX - dragX) * 0.0025;
    dragX = e.clientX;
  };
  const onUp = () => (dragX = null);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  const updateScroll = () => {
    const r = hero.getBoundingClientRect();
    scrollP = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
    wake();
  };
  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();

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

  // ------------------------------------------------------------------- loop
  const ELEV = (32 * Math.PI) / 180;
  let last = performance.now();
  let elapsed = 0;
  let frames = 0;
  let slowFrames = 0;
  let degraded = false;
  const minFrameMs = high ? 0 : 1000 / 31;

  const placeFloaters = (im: InstancedMesh, data: Floater[], spread: number, pe: number) => {
    data.forEach((f, i) => {
      const tt = elapsed * f.speed + f.phase;
      dummy.position.set(f.base[0] * spread + current.x * 0.25 * f.speed, f.base[1] + Math.sin(tt) * 0.1 - pe * 0.6, f.base[2]);
      dummy.rotation.set(f.rot[0] + elapsed * f.spinRate[0], f.rot[1] + elapsed * f.spinRate[1], f.rot[2]);
      dummy.scale.setScalar(f.scale);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
  };

  const frame = (now: number) => {
    raf = 0;
    if (now - last < minFrameMs) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const realDt = Math.min(1, (now - last) / 1000);
    const dt = Math.min(0.05, realDt); // animation step (capped so a hitch never jumps the scene)
    last = now;
    const idleFor = now - lastInput;
    // Easing to rest uses real time, so slow devices settle (and stop rendering) on schedule too.
    activity += ((idleFor > IDLE_MS ? 0 : 1) - activity) * Math.min(1, realDt * 2.5);
    elapsed += dt * Math.max(activity, 0.02);

    // Adaptive quality: drop resolution + shadows, then fall back to the photo.
    frames++;
    if (frames > 20 && dt > 0.034) slowFrames++;
    if (frames === 120) {
      if (slowFrames > 45 && !degraded) {
        degraded = true;
        dpr = 1;
        renderer.setPixelRatio(dpr);
        renderer.shadowMap.enabled = false;
        resize();
        frames = 0;
        slowFrames = 0;
      } else if (slowFrames > 60 && degraded) {
        destroy();
        return;
      }
    }

    const ease = 1 - Math.pow(0.0015, dt);
    current.x += (target.x - current.x) * ease;
    current.y += (target.y - current.y) * ease;
    dragVel *= Math.pow(0.04, dt);
    const p = scrollP;
    const pe = p * p * (3 - 2 * p);

    spin.rotation.y += dt * 0.2 * activity + dragVel;
    tilt.rotation.x = ELEV + current.y * 0.18 + pe * 0.6;
    tilt.rotation.z = -current.x * 0.18 + Math.sin(elapsed * 0.45) * 0.04;
    tilt.rotation.y = current.x * 0.16;
    root.position.set(current.x * 0.12, Math.sin(elapsed * 0.9) * 0.05 * activity - pe * 1.5, 0);
    root.scale.setScalar(1 - pe * 0.28);
    shadow.position.y = -1.0 - pe * 1.2;
    shadowMat.opacity = (1 - pe) * (0.75 - Math.sin(elapsed * 0.9) * 0.08);
    shadow.scale.setScalar(1 - pe * 0.3);

    const spread = 1 + pe * 0.7;
    placeFloaters(chipIM, chipFloats, spread, pe);
    placeFloaters(chunkIM, chunkFloats, spread, pe);
    placeFloaters(saltIM, saltFloats, spread, pe);
    floaters.rotation.y = current.x * 0.12;
    floaters.position.y = -pe * 0.8;

    renderer.render(scene, camera);
    const settled = idleFor > IDLE_MS && activity < 0.02 && Math.abs(target.x - current.x) + Math.abs(target.y - current.y) < 0.001 && Math.abs(dragVel) < 1e-4;
    if (ready && onScreen && !document.hidden && !destroyed && !settled) raf = requestAnimationFrame(frame);
  };

  function start() {
    if (ready && !raf && !destroyed && onScreen && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
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

  // Compile shaders without blocking, draw the first frame, then reveal.
  await tick();
  await renderer.compileAsync(scene, camera);
  if (destroyed) return { destroy };
  frame(performance.now()); // positions the floaters and renders once (loop not running yet)
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
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onLost);
    scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as Material | Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((mm) => mm.dispose());
    });
    bump.dispose();
    shadowTex.dispose();
    TEX?.dispose();
    scene.environment?.dispose();
    renderer.dispose();
  }

  return { destroy };
}

/** Layered value-noise canvas for the dough bump map (built cooperatively). */
async function noiseCanvas(size: number, rnd: () => number, tick: Tick): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  for (const [n, a] of [[48, 0.55], [110, 0.4], [220, 0.3], [size, 0.22]]) {
    const t = document.createElement('canvas');
    t.width = t.height = n;
    const tg = t.getContext('2d')!;
    const id = tg.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      if (i % 20000 === 0) await tick();
      const v = rnd() * 255;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    tg.putImageData(id, 0, 0);
    g.globalAlpha = a;
    g.imageSmoothingEnabled = true;
    g.drawImage(t, 0, 0, size, size);
  }
  return c;
}
