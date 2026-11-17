import type { WeaponId } from './weapons';

/** Classes (GAME.md 5). */
export type ClassId = 'assault' | 'engineer' | 'gunner' | 'sniper';
export const CLASS_IDS: readonly ClassId[] = ['assault', 'engineer', 'gunner', 'sniper'];

/** Everything a slot can hold. */
export type ItemId = WeaponId | 'medpack' | 'ammobox' | 'grenade' | 'torch' | 'none';

export interface ClassDef {
  id: ClassId;
  hp: number;
  speedMult: number;
  /** Slots 1..4: primary, pistol, gadget A, gadget B. */
  slots: readonly [WeaponId, WeaponId, ItemId, ItemId];
  /** Has the G quick-grenade (Assault only). */
  quickGrenade: boolean;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: { id: 'assault', hp: 100, speedMult: 1.0, slots: ['ar1', 'pistol', 'medpack', 'grenade'], quickGrenade: true },
  engineer: { id: 'engineer', hp: 100, speedMult: 1.0, slots: ['smg1', 'pistol', 'torch', 'rocket'], quickGrenade: false },
  gunner: { id: 'gunner', hp: 120, speedMult: 0.88, slots: ['lmg1', 'pistol', 'ammobox', 'none'], quickGrenade: false },
  sniper: { id: 'sniper', hp: 85, speedMult: 1.0, slots: ['bolt1', 'pistol', 'none', 'none'], quickGrenade: false },
};

export const ENABLED_CLASSES: readonly ClassId[] = CLASS_IDS;
export const DEFAULT_CLASS: ClassId = 'assault';
