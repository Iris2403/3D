/**
 * KUKI hero — the Classic Kuki (theme/assets/kuki-cookie.glb) being dunked into milk.
 *
 * Scene
 *  - the cookie, held at an angle, dips edge-first into a pool of milk: its underside is below
 *    the surface (never seen), and the dunked edge carries a clinging milk film with drips
 *  - a milk surface with ripples spreading from the dunk (vertex shader, analytic normals) that
 *    fades softly into the page
 *  - a slow-motion splash: a crown of thin milk sheets with fingers and rolled rims around the
 *    entry, plus droplets flying out on ballistic arcs and falling back
 *  - floating ingredients in the air: teardrop chocolate chips, broken chocolate pieces
 *    (fractured sides, smooth glossy tops, cocoa sheen), sea-salt crystals (cubes and hollow
 *    Maldon pyramids) and a few crumbs, tumbling with their own angular momentum
 *
 * Cost control
 *  - loaded only after the visitor's first interaction; set-up yields to the main thread and
 *    shaders compile asynchronously
 *  - renders only while visible; eases to rest and stops rendering after 6 s without input
 *  - adaptive pixel ratio, 30 fps + no shadow maps on lower-powered devices, photo fallback if slow
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface HeroOptions {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  quality: 'high' | 'low';
  /** URL of the cookie model (.glb). */
  model?: string;
}

