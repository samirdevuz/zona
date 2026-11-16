import * as THREE from 'three';
import { FLAG_POLE, NEUTRAL_COLOR_HEX, TEAM_COLOR_HEX, ZONES, type MapData } from '@zona/shared';

const ringVert = /* glsl */ `
#include <fog_pars_vertex>
varying vec2 vPos;
void main() {
  vPos = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const ringFrag = /* glsl */ `
uniform vec3 arcColor;
uniform vec3 restColor;
uniform float progress;
uniform float flash;
varying vec2 vPos;
#include <fog_pars_fragment>
void main() {
  float a = atan(vPos.x, -vPos.y);
  float t = (a + 3.14159265) / 6.28318531;
  vec3 c = t <= progress ? arcColor : restColor;
  float alpha = 0.8 + 0.2 * flash;
  c = mix(c, vec3(1.0, 0.2, 0.2), flash * 0.6);
  gl_FragColor = vec4(c, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

interface ZoneVisual {
  flag: THREE.Mesh;
  flagGeo: THREE.BufferGeometry;
  flagBase: Float32Array;
  ringMat: THREE.ShaderMaterial;
  baseY: number;
  owner: number;
}

const teamColor = (t: number): THREE.Color => new THREE.Color().setHex(t >= 0 ? TEAM_COLOR_HEX[t]! : NEUTRAL_COLOR_HEX);

/** Flags, poles and capture rings for every zone (GAME.md 4.2 zone anatomy). */
export class ZoneVisuals {
  readonly group = new THREE.Group();
  private readonly zones: ZoneVisual[] = [];
  private readonly flagMats: THREE.MeshLambertMaterial[];
  private readonly neutral = teamColor(-1);
  private readonly teamCols: THREE.Color[];

  constructor(map: MapData) {
    this.group.name = 'zones';
    this.teamCols = TEAM_COLOR_HEX.map((_, i) => teamColor(i));
    // Flags carry a little emissive so team colours stay readable in shade and at distance.
    const flagMat = (hex: number): THREE.MeshLambertMaterial =>
      new THREE.MeshLambertMaterial({ color: hex, emissive: new THREE.Color().setHex(hex).multiplyScalar(0.45), side: THREE.DoubleSide });
    this.flagMats = [...TEAM_COLOR_HEX.map((h) => flagMat(h)), flagMat(NEUTRAL_COLOR_HEX)];
    const poleGeo = new THREE.CylinderGeometry(FLAG_POLE.radius * 0.8, FLAG_POLE.radius, FLAG_POLE.height, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
    for (const z of map.zones) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(z.x, z.y + FLAG_POLE.height / 2, z.z);
      this.group.add(pole);

      const flagGeo = new THREE.PlaneGeometry(2.4, 1.4, 6, 2);
      flagGeo.translate(1.2 + FLAG_POLE.radius, 0, 0);
      const flag = new THREE.Mesh(flagGeo, this.flagMats[this.flagMats.length - 1]);
      flag.position.set(z.x, z.y + FLAG_POLE.height - 0.8, z.z);
      // Face the map centre so players spawning there and attackers coming from the middle see the flag face-on.
      const len = Math.hypot(z.x, z.z);
      flag.rotation.y = len > 1 ? Math.atan2(-z.x / len, -z.z / len) : 0;
      this.group.add(flag);

      const ringGeo = new THREE.RingGeometry(ZONES.captureRadius - 0.45, ZONES.captureRadius, 64, 1);
      const ringMat = new THREE.ShaderMaterial({
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { arcColor: { value: new THREE.Color() }, restColor: { value: new THREE.Color() }, progress: { value: 0 }, flash: { value: 0 } },
        ]),
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, z.y + 0.07, z.z);
      ring.renderOrder = 1;
      this.group.add(ring);

      this.zones.push({ flag, flagGeo, flagBase: Float32Array.from(flagGeo.attributes.position!.array), ringMat, baseY: z.y, owner: -2 });
    }
  }

  /** Update visuals from zone state: owner, contested and control per team. */
  update(i: number, owner: number, contested: boolean, control: ArrayLike<number>, time: number): void {
    const v = this.zones[i];
    if (!v) return;
    if (v.owner !== owner) {
      v.owner = owner;
      v.flag.material = this.flagMats[owner >= 0 ? owner : this.flagMats.length - 1]!;
    }
    // Arc: owner's control if owned; otherwise the leading team's control.
    let arcTeam = owner;
    let progress = owner >= 0 ? control[owner]! : 0;
    if (owner < 0) {
      for (let t = 0; t < control.length; t++) {
        if (control[t]! > progress) {
          progress = control[t]!;
          arcTeam = t;
        }
      }
    }
    const u = v.ringMat.uniforms;
    (u.arcColor!.value as THREE.Color).copy(arcTeam >= 0 ? this.teamCols[arcTeam]! : this.neutral);
    (u.restColor!.value as THREE.Color).copy(this.neutral);
    u.progress!.value = progress / 100;
    u.flash!.value = contested ? 0.5 + 0.5 * Math.sin(time * 10) : 0;
    // Flag rises with control.
    const raise = owner >= 0 ? control[owner]! / 100 : progress / 100;
    v.flag.position.y = v.baseY + 2 + raise * (FLAG_POLE.height - 2.8);
    // Cheap waving.
    const pos = v.flagGeo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let k = 0; k < pos.count; k++) {
      const x = v.flagBase[k * 3]!;
      arr[k * 3 + 2] = Math.sin(x * 2.2 - time * 4 + i) * 0.12 * (x / 2.4);
    }
    pos.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.material instanceof THREE.ShaderMaterial) o.material.dispose();
      }
    });
    for (const m of this.flagMats) m.dispose();
  }
}
