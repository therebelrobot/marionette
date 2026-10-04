// Frame rasteriser: one ray per pixel centre along the iso view direction,
// z-buffered across body parts, exactly as plinth renders blocks. No
// antialiasing — limbs come out as clean pixel shapes.

import { dot, sub, toLocal, toWorld, type Vec3 } from './math';
import { boundingSphere, type PosedFigure, type Primitive } from './skeleton';
import type { ProjectionSettings } from './types';

export const NO_PART = -1;

/** Surface markings that help read facing. */
export const Region = { Base: 0, Face: 1, Eye: 2, Stripe: 3 } as const;

export interface Projection {
  halfTile: number;
  quarterTile: number;
  levelHeight: number;
  /** z of the view direction (1, 1, viewZ). */
  viewZ: number;
}

export function makeProjection(settings: ProjectionSettings): Projection {
  const halfTile = settings.tileWidthPixels / 2;
  return {
    halfTile,
    quarterTile: settings.tileWidthPixels / 4,
    levelHeight: settings.levelHeightPixels,
    viewZ: halfTile / settings.levelHeightPixels,
  };
}

/** Screen offset (from the anchor) of a world point. The anchor is the tile centre at ground level. */
export function projectOffset(projection: Projection, point: Vec3): [number, number] {
  return [
    (point[0] - point[1]) * projection.halfTile,
    (point[0] + point[1]) * projection.quarterTile - point[2] * projection.levelHeight,
  ];
}

export interface FrameLayout {
  width: number;
  height: number;
  /** Pixel boundary where the tile centre sits (integers, so the figure samples symmetrically). */
  anchorX: number;
  anchorY: number;
}

export interface FrameBuffers {
  width: number;
  height: number;
  depth: Float32Array;
  part: Int8Array;
  region: Uint8Array;
  normalX: Float32Array;
  normalY: Float32Array;
  normalZ: Float32Array;
  shadow: Uint8Array;
  tile: Uint8Array;
  outline: Uint8Array;
}

// ── Intersections (largest t = nearest the viewer) ──────────────────────────

interface Hit { t: number; normal: Vec3; region: number }

function intersectEllipsoid(primitive: Extract<Primitive, { kind: 'ellipsoid' }>, origin: Vec3, direction: Vec3, pixel: number, markers: boolean, out: Hit): boolean {
  const { radii, frame } = primitive;
  const localOrigin = toLocal(frame, sub(origin, primitive.center));
  const localDirection = toLocal(frame, direction);
  const o: Vec3 = [localOrigin[0] / radii[0], localOrigin[1] / radii[1], localOrigin[2] / radii[2]];
  const d: Vec3 = [localDirection[0] / radii[0], localDirection[1] / radii[1], localDirection[2] / radii[2]];
  const a = dot(d, d), b = 2 * dot(o, d), c = dot(o, o) - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;
  const t = (-b + Math.sqrt(discriminant)) / (2 * a);
  const p: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  out.t = t;
  out.normal = normalise(toWorld(frame, [p[0] / radii[0], p[1] / radii[1], p[2] / radii[2]]));
  out.region = Region.Base;
  if (markers) {
    // p is on the unit sphere: x right, y forward, z up.
    if (p[1] > 0.28 && p[2] < 0.4 && p[2] > -0.92) out.region = Region.Face;
    // Eyes: one pixel-ish dot each side of centre, a little above the middle.
    const eyeHalfHeight = Math.max(0.16, (pixel * 0.7) / radii[2]);
    const eyeHalfWidth = Math.max(0.14, (pixel * 0.6) / radii[0]);
    if (p[1] > 0.5 && Math.abs(p[2] - 0.08) < eyeHalfHeight && Math.abs(Math.abs(p[0]) - 0.4) < eyeHalfWidth) out.region = Region.Eye;
  }
  return true;
}

function intersectBox(primitive: Extract<Primitive, { kind: 'box' }>, origin: Vec3, direction: Vec3, pixel: number, markers: boolean, isChest: boolean, out: Hit): boolean {
  const { half, frame } = primitive;
  const o = toLocal(frame, sub(origin, primitive.center));
  const d = toLocal(frame, direction);
  let near = -Infinity, far = Infinity, farAxis = 0, farSign = 1;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(d[axis]) < 1e-12) {
      if (Math.abs(o[axis]) > half[axis]) return false;
      continue;
    }
    let low = (-half[axis] - o[axis]) / d[axis];
    let high = (half[axis] - o[axis]) / d[axis];
    let sign = 1;
    if (low > high) { const swap = low; low = high; high = swap; sign = -1; }
    if (low > near) near = low;
    if (high < far) { far = high; farAxis = axis; farSign = sign; }
  }
  if (near > far) return false;
  let exitNormal: Vec3 | null = null;
  if (primitive.rounding && primitive.rounding > 1) {
    // Box ∩ ellipsoid: both convex, so the solid spans [max(nears), min(fars)].
    const radii: Vec3 = [half[0] * primitive.rounding, half[1] * primitive.rounding, half[2] * primitive.rounding];
    const so: Vec3 = [o[0] / radii[0], o[1] / radii[1], o[2] / radii[2]];
    const sd: Vec3 = [d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]];
    const a = dot(sd, sd), b = 2 * dot(so, sd), c = dot(so, so) - 1;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return false;
    const root = Math.sqrt(discriminant);
    const ellipsoidNear = (-b - root) / (2 * a), ellipsoidFar = (-b + root) / (2 * a);
    near = Math.max(near, ellipsoidNear);
    if (ellipsoidFar < far) {
      far = ellipsoidFar;
      const p: Vec3 = [so[0] + far * sd[0], so[1] + far * sd[1], so[2] + far * sd[2]];
      exitNormal = normalise(toWorld(frame, [p[0] / radii[0], p[1] / radii[1], p[2] / radii[2]]));
    }
    if (near > far) return false;
  }
  out.t = far;
  const local: Vec3 = [0, 0, 0];
  local[farAxis] = farSign;
  out.normal = exitNormal ?? toWorld(frame, local);
  out.region = Region.Base;
  if (exitNormal) return true;
  if (markers && isChest && farAxis === 1 && farSign > 0) {
    const x = o[0] + far * d[0];
    if (Math.abs(x) < Math.max(pixel * 0.55, half[0] * 0.08)) out.region = Region.Stripe;
  }
  return true;
}

