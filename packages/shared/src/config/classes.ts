import type { WeaponId } from './weapons';

/** Classes (GAME.md 5). M1 ships Assault only; the rest arrive in M2. */
export type ClassId = 'assault';

export interface ClassDef {
  id: ClassId;
  hp: number;
  speedMult: number;
  primary: WeaponId;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: { id: 'assault', hp: 100, speedMult: 1.0, primary: 'ar1' },
};

export const ENABLED_CLASSES: readonly ClassId[] = ['assault'];
export const DEFAULT_CLASS: ClassId = 'assault';
