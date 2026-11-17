// Build game-ready GLB models from the CC0 sources in assets-src/ (see sources.json).
// Usage: npm run assets:fetch && npm run assets:build [-- <asset id>...]
// Output: packages/client/public/assets/models/*.glb and the asset manifest.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { bakeParts, loadModel, mergeParts, partsBox, simplifyPart, transformParts, triCount, writeGlb } from './lib.mjs';
import { RECIPES } from './recipes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'assets-src');
const OUT = join(ROOT, 'packages/client/public/assets');
const sources = JSON.parse(readFileSync(join(ROOT, 'scripts/assets/sources.json'), 'utf8'));

/** Helpers handed to recipes. */
export const tools = {
  THREE,
  load: (rel) => loadModel(join(SRC, rel)),
  bakeParts,
  mergeParts,
  partsBox,
  transformParts,
  triCount,
  /** Simplify every part to `ratio` (per part; parts keep their colour). */
  simplify(parts, ratio, opts) {
    return parts.map((p) => ({ ...p, geo: simplifyPart(p.geo, ratio, opts) }));
  },
  clone(parts) {
    return parts.map((p) => ({ ...p, geo: p.geo.clone() }));
  },
};

const only = process.argv.slice(2);
mkdirSync(join(OUT, 'models'), { recursive: true });
const manifestPath = join(OUT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.models ??= {};
for (const r of RECIPES) {
  if (only.length && !only.includes(r.id)) continue;
  const src = sources[r.source];
  if (!src) throw new Error(`${r.id}: unknown source ${r.source}`);
  const files = [];
  const variants = await r.build(tools);
  for (const [i, nodes] of variants.entries()) {
    const name = variants.length > 1 ? `${r.file}_${i + 1}.glb` : `${r.file}.glb`;
    const glb = await writeGlb(nodes);
    writeFileSync(join(OUT, 'models', name), glb);
    const tris = Object.entries(nodes)
      .map(([k, g]) => `${k}=${g.isObject3D ? '-' : Math.round(triCount(g))}`)
      .join(' ');
    console.log(`${r.id.padEnd(16)} ${name.padEnd(18)} ${(glb.length / 1024).toFixed(0).padStart(5)} KB  ${tris}`);
    files.push(`models/${name}`);
  }
  manifest.models[r.id] = { files, license: src.license, source: `${src.title} by ${src.author} (${src.page})` };
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
