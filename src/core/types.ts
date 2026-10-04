// Data model for a figure document.
//
// World units match plinth: one floor tile is 1×1, one level is 1 unit tall.
// A figure's height class is its height in levels — child 1, adult 2, tall 3 —
// so a mannequin stands correctly against plinth blocks at the same tile size.

export type HeightClass = 'child' | 'adult' | 'tall';
export type Build = 'thin' | 'regular' | 'wide';

/** Direction order and naming match the guides: 0 S … 7 SE, clockwise on screen. */
export const DIRECTIONS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'] as const;
export type DirectionName = (typeof DIRECTIONS)[number];
export type DirectionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface FigureShape {
  heightClass: HeightClass;
  build: Build;
  /** Height in levels. Defaults from the class (1 / 2 / 3) but can be fine-tuned. */
  heightLevels: number;
  /** Multipliers around the class/build defaults (1 = default). */
  headScale: number;
  shoulderScale: number;
  hipScale: number;
  limbScale: number;
  legScale: number;
  armScale: number;
}

export interface ProjectionSettings {
  /** Same meaning as plinth: tile diamond width; tile height is half. */
  tileWidthPixels: number;
  /** Pixels per level of height. */
  levelHeightPixels: number;
}

export type ColourMode = 'guide' | 'grey';
export type OutlineMode = 'outside' | 'inside' | 'none';
export type OutlineScope = 'silhouette' | 'parts';

export interface LookSettings {
  /** 'guide' = the colour-coded guide look (right limbs warm, left cool); 'grey' = value only. */
  colourMode: ColourMode;
  /** Value bands for the light (3–6). */
  bands: number;
  /** Face patch, eyes and chest centre-line so facing reads at a glance. */
  facingMarkers: boolean;
  outline: OutlineMode;
  outlineScope: OutlineScope;
  shadow: boolean;
  /** The floor tile diamond under the feet (exported as its own, hidden-by-default layer). */
  tileGuide: boolean;
}

export type FrameFit = 'shared' | 'per-animation' | 'custom';

export interface FrameSettings {
  fit: FrameFit;
  /** Used when fit = custom. Anchor is bottom-centre. */
  width: number;
  height: number;
  /** Empty pixels around the auto-fitted figure. */
  padding: number;
}

export interface AnimationSettings {
  include: boolean;
  frames: number;
  /** Frames per second (decimals allowed: 3.5 fps ≈ 286 ms). */
  fps: number;
  loop: boolean;
  /** Scales every pose's departure from rest: 0.5 = subtle, 1.5 = broad. */
  intensity: number;
}

export interface FigureDocument {
  version: 1;
  name: string;
  shape: FigureShape;
  projection: ProjectionSettings;
  look: LookSettings;
  frame: FrameSettings;
  animations: Record<string, AnimationSettings>;
}

export const DEFAULT_PROJECTION: ProjectionSettings = { tileWidthPixels: 32, levelHeightPixels: 16 };

export const DEFAULT_LOOK: LookSettings = {
  colourMode: 'guide',
  bands: 4,
  facingMarkers: true,
  outline: 'outside',
  outlineScope: 'parts',
  shadow: true,
  tileGuide: false,
};

export const DEFAULT_FRAME: FrameSettings = { fit: 'per-animation', width: 48, height: 64, padding: 1 };

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
