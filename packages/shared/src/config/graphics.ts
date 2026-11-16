/** Graphics quality presets and budgets (GAME.md 13). */
export type GraphicsPresetId = 'low' | 'medium' | 'high';

export interface GraphicsPreset {
  id: GraphicsPresetId;
  maxDrawCalls: number;
  maxTriangles: number;
  fogFar: number;
  shadowMapSize: number;
  shadowRange: number;
  pixelRatioCap: number;
  antialias: boolean;
  dynamicLights: number;
  blobShadows: boolean;
}

export const GRAPHICS_PRESETS: Record<GraphicsPresetId, GraphicsPreset> = {
  low: { id: 'low', maxDrawCalls: 150, maxTriangles: 150_000, fogFar: 220, shadowMapSize: 0, shadowRange: 0, pixelRatioCap: 1.0, antialias: false, dynamicLights: 0, blobShadows: true },
  medium: { id: 'medium', maxDrawCalls: 250, maxTriangles: 300_000, fogFar: 320, shadowMapSize: 1024, shadowRange: 60, pixelRatioCap: 1.25, antialias: false, dynamicLights: 1, blobShadows: false },
  high: { id: 'high', maxDrawCalls: 400, maxTriangles: 600_000, fogFar: 450, shadowMapSize: 2048, shadowRange: 100, pixelRatioCap: 2.0, antialias: true, dynamicLights: 3, blobShadows: false },
};

export const GRAPHICS = {
  defaultPreset: 'low' as GraphicsPresetId,
  renderScaleMin: 0.5,
  renderScaleMax: 1.0,
  /** Suggest a lower preset when average FPS stays below this for suggestAfterS. */
  lowFpsThreshold: 40,
  suggestAfterS: 5,
  fogNearFactor: 0.35,
  fovMin: 70,
  fovMax: 110,
  fovDefault: 90,
  viewmodelFov: 60,
} as const;
