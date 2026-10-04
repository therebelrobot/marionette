// Document → frames. One place that knows how to go from settings to pixels,
// shared by the editor preview and every exporter.

import { ANIMATION_BY_KEY, ANIMATIONS, frameTime, samplePose, type AnimationDefinition } from './animations';
import { composeFrame, composeFrameLayers, type FrameLayer } from './compose';
import { bodyDimensions, type BodyDimensions } from './proportions';
import { makeProjection, primitiveExtents, renderFrame, type FrameBuffers, type FrameLayout, type Projection } from './render';
import { PART_GROUP, poseFigure, type PosedFigure } from './skeleton';
import { DIRECTIONS, type AnimationSettings, type DirectionIndex, type FigureDocument } from './types';

export interface FigureContext {
  document: FigureDocument;
  dimensions: BodyDimensions;
  projection: Projection;
}

export function figureContext(document: FigureDocument): FigureContext {
  return { document, dimensions: bodyDimensions(document.shape, document.projection), projection: makeProjection(document.projection) };
}

export function settingsFor(document: FigureDocument, key: string): AnimationSettings {
  const definition = ANIMATION_BY_KEY.get(key)!;
  return document.animations[key] ?? { ...definition.defaults, include: true, intensity: 1 };
}

export function posedFrame(context: FigureContext, key: string, frameIndex: number, direction: DirectionIndex): PosedFigure {
  const definition = ANIMATION_BY_KEY.get(key)!;
  const settings = settingsFor(context.document, key);
  const t = frameTime(frameIndex, settings.frames, settings.loop);
  return poseFigure(context.dimensions, samplePose(definition, t, settings.loop, settings.intensity), direction);
}

// ── Frame fitting ───────────────────────────────────────────────────────────

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

function figureBounds(context: FigureContext, posed: PosedFigure, bounds: Bounds): void {
  const { projection } = context;
  for (const primitive of posed.primitives) {
    const [minX, maxX, minY, maxY] = primitiveExtents(projection, primitive);
    bounds.minX = Math.min(bounds.minX, minX); bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.minY = Math.min(bounds.minY, minY); bounds.maxY = Math.max(bounds.maxY, maxY);
  }
  if (context.document.look.shadow) {
    const centreX = (posed.groundCenter[0] - posed.groundCenter[1]) * projection.halfTile;
    const centreY = (posed.groundCenter[0] + posed.groundCenter[1]) * projection.quarterTile;
    bounds.minX = Math.min(bounds.minX, centreX - posed.shadowRadius * Math.SQRT2 * projection.halfTile);
    bounds.maxX = Math.max(bounds.maxX, centreX + posed.shadowRadius * Math.SQRT2 * projection.halfTile);
    bounds.maxY = Math.max(bounds.maxY, centreY + posed.shadowRadius * Math.SQRT2 * projection.quarterTile);
  }
}

/** Animations whose frames decide the shared frame size. */
export function includedAnimations(document: FigureDocument): AnimationDefinition[] {
  return ANIMATIONS.filter((definition) => settingsFor(document, definition.key).include);
}

/**
 * Frame size and anchor. 'shared' fits every included animation (one cell
 * size for the whole character — what most engines want); 'per-animation'
 * fits just this one; 'custom' uses the given size, anchored bottom-centre.
 * The frame is always at least one tile wide and holds the tile diamond, so
 * frames line up with plinth scenes.
 */
export function frameLayout(context: FigureContext, key: string): FrameLayout {
  const { document, projection } = context;
  const padding = Math.max(document.look.outline === 'outside' ? 1 : 0, document.frame.padding);
  const tileBottom = Math.ceil(projection.quarterTile) + 1;
  if (document.frame.fit === 'custom') {
    const width = Math.max(2, Math.round(document.frame.width / 2) * 2);
    return { width, height: document.frame.height, anchorX: width / 2, anchorY: document.frame.height - tileBottom };
  }
  const keys = document.frame.fit === 'shared' ? includedAnimations(document).map((definition) => definition.key) : [key];
  if (!keys.includes(key)) keys.push(key);
  const bounds: Bounds = { minX: -projection.halfTile, maxX: projection.halfTile, minY: -projection.quarterTile, maxY: projection.quarterTile };
  for (const animationKey of keys) {
    const settings = settingsFor(document, animationKey);
    for (let frame = 0; frame < settings.frames; frame++) {
      for (let direction = 0; direction < DIRECTIONS.length; direction++) {
        figureBounds(context, posedFrame(context, animationKey, frame, direction as DirectionIndex), bounds);
      }
    }
  }
  const halfWidth = Math.ceil(Math.max(-bounds.minX, bounds.maxX)) + padding;
  const top = Math.ceil(-bounds.minY) + padding;
  const bottom = Math.max(Math.ceil(bounds.maxY), tileBottom - 1) + padding;
  return { width: halfWidth * 2, height: top + bottom, anchorX: halfWidth, anchorY: top };
}

const layoutCache = new WeakMap<FigureDocument, Map<string, FrameLayout>>();
export function cachedLayout(context: FigureContext, key: string): FrameLayout {
  let perDocument = layoutCache.get(context.document);
  if (!perDocument) { perDocument = new Map(); layoutCache.set(context.document, perDocument); }
  const cacheKey = context.document.frame.fit === 'shared' ? '*' : key;
  let layout = perDocument.get(cacheKey);
  if (!layout) { layout = frameLayout(context, key); perDocument.set(cacheKey, layout); }
  return layout;
}

// ── Render ──────────────────────────────────────────────────────────────────

export function renderBuffers(context: FigureContext, key: string, frameIndex: number, direction: DirectionIndex, layout = cachedLayout(context, key)): FrameBuffers {
  const look = context.document.look;
  return renderFrame(posedFrame(context, key, frameIndex, direction), layout, context.projection, {
    markers: look.facingMarkers,
    shadow: look.shadow,
    tileGuide: look.tileGuide,
    outline: look.outline,
    outlineScope: look.outlineScope,
    partGroups: PART_GROUP,
    pixel: context.dimensions.pixel,
  });
}

export function renderImage(context: FigureContext, key: string, frameIndex: number, direction: DirectionIndex, includeTile = context.document.look.tileGuide): { rgba: Uint8ClampedArray; width: number; height: number } {
  const buffers = renderBuffers(context, key, frameIndex, direction);
  return { rgba: composeFrame(buffers, context.document.look, { includeTile }), width: buffers.width, height: buffers.height };
}

export function renderLayers(context: FigureContext, key: string, frameIndex: number, direction: DirectionIndex): { layers: FrameLayer[]; width: number; height: number } {
  const buffers = renderBuffers(context, key, frameIndex, direction);
  return { layers: composeFrameLayers(buffers, context.document.look), width: buffers.width, height: buffers.height };
}
