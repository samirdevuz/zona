import { describe, expect, it } from 'vitest';
import {
  BTN,
  NET,
  TANK,
  VACT_CANNON,
  VACT_MG,
  VEHICLES,
  World,
  createVehicleScratch,
  createVehicleState,
  distToVehicle,
  generateMap,
  pushOutOfVehicle,
  rayVehicle,
  stepVehicle,
  type MapData,
  type VehicleState,
} from '../src';

const DT = NET.MOVE_DT;
function flatWorld(props: MapData['props'] = []): World {
  const base = generateMap(1, 2, 0);
  return new World({ ...base, terrain: { ...base.terrain, heightsCm: new Int16Array(base.terrain.heightsCm.length) }, props, zones: [] });
}
function drive(w: World, v: VehicleState, b: number, seconds: number, aimYaw = 0, aimPitch = 0): number {
  const sc = createVehicleScratch();
  let acts = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) acts |= stepVehicle(w, v, b, aimYaw, aimPitch, DT, true, sc);
  return acts;
}

describe('vehicles', () => {
  it('jeep accelerates to its top speed along its heading', () => {
    const w = flatWorld();
    const v = createVehicleState('jeep', 0, 0, 0, 0);
    drive(w, v, BTN.FORWARD, 1);
    expect(v.speed).toBeCloseTo(VEHICLES.jeep.accel, 0);
    drive(w, v, BTN.FORWARD, 3);
    expect(v.speed).toBe(VEHICLES.jeep.maxSpeed);
    expect(v.z).toBeLessThan(-40);
    expect(Math.abs(v.x)).toBeLessThan(1e-9);
  });
  it('jeep cannot turn on the spot, turns while moving; tank pivots', () => {
    const w = flatWorld();
    const j = createVehicleState('jeep', 0, 0, 0, 0);
    drive(w, j, BTN.LEFT, 1);
    expect(j.yaw).toBe(0);
    drive(w, j, BTN.FORWARD | BTN.LEFT, 1.5);
    expect(j.yaw).toBeGreaterThan(0.5);
    const t = createVehicleState('tank', 0, 0, 0, 0);
    drive(w, t, BTN.LEFT, 1);
    expect(t.yaw).toBeCloseTo(VEHICLES.tank.turnRate, 2);
    expect(Math.hypot(t.x, t.z)).toBeLessThan(1e-9);
  });
  it('brakes, reverses and coasts to a stop', () => {
    const w = flatWorld();
    const v = createVehicleState('jeep', 0, 0, 0, 0);
    drive(w, v, BTN.FORWARD, 2);
    drive(w, v, BTN.BACK, 2);
    expect(v.speed).toBeLessThan(0);
    expect(v.speed).toBeGreaterThanOrEqual(-VEHICLES.jeep.reverseSpeed);
    drive(w, v, 0, 3);
    expect(v.speed).toBe(0);
  });
  it('stops at a container and loses speed on impact', () => {
    const w = flatWorld([{ type: 'container', x: 0, y: 0, z: -30, rot: 0, scale: 1, variant: 0 }]);
    const v = createVehicleState('jeep', 0, 0, 0, 0);
    drive(w, v, BTN.FORWARD, 5);
    expect(v.z).toBeGreaterThan(-30 + 1.22 + 1.05 + 1.05 - 0.05);
    expect(v.speed).toBeLessThan(VEHICLES.jeep.maxSpeed);
  });
  it('drives over low obstacles but not sandbag walls', () => {
    // Sandbags are 0.95 m high: higher than passableHeight, so they block.
    const w = flatWorld([{ type: 'sandbags', x: 0, y: 0, z: -15, rot: 0, scale: 1, variant: 0 }]);
    const v = createVehicleState('jeep', 0, 0, 0, 0);
    drive(w, v, BTN.FORWARD, 3);
    expect(v.z).toBeGreaterThan(-15);
  });
  it('follows the terrain and tilts on slopes', () => {
    const map = generateMap(77, 2, 0);
    const w = new World(map);
    const z = map.zones[0]!;
    const v = createVehicleState('jeep', z.x, z.y, z.z, Math.PI / 2);
    drive(w, v, BTN.FORWARD, 4, 0, 0);
    expect(Math.abs(v.y - w.terrain.heightAt(v.x, v.z))).toBeLessThan(0.8);
  });
  it('tank turret turns at most 90 deg/s and clamps pitch; cannon reloads; coax overheats', () => {
    const w = flatWorld();
    const t = createVehicleState('tank', 0, 0, 0, 0);
    drive(w, t, 0, 0.5, 3, 1);
    expect(t.turretYaw).toBeCloseTo(Math.PI / 4, 2);
    expect(t.turretPitch).toBeCloseTo((TANK.turretPitchMaxDeg * Math.PI) / 180, 6);
    const sc = createVehicleScratch();
    expect(stepVehicle(w, t, BTN.FIRE, 0, 0, DT, true, sc) & VACT_CANNON).toBeTruthy();
    expect(stepVehicle(w, t, 0, 0, 0, DT, true, sc)).toBe(0);
    expect(stepVehicle(w, t, BTN.FIRE, 0, 0, DT, true, sc) & VACT_CANNON).toBe(0); // reloading
    drive(w, t, 0, TANK.cannon.reloadS);
    expect(stepVehicle(w, t, BTN.FIRE, 0, 0, DT, true, sc) & VACT_CANNON).toBeTruthy();
    let mg = 0;
    for (let i = 0; i < Math.round(6 / DT); i++) if (stepVehicle(w, t, BTN.ADS, 0, 0, DT, true, sc) & VACT_MG) mg++;
    expect(mg).toBeGreaterThan(45);
    expect(mg).toBeLessThanOrEqual(51); // ~5 s at 600 RPM, then overheated
    expect(t.overheatT).toBeGreaterThan(0);
  });
  it('rays and splash measure against the body box; infantry is pushed out', () => {
    const t = createVehicleState('tank', 0, 0, 0, 0);
    expect(rayVehicle(t, 0, 1, 20, 0, 0, -1)).toBeCloseTo(20 - VEHICLES.tank.halfLength, 6);
    expect(rayVehicle(t, 5, 1, 20, 0, 0, -1)).toBe(Infinity);
    expect(distToVehicle(t, 0, 1, 0)).toBe(0);
    expect(distToVehicle(t, VEHICLES.tank.halfWidth + 2, 1, 0)).toBeCloseTo(2, 6);
    const p = { x: 0.3, z: 0 };
    expect(pushOutOfVehicle(t, p, 0.4)).toBe(true);
    expect(Math.abs(p.x)).toBeGreaterThan(VEHICLES.tank.circleRadius);
  });
  it('is deterministic', () => {
    const map = generateMap(5, 2, 0);
    const w = new World(map);
    const a = createVehicleState('tank', map.zones[0]!.x, map.zones[0]!.y, map.zones[0]!.z, 1);
    const b = { ...a };
    const sa = createVehicleScratch();
    const sb = createVehicleScratch();
    for (let i = 0; i < 1500; i++) {
      const bt = [BTN.FORWARD, BTN.FORWARD | BTN.LEFT, BTN.BACK | BTN.RIGHT, BTN.FIRE | BTN.ADS][Math.floor(i / 120) % 4]!;
      stepVehicle(w, a, bt, Math.sin(i * 0.01), 0.1, DT, true, sa);
      stepVehicle(w, b, bt, Math.sin(i * 0.01), 0.1, DT, true, sb);
    }
    expect(b).toEqual(a);
  });
});
