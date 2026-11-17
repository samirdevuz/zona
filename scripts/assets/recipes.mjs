// How each game model is made from its CC0 source (see build.mjs and sources.json).
// Conventions (GAME.md 7.6): metres, +Y up, forward -Z, origin on the ground.
import * as THREE from 'three';
import { bakeTexturedParts, readPng, simplifyPart } from './lib.mjs';

const hexOf = (palette, fallback) => (name, _mesh, hex) => {
  if (name in palette) return palette[name];
  return fallback === undefined ? hex : fallback;
};

/** Simplify parts so the whole set has about `target` triangles (each part keeps its colour). */
function simplifyTo(t, parts, target, opts = {}) {
  const total = parts.reduce((s, p) => s + t.triCount(p.geo), 0);
  const ratio = Math.min(1, target / total);
  return parts.map((p) => ({ ...p, geo: simplifyPart(p.geo, ratio, opts) }));
}

/** Simplify each part by its own ratio (`ratioOf(part)`), e.g. keep round wheels, crush hidden frames. */
function simplifyBy(parts, ratioOf, opts = {}) {
  return parts.map((p) => ({ ...p, geo: simplifyPart(p.geo, ratioOf(p), opts) }));
}

/**
 * Far LOD: drop parts smaller than `minSize` metres (bolts, lamps), then simplify the rest
 * towards `target` triangles with a loose error bound (topology-preserving, never sloppy).
 */
function farLod(t, parts, target, minSize = 0.25) {
  const big = parts.filter((p) => {
    p.geo.computeBoundingBox();
    return p.geo.boundingBox.getSize(new THREE.Vector3()).length() >= minSize;
  });
  return t.mergeParts(simplifyTo(t, big, target, { error: 0.25 }));
}

/** Uniformly scale and move parts: centre x/z at the origin, lowest point on y = 0. */
function normalise(t, parts, scale, { rotY = 0, centre = true } = {}) {
  const m = new THREE.Matrix4().makeRotationY(rotY).premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  t.transformParts(parts, m);
  const box = t.partsBox(parts);
  const off = new THREE.Vector3(centre ? -(box.min.x + box.max.x) / 2 : 0, -box.min.y, centre ? -(box.min.z + box.max.z) / 2 : 0);
  t.transformParts(parts, new THREE.Matrix4().makeTranslation(off.x, off.y, off.z));
  return off;
}

/** Max |coordinate| of part vertices inside a box filter (used to fit team markings). */
function extent(parts, filter, axis) {
  let best = -Infinity;
  for (const p of parts) {
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const v = { x: a[i], y: a[i + 1], z: a[i + 2] };
      if (filter(v)) best = Math.max(best, axis === 'y' ? v.y : Math.abs(v[axis]));
    }
  }
  return best;
}

function boxGeo(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.toNonIndexed();
  n.deleteAttribute('uv');
  return n;
}

/** White boxes merged into one geometry (tinted with the team colour at runtime). */
function markingGeo(t, boxes) {
  return t.mergeParts(boxes.map((b) => ({ geo: boxGeo(...b), hex: 0xffffff })));
}

/** A mesh node placed at a pivot (writeGlb keeps its position). */
function pivotNode(geo, x, y, z) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }));
  m.position.set(x, y, z);
  return m;
}

const JEEP_COLORS = {
  'GAZ 67 khaki': 0x5d6a3c,
  'GAZ 67 rubber': 0x232323,
  'GAZ 67 black plastic': 0x1d1d1d,
  'GAZ 67 black metal': 0x34373a,
  'GAZ 67 leather': 0x4f4036,
  'GAZ 67 white light': 0xfff1c2,
  'GAZ 67 clear metal': 0x9a9da0,
  'GAZ 67 red light': 0xb0302c,
  'GAZ 67 untransparent glass': 0x8a9196,
  'GAZ 67 glass': null, // see-through in the source: dropped
  glass: null,
};

const TANK_COLORS = {
  camo: 0x5a6538,
  'black metal': 0x2a2c29,
  'brown metal': 0x6b4c36,
  'grey metal': 0x4a4d4f,
};

const NATURE = 'nature/Ultimate Nature Pack - Jun 2019/OBJ';
// Game palette (packages/client/src/render/props.ts) so models match the rest of the world.
const BARK = 0x6b4f35;
const LEAF = [0x4f8a3a, 0x5a913b, 0x467f36];
const PINE = [0x2f5d34, 0x356538, 0x2a5530];
const ROCK = [0x8d8a84, 0x96928b, 0x85827c];
const MOSS = 0x5d7f3c;

/**
 * Tree from the nature pack: uniform scale to `height`, trunk base (wood vertices near the
 * ground) moved to the origin and sunk a little so slopes do not show a gap.
 */
