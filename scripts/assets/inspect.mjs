// Dev tool: print what a model file contains (meshes, materials, size, triangles).
// Usage: node scripts/assets/inspect.mjs <file.fbx|obj|glb>
import { loadModel } from './lib.mjs';
import * as THREE from 'three';

const file = process.argv[2];
const root = await loadModel(file);
root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root);
let tris = 0;
const mats = new Map();
root.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry;
  tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    mats.set(m.name || '(unnamed)', { type: m.type, color: m.color?.getHexString(), map: m.map ? m.map.name || 'yes' : null, vc: !!m.vertexColors });
  }
  console.log(`mesh ${o.name} tris=${Math.round((g.index ? g.index.count : g.attributes.position.count) / 3)} groups=${g.groups.length} attrs=${Object.keys(g.attributes).join(',')}`);
});
const s = box.getSize(new THREE.Vector3());
console.log(`size x=${s.x.toFixed(3)} y=${s.y.toFixed(3)} z=${s.z.toFixed(3)}  min=${box.min.toArray().map((v) => v.toFixed(2))}  tris=${tris}`);
for (const [n, m] of mats) console.log('material', n, JSON.stringify(m));
