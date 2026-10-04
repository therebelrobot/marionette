// Body measurements from height class + build, in world units (levels).
//
// The class sets total height and the head count (how many head-heights tall
// the figure is): children have big heads and short legs, tall figures are
// leggier. Build scales widths and limb thickness. Everything is then nudged
// by the per-figure multipliers.

import type { Build, FigureShape, HeightClass, ProjectionSettings } from './types';

interface ClassProfile {
  heightLevels: number;
  headsTall: number;
  /** Hip-joint height as a fraction of total height. */
  legFraction: number;
  /** Shoulder width in head widths. */
  shoulderHeads: number;
  /** Limb radius as a fraction of total height. */
  limbFraction: number;
  /** Foot length as a fraction of total height. */
  footFraction: number;
}

export const CLASS_PROFILES: Record<HeightClass, ClassProfile> = {
  // Head counts are pixel-art stylised (the guides are ~4 heads tall); the Head
  // slider pulls toward realistic proportions (~6–7.5 heads) when wanted.
  child: { heightLevels: 1, headsTall: 3.1, legFraction: 0.36, shoulderHeads: 1.2, limbFraction: 0.06, footFraction: 0.12 },
  adult: { heightLevels: 2, headsTall: 4.3, legFraction: 0.45, shoulderHeads: 1.32, limbFraction: 0.04, footFraction: 0.1 },
  tall: { heightLevels: 3, headsTall: 5.4, legFraction: 0.49, shoulderHeads: 1.5, limbFraction: 0.032, footFraction: 0.09 },
};

interface BuildProfile { width: number; depth: number; limb: number; hip: number }

export const BUILD_PROFILES: Record<Build, BuildProfile> = {
  thin: { width: 0.82, depth: 0.82, limb: 0.78, hip: 0.86 },
  regular: { width: 1, depth: 1, limb: 1, hip: 1 },
  wide: { width: 1.32, depth: 1.4, limb: 1.3, hip: 1.28 },
};

export function defaultShape(heightClass: HeightClass = 'adult', build: Build = 'regular'): FigureShape {
  return {
    heightClass,
    build,
    heightLevels: CLASS_PROFILES[heightClass].heightLevels,
    headScale: 1,
    shoulderScale: 1,
    hipScale: 1,
    limbScale: 1,
    legScale: 1,
    armScale: 1,
  };
}

export interface BodyDimensions {
  height: number;
  headHeight: number;
  headWidth: number;
  headDepth: number;
  neckLength: number;
  neckRadius: number;
  shoulderHeight: number;
  hipHeight: number;
  chestWidth: number;
  chestDepth: number;
  chestHeight: number;
  pelvisWidth: number;
  pelvisDepth: number;
  pelvisHeight: number;
  /** Lateral offset of each shoulder / hip joint from the midline. */
  shoulderOffset: number;
  hipOffset: number;
  upperArmLength: number;
  forearmLength: number;
  upperArmRadius: number;
  forearmRadius: number;
  handRadius: number;
  thighLength: number;
  shinLength: number;
  thighRadius: number;
  shinRadius: number;
  footLength: number;
  footHeight: number;
  footWidth: number;
  /** One screen pixel in world units (smallest of the horizontal and vertical pixel). */
  pixel: number;
}

export function bodyDimensions(shape: FigureShape, projection: ProjectionSettings): BodyDimensions {
  const profile = CLASS_PROFILES[shape.heightClass];
  const build = BUILD_PROFILES[shape.build];
  const height = shape.heightLevels;
  // A horizontal world unit spans √2·halfTile screen pixels; a vertical one levelHeight.
  const pixel = 1 / Math.max(Math.SQRT2 * (projection.tileWidthPixels / 2), projection.levelHeightPixels);
  const minimumRadius = pixel * 0.95; // never thinner than ~2px across

  const headHeight = (height / profile.headsTall) * shape.headScale;
  const headWidth = headHeight * 0.82;
  const headDepth = headHeight * 0.9;
  const neckLength = headHeight * (shape.heightClass === 'child' ? 0.12 : 0.22);
  const shoulderHeight = height - headHeight - neckLength;
  const hipHeight = Math.min(shoulderHeight - headHeight, height * profile.legFraction * shape.legScale);

  const chestWidth = Math.max(headWidth * profile.shoulderHeads * build.width * shape.shoulderScale, pixel * 4);
  const chestDepth = Math.max(headDepth * 0.72 * build.depth, pixel * 3);
  const torsoSpan = shoulderHeight - hipHeight;
  const chestHeight = torsoSpan * 0.62;
  const pelvisHeight = torsoSpan * 0.5;
  const pelvisWidth = chestWidth * 0.8 * build.hip * shape.hipScale;
  const pelvisDepth = chestDepth * 0.92;

  const limbRadius = Math.max(height * profile.limbFraction * build.limb * shape.limbScale, minimumRadius);
  const upperArmRadius = Math.max(limbRadius * 0.82, minimumRadius);
  const forearmRadius = Math.max(upperArmRadius * 0.9, minimumRadius);
  const thighRadius = Math.max(limbRadius * 1.08, minimumRadius);
  const shinRadius = Math.max(limbRadius * 0.92, minimumRadius);

  const armSpan = torsoSpan * 1.45 * shape.armScale; // fingertips land around mid-thigh
  const upperArmLength = armSpan * 0.47;
  const forearmLength = armSpan * 0.4;
  const handRadius = Math.max(forearmRadius * 1.2, minimumRadius);

  const footHeight = Math.max(height * 0.035, pixel * 1.5);
  const legSpan = hipHeight - footHeight;
  const thighLength = legSpan * 0.5;
  const shinLength = legSpan * 0.5;

  return {
    height,
    headHeight, headWidth, headDepth,
    neckLength, neckRadius: Math.max(headWidth * 0.22, minimumRadius),
    shoulderHeight, hipHeight,
    chestWidth, chestDepth, chestHeight,
    pelvisWidth, pelvisDepth, pelvisHeight,
    shoulderOffset: chestWidth / 2 - upperArmRadius * 0.3,
    hipOffset: Math.max(pelvisWidth / 2 - thighRadius, thighRadius * 0.9),
    upperArmLength, forearmLength, upperArmRadius, forearmRadius, handRadius,
    thighLength, shinLength, thighRadius, shinRadius,
    footLength: Math.max(height * profile.footFraction, pixel * 3),
    footHeight,
    footWidth: Math.max(shinRadius * 2, pixel * 2),
    pixel,
  };
}