async function treeVariant(t, file, height, leaf, { nearTris, farTris, trunkR = 0 }) {
  const root = await t.load(`${NATURE}/${file}.obj`);
  // `leaf` is the foliage colour, or a material -> colour map (themes: Snow, Orange, ...).
  const pal = typeof leaf === 'number' ? { Wood: BARK, Green: leaf } : { Wood: BARK, ...leaf };
  const parts = t.bakeParts(root, (name, _o, hex) => (name in pal ? pal[name] : hex), { linearSource: true });
  const box = t.partsBox(parts);
  const s = height / (box.max.y - box.min.y);
  t.transformParts(parts, new THREE.Matrix4().makeScale(s, s, s));
  // Trunk base centre: wood vertices in the lowest 0.6 m.
  const b2 = t.partsBox(parts);
  let sx = 0;
  let sz = 0;
  let n = 0;
  let r = 0;
  for (const p of parts) {
    if (p.material !== 'Wood') continue;
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] - b2.min.y > 0.6) continue;
      sx += a[i];
      sz += a[i + 2];
      n++;
    }
  }
  const cx = n ? sx / n : (b2.min.x + b2.max.x) / 2;
  const cz = n ? sz / n : (b2.min.z + b2.max.z) / 2;
  for (const p of parts) {
    if (p.material !== 'Wood') continue;
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) if (a[i + 1] - b2.min.y < 0.6) r = Math.max(r, Math.hypot(a[i] - cx, a[i + 2] - cz));
  }
  t.transformParts(parts, new THREE.Matrix4().makeTranslation(-cx, -b2.min.y - 0.2, -cz));
  // Match the trunk to the collider radius: slim thick pine trunks (mostly hidden by foliage),
  // widen thin palm trunks (so bullets never stop in empty air next to them).
  if (trunkR && (r > trunkR || r < trunkR * 0.75)) {
    const k = trunkR / r;
    for (const p of parts) if (p.material === 'Wood') p.geo.applyMatrix4(new THREE.Matrix4().makeScale(k, 1, k));
  }
  // Foliage keeps most of its shape; branches (mostly inside the canopy) take the cuts.
  const lod = (target, error) => {
    const leaves = parts.filter((p) => p.material !== 'Wood');
    const wood = parts.filter((p) => p.material === 'Wood');
    const leafTris = leaves.reduce((a, p) => a + t.triCount(p.geo), 0);
    const leafTarget = Math.min(leafTris, target * 0.8);
    return t.mergeParts([...simplifyTo(t, leaves, leafTarget, { error }), ...simplifyTo(t, wood, target - leafTarget, { error: error * 2 })]);
  };
  return {
    nodes: { lod0: lod(nearTris, 0.03), lod1: lod(farTris, 0.2) },
    info: `${file} trunk r=${r.toFixed(2)}${trunkR && (r > trunkR || r < trunkR * 0.75) ? ` -> ${trunkR}` : ''}`,
  };
}

/** Rock fitted to a collision cylinder: horizontal radius `radius`, spanning y0..y1. */
async function rockVariant(t, file, radius, y0, y1, palette, { nearTris, farTris }) {
  const root = await t.load(`${NATURE}/${file}.obj`);
  const parts = t.bakeParts(root, (name) => palette[name] ?? null, { linearSource: true });
  const box = t.partsBox(parts);
  const c = box.getCenter(new THREE.Vector3());
  t.transformParts(parts, new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  let rMax = 0;
  for (const p of parts) {
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) rMax = Math.max(rMax, Math.hypot(a[i], a[i + 2]));
  }
  const k = radius / rMax;
  const ky = (y1 - y0) / (box.max.y - box.min.y);
  t.transformParts(parts, new THREE.Matrix4().makeScale(k, ky, k));
  t.transformParts(parts, new THREE.Matrix4().makeTranslation(0, y0, 0));
  return {
    nodes: { lod0: t.mergeParts(simplifyTo(t, parts, nearTris, { error: 0.03 })), lod1: t.mergeParts(simplifyTo(t, parts, farTris, { error: 0.15 })) },
    info: `xz x${k.toFixed(2)} y x${ky.toFixed(2)}`,
  };
}

/** Build several variants of one prop type. */
function variants(list) {
  return async (t) => {
    const out = [];
    for (const f of list) {
      const v = await f(t);
      console.log(`  ${v.info}`);
      out.push(v.nodes);
    }
    return out;
  };
}

const GUNS = 'guns/Ultimate Gun Pack - July 2019/OBJ';
const GUN_COLORS = {
  Black: 0x222324,
  Black2: 0x1a1a1b,
  DarkMetal: 0x2e3032,
  Metal: 0x45484b,
  Grey: 0x3a3c3f,
  Main: 0x2a2d30,
  MainDark: 0x1f2226,
  MainLight: 0x3c4044,
  DarkWood: 0x5a4632,
  Wood: 0x6e5338,
  Green: 0x4f5a34,
  Glass: 0x101826,
};

/**
 * Gun for the first-person viewmodel (and third-person hands): muzzle along -Z at
 * `muzzleZ`, rear end at `rearZ`, highest point (sights/scope) at `topY` - the same
 * frame as the procedural viewmodel items (render/viewmodel.ts).
 */
async function gun(t, file, { muzzleZ, rearZ, topY, tris = 700, flip = false }) {
  const parts = t.bakeParts(await t.load(`${GUNS}/${file}.obj`), hexOf(GUN_COLORS, 0x2b2d2f));
  const b = t.partsBox(parts);
  // Muzzle = the thinner end along x (the pack's guns lie along x).
  let left = -Infinity;
  let right = -Infinity;
  for (const p of parts) {
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const u = (a[i] - b.min.x) / (b.max.x - b.min.x);
      if (u < 0.04) left = Math.max(left, a[i + 1]);
      if (u > 0.96) right = Math.max(right, a[i + 1]);
    }
  }
  // The heuristic fails for skeleton/folding stocks and slim rifle stocks: `flip` was set per gun after
  // checking side renders (scripts/assets/dev/preview.html?arrow=1 marks the muzzle side).
  t.transformParts(parts, new THREE.Matrix4().makeRotationY((right < left ? Math.PI / 2 : -Math.PI / 2) + (flip ? Math.PI : 0)));
  const b2 = t.partsBox(parts);
  const s = (rearZ - muzzleZ) / (b2.max.z - b2.min.z);
  t.transformParts(parts, new THREE.Matrix4().makeScale(s, s, s));
  const b3 = t.partsBox(parts);
  t.transformParts(parts, new THREE.Matrix4().makeTranslation(-(b3.min.x + b3.max.x) / 2, topY - b3.max.y, muzzleZ - b3.min.z));
  return { lod0: t.mergeParts(simplifyTo(t, parts, tris, { error: 0.01 })) };
}

