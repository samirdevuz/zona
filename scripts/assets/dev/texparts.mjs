// Dev: list colour groups of a palette-textured model (per mesh).
import { bakeTexturedParts, loadModel, readPng } from '../lib.mjs';
const [file, png, filter] = process.argv.slice(2);
const parts = bakeTexturedParts(await loadModel(file), readPng(png), (hex, o) => (!filter || o.name.includes(filter) ? hex : null));
for (const p of parts) {
  p.geo.computeBoundingBox();
  const b = p.geo.boundingBox;
  console.log(p.mesh.padEnd(34), p.material, String(p.geo.attributes.position.count / 3).padStart(5), 'min', b.min.toArray().map((v) => v.toFixed(2)).join(','), 'max', b.max.toArray().map((v) => v.toFixed(2)).join(','));
}
