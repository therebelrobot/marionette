// Export bundles. Pure: the PNG encoder is injected (canvas in the browser,
// zlib in tests), so the same code builds every file in both places.
//
// Bundle layout mirrors the guides zip so existing references keep working:
//   walk_frames/0_S_walk_0.png        single frames
//   walk_strips/0_S_walk_strip.png    one row per direction
//   procreate/walk/0_S_walk.psd       frames as groups → Animation Assist
//   sheets/walk_sheet.png + .json     rows = directions, columns = frames
//   previews/walk_8way.gif, walk_S.gif
//   figure.json                       settings, timing, anchors

import { ANIMATION_BY_KEY, frameLabel } from './animations';
import { blit, composeFrame, composeFrameLayers, upscale } from './compose';
import { encodeGif } from './gif';
import { encodePsd, type PsdGroup } from './psd';
import { cachedLayout, figureContext, renderBuffers, settingsFor, type FigureContext } from './pipeline';
import { DIRECTIONS, type DirectionIndex, type FigureDocument } from './types';
import type { ZipEntry } from './zip';

export type PngEncoder = (rgba: Uint8ClampedArray, width: number, height: number) => Promise<Uint8Array>;
export type ExportFormat = 'psd' | 'sheet' | 'frames' | 'gif';

export interface ExportRequest {
  animations: string[];
  directions: DirectionIndex[];
  scale: number;
  formats: ExportFormat[];
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure';
}

const directionTag = (direction: DirectionIndex) => `${direction}_${DIRECTIONS[direction]}`;

/** Frames of one animation in one direction as flat RGBA (1×). */
function framesFor(context: FigureContext, key: string, direction: DirectionIndex): Uint8ClampedArray[] {
  const settings = settingsFor(context.document, key);
  return Array.from({ length: settings.frames }, (_, frame) =>
    composeFrame(renderBuffers(context, key, frame, direction), context.document.look, { includeTile: context.document.look.tileGuide }));
}

/** Procreate animation PSD: one closed group per frame, part layers inside. */
export function animationPsd(context: FigureContext, key: string, direction: DirectionIndex, scale: number): Uint8Array {
  const layout = cachedLayout(context, key);
  const settings = settingsFor(context.document, key);
  const definition = ANIMATION_BY_KEY.get(key)!;
  const groups: PsdGroup[] = [];
  let composite: Uint8ClampedArray | undefined;
  for (let frame = 0; frame < settings.frames; frame++) {
    const buffers = renderBuffers(context, key, frame, direction);
    const label = frameLabel(definition, frame, settings.frames, settings.loop);
    groups.push({
      name: `Frame ${frame + 1}${label ? ` - ${label}` : ''}`,
      children: composeFrameLayers(buffers, context.document.look).map((layer) => ({
        ...layer, rgba: upscale(layer.rgba, layout.width, layout.height, scale),
      })),
    });
    if (frame === 0) composite = upscale(composeFrame(buffers, context.document.look), layout.width, layout.height, scale);
  }
  return encodePsd(layout.width * scale, layout.height * scale, groups, { composite });
}

/** Single frame, flat layers (no groups) — for painting one key pose. */
export function framePsd(context: FigureContext, key: string, frame: number, direction: DirectionIndex, scale: number): Uint8Array {
  const layout = cachedLayout(context, key);
  const layers = composeFrameLayers(renderBuffers(context, key, frame, direction), context.document.look)
    .map((layer) => ({ ...layer, rgba: upscale(layer.rgba, layout.width, layout.height, scale) }));
  return encodePsd(layout.width * scale, layout.height * scale, layers);
}

export function animationGif(context: FigureContext, key: string, directions: DirectionIndex[] | 'compass', scale: number): Uint8Array {
  const layout = cachedLayout(context, key);
  const settings = settingsFor(context.document, key);
  const matte = [245, 242, 236] as const;
  if (directions === 'compass') {
    // 3×3: NW N NE / W · E / SW S SE
    const cells: (DirectionIndex | null)[] = [3, 4, 5, 2, null, 6, 1, 0, 7];
    const width = layout.width * 3, height = layout.height * 3;
    const perDirection = new Map<DirectionIndex, Uint8ClampedArray[]>();
    for (const cell of cells) if (cell !== null) perDirection.set(cell, framesFor(context, key, cell));
    const frames = Array.from({ length: settings.frames }, (_, frame) => {
      const sheet = new Uint8ClampedArray(width * height * 4);
      cells.forEach((cell, index) => {
        if (cell === null) return;
        blit(sheet, width, perDirection.get(cell)![frame], layout.width, layout.height, (index % 3) * layout.width, Math.floor(index / 3) * layout.height);
      });
      return upscale(sheet, width, height, scale);
    });
    return encodeGif(width * scale, height * scale, frames, { frameDuration: 1 / settings.fps, loop: true, matte });
  }
  const direction = directions[0];
  const frames = framesFor(context, key, direction).map((frame) => upscale(frame, layout.width, layout.height, scale));
  return encodeGif(layout.width * scale, layout.height * scale, frames, { frameDuration: 1 / settings.fps, loop: true, matte });
}