/** Soldier colours by body part (team colours are applied at runtime through the _team mask). */
const SOLDIER = { skin: 0xd8a77f, eyes: 0x222222, sleeve: 0x5f6b3a, glove: 0x2f3324, pants: 0x4b5320, boots: 0x2b2b2b };

/**
 * Rigged soldier from Quaternius' Animated Human (CC0): colours baked per vertex from the
 * dominant bone (vest, sleeves, gloves, trousers, boots) and, on the head, from the palette
 * texture (skin, eyes, hair -> helmet). `_team` marks vertices tinted with the team colour
 * at runtime (1 = vest, 2 = helmet). Keeps the idle/walk/run/jump/death clips.
 */
async function soldier(t) {
  const root = await t.load('human/Animated Human by @Quaternius/FBX/Animated Human.fbx');
  let mesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
  });
  const g = mesh.geometry;
  const bones = mesh.skeleton.bones.map((b) => b.name);
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const uv = g.attributes.uv;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const team = new Float32Array(n);
  const c = new THREE.Color();
  const eyes = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
    const bone = bones[si.getComponent(i, best)] ?? '';
    // Palette texture rows (32 px): skin 0-5, eyes 6-10, hair 11-16, shirt 17-22, pants 23-31.
    const row = Math.floor((1 - uv.getY(i)) * 32);
    let hex = SOLDIER.sleeve;
    let mask = 0;
    if (/Head/.test(bone)) {
      if (row < 6) hex = SOLDIER.skin;
      else if (row < 11) {
        hex = SOLDIER.eyes;
        eyes.push(i);
      } else {
        hex = 0xffffff;
        mask = 2;
      }
    } else if (/Neck/.test(bone)) hex = SOLDIER.skin;
    else if (/Hand|Thumb|Index/.test(bone)) hex = SOLDIER.glove;
    else if (/Foot|Toe/.test(bone)) hex = SOLDIER.boots;
    else if (/Hips|UpLeg|Leg/.test(bone)) hex = SOLDIER.pants;
    else if (/Spine/.test(bone)) {
      hex = 0xffffff;
      mask = 1;
    }
    c.setHex(hex);
    col.set([c.r, c.g, c.b], i * 3);
    team[i] = mask;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('_team', new THREE.BufferAttribute(team, 1));
  g.deleteAttribute('uv');
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true });
  // Facing: the eyes are on the front of the head; the game wants -Z forward.
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  const v = new THREE.Vector3();
  let ez = 0;
  for (const i of eyes) ez += mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).z;
  const head = mesh.skeleton.bones.find((b) => b.name === 'Head').getWorldPosition(new THREE.Vector3());
  const facesPlusZ = ez / Math.max(1, eyes.length) > head.z;
  const box = new THREE.Box3().setFromObject(root, true);
  const s = 1.8 / (box.max.y - box.min.y);
  const rig = new THREE.Group();
  rig.add(root);
  root.scale.setScalar(s);
  root.rotation.y = facesPlusZ ? Math.PI : 0;
  root.position.y = -box.min.y * s;
  const keep = { Idle: 'idle', Walk: 'walk', Run: 'run', Jump: 'jump', Death: 'death' };
  rig.animations = root.animations
    .map((a) => {
      const short = keep[a.name.split('|').pop()];
      if (!short) return null;
      const clip = a.clone();
      clip.name = short;
      // Fingers and end bones are invisible at game scale; drop their tracks and redundant keys.
      clip.tracks = clip.tracks.filter((tr) => !/Thumb|Index|_end|_End/.test(tr.name));
      clip.optimize();
      return clip;
    })
    .filter(Boolean);
  console.log(`  soldier: tris=${g.index ? g.index.count / 3 : n / 3} scale=${s.toFixed(5)} facesPlusZ=${facesPlusZ} clips=${rig.animations.map((a) => a.name).join(',')}`);
  return [{ rig }];
}

// ---- Structures (collider shapes: packages/shared/src/map/props.ts - keep in sync; checked by
// packages/client/test/models.test.ts) ----------------------------------------------------------

const CONCRETE = 0xa9a49a;
const CONCRETE_DARK = 0x8f8a80;
const WOOD = 0x8b6a45;
const WOOD_DARK = 0x6d5236;
const SAND = [0xb7a171, 0xa8925f, 0xbfa977, 0xae9866];
const SITE = 'site/LowPoly-House-Construction-Site-By-Majadroid';
const SURV = 'survival/Models/OBJ format';
const assetsRoot = new URL('../../assets-src/', import.meta.url).pathname;

/** Parts transformed by `m` (copies). */
function placed(parts, m) {
  return parts.map((p) => ({ ...p, geo: p.geo.clone().applyMatrix4(m) }));
}

/** Non-uniformly scale and move parts so their bounds become [x0,y0,z0]..[x1,y1,z1]. */
function fitBox(t, parts, x0, y0, z0, x1, y1, z1, rotY = 0) {
  let ps = placed(parts, new THREE.Matrix4().makeRotationY(rotY));
  const b = t.partsBox(ps);
  const s = new THREE.Vector3((x1 - x0) / (b.max.x - b.min.x), (y1 - y0) / (b.max.y - b.min.y), (z1 - z0) / (b.max.z - b.min.z));
  ps = placed(ps, new THREE.Matrix4().makeTranslation(-b.min.x, -b.min.y, -b.min.z));
  return placed(ps, new THREE.Matrix4().makeTranslation(x0, y0, z0).multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z)));
}

/** A plain coloured box part. */
function boxPart(x0, y0, z0, x1, y1, z1, hex) {
  return { geo: boxGeo(x0, y0, z0, x1, y1, z1), hex, material: 'box', mesh: 'box' };
}