/**
 * Capsule via Inigo Quilez's ray-capsule test, run backwards from a point past
 * the figure toward the scene so the first hit is the viewer-side surface.
 */
function intersectCapsule(primitive: Extract<Primitive, { kind: 'capsule' }>, origin: Vec3, direction: Vec3, out: Hit): boolean {
  const directionLength = Math.hypot(direction[0], direction[1], direction[2]);
  const rayDirection: Vec3 = [-direction[0] / directionLength, -direction[1] / directionLength, -direction[2] / directionLength];
  const far = 64;
  const rayOrigin: Vec3 = [origin[0] + direction[0] * far, origin[1] + direction[1] * far, origin[2] + direction[2] * far];
  const { a: pa, b: pb, radius } = primitive;
  const ba = sub(pb, pa);
  const oa = sub(rayOrigin, pa);
  const baba = dot(ba, ba), bard = dot(ba, rayDirection), baoa = dot(ba, oa), rdoa = dot(rayDirection, oa), oaoa = dot(oa, oa);
  const a = baba - bard * bard;
  let distance = -1;
  if (a > 1e-12) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - radius * radius * baba;
    const h = b * b - a * c;
    if (h < 0) return false;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) distance = t;
    else {
      const oc = y <= 0 ? oa : sub(rayOrigin, pb);
      const capB = dot(rayDirection, oc), capC = dot(oc, oc) - radius * radius;
      const capH = capB * capB - capC;
      if (capH > 0) distance = -capB - Math.sqrt(capH);
    }
  } else {
    // Ray parallel to the axis: only the end caps can be hit.
    for (const centre of [pa, pb]) {
      const oc = sub(rayOrigin, centre);
      const capB = dot(rayDirection, oc), capC = dot(oc, oc) - radius * radius;
      const capH = capB * capB - capC;
      if (capH > 0) {
        const candidate = -capB - Math.sqrt(capH);
        if (distance < 0 || candidate < distance) distance = candidate;
      }
    }
  }
  if (distance < 0) return false;
  const hit: Vec3 = [rayOrigin[0] + rayDirection[0] * distance, rayOrigin[1] + rayDirection[1] * distance, rayOrigin[2] + rayDirection[2] * distance];
  const along = Math.min(1, Math.max(0, dot(sub(hit, pa), ba) / baba));
  const closest: Vec3 = [pa[0] + ba[0] * along, pa[1] + ba[1] * along, pa[2] + ba[2] * along];
  out.t = far - distance / directionLength;
  out.normal = normalise(sub(hit, closest));
  out.region = Region.Base;
  return true;
}

function normalise(v: Vec3): Vec3 {
  const magnitude = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude];
}

// ── Screen extents ──────────────────────────────────────────────────────────

/** Screen-space bounds (offsets from the anchor) of a primitive. */
export function primitiveExtents(projection: Projection, primitive: Primitive): [number, number, number, number] {
  const horizontal = Math.SQRT2 * projection.halfTile;
  const vertical = Math.sqrt(2 * projection.quarterTile ** 2 + projection.levelHeight ** 2);
  const spheres: { center: Vec3; radius: number }[] =
    primitive.kind === 'capsule'
      ? [{ center: primitive.a, radius: primitive.radius }, { center: primitive.b, radius: primitive.radius }]
      : [boundingSphere(primitive)];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const sphere of spheres) {
    const [x, y] = projectOffset(projection, sphere.center);
    minX = Math.min(minX, x - sphere.radius * horizontal);
    maxX = Math.max(maxX, x + sphere.radius * horizontal);
    minY = Math.min(minY, y - sphere.radius * vertical);
    maxY = Math.max(maxY, y + sphere.radius * vertical);
  }
  return [minX, maxX, minY, maxY];
}

// ── Render ──────────────────────────────────────────────────────────────────

