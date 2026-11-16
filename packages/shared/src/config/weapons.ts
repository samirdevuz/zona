/** Weapon data (GAME.md 5.1). Angles in degrees, distances in metres, time in seconds. */
export type WeaponId = 'ar1';

export interface WeaponDef {
  id: WeaponId;
  damageBody: number;
  damageHead: number;
  rpm: number;
  automatic: boolean;
  magSize: number;
  reserveMax: number;
  reloadS: number;
  /** Cone half-angle when firing from the hip / aiming down sights. */
  spreadHipDeg: number;
  spreadAdsDeg: number;
  /** Full damage up to falloffStartM, then linear to falloffMinMult at falloffEndM, flat after. */
  falloffStartM: number;
  falloffEndM: number;
  falloffMinMult: number;
  rangeM: number;
  /** View kick per shot (client-side recoil). */
  recoilPitchDeg: number;
  recoilYawDeg: number;
  /** View recoil recovery speed when not firing. */
  recoilRecoverDegPerS: number;
  adsZoom: number;
  adsTimeS: number;
  vehicleDamageMult: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar1: {
    id: 'ar1',
    damageBody: 20,
    damageHead: 40,
    rpm: 600,
    automatic: true,
    magSize: 30,
    reserveMax: 120,
    reloadS: 2.2,
    spreadHipDeg: 1.5,
    spreadAdsDeg: 0.4,
    falloffStartM: 40,
    falloffEndM: 100,
    falloffMinMult: 0.6,
    rangeM: 400,
    recoilPitchDeg: 0.38,
    recoilYawDeg: 0.14,
    recoilRecoverDegPerS: 5,
    adsZoom: 1.35,
    adsTimeS: 0.18,
    vehicleDamageMult: 0.15,
  },
};

/** Spread modifiers shared by all weapons (GAME.md 5.1). */
export const WEAPON_COMMON = {
  /** Horizontal speed above which the shooter counts as moving. */
  movingSpeed: 1.0,
  movingSpreadMult: 1.5,
  airborneSpreadMult: 4.0,
  crouchSpreadMult: 0.85,
} as const;