/** Recolour parts (`fn(hex) -> hex`). */
const recolor = (parts, fn) => parts.map((p) => ({ ...p, hex: fn(p.hex) }));

async function sandbagParts(t) {
  return t.bakeParts(await t.load('sandbags/sandbag_model.obj'), () => SAND[0]);
}

/** A wall of sandbags filling [x0,x1] x [y0,y1] x [z0,z1] (bags along x, alternate rows offset). */
function sandbagWall(t, bag, x0, y0, z0, x1, y1, z1, { layers = 4, perRow = 4, seed = 0 } = {}) {
  const out = [];
  const h = (y1 - y0) / layers;
  const len = (x1 - x0) / perRow;
  for (let l = 0; l < layers; l++) {
    const off = l % 2 ? len * 0.35 : 0;
    for (let i = 0; i < perRow; i++) {
      const a = Math.max(x0, x0 + i * len + off - (l % 2 ? len * 0.35 : 0) * (i === 0 ? 1 : 0));
      const b = Math.min(x1, a + len * 1.02);
      const k = (l * 7 + i * 3 + seed) % SAND.length;
      out.push(...recolor(fitBox(t, bag, a, y0 + l * h, z0, b, y0 + (l + 1) * h * 1.04, z1, Math.PI / 2), () => SAND[k]));
    }
  }
  return out;
}

/** Kenney survival piece, recoloured to the game's wood/metal palette by hue and brightness. */
async function survivalPiece(t, name) {
  const img = readPng(`${assetsRoot}${SURV}/Textures/colormap.png`);
  return bakeTexturedParts(await t.load(`${SURV}/${name}.obj`), img, (hex) => {
    const c = new THREE.Color(hex);
    const hsl = c.getHSL({ h: 0, s: 0, l: 0 });
    if (hsl.s < 0.25) return hsl.l > 0.45 ? 0x8d9196 : 0x55595e; // metal
    return hsl.l > 0.5 ? WOOD : WOOD_DARK;
  });
}

/** Near model and a far stand-in made of plain boxes (the collider shape itself). */
const lods = (t, near, far) => ({ lod0: t.mergeParts(near), lod1: t.mergeParts(far) });

