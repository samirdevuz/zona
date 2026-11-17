import * as THREE from 'three';
import { GRAPHICS, GRAPHICS_PRESETS, type GraphicsPreset, type MapData, type MapTheme, type Terrain } from '@zona/shared';
import { BlobShadows, CharacterFactory } from './characters';
import { Effects } from './effects';
import { Entities } from './entities';
import { VehicleFactory } from './vehicles';
import { buildProps, type PropLods } from './props';
import { FirstPersonRig, type CameraRig } from './rigs';
import { assets } from './assets';
import { FOG_COLOR, buildSky, setSkyColors } from './sky';
import { themePalette } from './theme';
import { buildTerrain } from './terrain';
import { Viewmodel } from './viewmodel';
import { ZoneVisuals } from './zones';
import type { Settings } from '../settings';


/** Owns the three.js renderer, scenes and per-match world visuals. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly viewmodel = new Viewmodel();
  readonly characters = new CharacterFactory();
  readonly vehicleFactory = new VehicleFactory();
  rig: CameraRig = new FirstPersonRig();
  preset: GraphicsPreset;
  effects: Effects;
  readonly entities = new Entities();
  blobs: BlobShadows;
  /** Camera shake intensity (decays). */
  shake = 0;
  zones: ZoneVisuals | null = null;
  private terrainGroup: THREE.Group | null = null;
  private propsGroup: THREE.Group | null = null;
  private propLods: PropLods | null = null;
  private theme: MapTheme = 'summer';
  private terrain: Terrain | null = null;
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private renderScale = 1;
  stats = { calls: 0, triangles: 0 };
  /** Optional glTF assets (loaded once, in the background, before the first match). */
  readonly assetsReady: Promise<void> = assets.load().then(() => {
    this.assetsLoaded = true;
    this.viewmodel.reset();
    this.characters.reset();
  });
  assetsLoaded = false;
  readonly antialias: boolean;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.preset = GRAPHICS_PRESETS[settings.preset];
    this.antialias = this.preset.antialias;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.info.autoReset = false;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color().setHex(FOG_COLOR);
    this.scene.fog = new THREE.Fog(FOG_COLOR, 50, 220);
    this.hemi = new THREE.HemisphereLight(0xd6e8ff, 0x6b5a3a, 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.3);
    this.sun.position.set(80, 140, 50);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sky = buildSky();
    this.scene.add(this.sky);
    this.effects = new Effects(this.preset.dynamicLights);
    this.scene.add(this.effects.group);
    this.scene.add(this.entities.group);
    this.blobs = new BlobShadows(32);
    this.scene.add(this.blobs.mesh);
    this.applySettings(settings);
    this.resize();
  }

  applySettings(s: Settings): void {
    const p = GRAPHICS_PRESETS[s.preset];
    const shadowsChanged = p.shadowMapSize !== this.preset.shadowMapSize;
    this.preset = p;
    this.renderScale = Math.min(GRAPHICS.renderScaleMax, Math.max(GRAPHICS.renderScaleMin, s.renderScale));
    this.camera.fov = s.fov;
    this.camera.far = p.fogFar + 60;
    this.camera.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = p.fogFar * GRAPHICS.fogNearFactor;
    fog.far = p.fogFar;
    this.sky.scale.setScalar(p.fogFar + 20);
    this.renderer.shadowMap.enabled = p.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = p.shadowMapSize > 0;
    if (p.shadowMapSize > 0) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      const c = this.sun.shadow.camera;
      c.left = -p.shadowRange;
      c.right = p.shadowRange;
      c.top = p.shadowRange;
      c.bottom = -p.shadowRange;
      c.near = 1;
      c.far = 400;
      c.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.blobs.mesh.visible = p.blobShadows;
    if (shadowsChanged) {
      this.scene.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) o.material.needsUpdate = true;
      });
      this.setShadowFlags();
    }
    this.resize();
  }

  private setShadowFlags(): void {
    const on = this.preset.shadowMapSize > 0;
    this.terrainGroup?.traverse((o) => {
      if (o instanceof THREE.Mesh) o.receiveShadow = on;
    });
    this.propsGroup?.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = on;
        o.receiveShadow = on;
      }
    });
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.resize(w / h);
  }

  loadMap(map: MapData, terrain: Terrain, theme: MapTheme = 'summer'): void {
    this.unloadMap();
    this.theme = theme;
    const pal = themePalette(theme);
    (this.scene.background as THREE.Color).setHex(pal.fog);
    (this.scene.fog as THREE.Fog).color.setHex(pal.fog);
    this.hemi.color.setHex(pal.hemiSky);
    this.hemi.groundColor.setHex(pal.hemiGround);
    this.sun.color.setHex(pal.sun);
    this.sun.intensity = pal.sunIntensity;
    setSkyColors(this.sky, pal.skyTop, pal.skyHorizon, pal.skyGround);
    const shadows = this.preset.shadowMapSize > 0;
    this.terrainGroup = buildTerrain(map, terrain, shadows, pal);
    this.terrain = terrain;
    this.propLods = buildProps(map, shadows, theme, terrain);
    this.propsGroup = this.propLods.group;
    this.zones = new ZoneVisuals(map);
    this.scene.add(this.terrainGroup, this.propsGroup, this.zones.group);
  }

  /** Rebuild the props (e.g. once glTF models finished loading after the match started). */
  rebuildProps(map: MapData): void {
    if (!this.propsGroup) return;
    this.scene.remove(this.propsGroup);
    this.propsGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.propLods = buildProps(map, this.preset.shadowMapSize > 0, this.theme, this.terrain ?? undefined);
    this.propsGroup = this.propLods.group;
    this.scene.add(this.propsGroup);
    this.vehicleFactory.reset();
  }

  unloadMap(): void {
    for (const g of [this.terrainGroup, this.propsGroup]) {
      if (!g) continue;
      this.scene.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.terrainGroup = null;
    this.propsGroup = null;
    this.propLods = null;
    if (this.zones) {
      this.scene.remove(this.zones.group);
      this.zones.dispose();
      this.zones = null;
    }
  }

  /** Render the world, then the viewmodel on top with a cleared depth buffer. */
  render(): void {
    const cam = this.camera;
    this.sky.position.copy(cam.position);
    this.propLods?.update(cam.position.x, cam.position.z, this.preset.fogFar);
    if (this.sun.castShadow) {
      // Keep the shadow box centred on the camera, snapped to texels to avoid shimmering.
      const step = (this.preset.shadowRange * 2) / this.preset.shadowMapSize;
      const x = Math.round(cam.position.x / step) * step;
      const z = Math.round(cam.position.z / step) * step;
      this.sun.target.position.set(x, cam.position.y, z);
      this.sun.position.set(x + 80, cam.position.y + 140, z + 50);
    }
    const info = this.renderer.info;
    info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (this.viewmodel.visible) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
    this.stats.calls = info.render.calls;
    this.stats.triangles = info.render.triangles;
  }
}
