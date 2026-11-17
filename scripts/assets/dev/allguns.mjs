// Dev: convert every gun of the pack into a temp GLB (normalised, muzzle -Z) for a contact sheet.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { bakeParts, loadModel, mergeParts, partsBox, transformParts, writeGlb } from '../lib.mjs';
const dir = 'assets-src/guns/Ultimate Gun Pack - July 2019/OBJ';
mkdirSync('packages/client/public/assets/dev-tmp', { recursive: true });
const names = readdirSync(dir).filter((f) => f.endsWith('.obj')).map((f) => f.slice(0, -4));
for (const n of names) {
  const parts = bakeParts(await loadModel(`${dir}/${n}.obj`), (m, o, hex) => hex);
  const b = partsBox(parts);
  // Muzzle = the thinner end along x.
  const ends = [0, 0];
  for (const p of parts) {
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const u = (a[i] - b.min.x) / (b.max.x - b.min.x);
      if (u < 0.04) ends[0] = Math.max(ends[0], a[i + 1]) - 0;
      if (u > 0.96) ends[1] = Math.max(ends[1], a[i + 1]);
    }
  }
  const muzzlePlus = ends[1] < ends[0];
  transformParts(parts, new THREE.Matrix4().makeRotationY(muzzlePlus ? Math.PI / 2 : -Math.PI / 2));
  const b2 = partsBox(parts);
  const s = 1 / (b2.max.z - b2.min.z);
  transformParts(parts, new THREE.Matrix4().makeScale(s, s, s));
  writeFileSync(`packages/client/public/assets/dev-tmp/${n}.glb`, await writeGlb({ lod0: mergeParts(parts) }));
}
console.log(names.join(','));
