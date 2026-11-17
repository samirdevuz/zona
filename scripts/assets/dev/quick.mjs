// Dev: quick-convert models to temp GLBs (one per mesh) for previews.
// node scripts/assets/dev/quick.mjs <model> [palette.png] [meshFilterRegex]
import { mkdirSync, writeFileSync } from 'node:fs';
import { bakeParts, bakeTexturedParts, loadModel, mergeParts, partsBox, readPng, transformParts, writeGlb } from '../lib.mjs';
import * as THREE from 'three';
const [file, png, filter] = process.argv.slice(2);
const root = await loadModel(file);
const re = filter ? new RegExp(filter) : null;
const parts = png && png !== '-' ? bakeTexturedParts(root, readPng(png)) : bakeParts(root, (n, o, h) => h);
const byMesh = new Map();
for (const p of parts) {
  if (re && !re.test(p.mesh)) continue;
  if (!byMesh.has(p.mesh)) byMesh.set(p.mesh, []);
  byMesh.get(p.mesh).push(p);
}
mkdirSync('packages/client/public/assets/dev-tmp', { recursive: true });
const out = [];
for (const [mesh, ps] of byMesh) {
  const b = partsBox(ps);
  transformParts(ps, new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2));
  const name = mesh.replace(/[^A-Za-z0-9_-]/g, '_');
  writeFileSync(`packages/client/public/assets/dev-tmp/${name}.glb`, await writeGlb({ lod0: mergeParts(ps) }));
  const s = b.getSize(new THREE.Vector3());
  out.push(`${name} ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)} tris=${ps.reduce((a, p) => a + p.geo.attributes.position.count / 3, 0)}`);
}
console.log(out.join('\n'));
