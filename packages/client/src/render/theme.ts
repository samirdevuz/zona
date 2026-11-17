import type { MapTheme } from '@zona/shared';

/** Colours of one map theme (terrain, sky, fog, lights). Visual only: layout and colliders are shared. */
export interface ThemePalette {
  grassLo: number;
  grassHi: number;
  dry: number;
  dirt: number;
  road: number;
  rock: number;
  zone: number;
  ridge: number;
  skyTop: number;
  skyHorizon: number;
  skyGround: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunIntensity: number;
  /** Minimap terrain tint: low and high ground. */
  mapLo: number;
  mapHi: number;
}

export const THEMES: Record<MapTheme, ThemePalette> = {
  summer: {
    grassLo: 0x5f8a35,
    grassHi: 0x86a64a,
    dry: 0xa7a25a,
    dirt: 0x9a7b52,
    road: 0xb09464,
    rock: 0x8a857c,
    zone: 0xbfae82,
    ridge: 0x7a8f50,
    skyTop: 0x5b8fd6,
    skyHorizon: 0xcfe0ee,
    skyGround: 0x9fb2a0,
    fog: 0xc8d9e6,
    hemiSky: 0xd6e8ff,
    hemiGround: 0x6b5a3a,
    sun: 0xfff0d0,
    sunIntensity: 2.3,
    mapLo: 0x465f37,
    mapHi: 0x82966e,
  },
  autumn: {
    grassLo: 0x667a32,
    grassHi: 0x8c8c40,
    dry: 0x9c7a3e,
    dirt: 0x86613f,
    road: 0xa9895c,
    rock: 0x86807a,
    zone: 0xbba27a,
    ridge: 0x8a7a48,
    skyTop: 0x6f8fc4,
    skyHorizon: 0xe6d9c4,
    skyGround: 0xa89a80,
    fog: 0xddd2bf,
    hemiSky: 0xf0e2c8,
    hemiGround: 0x6b5232,
    sun: 0xffd9a8,
    sunIntensity: 2.1,
    mapLo: 0x6a6436,
    mapHi: 0x9c8a5c,
  },
  winter: {
    grassLo: 0xdfe6ec,
    grassHi: 0xf3f6f8,
    dry: 0xc9d3dc,
    dirt: 0x9a948c,
    road: 0xb8b2aa,
    rock: 0x8c8f96,
    zone: 0xd8d2c6,
    ridge: 0xc4ccd4,
    skyTop: 0x7f9fc8,
    skyHorizon: 0xe4ebf2,
    skyGround: 0xc8d0d8,
    fog: 0xdfe6ee,
    hemiSky: 0xe6f0ff,
    hemiGround: 0x8a8f99,
    sun: 0xfff4e8,
    sunIntensity: 1.8,
    mapLo: 0xb7c2cc,
    mapHi: 0xeef2f6,
  },
  desert: {
    grassLo: 0xc9a46a,
    grassHi: 0xdcbc82,
    dry: 0xd4b278,
    dirt: 0xb48a58,
    road: 0xbf9a68,
    rock: 0xa98a6a,
    zone: 0xd9c49a,
    ridge: 0xbf9c68,
    skyTop: 0x4f86d0,
    skyHorizon: 0xeadfc8,
    skyGround: 0xcbb48c,
    fog: 0xe8dcc4,
    hemiSky: 0xfff0d8,
    hemiGround: 0x8a6a42,
    sun: 0xffe6b8,
    sunIntensity: 2.6,
    mapLo: 0xa6844f,
    mapHi: 0xe0c48f,
  },
};

export const themePalette = (t: MapTheme | undefined): ThemePalette => THEMES[t ?? 'summer'] ?? THEMES.summer;
