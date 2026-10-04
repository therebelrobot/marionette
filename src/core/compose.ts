// Frame buffers → pixels: colour per part/region, banded light, lines, shadow.
// Also splits a frame into Procreate layers (one per limb group).

import { NO_PART, Region, type FrameBuffers } from './render';
import { PART_GROUP, type PartGroup } from './skeleton';
import type { LookSettings } from './types';

type RGB = readonly [number, number, number];

// Guide palette — the colour-coding of the reference guides: character's
// right side warm, left side cool, so you always know which leg is which.
const GUIDE = {
  chest: [150, 146, 168], stripe: [226, 222, 236], pelvis: [122, 118, 142],
  neck: [232, 204, 176], face: [232, 204, 176], hair: [96, 76, 112], eye: [34, 28, 44],
  rightLimb: [204, 112, 74], rightHand: [228, 125, 82], rightFoot: [153, 84, 55],
  leftLimb: [78, 168, 154], leftHand: [96, 186, 170], leftFoot: [52, 112, 103],
} satisfies Record<string, RGB>;

// Value-only palette: right limbs lighter than left so sides still separate.
const GREY = {
  chest: [170, 170, 170], stripe: [226, 226, 226], pelvis: [138, 138, 138],
  neck: [206, 206, 206], face: [212, 212, 212], hair: [104, 104, 104], eye: [40, 40, 40],
  rightLimb: [192, 192, 192], rightHand: [214, 214, 214], rightFoot: [150, 150, 150],
  leftLimb: [124, 124, 124], leftHand: [146, 146, 146], leftFoot: [92, 92, 92],
} satisfies Record<string, RGB>;

export const LINE_COLOUR: RGB = [34, 28, 44];
const SHADOW_RGBA = [0, 0, 0, 70] as const;
const TILE_RGBA = [0, 0, 0, 96] as const;

// Same light as plinth: upper-left-front.
const LIGHT = (() => {
  const x = 0.35, y = 0.7, z = 1;
  const magnitude = Math.hypot(x, y, z);
  return [x / magnitude, y / magnitude, z / magnitude] as const;
})();

function baseColour(part: number, region: number, look: LookSettings): RGB {
  const palette = look.colourMode === 'guide' ? GUIDE : GREY;
  if (region === Region.Eye) return palette.eye;
  if (region === Region.Face) return palette.face;
  if (region === Region.Stripe) return palette.stripe;
  switch (part) {
    case 0: return palette.pelvis;
    case 1: return palette.chest;
    case 2: return palette.neck;
    case 3: return look.facingMarkers ? palette.hair : palette.face;
    case 4: case 5: return palette.rightLimb;
    case 6: return palette.rightHand;
    case 7: case 8: return palette.leftLimb;
    case 9: return palette.leftHand;
    case 10: case 11: return palette.rightLimb;
    case 12: return palette.rightFoot;
    case 13: case 14: return palette.leftLimb;
    case 15: return palette.leftFoot;
    default: return palette.chest;
  }
}

function shade(buffers: FrameBuffers, index: number, bands: number): number {
  const lambert = buffers.normalX[index] * LIGHT[0] + buffers.normalY[index] * LIGHT[1] + buffers.normalZ[index] * LIGHT[2];
  const band = Math.min(bands - 1, Math.max(0, Math.floor(lambert * bands)));
  return 0.64 + 0.46 * (bands > 1 ? band / (bands - 1) : 1);
}

function writeRgba(target: Uint8ClampedArray, index: number, red: number, green: number, blue: number, alpha = 255): void {
  const offset = index * 4;
  target[offset] = red; target[offset + 1] = green; target[offset + 2] = blue; target[offset + 3] = alpha;
}

function figureColour(buffers: FrameBuffers, index: number, look: LookSettings): RGB {
  const part = buffers.part[index];
  const region = buffers.region[index];
  const colour = baseColour(part, region, look);
  if (region === Region.Eye) return colour;
  const factor = shade(buffers, index, look.bands);
  return [colour[0] * factor, colour[1] * factor, colour[2] * factor];
}

export interface ComposeOptions {
  /** Draw the tile diamond into the flat image (layers always carry it). */
  includeTile?: boolean;
  /** Ghost of another frame drawn underneath (editor onion skin). */
  onion?: Uint8ClampedArray;
}

