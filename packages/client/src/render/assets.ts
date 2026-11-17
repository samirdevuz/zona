import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Optional external models (GAME.md 11): an asset manifest maps asset ids to
 * glTF files with scale/offset/licence. Everything has a procedural fallback;
 * a missing manifest, a failed download or a bad file simply keeps the
 * procedural model. Models are loaded lazily at match start.
 */
export interface AssetEntry {
  url: string;
  scale?: number;
  offset?: [number, number, number];
  rotationY?: number;
  license: string;
  source?: string;
}

export interface AssetManifest {
  version: number;
  models: Record<string, AssetEntry>;
}

/** Asset ids the game asks for (props by type, vehicles). */
export const ASSET_IDS = [
  'prop.pine',
  'prop.tree',
  'prop.rock',
  'prop.boulder',
  'prop.container',
  'prop.barrier',
  'prop.sandbags',
  'vehicle.jeep',
  'vehicle.tank',
] as const;

export function parseManifest(raw: unknown): AssetManifest {
  const out: AssetManifest = { version: 1, models: {} };
  if (typeof raw !== 'object' || raw === null) return out;
  const models = (raw as { models?: unknown }).models;
  if (typeof models !== 'object' || models === null) return out;
  for (const [id, e] of Object.entries(models as Record<string, unknown>)) {
    if (typeof e !== 'object' || e === null) continue;
    const entry = e as Record<string, unknown>;
    if (typeof entry.url !== 'string' || typeof entry.license !== 'string') continue;
    if (/^[a-z]+:/i.test(entry.url) || entry.url.includes('..')) continue; // local files only
    out.models[id] = {
      url: entry.url,
      license: entry.license,
      scale: typeof entry.scale === 'number' ? entry.scale : 1,
      offset: Array.isArray(entry.offset) && entry.offset.length === 3 && entry.offset.every((v) => typeof v === 'number') ? (entry.offset as [number, number, number]) : [0, 0, 0],
      rotationY: typeof entry.rotationY === 'number' ? entry.rotationY : 0,
      ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
    };
  }
  return out;
}

/**
 * Merge every mesh of a glTF scene into one geometry with vertex colours taken
 * from the materials' base colours (keeps one draw call per instanced type and
 * the flat low-poly look).
 */
export function flattenScene(root: THREE.Object3D, e: AssetEntry): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  const col = new THREE.Color();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let g = (o.geometry as THREE.BufferGeometry).clone();
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(o.matrixWorld);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const c = (mat as THREE.MeshStandardMaterial | undefined)?.color;
    col.copy(c ?? new THREE.Color(0xcccccc));
    const n = g.attributes.position!.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(g);
  });
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return null;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...(e.offset ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.rotationY ?? 0, 0)),
    new THREE.Vector3().setScalar(e.scale ?? 1),
  );
  merged.applyMatrix4(m);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export class AssetLibrary {
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private loaded = false;
  readonly failed: string[] = [];

  /** Load the manifest and its models; never throws (falls back to procedural). */
  async load(base = './assets/'): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let manifest: AssetManifest;
    try {
      const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      manifest = parseManifest(await res.json());
    } catch {
      return;
    }
    const ids = Object.keys(manifest.models);
    if (ids.length === 0) return;
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    await Promise.all(
      ids.map(async (id) => {
        const e = manifest.models[id]!;
        try {
          const gltf = await loader.loadAsync(base + e.url);
          const g = flattenScene(gltf.scene, e);
          if (g) this.geos.set(id, g);
          else this.failed.push(id);
        } catch {
          this.failed.push(id);
        }
      }),
    );
  }

  /** Geometry for an asset id, or null to use the procedural model. */
  geometry(id: string): THREE.BufferGeometry | null {
    return this.geos.get(id) ?? null;
  }
}

export const assets = new AssetLibrary();
