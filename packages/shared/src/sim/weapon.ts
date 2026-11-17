import { CLASSES } from '../config/classes';
import { GADGETS } from '../config/gadgets';
import { WEAPONS, WEAPON_COMMON, type WeaponDef } from '../config/weapons';
import { BTN } from './input';
import { SLOT_COUNT, currentWeapon, itemAt, type PlayerState } from './player';

const EPS = 1e-9;

/** What an inventory step asks the server to do (and the client to show). */
export const ACT_NONE = 0;
export const ACT_SHOOT = 1;
export const ACT_ROCKET = 2;
export const ACT_GRENADE = 3;
export const ACT_MEDPACK = 4;
export const ACT_AMMOBOX = 5;
export const ACT_TORCH = 6;

/** Slot request value meaning "keep the current slot". */
export const SLOT_KEEP = -1;

function slotUsable(s: PlayerState, slot: number): boolean {
  return slot >= 0 && slot < SLOT_COUNT && itemAt(s, slot) !== 'none';
}

function startReload(s: PlayerState, w: WeaponDef): void {
  if (s.reloadT > 0 || s.mag[s.slot]! >= w.magSize || s.res[s.slot]! <= 0) return;
  s.reloadT = w.reloadS;
}

/**
 * Advance inventory timers and handle fire/reload/switch/gadget input for one
 * fixed step. Returns an ACT_* code. Shared by server and client prediction so
 * ammo, fire timing and switching never disagree.
 */
export function stepInventory(s: PlayerState, buttons: number, slotReq: number, dt: number): number {
  const pressed = buttons & ~s.prevB;
  s.prevB = buttons;
  const cls = CLASSES[s.classId];
  if (s.cooldown > 0) s.cooldown -= dt;
  if (s.gadgetCd > 0) s.gadgetCd = s.gadgetCd > dt ? s.gadgetCd - dt : 0;
  if (s.throwT > 0) s.throwT = s.throwT > dt ? s.throwT - dt : 0;

  const w0 = currentWeapon(s);
  const firing = (buttons & BTN.FIRE) !== 0;
  if (w0 && s.bloom > 0 && !(firing && w0.automatic)) s.bloom = Math.max(0, s.bloom - w0.bloomDecayDegPerS * dt);

  // Reload progress.
  if (s.reloadT > 0 && w0) {
    s.reloadT -= dt;
    if (s.reloadT <= EPS) {
      s.reloadT = 0;
      const take = Math.min(w0.magSize - s.mag[s.slot]!, s.res[s.slot]!);
      s.mag[s.slot]! += take;
      s.res[s.slot]! -= take;
    }
  }

  // Slot switching.
  if (slotReq !== SLOT_KEEP && slotReq !== s.slot && slotUsable(s, slotReq)) {
    s.slot = slotReq;
    s.switchT = GADGETS.switchTimeS;
    s.reloadT = 0;
    s.bloom = 0;
  }
  if (s.switchT > 0) {
    s.switchT = s.switchT > dt ? s.switchT - dt : 0;
    if (s.cooldown < 0) s.cooldown = 0;
    return ACT_NONE;
  }
  if (s.throwT > 0) return ACT_NONE;

  // Quick actions: G throws a grenade (Assault), Q deploys gadget A.
  if ((pressed & BTN.GRENADE) !== 0 && cls.quickGrenade) {
    const gs = cls.slots.indexOf('grenade');
    if (gs >= 0 && s.mag[gs]! > 0) {
      s.mag[gs]!--;
      s.throwT = GADGETS.grenade.throwTimeS;
      s.reloadT = 0;
      return ACT_GRENADE;
    }
  }
  if ((pressed & BTN.GADGET_A) !== 0) {
    const act = deploy(s, cls.slots[2]!);
    if (act !== ACT_NONE) return act;
  }

  const item = itemAt(s, s.slot);
  if (item === 'grenade') {
    if ((pressed & BTN.FIRE) !== 0 && s.mag[s.slot]! > 0 && !s.sprinting) {
      s.mag[s.slot]!--;
      s.throwT = GADGETS.grenade.throwTimeS;
      return ACT_GRENADE;
    }
    return ACT_NONE;
  }
  if (item === 'medpack' || item === 'ammobox') return (pressed & BTN.FIRE) !== 0 ? deploy(s, item) : ACT_NONE;
  if (item === 'torch') return firing && !s.sprinting ? ACT_TORCH : ACT_NONE;

  const w = w0;
  if (!w) return ACT_NONE;
  if ((buttons & BTN.RELOAD) !== 0) startReload(s, w);
  const trigger = w.automatic ? firing : (pressed & BTN.FIRE) !== 0;
  if (!trigger || s.sprinting || s.reloadT > 0) {
    if (s.cooldown < 0) s.cooldown = 0;
    return ACT_NONE;
  }
  if (s.cooldown > EPS) return ACT_NONE;
  if (s.mag[s.slot]! <= 0) {
    startReload(s, w);
    if (s.cooldown < 0) s.cooldown = 0;
    return ACT_NONE;
  }
  s.mag[s.slot]!--;
  s.shots++;
  // Accumulate so the average fire rate is exact at any RPM.
  s.cooldown = (s.cooldown < 0 ? s.cooldown : 0) + 60 / w.rpm;
  if (w.bloomPerShotDeg > 0) s.bloom = Math.min(w.bloomMaxDeg, s.bloom + w.bloomPerShotDeg);
  if (w.projectile === 'rocket') {
    // Single-shot launcher: reload right after firing.
    if (s.mag[s.slot] === 0) startReload(s, w);
    return ACT_ROCKET;
  }
  return ACT_SHOOT;
}

