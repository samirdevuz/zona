import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/render/assets';

describe('asset manifest', () => {
  it('keeps valid local entries and drops bad ones', () => {
    const m = parseManifest({
      version: 1,
      models: {
        'prop.pine': { url: 'models/pine.glb', license: 'CC0', scale: 2, source: 'Kenney' },
        'prop.rock': { url: 'https://evil.example/x.glb', license: 'CC0' },
        'prop.tree': { url: '../../secret.glb', license: 'CC0' },
        'prop.barrier': { url: 'models/b.glb' },
        'prop.boulder': { files: ['models/b1.glb', '/etc/passwd'], license: 'CC0' },
        'vehicle.jeep': { url: 'models/jeep.gltf', license: 'CC-BY 4.0', offset: [0, 0.1, 0], rotationY: 3.14 },
        'vehicle.tank': { files: ['models/tank_1.glb', 'models/tank_2.glb'], license: 'CC0' },
      },
    });
    expect(Object.keys(m.models).sort()).toEqual(['prop.pine', 'vehicle.jeep', 'vehicle.tank']);
    expect(m.models['prop.pine']!.scale).toBe(2);
    expect(m.models['prop.pine']!.files).toEqual(['models/pine.glb']);
    expect(m.models['vehicle.jeep']!.offset).toEqual([0, 0.1, 0]);
    expect(m.models['vehicle.tank']!.files).toHaveLength(2);
  });
  it('survives garbage', () => {
    expect(parseManifest(null).models).toEqual({});
    expect(parseManifest({ models: 3 }).models).toEqual({});
    expect(parseManifest({ models: { a: { files: [], license: 'CC0' } } }).models).toEqual({});
  });
});