export interface RenderFlags {
  markers: boolean;
  shadow: boolean;
  tileGuide: boolean;
  outline: 'outside' | 'inside' | 'none';
  outlineScope: 'silhouette' | 'parts';
  /** Groups per part index, for part-boundary lines. */
  partGroups: readonly string[];
  /** One pixel in world units. */
  pixel: number;
}

export function renderFrame(posed: PosedFigure, layout: FrameLayout, projection: Projection, flags: RenderFlags): FrameBuffers {
  const { width, height, anchorX, anchorY } = layout;
  const size = width * height;
  const buffers: FrameBuffers = {
    width, height,
    depth: new Float32Array(size).fill(-Infinity),
    part: new Int8Array(size).fill(NO_PART),
    region: new Uint8Array(size),
    normalX: new Float32Array(size),
    normalY: new Float32Array(size),
    normalZ: new Float32Array(size),
    shadow: new Uint8Array(size),
    tile: new Uint8Array(size),
    outline: new Uint8Array(size),
  };
  const direction: Vec3 = [1, 1, projection.viewZ];
  const hit: Hit = { t: 0, normal: [0, 0, 1], region: 0 };

  const rayOrigin = (pixelX: number, pixelY: number): Vec3 => {
    const difference = (pixelX + 0.5 - anchorX) / projection.halfTile;
    const sum = (pixelY + 0.5 - anchorY) / projection.quarterTile;
    return [(sum + difference) / 2, (sum - difference) / 2, 0];
  };

  for (const primitive of posed.primitives) {
    const [minX, maxX, minY, maxY] = primitiveExtents(projection, primitive);
    const startX = Math.max(0, Math.floor(anchorX + minX)), endX = Math.min(width, Math.ceil(anchorX + maxX) + 1);
    const startY = Math.max(0, Math.floor(anchorY + minY)), endY = Math.min(height, Math.ceil(anchorY + maxY) + 1);
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const origin = rayOrigin(x, y);
        let found: boolean;
        if (primitive.kind === 'capsule') found = intersectCapsule(primitive, origin, direction, hit);
        else if (primitive.kind === 'ellipsoid') found = intersectEllipsoid(primitive, origin, direction, flags.pixel, flags.markers, hit);
        else found = intersectBox(primitive, origin, direction, flags.pixel, flags.markers, primitive.part === 1, hit);
        if (!found) continue;
        const index = y * width + x;
        if (hit.t <= buffers.depth[index]) continue;
        buffers.depth[index] = hit.t;
        buffers.part[index] = primitive.part;
        buffers.region[index] = hit.region;
        buffers.normalX[index] = hit.normal[0];
        buffers.normalY[index] = hit.normal[1];
        buffers.normalZ[index] = hit.normal[2];
      }
    }
  }

  // Ground: shadow disc (a circle on the floor reads as a 2:1 ellipse) and the tile diamond.
  const inTile = new Uint8Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [groundX, groundY] = rayOrigin(x, y);
      const index = y * width + x;
      if (flags.shadow && Math.hypot(groundX - posed.groundCenter[0], groundY - posed.groundCenter[1]) <= posed.shadowRadius) buffers.shadow[index] = 1;
      if (Math.abs(groundX) <= 0.5 && Math.abs(groundY) <= 0.5) inTile[index] = 1;
    }
  }
  if (flags.tileGuide) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (!inTile[index]) continue;
        const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
          !inTile[index - 1] || !inTile[index + 1] || !inTile[index - width] || !inTile[index + width];
        if (edge) buffers.tile[index] = 1;
      }
    }
  }

  computeOutline(buffers, flags);
  return buffers;
}

function computeOutline(buffers: FrameBuffers, flags: RenderFlags): void {
  if (flags.outline === 'none') return;
  const { width, height, part, depth } = buffers;
  // Depth jump that counts as one limb crossing another (in ray units ≈ world units).
  const jump = Math.max(flags.pixel * 3, 0.12);
  const isEdge = (first: number, second: number): boolean => {
    const partFirst = part[first], partSecond = part[second];
    if (partFirst === NO_PART && partSecond === NO_PART) return false;
    if (partFirst === NO_PART || partSecond === NO_PART) return true;
    if (flags.outlineScope === 'silhouette') return false;
    if (flags.partGroups[partFirst] !== flags.partGroups[partSecond]) return true;
    return partFirst !== partSecond && Math.abs(depth[first] - depth[second]) > jump;
  };
  // 'outside' draws on the farther pixel (background counts as farthest), so
  // limbs keep their full width and the line wraps the shape; 'inside' draws on the nearer.
  const pick = (first: number, second: number) =>
    flags.outline === 'outside'
      ? (depth[first] <= depth[second] ? first : second)
      : (depth[first] >= depth[second] ? first : second);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (x + 1 < width && isEdge(index, index + 1)) buffers.outline[pick(index, index + 1)] = 1;
      if (y + 1 < height && isEdge(index, index + width)) buffers.outline[pick(index, index + width)] = 1;
      if (flags.outline === 'inside' && part[index] !== NO_PART && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) buffers.outline[index] = 1;
    }
  }
}
