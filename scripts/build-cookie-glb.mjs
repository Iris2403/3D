// Stage 2 of the KUKI 3D cookie model: builds theme/assets/kuki-cookie.glb from the maps made by
// scripts/build-cookie-maps.py (real colour, side wall, relief, normal detail and outline).
//
// Mesh: a polar grid shaped like the real cookie — domed top displaced by the relief map (melted
// chocolate, crumble, salt stand proud), a puffy rounded rim, the side wall and a flat base, with
// the cookie's own irregular outline. UVs address a 2-region atlas (top view / side-wall strip);
// the rim↔wall seam and the 0°/360° wrap use duplicated vertices with welded normals.
// Material: glTF PBR metallic-roughness (base colour + normal map, roughness 0.72).
// Output is quantized + meshopt-compressed (EXT_meshopt_compression) with WebP textures.
//
//   node scripts/build-cookie-glb.mjs
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, meshopt, tangents, unweld, weld } from '@gltf-transform/functions';
import { generateTangents } from 'mikktspace';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS = join(ROOT, 'source-assets', 'model');
const OUT = join(ROOT, 'theme', 'assets', 'kuki-cookie.glb');

// ------------------------------------------------------------------ inputs
const edge = JSON.parse(readFileSync(join(MAPS, 'edge.json'), 'utf8'));
const heightImg = await sharp(join(MAPS, 'height.png')).greyscale().raw().toBuffer({ resolveWithObject: true });
const HW = heightImg.info.width;
const heightAt = (u, v) => {
  // bilinear sample of the 1024² relief, u,v in 0..1 (v down)
  const x = Math.min(HW - 1.001, Math.max(0, u * (HW - 1)));
  const y = Math.min(HW - 1.001, Math.max(0, v * (HW - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const p = (xx, yy) => heightImg.data[yy * HW + xx] / 255;
  return p(x0, y0) * (1 - fx) * (1 - fy) + p(x0 + 1, y0) * fx * (1 - fy) + p(x0, y0 + 1) * (1 - fx) * fy + p(x0 + 1, y0 + 1) * fx * fy;
};
// Smooth the measured outline a little (per degree → per segment).
const edgeAt = (theta) => {
  const d = ((theta * 180) / Math.PI + 360) % 360;
  let s = 0, w = 0;
  for (let k = -4; k <= 4; k++) {
    const i = (Math.round(d) + k + 360) % 360;
    const wk = 1 - Math.abs(k) / 5;
    s += edge[i] * wk;
    w += wk;
  }
  return s / w;
};

// ------------------------------------------------------------------ shape (cookie radius ≈ 1)
const SEG = 192;                 // around
const TOP_RINGS = 56;            // centre → start of rim
const TOP_R = 0.9;               // flat-ish top ends at 90% of the radius, then the puffy rim
const ATLAS_H = 1280, STRIP_Y = 1024;
const yTop = (s) => 0.335 - 0.035 * s * s;           // gentle dome
const RELIEF = 0.065;                                 // max relief (chocolate) above the dough
const reliefAt = (u, v) => (heightAt(u, v) - 0.3) * RELIEF;

// Profile rows: [kind, param] — kind 0 top, 1 rim (top texture), 2 wall (strip), 3 base (strip)
const rows = [];
for (let i = 0; i <= TOP_RINGS; i++) rows.push({ kind: 0, s: i / TOP_RINGS });
for (let i = 1; i <= 12; i++) rows.push({ kind: 1, t: i / 12 });              // rim: top edge → wall top
rows.push({ kind: 2, t: 0, seam: true });                                     // duplicated seam row
for (let i = 1; i <= 8; i++) rows.push({ kind: 2, t: i / 8 });               // wall
for (let i = 1; i <= 14; i++) rows.push({ kind: 3, s: 1 - i / 14 });          // base → centre

const COLS = SEG + 1;
const pos = [], uv = [];
for (const row of rows) {
  for (let j = 0; j <= SEG; j++) {
    const th = (j / SEG) * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    const R = edgeAt(th);
    let r, y, U, V;
    if (row.kind === 0) {
      r = row.s * TOP_R * R;
      const tu = 0.5 + 0.5 * c * row.s * TOP_R, tv = 0.5 + 0.5 * sn * row.s * TOP_R;
      y = yTop(row.s) + reliefAt(tu, tv) * Math.min(1, (1 - row.s) * 6 + 0.25);
      U = tu; V = (tv * 1024) / ATLAS_H;
    } else if (row.kind === 1) {
      // puffy rounded rim: quarter-ellipse from (TOP_R·R, yTop(1)) out and down to (R, wall top)
      const a = (row.t * Math.PI) / 2;
      r = (TOP_R + (1 - TOP_R) * Math.sin(a)) * R;
      y = 0.21 + (yTop(1) - 0.21) * Math.cos(a) + 0.012 * Math.sin(a * 2);
      const rr = TOP_R + (1 - TOP_R) * Math.sin(a) * 0.98;
      const tu = 0.5 + 0.5 * c * rr, tv = 0.5 + 0.5 * sn * rr;
      U = tu; V = (tv * 1024) / ATLAS_H;
    } else if (row.kind === 2) {
      // side wall with a slight belly, down to a softly rounded base edge
      r = R * (1 + 0.012 * Math.sin(row.t * Math.PI));
      y = 0.21 * (1 - row.t) + 0.012 * row.t;
      U = j / SEG; V = (STRIP_Y + (6 + row.t * 238)) / ATLAS_H;
    } else {
      r = row.s * 0.985 * R;
      y = 0;
      U = j / SEG; V = (STRIP_Y + 248) / ATLAS_H;
    }
    // Mirror the front of the top view onto the cookie: world +z faces the viewer = image down.
    pos.push(c * r, y, sn * r);
    uv.push(U, V);
  }
}
const idx = [];
for (let i = 0; i < rows.length - 1; i++) {
  if (rows[i + 1].seam) continue; // seam row coincides with the row above: no triangles
  for (let j = 0; j < SEG; j++) {
    const a = i * COLS + j, b = a + 1, c = a + COLS, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
}

// Smooth normals, then weld coincident vertices (wrap column + seam row) so shading is seamless.
const nrm = new Float32Array(pos.length);
for (let k = 0; k < idx.length; k += 3) {
  const [ia, ib, ic] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
  const ux = pos[ib] - pos[ia], uy = pos[ib + 1] - pos[ia + 1], uz = pos[ib + 2] - pos[ia + 2];
  const vx = pos[ic] - pos[ia], vy = pos[ic + 1] - pos[ia + 1], vz = pos[ic + 2] - pos[ia + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const p of [ia, ib, ic]) { nrm[p] += nx; nrm[p + 1] += ny; nrm[p + 2] += nz; }
}
const groups = new Map();
for (let i = 0; i < pos.length / 3; i++) {
  const key = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
  (groups.get(key) || groups.set(key, []).get(key)).push(i);
}
for (const ids of groups.values()) {
  let x = 0, y = 0, z = 0;
  for (const i of ids) { x += nrm[i * 3]; y += nrm[i * 3 + 1]; z += nrm[i * 3 + 2]; }
  const l = Math.hypot(x, y, z) || 1;
  for (const i of ids) { nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l; }
}
// Faces must point outward (top normal up).
if (nrm[COLS * 3 * 2 + 1] < 0) {
  for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  for (let k = 0; k < nrm.length; k++) nrm[k] = -nrm[k];
}

// ------------------------------------------------------------------ glTF document
const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const albedo = await sharp(join(MAPS, 'albedo.png')).webp({ quality: 78, effort: 6 }).toBuffer();
const normal = await sharp(join(MAPS, 'normal.png')).resize(512, 640).webp({ quality: 80, effort: 6 }).toBuffer(); // fine detail survives at half res
const baseTex = doc.createTexture('kuki-albedo').setImage(albedo).setMimeType('image/webp');
const normTex = doc.createTexture('kuki-normal').setImage(normal).setMimeType('image/webp');
const material = doc
  .createMaterial('KUKI cookie')
  .setBaseColorTexture(baseTex)
  .setNormalTexture(normTex)
  .setNormalScale(1.0)
  .setRoughnessFactor(0.72)
  .setMetallicFactor(0);
const prim = doc
  .createPrimitive()
  .setMaterial(material)
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
  .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
const mesh = doc.createMesh('KukiCookie').addPrimitive(prim);
const node = doc.createNode('KukiCookie').setMesh(mesh);
doc.createScene('KUKI').addChild(node);
doc.getRoot().getAsset().generator = 'KUKI build-cookie-glb.mjs';

await MeshoptEncoder.ready;
// MikkTSpace tangents make the normal map portable across glTF viewers.
await doc.transform(unweld(), tangents({ generateTangents, overwrite: true }), weld(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const glb = await io.writeBinary(doc);
(await import('node:fs')).writeFileSync(OUT, glb);
console.log(`kuki-cookie.glb: ${(glb.byteLength / 1024).toFixed(0)} KB · ${pos.length / 3} vertices · ${idx.length / 3} triangles`);
