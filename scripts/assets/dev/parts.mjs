import { loadModel, bakeParts } from '../lib.mjs';
import * as THREE from 'three';
const root = await loadModel(process.argv[2]);
const parts = bakeParts(root, (n, o, hex) => hex);
const acc = new Map();
for (const p of parts) {
  p.geo.computeBoundingBox();
  const k = `${p.mesh} / ${p.material}`;
  const b = p.geo.boundingBox;
  const a = acc.get(k) ?? { box: new THREE.Box3(), tris: 0, hex: p.hex };
  a.box.union(b); a.tris += p.geo.attributes.position.count / 3; acc.set(k, a);
}
for (const [k, a] of acc) console.log(k.padEnd(48), '#' + a.hex.toString(16).padStart(6, '0'), String(a.tris).padStart(6), 'min', a.box.min.toArray().map(v => v.toFixed(0)).join(','), 'max', a.box.max.toArray().map(v => v.toFixed(0)).join(','));
