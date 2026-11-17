import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * External models (GAME.md 11): an asset manifest maps asset ids to glTF files.
 * Everything has a procedural fallback; a missing manifest, a failed download or a
 * bad file keeps the procedural model. The bundled models are built from CC0
 * sources by scripts/assets (see CREDITS.md).
 *
 * Built models use named nodes: `lod0`/`lod1` (props), `body`/`body_lod1` (jeep),
 * `hull`, `turret` > `barrel` (tank), `marking` (team colour), `rig` (characters).
 * A node's position is its pivot relative to its parent.
 */
export interface AssetEntry {
  /** One file per variant. */
  files: string[];
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

const safeUrl = (u: unknown): u is string => typeof u === 'string' && !/^[a-z]+:/i.test(u) && !u.includes('..') && !u.startsWith('/');

export function parseManifest(raw: unknown): AssetManifest {
  const out: AssetManifest = { version: 1, models: {} };
  if (typeof raw !== 'object' || raw === null) return out;
  const models = (raw as { models?: unknown }).models;
  if (typeof models !== 'object' || models === null) return out;
  for (const [id, e] of Object.entries(models as Record<string, unknown>)) {
    if (typeof e !== 'object' || e === null) continue;
    const entry = e as Record<string, unknown>;
    if (typeof entry.license !== 'string') continue;
    const files = Array.isArray(entry.files) ? entry.files : [entry.url];
    if (files.length === 0 || !files.every(safeUrl)) continue; // local files only
    out.models[id] = {
      files: files as string[],
      license: entry.license,
      scale: typeof entry.scale === 'number' ? entry.scale : 1,
      offset: Array.isArray(entry.offset) && entry.offset.length === 3 && entry.offset.every((v) => typeof v === 'number') ? (entry.offset as [number, number, number]) : [0, 0, 0],
      rotationY: typeof entry.rotationY === 'number' ? entry.rotationY : 0,
      ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
    };
  }
  return out;
}

/** Flat-shaded, vertex-coloured copy of one mesh's geometry (no transform applied). */
function meshGeometry(o: THREE.Mesh): THREE.BufferGeometry {
  let g = (o.geometry as THREE.BufferGeometry).clone();
  if (g.index) g = g.toNonIndexed();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'color') g.deleteAttribute(name);
  if (!g.attributes.color) {
    // Hand-added models: take the material's base colour.
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const c = (mat as THREE.MeshStandardMaterial | undefined)?.color ?? new THREE.Color(0xcccccc);
    const n = g.attributes.position!.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  } else if (g.attributes.color.itemSize === 4) {
    const src = g.attributes.color;
    const arr = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      arr[i * 3] = src.getX(i);
      arr[i * 3 + 1] = src.getY(i);
      arr[i * 3 + 2] = src.getZ(i);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Merge every mesh of a glTF scene into one geometry (hand-added models without
 * named nodes); applies the manifest's scale/offset/rotation.
 */
export function flattenScene(root: THREE.Object3D, e: Pick<AssetEntry, 'scale' | 'offset' | 'rotationY'>): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) return;
    const g = meshGeometry(o);
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return null;
  merged.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...(e.offset ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.rotationY ?? 0, 0)),
      new THREE.Vector3().setScalar(e.scale ?? 1),
    ),
  );
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/** A named node of a model: its geometry and its pivot relative to the parent node. */
export interface ModelNode {
  geo: THREE.BufferGeometry;
  position: THREE.Vector3;
}

export class AssetLibrary {
  private readonly gltfs = new Map<string, GLTF[]>();
  private readonly entries = new Map<string, AssetEntry>();
  private readonly nodes = new Map<string, ModelNode | null>();
  private readonly flat = new Map<string, THREE.BufferGeometry | null>();
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
          const list = await Promise.all(e.files.map((f) => loader.loadAsync(base + f)));
          this.gltfs.set(id, list);
          this.entries.set(id, e);
        } catch {
          this.failed.push(id);
        }
      }),
    );
  }

  has(id: string): boolean {
    return this.gltfs.has(id);
  }

  /** Number of variants of a model (0 when it is not available). */
  variants(id: string): number {
    return this.gltfs.get(id)?.length ?? 0;
  }

  /** Raw glTF (animated characters). */
  gltf(id: string, variant = 0): GLTF | null {
    return this.gltfs.get(id)?.[variant] ?? null;
  }

  /** A named node's geometry and pivot, or null. */
  node(id: string, name: string, variant = 0): ModelNode | null {
    const key = `${id}#${variant}#${name}`;
    if (this.nodes.has(key)) return this.nodes.get(key)!;
    const scene = this.gltf(id, variant)?.scene;
    if (!scene) return null; // not loaded (yet): do not cache
    const o = scene?.getObjectByName(name);
    const out = o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh) ? { geo: meshGeometry(o), position: o.position.clone() } : null;
    this.nodes.set(key, out);
    return out;
  }

  /** Whole model as one geometry (hand-added models without named nodes), or null. */
  geometry(id: string, variant = 0): THREE.BufferGeometry | null {
    const key = `${id}#${variant}`;
    if (this.flat.has(key)) return this.flat.get(key)!;
    const g = this.gltf(id, variant);
    if (!g) return null; // not loaded (yet): do not cache
    const out = flattenScene(g.scene, this.entries.get(id) ?? {});
    this.flat.set(key, out);
    return out;
  }
}

export const assets = new AssetLibrary();
