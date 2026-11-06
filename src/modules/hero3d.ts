/**
 * KUKI hero — the real Classic Kuki as a 3D model (theme/assets/kuki-cookie.glb), with floating
 * chocolate chips, chunks and sea-salt flakes around it.
 *
 * The model is reconstructed from the KUKI product render (scripts/build-cookie-maps.py +
 * scripts/build-cookie-glb.mjs): real colour, real side wall, relief for the melted chocolate /
 * crumble / salt, a normal map for crust detail, and the cookie's own outline. It is a standard
 * glTF 2.0 binary (meshopt-compressed geometry, WebP textures) and can be swapped for any other
 * cookie .glb of radius ≈ 1 centred on the origin.
 *
 * Cost control
 *  - loaded only after the visitor's first interaction; set-up yields to the main thread and
 *    shaders compile asynchronously
 *  - renders only while visible; eases to rest and stops rendering after 6 s without input
 *  - adaptive pixel ratio, 30 fps + no shadow maps on lower-powered devices, photo fallback if slow
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
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
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
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

// Floating pieces: lathe-turned chocolate disc, bevelled broken chunk, flat salt crystal.
function discChipGeo(r: number, h: number, seed: number): BufferGeometry {
  const pts = [[0, 0], [r * 0.9, 0], [r, h * 0.2], [r, h * 0.7], [r * 0.9, h * 0.96], [r * 0.45, h * 1.04], [0, h * 1.06]].map((p) => new Vector2(p[0], p[1]));
  const g = new LatheGeometry(pts, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.09 * fbm(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7, seed, 2) + 0.035 * Math.sin(a * 3 + seed * 2);
    p.setXYZ(i, x * k, y * (1 + 0.08 * fbm(x * 9 + seed, z * 9, 3, 2)), z * k);
  }
  g.computeVertexNormals();
  return g;
}
function chunkGeo(w: number, t: number, d: number, seed: number): BufferGeometry {
  const g = new BoxGeometry(w, t, d, 10, 3, 10);
  const p = g.attributes.position, n = g.attributes.normal;
  const hx = w / 2, hy = t / 2, hz = d / 2, rr = Math.min(0.016, t * 0.3);
  const v = new Vector3(), inn = new Vector3(), nn = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inn.set(clamp(v.x, -hx + rr, hx - rr), clamp(v.y, -hy + rr, hy - rr), clamp(v.z, -hz + rr, hz - rr));
    nn.subVectors(v, inn);
    if (nn.lengthSq() > 1e-10) {
      nn.normalize();
      v.copy(inn).addScaledVector(nn, rr);
      n.setXYZ(i, nn.x, nn.y, nn.z);
    }
    const tx = (v.x / hx + 1) / 2;
    v.z *= 1 - 0.2 * tx;
    v.x += v.z * 0.22;
    v.y += 0.005 * fbm(v.x * 14 + seed, v.z * 14, seed, 2);
    p.setXYZ(i, v.x, v.y + hy, v.z);
  }
  g.computeBoundingSphere();
  return g;
}
function saltGeo(): BufferGeometry {
  const g = new IcosahedronGeometry(1, 0); // already non-indexed → faceted crystal
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.28 * (h3(Math.round(x * 50) + 1, Math.round(y * 50), Math.round(z * 50)) * 2 - 1);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.scale(1, 0.55, 0.85);
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
  const rnd = mulberry32(11);
  const R = (a: number, b: number) => a + (b - a) * rnd();

  const renderer = new WebGLRenderer({ canvas, antialias: high, alpha: true, powerPreference: high ? 'high-performance' : 'low-power' });
  let dpr = Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.35);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  // The model's colour comes from a studio photo (lighting already baked in): no filmic curve,
  // which would wash out its rich golden-orange, and a gentle rig that only adds shape.
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Load the cookie model (meshopt-compressed geometry, WebP textures).
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(model);
  await tick();

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  await tick();

  const camera = new PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0.1, 6.4);
  camera.lookAt(0, 0, 0);

  // root (scroll + float) → tilt (pointer; shows the top like a 34° camera) → spin.
  const root = new Group();
  const tilt = new Group();
  const spin = new Group();
  scene.add(root);
  root.add(tilt);
  tilt.add(spin);

  const key = new DirectionalLight(0xfff1df, 0.62);
  key.position.set(-2.4, 4.2, 2.6);
  key.castShadow = high;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 0.5, far: 12 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 5;
  tilt.add(key, key.target);
  const rim = new DirectionalLight(0xffe2c4, 0.35);
  rim.position.set(3, 2.2, -3.2);
  tilt.add(rim);
  // Total irradiance on the top ≈ 1: the photo's own colours come through as photographed.
  scene.add(new HemisphereLight(0xfff6ea, 0x8a6a4a, 0.27));

  // ------------------------------------------------------------------- the cookie
  const cookie = gltf.scene;
  cookie.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    const mat = m.material as MeshStandardMaterial;
    mat.envMapIntensity = 0.12;
    mat.roughness = 0.9; // matte dough: no grey sheen over the photo's colours
    if (mat.map) mat.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  });
  cookie.position.y = -0.17; // centre the cookie's mass on the tilt pivot
  spin.add(cookie);
  await tick();

  // ------------------------------------------------------------------- floating chocolate + salt
  // Around (not on) the cookie, in the same melted chocolate as the photo, plus loose salt
  // crystals catching the light. World space, so they drift independently of the cookie.
  const chocMat = (hex: number, rough = 0.34) =>
    new MeshPhysicalMaterial({ color: new Color().setHex(hex, SRGBColorSpace), roughness: rough, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.32, envMapIntensity: 1.1 });
  const saltMat = new MeshPhysicalMaterial({
    color: 0xf3efe8, roughness: 0.12, metalness: 0, flatShading: true, transparent: true, opacity: 0.85,
    clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.55, envMapIntensity: 1.4,
  });
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
  const chipFloats = ring(high ? 8 : 5, 1.45, 2.15, 0.07, 0.11, 1.0);
  const chunkFloats = ring(high ? 3 : 2, 1.6, 2.2, 0.16, 0.22, 0.9);
  const saltFloats = ring(high ? 16 : 9, 1.15, 2.0, 0.03, 0.055, 1.1);
  const chipIM = new InstancedMesh(discChipGeo(1, 0.52, 4.2), chocMat(0x4a2618), chipFloats.length);
  const chunkIM = new InstancedMesh(chunkGeo(1, 0.24, 0.8, 7.7), chocMat(0x52291a), chunkFloats.length);
  const saltIM = new InstancedMesh(saltGeo(), saltMat, saltFloats.length);
  floaters.add(chipIM, chunkIM, saltIM);
  const dummy = new Object3D();
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
  const ELEV = (34 * Math.PI) / 180;
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
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((mm) => {
        const std = mm as MeshStandardMaterial;
        [std.map, std.normalMap].forEach((t: Texture | null | undefined) => t?.dispose());
        mm.dispose();
      });
    });
    shadowTex.dispose();
    scene.environment?.dispose();
    renderer.dispose();
  }

  return { destroy };
}
