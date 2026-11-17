// Node helpers for the asset pipeline (scripts/assets/build.mjs).
// Loads FBX / OBJ(+MTL) / glTF with three.js loaders, bakes material colours into
// vertex colours, simplifies with meshoptimizer and writes GLB files.
import { readFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { PNG } from 'pngjs';

await MeshoptSimplifier.ready;

// --- Node polyfills -----------------------------------------------------------
// Textures are not decoded in Node; materials keep their names for colour mapping.
THREE.TextureLoader.prototype.load = function (url) {
  const t = new THREE.Texture();
  t.name = String(url).split(/[\\/]/).pop();
  return t;
};
THREE.ImageLoader.prototype.load = () => null;
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((b) => {
        this.result = b;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((b) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  };
}

export async function loadModel(file) {
  const ext = extname(file).toLowerCase();
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (ext === '.fbx') return new FBXLoader().parse(ab, dirname(file) + '/');
  if (ext === '.obj') {
    const obj = new OBJLoader();
    try {
      const mtl = new MTLLoader().parse(readFileSync(file.slice(0, -4) + '.mtl', 'utf8'), dirname(file) + '/');
      mtl.preload();
      obj.setMaterials(mtl);
    } catch {
      // no .mtl next to the .obj
    }
    return obj.parse(buf.toString('utf8'));
  }
  if (ext === '.glb' || ext === '.gltf') {
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, dirname(file) + '/', res, rej));
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
  throw new Error(`unsupported model format: ${file}`);
}

/**
 * Source colour of a material as sRGB hex. Blender exports (FBX Kd, MTL Kd) store
 * linear values, which three.js loaders read as sRGB; `linearSource` undoes that.
 */
export function materialHex(m, linearSource = true) {
  if (!m?.color) return 0xffffff;
  if (!linearSource) return m.color.getHex();
  const s = m.color.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return new THREE.Color().setRGB(s.r, s.g, s.b, THREE.LinearSRGBColorSpace).getHex();
}

/**
 * Flatten a loaded scene into parts: one non-indexed geometry (position, normal,
 * color) per (mesh, material) in world space. `colorOf(materialName, mesh, baseHex)`
 * returns a hex colour or null to drop that part (e.g. glass).
 */
export function bakeParts(root, colorOf, { linearSource = true } = {}) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
    for (const grp of groups) {
      const m = mats[grp.materialIndex] ?? mats[0];
      const hex = colorOf(m?.name ?? '', o, materialHex(m, linearSource));
      if (hex === null || hex === undefined) continue;
      const pos = g.attributes.position.array.slice(grp.start * 3, (grp.start + grp.count) * 3);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      parts.push({ geo: pg, hex, material: m?.name ?? '', mesh: o.name });
    }
  });
  return parts;
}

/** Decode a PNG into { width, height, data (RGBA) }. */
export function readPng(file) {
  return PNG.sync.read(readFileSync(file));
}

/**
 * Like bakeParts, for models coloured through a texture (palette atlases): every triangle
 * takes the texel under its UV centre; triangles are grouped by colour into parts.
 * `colorOf(hex, mesh)` may remap a colour or return null to drop those triangles.
 */
export function bakeTexturedParts(root, img, colorOf = (hex) => hex, { flipY = true } = {}) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const pos = g.attributes.position.array;
    const uv = g.attributes.uv;
    const byHex = new Map();
    for (let t = 0; t < pos.length / 9; t++) {
      let hex = 0xcccccc;
      if (uv) {
        let u = 0;
        let v = 0;
        for (let k = 0; k < 3; k++) {
          u += uv.getX(t * 3 + k) / 3;
          v += uv.getY(t * 3 + k) / 3;
        }
        u -= Math.floor(u);
        v -= Math.floor(v);
        const px = Math.min(img.width - 1, Math.floor(u * img.width));
        const py = Math.min(img.height - 1, Math.floor((flipY ? 1 - v : v) * img.height));
        const i = (py * img.width + px) * 4;
        hex = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
      }
      const out = colorOf(hex, o);
      if (out === null || out === undefined) continue;
      let list = byHex.get(out);
      if (!list) byHex.set(out, (list = []));
      for (let k = 0; k < 9; k++) list.push(pos[t * 9 + k]);
    }
    for (const [hex, arr] of byHex) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      parts.push({ geo: pg, hex, material: `#${hex.toString(16).padStart(6, '0')}`, mesh: o.name });
    }
  });
  return parts;
}

/** Number of triangles in non-indexed or indexed geometry. */
export const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/**
 * Simplify one single-colour part to about `ratio` of its triangles. Vertices are
 * welded by position first (flat-shaded sources duplicate them per face).
 */
export function simplifyPart(geo, ratio, { sloppy = false, error = 0.02 } = {}) {
  if (ratio >= 1) return geo;
  const welded = mergeVertices(geo, 1e-4);
  const pos = welded.attributes.position.array;
  const idx = welded.index ? new Uint32Array(welded.index.array) : new Uint32Array([...Array(pos.length / 3).keys()]);
  const target = Math.max(3, Math.floor((idx.length / 3) * ratio) * 3);
  const [out] = sloppy
    ? MeshoptSimplifier.simplifySloppy(idx, new Float32Array(pos), 3, null, target, error)
    : MeshoptSimplifier.simplify(idx, new Float32Array(pos), 3, target, error, []);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(out), 1));
  const flat = g.toNonIndexed();
  return flat;
}

/** Merge coloured parts into one flat-shaded geometry with a COLOR_0 attribute. */
export function mergeParts(parts) {
  const geos = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (g.attributes.position.count === 0) continue;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    c.setHex(p.hex); // stored linear, like three.js vertex colours
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(out);
  }
  const merged = mergeGeometries(geos, false);
  merged.computeVertexNormals(); // non-indexed -> flat face normals
  return merged;
}

/** Bounding box of a list of parts. */
export function partsBox(parts) {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox);
  }
  return box;
}

/** Apply a matrix to every part. */
export function transformParts(parts, m) {
  for (const p of parts) p.geo.applyMatrix4(m);
}

/** Write a GLB whose top-level nodes are the given named geometries (vertex colours). */
export async function writeGlb(nodes) {
  const scene = new THREE.Scene();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  for (const [name, obj] of Object.entries(nodes)) {
    if (obj.isObject3D) {
      obj.name = name;
      scene.add(obj);
      continue;
    }
    const mesh = new THREE.Mesh(obj, mat);
    mesh.name = name;
    scene.add(mesh);
  }
  // Store compactly: indexed, no normals (the client rebuilds flat normals). Skinned meshes keep theirs.
  scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const g = o.geometry.clone();
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    o.geometry = mergeVertices(g, 1e-5);
  });
  const exporter = new GLTFExporter();
  const animations = Object.values(nodes).flatMap((o) => (o.isObject3D ? (o.animations ?? []) : []));
  const res = await exporter.parseAsync(scene, { binary: true, animations });
  return Buffer.from(res);
}