export interface SheetMetadata {
  animation: string;
  frameWidth: number;
  frameHeight: number;
  anchorX: number;
  anchorY: number;
  frames: number;
  fps: number;
  frameDurationMs: number;
  loop: boolean;
  scale: number;
  rows: { direction: string; index: number }[];
  frameLabels: (string | null)[];
}

export async function buildExport(document: FigureDocument, request: ExportRequest, encodePng: PngEncoder): Promise<ZipEntry[]> {
  const context = figureContext(document);
  const entries: ZipEntry[] = [];
  const { scale } = request;
  const metadata: Record<string, SheetMetadata> = {};

  for (const key of request.animations) {
    const definition = ANIMATION_BY_KEY.get(key);
    if (!definition) continue;
    const settings = settingsFor(document, key);
    const layout = cachedLayout(context, key);
    const frameWidth = layout.width * scale, frameHeight = layout.height * scale;
    const labels = Array.from({ length: settings.frames }, (_, frame) => frameLabel(definition, frame, settings.frames, settings.loop) ?? null);
    metadata[key] = {
      animation: key,
      frameWidth, frameHeight,
      anchorX: layout.anchorX * scale, anchorY: layout.anchorY * scale,
      frames: settings.frames, fps: settings.fps, frameDurationMs: Math.round(1000 / settings.fps), loop: settings.loop,
      scale,
      rows: request.directions.map((direction) => ({ direction: DIRECTIONS[direction], index: direction })),
      frameLabels: labels,
    };

    const perDirection = new Map<DirectionIndex, Uint8ClampedArray[]>();
    for (const direction of request.directions) {
      perDirection.set(direction, framesFor(context, key, direction).map((frame) => upscale(frame, layout.width, layout.height, scale)));
    }

    if (request.formats.includes('frames')) {
      for (const direction of request.directions) {
        const frames = perDirection.get(direction)!;
        for (let frame = 0; frame < frames.length; frame++) {
          entries.push({ name: `${key}_frames/${directionTag(direction)}_${key}_${frame}.png`, data: await encodePng(frames[frame], frameWidth, frameHeight) });
        }
        const stripWidth = frameWidth * frames.length;
        const strip = new Uint8ClampedArray(stripWidth * frameHeight * 4);
        frames.forEach((frame, index) => blit(strip, stripWidth, frame, frameWidth, frameHeight, index * frameWidth, 0));
        entries.push({ name: `${key}_strips/${directionTag(direction)}_${key}_strip.png`, data: await encodePng(strip, stripWidth, frameHeight) });
      }
    }

    if (request.formats.includes('sheet')) {
      const sheetWidth = frameWidth * settings.frames, sheetHeight = frameHeight * request.directions.length;
      const sheet = new Uint8ClampedArray(sheetWidth * sheetHeight * 4);
      request.directions.forEach((direction, row) => {
        perDirection.get(direction)!.forEach((frame, column) => blit(sheet, sheetWidth, frame, frameWidth, frameHeight, column * frameWidth, row * frameHeight));
      });
      entries.push({ name: `sheets/${key}_sheet.png`, data: await encodePng(sheet, sheetWidth, sheetHeight) });
      entries.push({ name: `sheets/${key}_sheet.json`, data: new TextEncoder().encode(JSON.stringify(metadata[key], null, 2)) });
    }

    if (request.formats.includes('psd')) {
      for (const direction of request.directions) {
        entries.push({ name: `procreate/${key}/${directionTag(direction)}_${key}.psd`, data: animationPsd(context, key, direction, scale) });
      }
    }

    if (request.formats.includes('gif')) {
      const previewScale = Math.max(scale, 3);
      if (request.directions.length === 8) entries.push({ name: `previews/${key}_8way.gif`, data: animationGif(context, key, 'compass', previewScale) });
      for (const direction of request.directions) {
        entries.push({ name: `previews/${key}_${DIRECTIONS[direction]}.gif`, data: animationGif(context, key, [direction], previewScale) });
      }
    }
  }

  entries.push({
    name: 'figure.json',
    data: new TextEncoder().encode(JSON.stringify({
      name: document.name,
      shape: document.shape,
      projection: document.projection,
      note: 'Anchor = the tile centre at ground level, measured from the frame’s top-left (pixels, at this export scale). Directions: 0 S … 7 SE, clockwise on screen.',
      animations: metadata,
    }, null, 2)),
  });
  return entries;
}
