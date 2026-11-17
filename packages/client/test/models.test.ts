import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { PROP_DEFS, type PropType } from '@zona/shared';

const MODELS = join(__dirname, '../public/assets/models');

async function nodeBox(file: string, node: string): Promise<THREE.Box3> {
  const buf = readFileSync(join(MODELS, file));
  const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej),
  );
  const o = gltf.scene.getObjectByName(node);
  if (!o) throw new Error(`${file}: no node ${node}`);
  return new THREE.Box3().setFromObject(o);
}

/** Bounds of a prop's collision parts (unscaled). */
function colliderBox(type: PropType): THREE.Box3 {
  const b = new THREE.Box3();
  for (const p of PROP_DEFS[type].parts) {
    if (p.kind === 'box') b.union(new THREE.Box3(new THREE.Vector3(p.x - p.hx, p.y0, p.z - p.hz), new THREE.Vector3(p.x + p.hx, p.y1, p.z + p.hz)));
    else b.union(new THREE.Box3(new THREE.Vector3(p.x - p.r, p.y0, p.z - p.r), new THREE.Vector3(p.x + p.r, p.y1, p.z + p.r)));
  }
  return b;
}

// Built models must match the gameplay shapes they stand for (scripts/assets/recipes.mjs):
// what you see is what stops bullets and players.
describe('structure models match their colliders', () => {
  const cases: [PropType, string][] = [
    ['barrier', 'barrier.glb'],
    ['sandbags', 'sandbags.glb'],
    ['container', 'container_1.glb'],
    ['container', 'container_2.glb'],
    ['ruin', 'ruin.glb'],
    ['tower', 'tower.glb'],
    ['bunker', 'bunker.glb'],
  ];
  for (const [type, file] of cases) {
    it(`${type} (${file})`, async () => {
      const c = colliderBox(type);
      for (const node of ['lod0', 'lod1']) {
        const m = await nodeBox(file, node);
        for (const k of ['x', 'y', 'z'] as const) {
          expect(m.min[k], `${node} min.${k}`).toBeGreaterThan(c.min[k] - 0.25);
          expect(m.max[k], `${node} max.${k}`).toBeLessThan(c.max[k] + 0.25);
          expect(m.max[k] - m.min[k], `${node} size.${k}`).toBeGreaterThan((c.max[k] - c.min[k]) * 0.85);
        }
      }
    });
  }
});
