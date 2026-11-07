/**
 * KUKI hero — the KUKI box opens and the real Classic Kuki (theme/assets/kuki-cookie.glb) rises
 * out of it. The box is the brand's sage packaging: the mascot face on the lid, the four-step mascot
 * print ("Step 1 … Step 4: Smile & Repeat") inside it. A few sea-salt flakes drift off the cookie.
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
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
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
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
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
  /** Mascot illustrations printed inside the lid (steps 1–3), then the mascot face for the lid top. */
  art?: string[];
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

// Floating salt crystal.
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
export async function mountHero({ hero, canvas, stage, quality, model, art = [] }: HeroOptions): Promise<{ destroy: () => void }> {
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

  // root (scroll) → tilt (camera elevation + pointer) → stageG (3/4 view of the box)
  //   ├─ boxG: base + lid on its hinge
  //   └─ cookieG (rises out of the box) → spin → cookie
  const root = new Group();
  const tilt = new Group();
  const stageG = new Group();
  scene.add(root);
  root.add(tilt);
  tilt.add(stageG);
  const YAW = -0.52;
  stageG.rotation.y = YAW;

  const key = new DirectionalLight(0xfff1df, 0.62);
  key.position.set(-2.4, 4.2, 2.6);
  key.castShadow = high;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 14 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 5;
  tilt.add(key, key.target);
  const rim = new DirectionalLight(0xffe2c4, 0.35);
  rim.position.set(3, 2.2, -3.2);
  tilt.add(rim);
  // Total irradiance on the top ≈ 1: the photo's own colours come through as photographed.
  scene.add(new HemisphereLight(0xfff6ea, 0x8a6a4a, 0.27));

  // ------------------------------------------------------------------- the KUKI box
  // Sage mailer box (cookie radius = 1): base with double-thick walls, a lid hinged at the back with
  // a tuck flap at the front. Outside: "KUKI". Inside the lid: the four-step mascot print.
  const BW = 2.56, BD = 2.56, BH = 0.6, BT = 0.045;
  const BOX_Y = -0.95;
  const SAGE = '#a3b091', INK = '#2b3422';
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = 1) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = aniso;
    if (repeat !== 1) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(repeat, repeat);
    }
    return t;
  };
  // Uncoated board: fine speckle + faint fibres, so flat faces don't read as plastic.
  const paper = (g: CanvasRenderingContext2D, w: number, h: number, base = SAGE) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const prng = mulberry32(5);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (prng() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.05;
    g.strokeStyle = '#ffffff';
    for (let i = 0; i < (w * h) / 900; i++) {
      const x = prng() * w, y = prng() * h, a = prng() * Math.PI;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const boardTex = canvasTex(256, 256, (g) => paper(g, 256, 256), 3);
  const boardMat = new MeshStandardMaterial({ map: boardTex, roughness: 0.93, metalness: 0, envMapIntensity: 0.35 });
  const boardInnerMat = new MeshStandardMaterial({ map: boardTex, color: 0xcdd3c0, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });

  // Load the mascot illustrations (best effort: the print works without them).
  const loadImg = (src: string) =>
    new Promise<HTMLImageElement | null>((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  const [mascots] = await Promise.all([Promise.all(art.slice(0, 4).map(loadImg)), document.fonts?.ready]);
  await tick();
  const bodyFont = (w: number, px: number) => `${w} ${px}px Manrope, "Manrope Fallback", Arial, sans-serif`;

  // Inside of the lid — as printed on the real box.
  const printTex = canvasTex(1024, 1024, (g) => {
    paper(g, 1024, 1024);
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const steps = [
      ['Step 1', 'Pick one (or two!)', 'cookies up,', "we won't judge"],
      ['Step 2', 'Dip it!', '(Milk is the best,', 'but you do you)'],
      ['Step 3', 'Take a big bite', '(no crumbs', 'left behind)'],
    ];
    const colW = 1024 / 3;
    steps.forEach((s, i) => {
      const cx = colW * i + colW / 2;
      g.font = bodyFont(800, 50);
      g.fillText(s[0], cx, 150);
      g.font = bodyFont(600, 27);
      s.slice(1).forEach((line, k) => g.fillText(line, cx, 200 + k * 34));
      const im = mascots[i];
      if (im) {
        const h = 400, w = (im.naturalWidth / im.naturalHeight) * h;
        g.drawImage(im, cx - w / 2, 315, w, h);
      }
    });
    // dashed column rules
    g.lineWidth = 3;
    g.setLineDash([14, 12]);
    [1, 2].forEach((i) => {
      g.beginPath();
      g.moveTo(colW * i, 90);
      g.lineTo(colW * i, 760);
      g.stroke();
    });
    g.setLineDash([]);
    g.font = bodyFont(800, 58);
    g.fillText('Step 4: Smile & Repeat', 512, 880);
  });
  // Outside of the lid: the KUKI mascot face (the brand mark), as on the site header.
  const lidTopTex = canvasTex(1024, 1024, (g) => {
    paper(g, 1024, 1024);
    const face = mascots[3];
    if (face) {
      const d = 470;
      g.save();
      g.translate(512, 512);
      g.rotate(-0.14);
      g.drawImage(face, -d / 2, -d / 2, d, d);
      g.restore();
    }
  });
  const lidOuterMat = new MeshStandardMaterial({ map: lidTopTex, roughness: 0.9, metalness: 0, envMapIntensity: 0.35 });
  const lidInnerMat = new MeshStandardMaterial({ map: printTex, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });

  const boxG = new Group();
  boxG.position.y = BOX_Y;
  stageG.add(boxG);
  const slab = (w: number, h: number, d: number, mat: Material | Material[], x: number, y: number, z: number, parent: Object3D = boxG) => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  slab(BW, BT, BD, boardInnerMat, 0, BT / 2, 0);
  slab(BW, BH, BT, [boardMat, boardMat, boardMat, boardMat, boardMat, boardInnerMat], 0, BH / 2, BD / 2 - BT / 2);
  slab(BW, BH, BT, [boardMat, boardMat, boardMat, boardMat, boardInnerMat, boardMat], 0, BH / 2, -BD / 2 + BT / 2);
  slab(BT, BH, BD - 2 * BT, [boardMat, boardInnerMat, boardMat, boardMat, boardMat, boardMat], BW / 2 - BT / 2, BH / 2, 0);
  slab(BT, BH, BD - 2 * BT, [boardInnerMat, boardMat, boardMat, boardMat, boardMat, boardMat], -BW / 2 + BT / 2, BH / 2, 0);
  // Lid on its hinge (back top edge). Closed = 0; opening rotates it up and back.
  const hinge = new Group();
  hinge.position.set(0, BH, -BD / 2);
  boxG.add(hinge);
  const LT = 0.03;
  slab(BW + 0.02, LT, BD + 0.02, [boardMat, boardMat, lidOuterMat, lidInnerMat, boardMat, boardMat], 0, LT / 2, BD / 2 + 0.01, hinge);
  slab(BW + 0.02, BH * 0.86, LT, boardMat, 0, -BH * 0.43 + LT, BD + 0.02 + LT / 2, hinge); // front tuck flap
  const LID_OPEN = 1.78; // ≈ 102°
  await tick();

  // Soft contact shadow under the box.
  const shadowTex = canvasTex(256, 256, (g) => {
    g.shadowColor = 'rgba(40,30,15,.55)';
    g.shadowBlur = 28;
    g.shadowOffsetX = 1000;
    g.fillStyle = '#000';
    g.beginPath();
    g.roundRect(40 - 1000, 40, 176, 176, 18);
    g.fill();
  });
  const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadow = new Mesh(new PlaneGeometry(BW * 1.45, BD * 1.45), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.renderOrder = -1;
  boxG.add(shadow);

  // ------------------------------------------------------------------- the cookie
  const cookie = gltf.scene;
  cookie.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    const mat = m.material as MeshStandardMaterial;
    mat.envMapIntensity = 0.12;
    mat.roughness = 0.9; // matte dough: no grey sheen over the photo's colours
    if (mat.map) mat.map.anisotropy = aniso;
  });
  const bb = new Box3().setFromObject(cookie);
  const COOKIE_H = bb.max.y - bb.min.y;
  cookie.position.y = -bb.min.y - COOKIE_H / 2; // spin about the cookie's middle
  const cookieG = new Group();
  cookieG.rotation.order = 'YXZ';
  cookieG.rotation.y = -YAW; // face the camera, not the box
  const spin = new Group();
  cookieG.add(spin);
  spin.add(cookie);
  stageG.add(cookieG);
  const Y_INSIDE = BOX_Y + BT + COOKIE_H / 2 + 0.004;
  const Y_HOVER = BOX_Y + BH + 0.78;
  await tick();

  // ------------------------------------------------------------------- sea-salt flakes
  const saltMat = new MeshPhysicalMaterial({
    color: 0xf3efe8, roughness: 0.12, metalness: 0, flatShading: true, transparent: true, opacity: 0.85,
    clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.55, envMapIntensity: 1.4,
  });
  type Floater = { base: [number, number, number]; rot: [number, number, number]; spinRate: [number, number]; speed: number; phase: number; scale: number };
  const SALT_N = high ? 14 : 8;
  const saltFloats: Floater[] = Array.from({ length: SALT_N }, (_, i) => {
    const a = (i / SALT_N) * Math.PI * 2 + R(-0.35, 0.35);
    const r = R(1.2, 1.85);
    return {
      base: [Math.cos(a) * r, R(-0.35, 0.75), Math.sin(a) * r * 0.55 + R(0, 0.4)],
      rot: [R(0, 6), R(0, 6), R(0, 6)],
      spinRate: [R(-0.5, 0.5), R(-0.6, 0.6)],
      speed: R(0.35, 0.8),
      phase: R(0, 6.283),
      scale: R(0.03, 0.055),
    };
  });
  const saltIM = new InstancedMesh(saltGeo(), saltMat, saltFloats.length);
  const floaters = new Group();
  floaters.rotation.y = -YAW;
  floaters.add(saltIM);
  stageG.add(floaters);
  const dummy = new Object3D();
  await tick();

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
  const ELEV = (24 * Math.PI) / 180;
  const BASE_SCALE = 0.5;
  const INTRO_END = 2.7;
  let introT = Math.max(0, Number(hero.dataset.introAt) || 0); // data-intro-at: render a given moment (fallback stills)
  let last = performance.now();
  let elapsed = 0;
  let frames = 0;
  let slowFrames = 0;
  let degraded = false;
  const minFrameMs = high ? 0 : 1000 / 31;
  const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
  const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
  const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
  const easeInOut = (x: number) => x * x * (3 - 2 * x);

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

    // Intro (plays once, ~2.7 s): the closed box gives a little hop, the lid swings open, the
    // cookie rises out and turns to face you. Scrolling away lowers it back towards the box.
    introT += dt;
    const t = introT;
    const hop = Math.sin(seg(t, 0.2, 0.62) * Math.PI);
    const lidP = seg(t, 0.55, 1.55);
    const riseP = easeOutCubic(seg(t, 1.0, 2.5));
    hinge.rotation.x = -LID_OPEN * easeOutBack(lidP) - hop * 0.08;
    boxG.position.y = BOX_Y + hop * 0.06;
    boxG.rotation.z = Math.sin(t * 38) * 0.012 * hop;
    const bob = Math.sin(elapsed * 0.9) * 0.05 * activity * riseP;
    const sink = easeInOut(clamp(pe * 1.4, 0, 1)) * 0.7;
    cookieG.position.y = Y_INSIDE + (Y_HOVER - Y_INSIDE) * riseP * (1 - sink) + bob;
    cookieG.rotation.x = 0.32 * riseP * (1 - sink); // tip the top towards the viewer as it rises
    spin.rotation.y += dt * (0.2 * activity + 1.6 * (1 - riseP) * Math.min(1, t)) + dragVel;

    tilt.rotation.x = ELEV + current.y * 0.12 + pe * 0.35;
    tilt.rotation.z = -current.x * 0.06;
    tilt.rotation.y = current.x * 0.22;
    root.position.set(current.x * 0.1, -0.2 - pe * 1.2, 0);
    root.scale.setScalar(BASE_SCALE * (1 - pe * 0.22));

    // salt drifts off the risen cookie
    floaters.position.y = cookieG.position.y;
    saltFloats.forEach((f, i) => {
      const tt = elapsed * f.speed + f.phase;
      dummy.position.set(f.base[0] * (0.6 + 0.4 * riseP) + current.x * 0.2 * f.speed, f.base[1] + Math.sin(tt) * 0.1, f.base[2]);
      dummy.rotation.set(f.rot[0] + elapsed * f.spinRate[0], f.rot[1] + elapsed * f.spinRate[1], f.rot[2]);
      dummy.scale.setScalar(f.scale * seg(riseP, 0.5, 1) * (1 - sink));
      dummy.updateMatrix();
      saltIM.setMatrixAt(i, dummy.matrix);
    });
    saltIM.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
    const settled = introT > INTRO_END && idleFor > IDLE_MS && activity < 0.02 && Math.abs(target.x - current.x) + Math.abs(target.y - current.y) < 0.001 && Math.abs(dragVel) < 1e-4;
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
  frame(performance.now()); // poses the scene and renders once (loop not running yet)
  ready = true;
  lastInput = performance.now();
  requestAnimationFrame(() => hero.classList.add('is-3d'));
  start();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    hero.classList.remove('is-3d');
    hero.classList.add('hero--static');
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
