/** Weapon data (GAME.md 5.1). Angles in degrees, distances in metres, time in seconds. */
export type WeaponId = 'ar1' | 'smg1' | 'lmg1' | 'bolt1' | 'pistol' | 'rocket' | 'coax' | 'cannon';

/** Stable order used for compact network encoding. */
export const WEAPON_IDS: readonly WeaponId[] = ['ar1', 'smg1', 'lmg1', 'bolt1', 'pistol', 'rocket', 'coax', 'cannon'];

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
  /** Extra spread per shot (LMG), its cap on the total cone, and decay when not firing. */
  bloomPerShotDeg: number;
  bloomMaxDeg: number;
  bloomDecayDegPerS: number;
  /** Spread multiplier when crouched and not moving. */
  crouchStillMult: number;
  /** Full damage up to falloffStartM, then linear to falloffMinMult at falloffEndM, flat after. */
  falloffStartM: number;
  falloffEndM: number;
  falloffMinMult: number;
  rangeM: number;
  /** View kick per shot (client-side recoil). */
  recoilPitchDeg: number;
  recoilYawDeg: number;
  recoilRecoverDegPerS: number;
  adsZoom: number;
  adsTimeS: number;
  /** Scoped weapons show a scope overlay and hide the viewmodel when aiming. */
  scope: boolean;
  /** Aim sway amplitude while scoped (client applies it to the sent aim). */
  swayDeg: number;
  vehicleDamageMult: number;
  /** Projectile weapons spawn a server projectile instead of a hitscan ray. */
  projectile: 'rocket' | 'shell' | null;
}

const base = {
  bloomPerShotDeg: 0,
  bloomMaxDeg: 0,
  bloomDecayDegPerS: 0,
  crouchStillMult: 0.85,
  scope: false,
  swayDeg: 0,
  projectile: null,
} as const;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar1: {
    ...base,
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
  smg1: {
    ...base,
    id: 'smg1',
    damageBody: 14,
    damageHead: 28,
    rpm: 900,
    automatic: true,
    magSize: 35,
    reserveMax: 140,
    reloadS: 1.9,
    spreadHipDeg: 2.5,
    spreadAdsDeg: 1.2,
    falloffStartM: 20,
    falloffEndM: 60,
    falloffMinMult: 0.5,
    rangeM: 300,
    recoilPitchDeg: 0.26,
    recoilYawDeg: 0.2,
    recoilRecoverDegPerS: 6,
    adsZoom: 1.25,
    adsTimeS: 0.14,
    vehicleDamageMult: 0.1,
  },
  lmg1: {
    ...base,
    id: 'lmg1',
    damageBody: 16,
    damageHead: 32,
    rpm: 750,
    automatic: true,
    magSize: 100,
    reserveMax: 200,
    reloadS: 5.0,
    spreadHipDeg: 3.0,
    spreadAdsDeg: 1.5,
    bloomPerShotDeg: 0.15,
    bloomMaxDeg: 6,
    bloomDecayDegPerS: 4,
    crouchStillMult: 0.5,
    falloffStartM: 35,
    falloffEndM: 90,
    falloffMinMult: 0.6,
    rangeM: 400,
    recoilPitchDeg: 0.3,
    recoilYawDeg: 0.22,
    recoilRecoverDegPerS: 5,
    adsZoom: 1.3,
    adsTimeS: 0.3,
    vehicleDamageMult: 0.2,
  },
  bolt1: {
    ...base,
    id: 'bolt1',
    damageBody: 70,
    damageHead: 150,
    rpm: 42,
    automatic: false,
    magSize: 5,
    reserveMax: 20,
    reloadS: 3.0,
    spreadHipDeg: 4.0,
    spreadAdsDeg: 0.05,
    crouchStillMult: 1,
    falloffStartM: 1000,
    falloffEndM: 1001,
    falloffMinMult: 1,
    rangeM: 600,
    recoilPitchDeg: 2.2,
    recoilYawDeg: 0.4,
    recoilRecoverDegPerS: 4,
    adsZoom: 4,
    adsTimeS: 0.25,
    scope: true,
    swayDeg: 0.22,
    vehicleDamageMult: 0.5,
  },
  pistol: {
    ...base,
    id: 'pistol',
    damageBody: 25,
    damageHead: 50,
    rpm: 400,
    automatic: false,
    magSize: 12,
    reserveMax: 36,
    reloadS: 1.5,
    spreadHipDeg: 1.8,
    spreadAdsDeg: 0.8,
    falloffStartM: 25,
    falloffEndM: 70,
    falloffMinMult: 0.5,
    rangeM: 250,
    recoilPitchDeg: 0.9,
    recoilYawDeg: 0.25,
    recoilRecoverDegPerS: 8,
    adsZoom: 1.2,
    adsTimeS: 0.12,
    vehicleDamageMult: 0.05,
  },
  rocket: {
    ...base,
    id: 'rocket',
    // Direct-hit damage; splash is in GADGETS.rocket.
    damageBody: 60,
    damageHead: 60,
    rpm: 60,
    automatic: false,
    magSize: 1,
    reserveMax: 3,
    reloadS: 3.5,
    spreadHipDeg: 1.5,
    spreadAdsDeg: 0.3,
    crouchStillMult: 1,
    falloffStartM: 1000,
    falloffEndM: 1001,
    falloffMinMult: 1,
    rangeM: 400,
    recoilPitchDeg: 1.5,
    recoilYawDeg: 0.3,
    recoilRecoverDegPerS: 4,
    adsZoom: 1.5,
    adsTimeS: 0.3,
    vehicleDamageMult: 1,
    projectile: 'rocket',
  },
  /** Tank coaxial machine gun (vehicle weapon; heat in TANK.coax). */
  coax: {
    ...base,
    id: 'coax',
    damageBody: 12,
    damageHead: 24,
    rpm: 600,
    automatic: true,
    magSize: 999,
    reserveMax: 0,
    reloadS: 0,
    spreadHipDeg: 0.8,
    spreadAdsDeg: 0.8,
    falloffStartM: 50,
    falloffEndM: 120,
    falloffMinMult: 0.6,
    rangeM: 400,
    recoilPitchDeg: 0,
    recoilYawDeg: 0,
    recoilRecoverDegPerS: 0,
    adsZoom: 1,
    adsTimeS: 0.1,
    vehicleDamageMult: 0.1,
  },
  /** Tank cannon (projectile; damage in TANK.cannon). Listed for kill-feed names. */
  cannon: {
    ...base,
    id: 'cannon',
    damageBody: 110,
    damageHead: 110,
    rpm: 20,
    automatic: false,
    magSize: 1,
    reserveMax: 0,
    reloadS: 3,
    spreadHipDeg: 0.2,
    spreadAdsDeg: 0.2,
    falloffStartM: 1000,
    falloffEndM: 1001,
    falloffMinMult: 1,
    rangeM: 500,
    recoilPitchDeg: 0,
    recoilYawDeg: 0,
    recoilRecoverDegPerS: 0,
    adsZoom: 1,
    adsTimeS: 0.1,
    vehicleDamageMult: 1,
    projectile: 'shell',
  },
};

/** Spread modifiers shared by all weapons (GAME.md 5.1). */
export const WEAPON_COMMON = {
  /** Horizontal speed above which the shooter counts as moving. */
  movingSpeed: 1.0,
  movingSpreadMult: 1.5,
  airborneSpreadMult: 4.0,
} as const;