const STRUCTURES = [
  {
    id: 'prop.barrier',
    source: 'concrete',
    file: 'barrier',
    // Collider: box x +-1.5, z +-0.35, y 0..1.05.
    async build(t) {
      const parts = t.bakeParts(await t.load('concrete/barrier/barrier.obj'), () => CONCRETE, { linearSource: false });
      const near = fitBox(t, parts, -1.5, 0, -0.35, 1.5, 1.05, 0.35);
      // Painted band near the top (team-neutral hazard yellow).
      near.push(boxPart(-1.32, 0.86, -0.205, 1.32, 0.92, 0.205, 0xd9c84a));
      return [lods(t, near, [boxPart(-1.5, 0, -0.35, 1.5, 0.45, 0.35, CONCRETE), boxPart(-1.5, 0.45, -0.25, 1.5, 1.05, 0.25, CONCRETE)])];
    },
  },
  {
    id: 'prop.sandbags',
    source: 'sandbags',
    file: 'sandbags',
    // Collider: box x +-1.6, z +-0.5, y 0..0.95.
    async build(t) {
      const bag = await sandbagParts(t);
      const near = [...sandbagWall(t, bag, -1.6, 0, -0.5, 1.6, 0.95, 0.02), ...sandbagWall(t, bag, -1.6, 0, -0.02, 1.6, 0.95, 0.5, { seed: 2 })];
      return [lods(t, near, [boxPart(-1.6, 0, -0.5, 1.6, 0.95, 0.5, SAND[1])])];
    },
  },
  {
    id: 'prop.container',
    source: 'site',
    file: 'container',
    // Collider: box x +-3.05, z +-1.22, y 0..2.6. The light body is tinted per instance (props.ts).
    async build(t) {
      const img = readPng(`${assetsRoot}${SITE}/ImphenziaPalette01-256-Gradient.png`);
      const root = await t.load(`${SITE}/fbx files/Containers-Office.fbx`);
      const out = [];
      for (const name of ['Office_Container_Single_Green', 'Office_Container_Single_Red']) {
        const parts = bakeTexturedParts(root, img, (hex, o) => {
          if (o.name !== name) return null;
          const c = new THREE.Color(hex);
          const l = (c.r + c.g + c.b) / 3;
          return l > 0.62 ? 0xe4e4e4 : l > 0.35 ? 0x8a8f94 : 0x2f3236; // body / door, window / frame
        });
        const near = fitBox(t, parts, -3.05, 0, -1.22, 3.05, 2.6, 1.22, Math.PI / 2);
        out.push(lods(t, near, [boxPart(-3.05, 0, -1.22, 3.05, 2.6, 1.22, 0xe4e4e4)]));
      }
      return out;
    },
  },
  {
    id: 'prop.ruin',
    source: 'concrete',
    file: 'ruin',
    // Collider: walls x -3..-1 and 1..3 (z +-0.3, y 0..2.8), low part x -1..1 (y 0..0.9).
    async build(t) {
      const wall = t.bakeParts(await t.load('concrete/wall/wall.obj'), () => CONCRETE_DARK, { linearSource: false });
      const cube = t.bakeParts(await t.load('concrete/cube/cube.obj'), () => CONCRETE, { linearSource: false });
      const near = [];
      for (const [x0, x1] of [
        [-3, -2],
        [-2, -1],
        [1, 2],
        [2, 3],
      ])
        near.push(...fitBox(t, wall, x0 + 0.02, 0, -0.3, x1 - 0.02, 2.8, 0.3));
      near.push(...fitBox(t, cube, -1, 0, -0.3, -0.02, 0.9, 0.3), ...fitBox(t, cube, 0.02, 0, -0.3, 1, 0.82, 0.3));
      near.splice(0, near.length, ...simplifyTo(t, near, 1300, { error: 0.01 }));
      const far = [boxPart(-3, 0, -0.3, -1, 2.8, 0.3, CONCRETE_DARK), boxPart(1, 0, -0.3, 3, 2.8, 0.3, CONCRETE_DARK), boxPart(-1, 0, -0.3, 1, 0.9, 0.3, CONCRETE)];
      return [lods(t, near, far)];
    },
  },
  {
    id: 'prop.tower',
    source: 'survival',
    file: 'tower',
    // Collider: TOWER in props.ts - legs at +-1.8, platform +-2 at y 3.9..4.2, parapet 0.95,
    // stairs (10 x 0.42 m) along -z, roof +-2.2 at y 6.6..6.8 on thin posts.
    async build(t) {
      const frame = await survivalPiece(t, 'structure');
      const floor = await survivalPiece(t, 'floor');
      const fence = await survivalPiece(t, 'fence-fortified');
      const panel = await survivalPiece(t, 'metal-panel');
      const p = 2;
      const top = 4.2;
      const ph = top + 0.95;
      const near = [];
      near.push(...fitBox(t, frame, -1.98, 0, -1.98, 1.98, 1.95, 1.98), ...fitBox(t, frame, -1.98, 1.95, -1.98, 1.98, 3.9, 1.98));
      near.push(...fitBox(t, floor, -p, 3.9, -p, p, top, p));
      near.push(...fitBox(t, fence, -p, top, p - 0.14, p, ph, p)); // back
      near.push(...fitBox(t, fence, -p, top, -p, -p + 0.14, ph, p, Math.PI / 2)); // left
      near.push(...fitBox(t, fence, p - 0.14, top, -p, p, ph, p, Math.PI / 2)); // right
      near.push(...fitBox(t, fence, -p, top, -p, -0.7, ph, -p + 0.14)); // front-left
      near.push(...fitBox(t, fence, 0.7, top, -p, p, ph, -p + 0.14)); // front-right
      near.push(...fitBox(t, panel, -p - 0.2, 6.6, -p - 0.2, p + 0.2, 6.8, p + 0.2, 0).map((q) => ({ ...q })));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) near.push(boxPart(sx * 1.88 - 0.07, ph, sz * 1.88 - 0.07, sx * 1.88 + 0.07, 6.6, sz * 1.88 + 0.07, WOOD_DARK));
      // Solid steps (the collider steps are solid blocks): tread on top, darker riser below.
      for (let k = 1; k <= 10; k++) {
        const zFar = -p - (10 - k + 1) * 0.55;
        near.push(boxPart(-0.72, k * 0.42 - 0.08, zFar - 0.02, 0.72, k * 0.42, zFar + 0.55, WOOD));
        near.push(boxPart(-0.7, 0, zFar, 0.7, k * 0.42 - 0.08, zFar + 0.55, k % 2 ? WOOD_DARK : 0x5f4730));
      }
      const far = [boxPart(-p, 3.9, -p, p, top, p, WOOD), boxPart(-p, top, -p, p, ph, p, WOOD_DARK), boxPart(-p - 0.2, 6.6, -p - 0.2, p + 0.2, 6.8, p + 0.2, 0x5d4a35)];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) far.push(boxPart(sx * 1.8 - 0.18, 0, sz * 1.8 - 0.18, sx * 1.8 + 0.18, 3.9, sz * 1.8 + 0.18, WOOD_DARK));
      for (let k = 1; k <= 10; k += 3) far.push(boxPart(-0.7, 0, -p - (10 - k + 1) * 0.55, 0.7, k * 0.42, -p, WOOD));
      return [lods(t, simplifyTo(t, near, 2600, { error: 0.01 }), far)];
    },
  },
  {
    id: 'prop.bunker',
    source: 'sandbags',
    file: 'bunker',
    // Collider: BUNKER in props.ts (6x6 m, walls 0.5, 2.5 high, roof 0.4, door on -z, slit on +z)
    // plus the roof sandbag ring (y 2.9..3.25) added there for this model.
    async build(t) {
      const h = 3;
      const w = 0.5;
      const top = 2.5;
      const roof = 2.9;
      const shell = [
        boxPart(-h, 0, h - w, h, 1.45, h, CONCRETE),
        boxPart(-h, 1.8, h - w, h, top, h, CONCRETE),
        boxPart(-h, 0, -h + w, -h + w, top, h - w, CONCRETE),
        boxPart(h - w, 0, -h + w, h, top, h - w, CONCRETE),
        boxPart(-h, 0, -h, -0.9, top, -h + w, CONCRETE),
        boxPart(0.9, 0, -h, h, top, -h + w, CONCRETE),
        boxPart(-0.9, 2.0, -h, 0.9, top, -h + w, CONCRETE_DARK),
        boxPart(-h - 0.06, top, -h - 0.06, h + 0.06, roof, h + 0.06, CONCRETE_DARK),
        boxPart(-h + w, 0.01, -h + w, h - w, 0.03, h - w, 0x5c5850),
        // Darker base course and corner pillars break up the flat walls.
        boxPart(-h - 0.04, 0, -h - 0.04, -h + 0.3, top, -h + 0.3, CONCRETE_DARK),
        boxPart(h - 0.3, 0, -h - 0.04, h + 0.04, top, -h + 0.3, CONCRETE_DARK),
        boxPart(-h - 0.04, 0, h - 0.3, -h + 0.3, top, h + 0.04, CONCRETE_DARK),
        boxPart(h - 0.3, 0, h - 0.3, h + 0.04, top, h + 0.04, CONCRETE_DARK),
      ];
      const bag = await sandbagParts(t);
      const ring = [
        ...sandbagWall(t, bag, -h, roof, h - 0.55, h, roof + 0.35, h, { layers: 1, perRow: 7 }),
        ...sandbagWall(t, bag, -h, roof, -h, h, roof + 0.35, -h + 0.55, { layers: 1, perRow: 7, seed: 1 }),
        ...placed(sandbagWall(t, bag, -h + 0.55, roof, -0.275, h - 0.55, roof + 0.35, 0.275, { layers: 1, perRow: 5, seed: 2 }), new THREE.Matrix4().makeTranslation(0, 0, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).premultiply(new THREE.Matrix4().makeTranslation(-h + 0.275, 0, 0))),
        ...placed(sandbagWall(t, bag, -h + 0.55, roof, -0.275, h - 0.55, roof + 0.35, 0.275, { layers: 1, perRow: 5, seed: 3 }), new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(h - 0.275, 0, 0))),
      ];
      const far = [...shell.slice(0, 8), boxPart(-h, roof, -h, h, roof + 0.35, h, SAND[1])];
      return [lods(t, [...shell, ...ring], far)];
    },
  },
];