/** Flattened RGBA frame. */
export function composeFrame(buffers: FrameBuffers, look: LookSettings, options: ComposeOptions = {}): Uint8ClampedArray {
  const size = buffers.width * buffers.height;
  const rgba = new Uint8ClampedArray(size * 4);
  for (let index = 0; index < size; index++) {
    if (options.onion && options.onion[index * 4 + 3]) {
      writeRgba(rgba, index, options.onion[index * 4], options.onion[index * 4 + 1], options.onion[index * 4 + 2], 70);
    }
    if (options.includeTile && buffers.tile[index]) writeRgba(rgba, index, TILE_RGBA[0], TILE_RGBA[1], TILE_RGBA[2], TILE_RGBA[3]);
    if (buffers.shadow[index] && buffers.part[index] === NO_PART) {
      // Shadow over tile line: the darker of the two.
      const alpha = Math.max(rgba[index * 4 + 3], SHADOW_RGBA[3]);
      writeRgba(rgba, index, 0, 0, 0, alpha);
    }
    if (buffers.part[index] !== NO_PART) {
      const [red, green, blue] = figureColour(buffers, index, look);
      writeRgba(rgba, index, red, green, blue);
    }
    if (buffers.outline[index]) writeRgba(rgba, index, LINE_COLOUR[0], LINE_COLOUR[1], LINE_COLOUR[2]);
  }
  return rgba;
}

export interface FrameLayer {
  name: string;
  rgba: Uint8ClampedArray;
  hidden?: boolean;
}

const GROUP_LAYERS: { group: PartGroup; name: string }[] = [
  { group: 'leftLeg', name: 'Left leg' },
  { group: 'rightLeg', name: 'Right leg' },
  { group: 'leftArm', name: 'Left arm' },
  { group: 'rightArm', name: 'Right arm' },
  { group: 'body', name: 'Body' },
  { group: 'head', name: 'Head' },
];

/**
 * Layers bottom → top. Each limb layer holds only the pixels that limb won in
 * the z-buffer, so layers never overlap and their order can't break occlusion.
 */
export function composeFrameLayers(buffers: FrameBuffers, look: LookSettings): FrameLayer[] {
  const size = buffers.width * buffers.height;
  const make = () => new Uint8ClampedArray(size * 4);
  const tile = make(), shadow = make(), lines = make();
  const groups = new Map<PartGroup, Uint8ClampedArray>(GROUP_LAYERS.map(({ group }) => [group, make()]));
  for (let index = 0; index < size; index++) {
    if (buffers.tile[index]) writeRgba(tile, index, TILE_RGBA[0], TILE_RGBA[1], TILE_RGBA[2], TILE_RGBA[3]);
    if (buffers.shadow[index]) writeRgba(shadow, index, SHADOW_RGBA[0], SHADOW_RGBA[1], SHADOW_RGBA[2], SHADOW_RGBA[3]);
    const part = buffers.part[index];
    if (part !== NO_PART) {
      const [red, green, blue] = figureColour(buffers, index, look);
      writeRgba(groups.get(PART_GROUP[part])!, index, red, green, blue);
    }
    if (buffers.outline[index]) writeRgba(lines, index, LINE_COLOUR[0], LINE_COLOUR[1], LINE_COLOUR[2]);
  }
  const layers: FrameLayer[] = [];
  if (look.tileGuide) layers.push({ name: 'Tile', rgba: tile, hidden: true });
  if (look.shadow) layers.push({ name: 'Shadow', rgba: shadow });
  for (const { group, name } of GROUP_LAYERS) layers.push({ name, rgba: groups.get(group)! });
  if (look.outline !== 'none') layers.push({ name: 'Lines', rgba: lines });
  return layers;
}

/** Nearest-neighbour integer upscale. */
export function upscale(rgba: Uint8ClampedArray, width: number, height: number, factor: number): Uint8ClampedArray {
  if (factor === 1) return rgba;
  const scaledWidth = width * factor;
  const output = new Uint8ClampedArray(scaledWidth * height * factor * 4);
  const source = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const target = new Uint32Array(output.buffer);
  for (let y = 0; y < height * factor; y++) {
    const sourceRow = Math.floor(y / factor) * width;
    for (let x = 0; x < scaledWidth; x++) target[y * scaledWidth + x] = source[sourceRow + Math.floor(x / factor)];
  }
  return output;
}

/** Paste a frame into a larger sheet at (left, top). */
export function blit(target: Uint8ClampedArray, targetWidth: number, source: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, left: number, top: number): void {
  for (let y = 0; y < sourceHeight; y++) {
    target.set(source.subarray(y * sourceWidth * 4, (y + 1) * sourceWidth * 4), ((top + y) * targetWidth + left) * 4);
  }
}
