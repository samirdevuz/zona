import { WEAPONS, WEAPON_COMMON, type WeaponDef } from '../config/weapons';
import { BTN } from './input';
import type { PlayerState } from './player';

const EPS = 1e-9;

/**
 * Advance weapon timers and handle fire/reload input for one fixed step.
 * Returns true if a shot was fired this step. Shared by server and client
 * prediction so ammo and fire timing never disagree.
 */
export function stepWeapon(s: PlayerState, buttons: number, dt: number): boolean {
  const w = WEAPONS[s.weapon];
  if (s.cooldown > 0) s.cooldown -= dt;
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= EPS) {
      s.reloadT = 0;
      const take = Math.min(w.magSize - s.ammo, s.reserve);
      s.ammo += take;
      s.reserve -= take;
    }
  }
  if ((buttons & BTN.RELOAD) !== 0) startReload(s, w);

  if ((buttons & BTN.FIRE) === 0 || s.sprinting || s.reloadT > 0) {
    if (s.cooldown < 0) s.cooldown = 0;
    return false;
  }
  if (s.cooldown > EPS) return false;
  if (s.ammo <= 0) {
    startReload(s, w);
    if (s.cooldown < 0) s.cooldown = 0;
    return false;
  }
  s.ammo--;
  s.shots++;
  // Accumulate so the average fire rate is exact at any RPM.
  s.cooldown = (s.cooldown < 0 ? s.cooldown : 0) + 60 / w.rpm;
  return true;
}

function startReload(s: PlayerState, w: WeaponDef): void {
  if (s.reloadT > 0 || s.ammo >= w.magSize || s.reserve <= 0) return;
  s.reloadT = w.reloadS;
}

/** Current cone half-angle in degrees for the shooter's state (GAME.md 5.1). */
export function spreadDeg(s: PlayerState): number {
  const w = WEAPONS[s.weapon];
  let sp = s.ads ? w.spreadAdsDeg : w.spreadHipDeg;
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (!s.onGround) sp *= WEAPON_COMMON.airborneSpreadMult;
  else if (speed > WEAPON_COMMON.movingSpeed) sp *= WEAPON_COMMON.movingSpreadMult;
  else if (s.crouched) sp *= WEAPON_COMMON.crouchSpreadMult;
  return sp;
}

/** Damage multiplier for distance (linear falloff between start and end). */
export function falloffMult(w: WeaponDef, dist: number): number {
  if (dist <= w.falloffStartM) return 1;
  if (dist >= w.falloffEndM) return w.falloffMinMult;
  const t = (dist - w.falloffStartM) / (w.falloffEndM - w.falloffStartM);
  return 1 + (w.falloffMinMult - 1) * t;
}