// ---- Map themes (render/theme.ts): same colliders, themed looks ---------------------------------
const SNOW = 0xeef3f8;
const SANDSTONE = [0xc49a6c, 0xb98d5f, 0xcfa679];
const AUTUMN = [0xc8742a, 0xd38f2e, 0xb85a2c];
const tree = (files, pals, o) => variants(files.map((f, i) => (t) => treeVariant(t, f, o.height, pals[i % pals.length], o)));
const rocks = (files, pals, o) => variants(files.map((f, i) => (t) => rockVariant(t, f, o.r, o.y0, o.y1, pals[i % pals.length], o)));
const TREE = { height: 6.8, nearTris: 520, farTris: 110 };
const PINE_O = { height: 8.2, nearTris: 420, farTris: 90, trunkR: 0.32 };
const ROCK_O = { r: 1.15, y0: -0.4, y1: 1.05, nearTris: 120, farTris: 40 };
const BOULDER_O = { r: 2.25, y0: -0.6, y1: 2.65, nearTris: 160, farTris: 50 };

const THEMED = [
  { id: 'prop.tree@autumn', source: 'nature', file: 'tree_autumn', build: tree(['CommonTree_Autumn_1', 'CommonTree_Autumn_2', 'CommonTree_Autumn_5'], AUTUMN.map((c) => ({ Orange: c })), TREE) },
  { id: 'prop.pine@autumn', source: 'nature', file: 'pine_autumn', build: tree(['PineTree_Autumn_4', 'PineTree_Autumn_5'], [{ Orange: 0xa8622c, LightOrange: 0xc4913f }, { Orange: 0x9a5a2a, LightOrange: 0xb88a3c }], PINE_O) },
  { id: 'prop.tree@winter', source: 'nature', file: 'tree_winter', build: tree(['CommonTree_Snow_1', 'CommonTree_Snow_2', 'CommonTree_Snow_5'], [{ Green: 0x3f5d3a, Snow: SNOW }], TREE) },
  { id: 'prop.pine@winter', source: 'nature', file: 'pine_winter', build: tree(['PineTree_Snow_4', 'PineTree_Snow_5'], [{ Green: 0x2a4f31, Snow: SNOW }], PINE_O) },
  { id: 'prop.rock@winter', source: 'nature', file: 'rock_winter', build: rocks(['Rock_Snow_3', 'Rock_Snow_5', 'Rock_Snow_6'], ROCK.map((c) => ({ Rock: c, Snow: SNOW })), ROCK_O) },
  { id: 'prop.boulder@winter', source: 'nature', file: 'boulder_winter', build: rocks(['Rock_Snow_4', 'Rock_Snow_6', 'Rock_Snow_7'], ROCK.map((c) => ({ Rock: c, Snow: SNOW })), BOULDER_O) },
  // Desert: palms for trees, bare dead trees for pines (trunk colliders), sandstone rocks.
  { id: 'prop.tree@desert', source: 'nature', file: 'tree_desert', build: tree(['PalmTree_1', 'PalmTree_2', 'PalmTree_3'], [{ Wood: 0x8a6a45, Green: 0x6f8f3a, DarkGreen: 0x55702e, Coconuts: 0x6b4a2e }], { ...TREE, trunkR: 0.35 }) },
  { id: 'prop.pine@desert', source: 'nature', file: 'pine_desert', build: tree(['CommonTree_Dead_1', 'CommonTree_Dead_2', 'CommonTree_Dead_5'], [{ Wood: 0x7d6a55 }], { height: 7.0, nearTris: 360, farTris: 80, trunkR: 0.32 }) },
  { id: 'prop.rock@desert', source: 'nature', file: 'rock_desert', build: rocks(['Rock_3', 'Rock_5', 'Rock_6'], SANDSTONE.map((c) => ({ Rock: c })), ROCK_O) },
  { id: 'prop.boulder@desert', source: 'nature', file: 'boulder_desert', build: rocks(['Rock_4', 'Rock_6', 'Rock_7'], SANDSTONE.map((c) => ({ Rock: c })), BOULDER_O) },
];