function deploy(s: PlayerState, item: string): number {
  if (s.gadgetCd > 0 || s.sprinting) return ACT_NONE;
  if (item === 'medpack') {
    s.gadgetCd = GADGETS.medpack.cooldownS;
    return ACT_MEDPACK;
  }
  if (item === 'ammobox') {
    s.gadgetCd = GADGETS.ammobox.cooldownS;
    return ACT_AMMOBOX;
  }
  return ACT_NONE;
}

/** Backwards-compatible single-weapon step (keeps the selected slot). */
export function stepWeapon(s: PlayerState, buttons: number, dt: number): boolean {
  const a = stepInventory(s, buttons, SLOT_KEEP, dt);
  return a === ACT_SHOOT || a === ACT_ROCKET;
}

/** Current cone half-angle in degrees for the shooter's state (GAME.md 5.1). */
export function spreadDeg(s: PlayerState): number {
  const w = currentWeapon(s) ?? WEAPONS.pistol;
  let sp = s.ads ? w.spreadAdsDeg : w.spreadHipDeg;
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (!s.onGround) sp *= WEAPON_COMMON.airborneSpreadMult;
  else if (speed > WEAPON_COMMON.movingSpeed) sp *= WEAPON_COMMON.movingSpreadMult;
  else if (s.crouched) sp *= w.crouchStillMult;
  sp += s.bloom;
  if (w.bloomMaxDeg > 0 && sp > w.bloomMaxDeg) sp = w.bloomMaxDeg;
  return sp;
}

/** Damage multiplier for distance (linear falloff between start and end). */
export function falloffMult(w: WeaponDef, dist: number): number {
  if (dist <= w.falloffStartM) return 1;
  if (dist >= w.falloffEndM) return w.falloffMinMult;
  const t = (dist - w.falloffStartM) / (w.falloffEndM - w.falloffStartM);
  return 1 + (w.falloffMinMult - 1) * t;
}

/** Linear splash falloff: full damage at the centre, 0 at the radius. */
export function splashDamage(maxDamage: number, radius: number, dist: number): number {
  if (dist >= radius) return 0;
  return maxDamage * (1 - dist / radius);
}

/**
 * Add `fraction` of each gun's reserveMax (and of the grenade count) to the
 * player's stock. `acc` carries fractional remainders between calls.
 */
export function refillAmmo(s: PlayerState, fraction: number, acc: number[]): boolean {
  let changed = false;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const it = itemAt(s, i);
    let cap = 0;
    let room = 0;
    if (it in WEAPONS) {
      const w = WEAPONS[it as keyof typeof WEAPONS];
      cap = w.reserveMax;
      room = w.reserveMax + w.magSize - s.mag[i]! - s.res[i]!;
    } else if (it === 'grenade') {
      cap = GADGETS.grenade.carried;
      room = cap - s.mag[i]!;
    }
    if (room <= 0) {
      acc[i] = 0;
      continue;
    }
    acc[i] = (acc[i] ?? 0) + fraction * cap;
    const add = Math.min(room, Math.floor(acc[i]!));
    if (add > 0) {
      acc[i]! -= add;
      if (it === 'grenade') s.mag[i]! += add;
      else s.res[i]! += add;
      changed = true;
    }
  }
  return changed;
}