// ---------------------------------------------------------------------------------------------
// Utilities
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
function h3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + 0.123) * 43758.5453123;
  return s - Math.floor(s);
}
function vn(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const a = l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v);
  const b = l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v);
  return l(a, b, w);
}
function fbm(x: number, y: number, z: number, o = 4): number {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < o; i++) {
    s += a * (vn(x * f, y * f, z * f) * 2 - 1);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
const ridged = (x: number, y: number, z: number) => 1 - Math.abs(vn(x, y, z) * 2 - 1);

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

// ---------------------------------------------------------------------------------------------
// Ingredient geometry
// ---------------------------------------------------------------------------------------------
/** A real chocolate chip: flat base, teardrop body, soft tip (lathe profile + slight irregularity). */
function teardropChipGeo(seed: number): BufferGeometry {
  const prof: Vector2[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 base centre → 1 tip
    const y = t * 1.0;
    // radius: wide rounded base, concave flank, soft rounded tip
    const r = t < 0.12 ? 0.62 + 0.38 * Math.sin((t / 0.12) * Math.PI * 0.5) : Math.max(0.02, Math.pow(1 - (t - 0.12) / 0.88, 1.35) * 1.0 - 0.02 * Math.sin(t * 9));
    prof.push(new Vector2(i === 0 ? 0 : r, y * 0.95));
  }
  prof[0].set(0, 0);
  prof.splice(1, 0, new Vector2(0.62, 0));
  const g = new LatheGeometry(prof, 28);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.06 * fbm(x * 2.2 + seed, y * 2.2, z * 2.2 + seed, 2);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.translate(0, -0.35, 0);
  g.computeVertexNormals();
  return g;
}

/** A broken piece of chocolate: smooth glossy top/bottom, fractured (ridged, faceted) sides. */
function brokenChocolateGeo(seed: number): BufferGeometry {
  const w = 1, t = 0.34, d = 0.72;
  let g: BufferGeometry = new BoxGeometry(w, t, d, 8, 2, 8);
  const p = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const side = Math.max(Math.abs(v.x) / (w / 2), Math.abs(v.z) / (d / 2)); // 1 on the sides
    // irregular outline (a broken shard, not a rectangle)
    const ang = Math.atan2(v.z, v.x);
    const outline = 1 + 0.18 * fbm(Math.cos(ang) * 1.3 + seed, Math.sin(ang) * 1.3, seed, 3);
    v.x *= outline;
    v.z *= outline;
    // fracture relief on the broken sides, gentle wave on the moulded top
    if (side > 0.98 && Math.abs(v.y) < t / 2 - 1e-3) {
      const r = ridged(v.x * 9 + seed, v.y * 9, v.z * 9) * 0.06;
      v.x += Math.sign(v.x) * r;
      v.z += Math.sign(v.z) * r;
    }
    if (v.y > 0) v.y += 0.02 * fbm(v.x * 3 + seed, 0, v.z * 3, 2);
    // slight taper towards the top, like a moulded bar
    if (v.y > 0) {
      v.x *= 0.94;
      v.z *= 0.94;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g = g.toNonIndexed(); // crisp facets on the fracture
  g.computeVertexNormals();
  return g;
}

/** Salt: a slightly irregular cube crystal… */
function saltCubeGeo(): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.12 * (h3(Math.round(x * 10) + 3, Math.round(y * 10), Math.round(z * 10)) * 2 - 1);
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}
/** …and a hollow Maldon-style pyramid flake. */
function saltPyramidGeo(): BufferGeometry {
  const g = new ConeGeometry(1, 0.7, 4, 1, true).toNonIndexed();
  g.rotateY(Math.PI / 4);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------
export async function mountHero({ hero, canvas, stage, quality, model }: HeroOptions): Promise<{ destroy: () => void }> {
  if (!model) throw new Error('no model');
  const tick = makeTick();
  const high = quality === 'high';
  const rnd = mulberry32(17);
  const R = (a: number, b: number) => a + (b - a) * rnd();

  const renderer = new WebGLRenderer({ canvas, antialias: high, alpha: true, powerPreference: high ? 'high-performance' : 'low-power' });
  let dpr = Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.35);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  // The cookie's colour comes from a studio photo: no filmic curve (it would wash out the golden
  // orange) and a gentle, calibrated rig.
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(model);
  await tick();

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  await tick();

  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  const CAM_TARGET = new Vector3(0, 0.5, 0);
  camera.position.set(0, 2.7, 6.7); // ~20° above the milk: you look down into the pool
  camera.lookAt(CAM_TARGET);

  // world (scroll) → orbit (pointer / drag) → everything
  const world = new Group();
  const orbit = new Group();
  scene.add(world);
  world.add(orbit);

  const key = new DirectionalLight(0xfff1df, 0.62);
  key.position.set(-2.6, 4.4, 3.2);
  key.castShadow = high;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 0.5, far: 14 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  orbit.add(key, key.target);
  const rim = new DirectionalLight(0xffe2c4, 0.35);
  rim.position.set(3, 2.4, -3.4);
  orbit.add(rim);
  scene.add(new HemisphereLight(0xfff6ea, 0x8a6a4a, 0.27));

  // Shared uniforms for the milk shaders.
  const uMilk = { uTime: { value: 0 }, uMilkY: { value: 0 }, uAmp: { value: 1 } };
  // Creamy (not paper-white) so the pure-white highlights and reflections give the milk its form.
  const MILK = new Color().setHex(0xddd2bf, SRGBColorSpace);

  // ------------------------------------------------------------------- the cookie, dunked
  const cookieHold = new Group(); // dunk motion
  orbit.add(cookieHold);
  const cookie = gltf.scene;
  cookie.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    const mat = m.material as MeshStandardMaterial;
    mat.envMapIntensity = 0.12;
    mat.roughness = 0.9;
    if (mat.map) mat.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // Milk clinging to the dunked edge: whiten + gloss below the waterline, with a wavy edge and
    // drips running down from it (world-space, so it follows the milk, not the cookie).
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uMilk, { uMilkColor: { value: MILK } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMilkWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMilkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vMilkWorld;
          uniform float uMilkY;
          uniform float uTime;
          uniform vec3 uMilkColor;
          float milkFilm() {
            float x = vMilkWorld.x;
            float edge = uMilkY + 0.07 + 0.025 * sin(x * 11.0 + uTime * 0.6) + 0.015 * sin(x * 27.0);
            float drip = pow(max(0.0, sin(x * 17.0 + 1.3) * sin(x * 5.3)), 6.0) * 0.16;
            return smoothstep(edge + drip + 0.012, edge + drip - 0.012, vMilkWorld.y);
          }`,
        )
        .replace('#include <map_fragment>', '#include <map_fragment>\nfloat mf = milkFilm();\ndiffuseColor.rgb = mix(diffuseColor.rgb, uMilkColor, mf * 0.88);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, mf);');
    };
  });
  // Upright-ish, top facing the viewer, the lower edge in the milk (radius 1, ~0.34 thick).
  cookie.rotation.set(0.9, 0, -0.12);
  cookie.position.set(0, 0, 0);
  cookieHold.add(cookie);
  cookieHold.position.set(0, 0.36, 0.05);
  await tick();

  // ------------------------------------------------------------------- milk surface
  const milkGeo = new PlaneGeometry(5.4, 5.4, high ? 160 : 100, high ? 160 : 100);
  milkGeo.rotateX(-Math.PI / 2);
  const fade = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    // Opaque out to ~2× the cookie's radius (so nothing below the surface shows through), then a
    // soft fade into the page.
    gr.addColorStop(0, '#fff');
    gr.addColorStop(0.58, '#fff');
    gr.addColorStop(0.8, '#777');
    gr.addColorStop(0.96, '#000');
    gr.addColorStop(1, '#000');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    return new CanvasTexture(c);
  })();
  const milkMat = new MeshPhysicalMaterial({
    color: MILK,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    sheen: 0.4,
    sheenColor: new Color(0xffffff),
    envMapIntensity: 1.5,
    transparent: true,
    alphaMap: fade,
    depthWrite: false,
  });
  // Ripples spreading from the dunk (analytic height + normal, no CPU work per frame).
  milkMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uMilk);
    const wave = `
      uniform float uTime;
      uniform float uAmp;
      float milkH(vec2 p) {
        vec2 q = vec2(p.x / 0.98, (p.y - 0.33) / 0.3);
        float r = length(q);
        float ring = smoothstep(0.85, 1.25, r);
        float h = 0.018 * sin(r * 6.0 - uTime * 1.6) * exp(-(r - 1.0) * 0.8)
                + 0.006 * sin(r * 13.0 - uTime * 2.3 + 1.0) * exp(-(r - 1.0) * 1.4);
        // a gentle swell lifted around the cookie where the milk is displaced
        h += 0.035 * exp(-pow((r - 1.1) * 3.0, 2.0));
        return h * ring * uAmp;
      }`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + wave)
      .replace(
        '#include <beginnormal_vertex>',
        `float e = 0.02;
        float hC = milkH(position.xz);
        float hX = milkH(position.xz + vec2(e, 0.0));
        float hZ = milkH(position.xz + vec2(0.0, e));
        vec3 objectNormal = normalize(vec3(-(hX - hC) / e, 1.0, -(hZ - hC) / e));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\ntransformed.y += hC;');
  };
  const milk = new Mesh(milkGeo, milkMat);
  milk.receiveShadow = true;
  milk.renderOrder = 1;
  orbit.add(milk);
  await tick();

  // ------------------------------------------------------------------- splash
  // Modelled on milk-splash photography: a soft lip of milk hugging the cookie where it enters,
  // a low rounded crown around it, and tapered jets curving out of the crown — each carrying a
  // droplet about to break off — plus droplets in flight (slow motion).
  // Where the tilted cookie actually crosses the surface: its front edge enters at z ≈ 0.33.
  const RX = 0.98, RZ = 0.3, CZ = 0.33;
  const splashMat = new MeshPhysicalMaterial({
    color: MILK,
    roughness: 0.07,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    sheen: 0.4,
    sheenColor: new Color(0xffffff),
    envMapIntensity: 1.6,
  });
  const ell = (th: number, k = 1) => new Vector3(Math.cos(th) * RX * k, 0, CZ + Math.sin(th) * RZ * k);

  // Meniscus lip + low crown: a closed, thick, rounded profile swept around the entry ellipse.
  // Profile (in the radial / vertical plane): inner foot → rounded lip → outer foot.
  const N = high ? 128 : 84;
  const PROF = 14;
  const crownPos = new Float32Array((N + 1) * PROF * 3);
  const crownIdx: number[] = [];
  for (let i = 0; i < PROF - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * (N + 1) + j, b = a + 1, c = a + N + 1, d = c + 1;
      crownIdx.push(a, b, c, b, d, c);
    }
  }
  const crownGeo = new BufferGeometry();
  crownGeo.setAttribute('position', new BufferAttribute(crownPos, 3));
  crownGeo.setIndex(crownIdx);
  const crown = new Mesh(crownGeo, splashMat);
  crown.castShadow = true;
  orbit.add(crown);
  const lobes = Array.from({ length: 9 }, () => ({ a: R(0, Math.PI * 2), w: R(0.15, 0.35), h: R(0.03, 0.08), ph: R(0, 6.28) }));
  const crownH = (th: number, t: number) => {
    let h = 0.05 + 0.012 * Math.sin(th * 5 + t * 0.7);
    for (const l of lobes) {
      let d = Math.abs(((th - l.a + Math.PI) % (Math.PI * 2)) - Math.PI);
      d = Math.min(d, Math.PI * 2 - d);
      h += l.h * Math.exp(-(d * d) / (2 * l.w * l.w)) * (0.85 + 0.15 * Math.sin(t * 0.8 + l.ph));
    }
    return h;
  };
  const updateCrown = (t: number, lift: number) => {
    for (let i = 0; i < PROF; i++) {
      // u: 0 → 1 across the profile; radial offset + height trace a rounded bump (a "lip")
      const u = i / (PROF - 1);
      const ang = u * Math.PI; // half-circle from inner foot to outer foot
      for (let j = 0; j <= N; j++) {
        const th = (j / N) * Math.PI * 2;
        const h = crownH(th, t) * lift;
        const radial = 1.0 + 0.07 - Math.cos(ang) * 0.07 + 0.02 * Math.sin(ang); // 1.0 … 1.14
        const y = Math.sin(ang) * h - 0.012;
        const k = (i * (N + 1) + j) * 3;
        crownPos[k] = Math.cos(th) * RX * radial;
        crownPos[k + 1] = y;
        crownPos[k + 2] = CZ + Math.sin(th) * RZ * radial;
      }
    }
    crownGeo.attributes.position.needsUpdate = true;
    crownGeo.computeVertexNormals();
  };
  updateCrown(0, 1);

  // Jets: tapered tubes curving up and out of the crown, a bead forming at each tip.
  type Jet = { th: number; len: number; lean: number; r0: number; ph: number };
  const JETS = high ? 14 : 9;
  const jets: Jet[] = Array.from({ length: JETS }, (_, i) => ({
    th: (i / JETS) * Math.PI * 2 + R(-0.18, 0.18),
    len: R(0.14, 0.42) * (Math.abs(Math.cos((i / JETS) * Math.PI * 2)) * 0.6 + 0.5),
    lean: R(0.35, 0.75),
    r0: R(0.018, 0.03),
    ph: R(0, 6.28),
  }));
  const JET_SEG = 10, JET_RAD = 8;
  const jetGeo = (() => {
    // unit jet along +y (0..1), radius 1 → 0.25 taper; bent in the frame loop via instance matrices
    const g = new LatheGeometry(
      Array.from({ length: JET_SEG + 1 }, (_, i) => {
        const t = i / JET_SEG;
        return new Vector2(t === 1 ? 0 : (1 - t * 0.72) * (1 + 0.25 * Math.exp(-t * 8)), t);
      }),
      JET_RAD,
    );
    g.computeVertexNormals();
    return g;
  })();
  const jetIM = new InstancedMesh(jetGeo, splashMat, jets.length);
  jetIM.castShadow = true;
  orbit.add(jetIM);
  const DROPS = high ? 34 : 18;
  const dropGeo = new SphereGeometry(1, 14, 10);
  const drops = new InstancedMesh(dropGeo, splashMat, DROPS + jets.length);
  drops.castShadow = true;
  orbit.add(drops);
  const dummy = new Object3D();
  const UP = new Vector3(0, 1, 0);
  const qTmp = new Quaternion();
  const jetTip = (j: Jet, t: number, lift: number) => {
    const base = ell(j.th, 1.08);
    base.y = crownH(j.th, t) * lift * 0.8;
    const out = new Vector3(Math.cos(j.th), 0, Math.sin(j.th) * (RZ / RX)).normalize();
    const dir = out.multiplyScalar(j.lean).add(new Vector3(0, 1, 0)).normalize();
    const len = j.len * lift * (0.9 + 0.1 * Math.sin(t * 0.9 + j.ph));
    return { base, dir, len, tip: base.clone().addScaledVector(dir, len) };
  };
  type Drop = { p: Vector3; v: Vector3; s: number };
  const spawnDrop = (d?: Drop): Drop => {
    const j = jets[Math.floor(rnd() * jets.length)];
    const { tip, dir } = jetTip(j, 0, 1);
    const v = dir.clone().multiplyScalar(R(0.5, 1.1)).add(new Vector3(0, R(0.3, 0.7), 0));
    const s = R(0.012, 0.03);
    if (d) {
      d.p.copy(tip);
      d.v.copy(v);
      d.s = s;
      return d;
    }
    return { p: tip, v, s };
  };
  const dropData: Drop[] = Array.from({ length: DROPS }, () => {
    const d = spawnDrop();
    const age = R(0, 1.4);
    d.p.addScaledVector(d.v, age);
    d.p.y -= 0.8 * age * age;
    d.v.y -= 1.6 * age;
    return d;
  });
  const updateDrops = (dt: number, t: number, lift: number) => {
    jets.forEach((j, i) => {
      const { base, dir, len, tip } = jetTip(j, t, lift);
      dummy.position.copy(base);
      dummy.quaternion.setFromUnitVectors(UP, dir);
      dummy.scale.set(j.r0, len, j.r0);
      dummy.updateMatrix();
      jetIM.setMatrixAt(i, dummy.matrix);
      // bead at the tip (slightly larger than the jet: the droplet about to separate)
      dummy.position.copy(tip);
      dummy.quaternion.setFromUnitVectors(UP, dir);
      const s = j.r0 * 1.35;
      dummy.scale.set(s, s * 1.25, s);
      dummy.updateMatrix();
      drops.setMatrixAt(DROPS + i, dummy.matrix);
    });
    jetIM.instanceMatrix.needsUpdate = true;
    dropData.forEach((d, i) => {
      d.v.y -= 1.6 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < -0.02) spawnDrop(d);
      dummy.position.copy(d.p);
      qTmp.setFromUnitVectors(UP, d.v.clone().normalize());
      dummy.quaternion.copy(qTmp);
      const stretch = 1 + Math.min(1.2, d.v.length() * 0.5);
      dummy.scale.set(d.s, d.s * stretch, d.s);
      dummy.updateMatrix();
      drops.setMatrixAt(i, dummy.matrix);
    });
    drops.instanceMatrix.needsUpdate = true;
  };
  updateDrops(0, 0, 1);
  await tick();

  // ------------------------------------------------------------------- floating ingredients
  const chocMat = new MeshPhysicalMaterial({
    color: new Color().setHex(0x3b1d11, SRGBColorSpace),
    roughness: 0.36,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    sheen: 0.35,
    sheenColor: new Color().setHex(0x8a5a3c, SRGBColorSpace), // faint cocoa bloom
    envMapIntensity: 0.9,
  });
  const saltMat = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    ior: 1.54,
    specularIntensity: 1,
    envMapIntensity: 1.6,
    side: DoubleSide,
  });
  const crumbMat = new MeshStandardMaterial({ color: new Color().setHex(0xc27a35, SRGBColorSpace), roughness: 0.95, flatShading: true, envMapIntensity: 0.3 });

  type Floater = { p: Vector3; base: Vector3; axis: Vector3; spin: number; q: Quaternion; s: Vector3; bob: number; ph: number };
  const makeFloaters = (n: number, size: [number, number], shape: (s: number) => Vector3, zone: { r: [number, number]; y: [number, number] }): Floater[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + R(-0.4, 0.4);
      const r = R(zone.r[0], zone.r[1]);
      const base = new Vector3(Math.cos(a) * r, R(zone.y[0], zone.y[1]), Math.sin(a) * r * 0.6 + R(-0.3, 0.6));
      const s = R(size[0], size[1]);
      return {
        p: base.clone(),
        base,
        axis: new Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize(),
        spin: R(0.25, 0.7) * (rnd() < 0.5 ? -1 : 1),
        q: new Quaternion().setFromEuler(new Euler(R(0, 6), R(0, 6), R(0, 6))),
        s: shape(s),
        bob: R(0.04, 0.09),
        ph: R(0, 6.28),
      };
    });
  const zoneHigh = { r: [1.45, 2.25] as [number, number], y: [0.55, 2.05] as [number, number] };
  const chips = makeFloaters(high ? 7 : 4, [0.09, 0.13], (s) => new Vector3(s, s * 1.05, s), zoneHigh);
  const pieces = makeFloaters(high ? 4 : 2, [0.17, 0.25], (s) => new Vector3(s, s, s), zoneHigh);
  const cubes = makeFloaters(high ? 12 : 7, [0.022, 0.04], (s) => new Vector3(s, s, s), { r: [1.25, 2.1], y: [0.4, 2.1] });
  const pyramids = makeFloaters(high ? 6 : 3, [0.04, 0.06], (s) => new Vector3(s, s * 0.8, s), { r: [1.3, 2.1], y: [0.5, 2.0] });
  const crumbs = makeFloaters(high ? 10 : 6, [0.018, 0.034], (s) => new Vector3(s, s * 0.7, s * 0.9), { r: [1.15, 1.9], y: [0.3, 1.8] });
  const chipIM = new InstancedMesh(teardropChipGeo(3.1), chocMat, chips.length);
  const pieceIM = new InstancedMesh(brokenChocolateGeo(5.7), chocMat, pieces.length);
  const cubeIM = new InstancedMesh(saltCubeGeo(), saltMat, cubes.length);
  const pyrIM = new InstancedMesh(saltPyramidGeo(), saltMat, pyramids.length);
  const crumbIM = new InstancedMesh(new DodecahedronGeometry(1, 0), crumbMat, crumbs.length);
  for (const im of [chipIM, pieceIM]) im.castShadow = true;
  const floaters = new Group();
  floaters.add(chipIM, pieceIM, cubeIM, pyrIM, crumbIM);
  orbit.add(floaters);
  const qStep = new Quaternion();
  const placeFloaters = (im: InstancedMesh, data: Floater[], dt: number, t: number, spread: number) => {
    data.forEach((f, i) => {
      // tumble with constant angular momentum (realistic, never "wobbly")
      qStep.setFromAxisAngle(f.axis, f.spin * dt);
      f.q.premultiply(qStep);
      f.p.set(f.base.x * spread, f.base.y + Math.sin(t * 0.7 + f.ph) * f.bob, f.base.z);
      dummy.position.copy(f.p);
      dummy.quaternion.copy(f.q);
      dummy.scale.copy(f.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  await tick();

  // ------------------------------------------------------------------- interaction
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let yaw = 0;
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
  let dragX: number | null = null;
  const onDown = (e: PointerEvent) => {
    wake();
    dragX = e.clientX;
  };
  const onMove = (e: PointerEvent) => {
    if (dragX === null) return;
    dragVel += (e.clientX - dragX) * 0.002;
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
  let last = performance.now();
  let elapsed = 0;
  let frames = 0;
  let slowFrames = 0;
  let degraded = false;
  const minFrameMs = high ? 0 : 1000 / 31;

  const frame = (now: number) => {
    raf = 0;
    if (now - last < minFrameMs) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const realDt = Math.min(1, (now - last) / 1000);
    const dt = Math.min(0.05, realDt);
    last = now;
    const idleFor = now - lastInput;
    activity += ((idleFor > IDLE_MS ? 0 : 1) - activity) * Math.min(1, realDt * 2.5);
    const adt = dt * Math.max(activity, 0.02);
    elapsed += adt;

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
    yaw += dragVel;
    const pe = scrollP * scrollP * (3 - 2 * scrollP);

    // Pointer / drag orbit the whole scene a little (the cookie stays in the milk).
    orbit.rotation.y = yaw + current.x * 0.32;
    orbit.rotation.x = current.y * 0.06;
    // The dunk: a slow dip-and-lift, deeper as you scroll.
    const dunk = Math.sin(elapsed * 0.55) * 0.045 * activity;
    cookieHold.position.y = 0.36 + dunk - pe * 0.5;
    cookieHold.rotation.z = Math.sin(elapsed * 0.4) * 0.02 * activity;
    world.position.y = -pe * 0.6;
    world.scale.setScalar(1 - pe * 0.18);
    uMilk.uTime.value = elapsed;
    uMilk.uMilkY.value = world.position.y;
    const lift = 0.85 + 0.15 * Math.sin(elapsed * 0.55 + 1.2);
    updateCrown(elapsed, lift);
    updateDrops(adt * 0.45, elapsed, lift); // slow-motion droplets

    const spread = 1 + pe * 0.5;
    placeFloaters(chipIM, chips, adt, elapsed, spread);
    placeFloaters(pieceIM, pieces, adt, elapsed, spread);
    placeFloaters(cubeIM, cubes, adt, elapsed, spread);
    placeFloaters(pyrIM, pyramids, adt, elapsed, spread);
    placeFloaters(crumbIM, crumbs, adt, elapsed, spread);

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

  await tick();
  await renderer.compileAsync(scene, camera);
  if (destroyed) return { destroy };
  frame(performance.now());
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
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((mm) => {
        const std = mm as MeshStandardMaterial;
        [std.map, std.normalMap, std.alphaMap].forEach((t: Texture | null | undefined) => t?.dispose());
        mm.dispose();
      });
    });
    scene.environment?.dispose();
    renderer.dispose();
  }

  return { destroy };
}