/** Ground cover (no collision, drawn only near the camera): small, heavily simplified plants. */
async function decoVariant(t, file, height, pal, tris) {
  const root = await t.load(`${NATURE}/${file}.obj`);
  const parts = t.bakeParts(root, (name, _o, hex) => (name in pal ? pal[name] : hex), { linearSource: true });
  const box = t.partsBox(parts);
  const s = height / (box.max.y - box.min.y);
  const c = box.getCenter(new THREE.Vector3());
  t.transformParts(parts, new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z)));
  t.transformParts(parts, new THREE.Matrix4().makeTranslation(0, -0.05, 0));
  return { nodes: { lod0: t.mergeParts(simplifyTo(t, parts, tris, { error: 0.08 })) }, info: `${file} h=${height}` };
}
const deco = (list) => variants(list.map(([f, h, pal, tris]) => (t) => decoVariant(t, f, h, pal, tris)));
const DECOR = [
  { id: 'deco@summer', source: 'nature', file: 'deco_summer', build: deco([['Grass_Short', 0.6, { Green: 0x6a9a3c }, 60], ['Bush_1', 1.1, { Green: 0x4f8a3a }, 80], ['BushBerries_1', 0.9, { Green: 0x568f3a }, 80]]) },
  { id: 'deco@autumn', source: 'nature', file: 'deco_autumn', build: deco([['Grass_Short', 0.6, { Green: 0xa89a4c }, 60], ['Bush_1', 1.1, { Green: 0xc07a34 }, 80], ['Bush_2', 1.0, { Green: 0x9a6a2e }, 80]]) },
  { id: 'deco@winter', source: 'nature', file: 'deco_winter', build: deco([['Bush_Snow_1', 1.1, { Green: 0x3f5d3a, Snow: SNOW }, 80], ['Bush_Snow_2', 1.0, { Green: 0x46603e, Snow: SNOW }, 80]]) },
  { id: 'deco@desert', source: 'nature', file: 'deco_desert', build: deco([['Grass_Short', 0.55, { Green: 0xc2a66a }, 60], ['Cactus_1', 0.9, { Green: 0x5f8a3e, LightOrange: 0xd9a65a }, 80], ['Plant_2', 0.9, { Wood: 0x8a6a45, Leaves: 0xa89060 }, 70]]) },
];

