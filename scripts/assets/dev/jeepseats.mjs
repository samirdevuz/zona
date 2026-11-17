import { loadModel, bakeParts, partsBox } from '../lib.mjs';
import * as THREE from 'three';
const root = await loadModel('assets-src/gaz67/GAZ 67.fbx');
const parts = bakeParts(root, (n, o, h) => h);
const s = 0.0122;
for (const p of parts) p.geo.applyMatrix4(new THREE.Matrix4().makeScale(s, s, s));
const b = partsBox(parts);
const off = new THREE.Vector3(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
for (const p of parts) p.geo.applyMatrix4(new THREE.Matrix4().makeTranslation(off.x, off.y, off.z));
for (const want of ['GAZ 67 leather', 'GAZ 67 black plastic']) {
  for (const side of [-1, 1]) {
    const box = new THREE.Box3();
    for (const p of parts) {
      if (p.material !== want || (want.includes('plastic') && p.mesh !== 'steer_wheel')) continue;
      const a = p.geo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) if (Math.sign(a[i]) === side && a[i + 2] < 0.6) box.expandByPoint(new THREE.Vector3(a[i], a[i + 1], a[i + 2]));
    }
    if (!box.isEmpty()) console.log(want, side, 'min', box.min.toArray().map(v => v.toFixed(2)).join(','), 'max', box.max.toArray().map(v => v.toFixed(2)).join(','));
  }
}
