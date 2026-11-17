// Dev tool: x/y extents of a mesh per z slice (to find barrels, turrets...).
import { loadModel, bakeParts } from '../lib.mjs';
const [file, meshName, step = '10'] = process.argv.slice(2);
const root = await loadModel(file);
const parts = bakeParts(root, (n, o, hex) => (o.name === meshName ? hex : null));
const bins = new Map();
for (const p of parts) {
  const a = p.geo.attributes.position.array;
  for (let i = 0; i < a.length; i += 9) {
    const cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
    const k = Math.floor(cz / Number(step));
    const b = bins.get(k) ?? { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, n: 0 };
    for (let j = 0; j < 9; j += 3) {
      b.x0 = Math.min(b.x0, a[i + j]); b.x1 = Math.max(b.x1, a[i + j]);
      b.y0 = Math.min(b.y0, a[i + j + 1]); b.y1 = Math.max(b.y1, a[i + j + 1]);
    }
    b.n++; bins.set(k, b);
  }
}
for (const k of [...bins.keys()].sort((a, b) => a - b)) {
  const b = bins.get(k);
  console.log(`z ${String(k * step).padStart(5)}  x ${b.x0.toFixed(0)}..${b.x1.toFixed(0)}  y ${b.y0.toFixed(0)}..${b.y1.toFixed(0)}  tris ${b.n}`);
}