export const RECIPES = [
  {
    id: 'vehicle.jeep',
    source: 'gaz67',
    file: 'jeep',
    async build(t) {
      const root = await t.load('gaz67/GAZ 67.fbx');
      // Source is in centimetres, forward -Z, driver on the left. 3.35 m -> 4.1 m (jeep collider 4.2 m).
      const parts = t.bakeParts(root, hexOf(JEEP_COLORS));
      normalise(t, parts, 0.0122);
      const hoodY = extent(parts, (v) => v.z < -0.9 && v.z > -1.6 && Math.abs(v.x) < 0.2, 'y');
      const sideX = extent(parts, (v) => v.y > 0.75 && v.y < 1.0 && Math.abs(v.z) < 0.6, 'x');
      const marking = markingGeo(t, [
        [-0.22, hoodY + 0.005, -1.55, 0.22, hoodY + 0.02, -0.95],
        [-sideX - 0.012, 0.78, -0.5, -sideX + 0.01, 0.98, 0.5],
        [sideX - 0.01, 0.78, -0.5, sideX + 0.012, 0.98, 0.5],
      ]);
      return [
        {
          body: t.mergeParts([
            ...simplifyBy(parts.filter((p) => p.mesh.startsWith('wheel')), () => 0.45, { error: 0.01 }),
            ...simplifyBy(parts.filter((p) => p.mesh === 'frame'), () => 0.1, { error: 0.1 }),
            ...simplifyBy(parts.filter((p) => !p.mesh.startsWith('wheel') && p.mesh !== 'frame'), () => 0.3, { error: 0.035 }),
          ]),
          body_lod1: t.mergeParts([
            ...simplifyBy(parts.filter((p) => p.mesh.startsWith('wheel')), () => 0.15, { error: 0.05 }),
            ...simplifyBy(parts.filter((p) => !p.mesh.startsWith('wheel') && p.mesh !== 'frame' && p.mesh !== 'details'), () => 0.12, { error: 0.06 }),
          ]),
          marking,
        },
      ];
    },
  },
  {
    id: 'vehicle.tank',
    source: 't12',
    file: 'tank',
    async build(t) {
      const root = await t.load('t12/T-12 soviet tank.fbx');
      const all = t.bakeParts(root, hexOf(TANK_COLORS));
      // Source faces +Z in centimetres: turn it around; 6.27 m -> 6.6 m (tank collider).
      const s = 0.01053;
      normalise(t, all, s, { rotY: Math.PI });
      const hull = all.filter((p) => p.mesh === 'T-26_BODY');
      const tower = all.filter((p) => p.mesh === 'T-26_TOWER');
      // Split the gun barrel (thin cylinder ahead of the mantlet) from the turret.
      // Measured with scripts/assets/dev/tankdbg.mjs: the turret body spans z -2.0..0 m,
      // the mantlet front is at z -2.1 m and the 45 mm barrel (axis y 1.97 m, x 0) reaches z -3.05 m.
      const tb = t.partsBox(tower);
      const pivotX = 0;
      const pivotY = tb.min.y;
      const barrelY = 1.97;
      const mantletZ = -2.1;
      let pivotZ = 0;
      {
        // Turret ring centre: middle of the turret body (without the barrel).
        let zMin = Infinity;
        let zMax = -Infinity;
        for (const p of tower) {
          const a = p.geo.attributes.position.array;
          for (let i = 2; i < a.length; i += 3) {
            if (a[i] <= -2.0) continue;
            zMin = Math.min(zMin, a[i]);
            zMax = Math.max(zMax, a[i]);
          }
        }
        pivotZ = (zMin + zMax) / 2;
      }
      const turret = [];
      const barrel = [];
      for (const p of tower) {
        const a = p.geo.attributes.position.array;
        const keep = [];
        const gun = [];
        for (let i = 0; i < a.length; i += 9) {
          const cx = (a[i] + a[i + 3] + a[i + 6]) / 3;
          const cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
          const cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
          const isGun = cz < -2.15 && Math.abs(cx - pivotX) < 0.07 && Math.abs(cy - barrelY) < 0.07;
          (isGun ? gun : keep).push(...a.slice(i, i + 9));
        }
        const mk = (arr) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
          return { ...p, geo: g };
        };
        if (keep.length) turret.push(mk(keep));
        if (gun.length) barrel.push(mk(gun));
      }
      // Barrel in its own space: trunnion at the mantlet, pointing -Z, stretched to the
      // gameplay barrel length (TANK.barrelLength = 3.2 m from the turret pivot).
      const trunnionZ = mantletZ;
      const bb = t.partsBox(barrel);
      const tipFromTrunnion = trunnionZ - bb.min.z;
      const wantTip = 3.2 - (pivotZ - trunnionZ);
      const stretch = wantTip / tipFromTrunnion;
      t.transformParts(barrel, new THREE.Matrix4().makeTranslation(-pivotX, -barrelY, -trunnionZ));
      t.transformParts(barrel, new THREE.Matrix4().makeScale(1.5, 1.5, stretch)); // a bit thicker: reads better at range
      t.transformParts(turret, new THREE.Matrix4().makeTranslation(-pivotX, -pivotY, -pivotZ));
      // Team bands on the turret side walls (turret body half-width 0.75 m, measured).
      const midY = (barrelY - pivotY) * 0.75;
      const sideX = 0.765;
      const marking = markingGeo(t, [
        [-sideX - 0.012, midY - 0.14, -0.4, -sideX + 0.01, midY + 0.12, 0.4],
        [sideX - 0.01, midY - 0.14, -0.4, sideX + 0.012, midY + 0.12, 0.4],
      ]);
      // Hierarchy: turret (pivot in hull space) > barrel (trunnion in turret space) + marking.
      const turretNode = pivotNode(t.mergeParts(simplifyTo(t, turret, 1400, { error: 0.03 })), pivotX, pivotY, pivotZ);
      const barrelNode = pivotNode(t.mergeParts(barrel), 0, barrelY - pivotY, trunnionZ - pivotZ);
      barrelNode.name = 'barrel';
      const markingNode = pivotNode(marking, 0, 0, 0);
      markingNode.name = 'marking';
      turretNode.add(barrelNode, markingNode);
      return [
        {
          hull: t.mergeParts(simplifyTo(t, hull, 3600, { error: 0.03 })),
          hull_lod1: farLod(t, hull, 700),
          turret: turretNode,
          turret_lod1: pivotNode(farLod(t, turret, 260), pivotX, pivotY, pivotZ),
        },
      ];
    },
  },
  {
    id: 'prop.tree',
    source: 'nature',
    file: 'tree',
    // Collider: trunk cylinder r 0.35, 6 m (props.ts). Canopy above that is visual only.
    build: variants(
      // CommonTree_3/4 dropped: a dead branch sticking out / too spindly.
      ['CommonTree_1', 'CommonTree_2', 'CommonTree_5'].map((f, i) => (t) => treeVariant(t, f, 6.8, LEAF[i], { nearTris: 520, farTris: 110 })),
    ),
  },
  {
    id: 'prop.pine',
    source: 'nature',
    file: 'pine',
    // Collider: trunk cylinder r 0.3, 7.5 m.
    build: variants(
      // Pines 1-3 have foliage down to the ground, where players could hide inside non-solid branches.
      ['PineTree_4', 'PineTree_5'].map((f, i) => (t) => treeVariant(t, f, 8.2, PINE[i], { nearTris: 420, farTris: 90, trunkR: 0.32 })),
    ),
  },
  {
    id: 'prop.rock',
    source: 'nature',
    file: 'rock',
    // Collider: cylinder r 1.05 from y -0.4 to 1.0 (scaled per prop).
    build: variants(
      ['Rock_3', 'Rock_5', 'Rock_6'].map((f, i) => (t) => rockVariant(t, f, 1.15, -0.4, 1.05, { Rock: ROCK[i] }, { nearTris: 120, farTris: 40 })),
    ),
  },
  {
    id: 'prop.boulder',
    source: 'nature',
    file: 'boulder',
    // Collider: cylinder r 2.1 from y -0.6 to 2.6.
    build: variants(
      ['Rock_Moss_4', 'Rock_Moss_6', 'Rock_Moss_7'].map((f, i) => (t) => rockVariant(t, f, 2.25, -0.6, 2.65, { Rock: ROCK[i], Green: MOSS }, { nearTris: 160, farTris: 50 })),
    ),
  },
  // Weapons: same frame as the procedural viewmodel items (muzzle/rear/top from viewmodel.ts).
  { id: 'weapon.ar1', source: 'guns', file: 'gun_ar1', build: async (t) => [await gun(t, 'AssaultRifle2_1', { muzzleZ: -0.68, rearZ: 0.31, topY: 0.1 })] },
  { id: 'weapon.smg1', source: 'guns', file: 'gun_smg1', build: async (t) => [await gun(t, 'SubmachineGun_2', { muzzleZ: -0.42, rearZ: 0.3, topY: 0.085, flip: true })] },
  { id: 'weapon.lmg1', source: 'guns', file: 'gun_lmg1', build: async (t) => [await gun(t, 'Bullpup_2', { muzzleZ: -0.78, rearZ: 0.34, topY: 0.1, tris: 800 })] },
  { id: 'weapon.bolt1', source: 'guns', file: 'gun_bolt1', build: async (t) => [await gun(t, 'SniperRifle_6', { muzzleZ: -0.9, rearZ: 0.36, topY: 0.15, flip: true })] },
  { id: 'weapon.pistol', source: 'guns', file: 'gun_pistol', build: async (t) => [await gun(t, 'Pistol_1', { muzzleZ: -0.19, rearZ: 0.03, topY: 0.05, tris: 400, flip: true })] },
  { id: 'character.soldier', source: 'human', file: 'soldier', build: soldier },
  ...STRUCTURES,
  ...THEMED,
  ...DECOR,
];
