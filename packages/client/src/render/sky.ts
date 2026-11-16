import * as THREE from 'three';

export const SKY_TOP = 0x5b8fd6;
export const SKY_HORIZON = 0xcfe0ee;
export const FOG_COLOR = 0xc8d9e6;

/** Gradient sky dome (one draw call, no textures). Follows the camera. */
export function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 16, 10);
  const top = new THREE.Color().setHex(SKY_TOP);
  const hor = new THREE.Color().setHex(SKY_HORIZON);
  const ground = new THREE.Color().setHex(0x9fb2a0);
  const pos = geo.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
    else c.copy(hor).lerp(ground, Math.min(1, -y * 3));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}
