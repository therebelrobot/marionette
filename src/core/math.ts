// Tiny vector / frame helpers. A Frame is an orthonormal basis expressed in
// world coordinates: `right`, `forward`, `up`. World axes follow plinth:
// +x runs screen down-right, +y screen down-left, +z up.

export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const magnitude = length(a) || 1;
  return [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude];
};
/** a + b·factor */
export const addScaled = (a: Vec3, b: Vec3, factor: number): Vec3 => [a[0] + b[0] * factor, a[1] + b[1] * factor, a[2] + b[2] * factor];

export const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export interface Frame {
  right: Vec3;
  forward: Vec3;
  up: Vec3;
}

/** Rotate vector `v` about unit `axis` by `angle` radians (Rodrigues). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const crossed = cross(axis, v);
  const projected = dot(axis, v) * (1 - cosine);
  return [
    v[0] * cosine + crossed[0] * sine + axis[0] * projected,
    v[1] * cosine + crossed[1] * sine + axis[1] * projected,
    v[2] * cosine + crossed[2] * sine + axis[2] * projected,
  ];
}

/** Turn the frame so `forward` swings toward `right` (positive = turn right). */
export function yawRight(frame: Frame, degrees: number): Frame {
  if (!degrees) return frame;
  const angle = radians(degrees), cosine = Math.cos(angle), sine = Math.sin(angle);
  return {
    up: frame.up,
    forward: addScaled(scale(frame.forward, cosine), frame.right, sine),
    right: addScaled(scale(frame.right, cosine), frame.forward, -sine),
  };
}

/** Tip the frame so `up` leans toward `forward` (positive = bow / lean forward). */
export function pitchForward(frame: Frame, degrees: number): Frame {
  if (!degrees) return frame;
  const angle = radians(degrees), cosine = Math.cos(angle), sine = Math.sin(angle);
  return {
    right: frame.right,
    up: addScaled(scale(frame.up, cosine), frame.forward, sine),
    forward: addScaled(scale(frame.forward, cosine), frame.up, -sine),
  };
}

/** Tilt the frame so `up` leans toward `right` (positive = lean right). */
export function rollRight(frame: Frame, degrees: number): Frame {
  if (!degrees) return frame;
  const angle = radians(degrees), cosine = Math.cos(angle), sine = Math.sin(angle);
  return {
    forward: frame.forward,
    up: addScaled(scale(frame.up, cosine), frame.right, sine),
    right: addScaled(scale(frame.right, cosine), frame.up, -sine),
  };
}

/** Express a local (right, forward, up) vector in world coordinates. */
export function toWorld(frame: Frame, local: Vec3): Vec3 {
  return [
    frame.right[0] * local[0] + frame.forward[0] * local[1] + frame.up[0] * local[2],
    frame.right[1] * local[0] + frame.forward[1] * local[1] + frame.up[1] * local[2],
    frame.right[2] * local[0] + frame.forward[2] * local[1] + frame.up[2] * local[2],
  ];
}

/** Express a world vector in a frame's local (right, forward, up) coordinates. */
export function toLocal(frame: Frame, world: Vec3): Vec3 {
  return [dot(frame.right, world), dot(frame.forward, world), dot(frame.up, world)];
}

/** Component of `v` perpendicular to unit `axis`, normalised; falls back when degenerate. */
export function perpendicular(v: Vec3, axis: Vec3, fallback: Vec3): Vec3 {
  const projected = sub(v, scale(axis, dot(v, axis)));
  return length(projected) < 1e-6 ? normalize(sub(fallback, scale(axis, dot(fallback, axis)))) : normalize(projected);
}
