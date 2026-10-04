// Animation library.
//
// Each animation is a few named key poses on a 0–1 timeline. Frames are
// *sampled* from that curve, so the frame count is free: 8 frames hits every
// key of a walk exactly (contact, down, passing, up × 2), 12 adds in-betweens,
// 4 keeps the extremes. Interpolation is Catmull-Rom (wrapping for loops) so
// motion eases through keys instead of snapping.
//
// Poses are written relative to rest and only list what changes. Walk and run
// define the first half-cycle; the second half is the mirror (left ↔ right).

import { restPose, type ArmPose, type LegPose, type Pose } from './skeleton';
import type { AnimationSettings } from './types';

type PosePatch = Partial<Omit<Pose, 'armRight' | 'armLeft' | 'legRight' | 'legLeft'>> & {
  armRight?: Partial<ArmPose>;
  armLeft?: Partial<ArmPose>;
  legRight?: Partial<LegPose>;
  legLeft?: Partial<LegPose>;
  /** Shorthand applied to both sides before the per-side values. */
  arms?: Partial<ArmPose>;
  legs?: Partial<LegPose>;
};

interface Key { t: number; label?: string; pose: PosePatch }

export type AnimationCategory = 'Locomotion' | 'Emotes' | 'Actions';

export interface AnimationDefinition {
  key: string;
  label: string;
  category: AnimationCategory;
  defaults: Omit<AnimationSettings, 'include' | 'intensity'>;
  keys: Key[];
  /** Keys cover t ∈ [0, 0.5); the second half mirrors them. */
  mirrorHalf?: boolean;
}

// ── Pose plumbing ───────────────────────────────────────────────────────────

const SCALAR_FIELDS = [
  'lift', 'offsetForward', 'offsetRight', 'rootYaw', 'rootPitch', 'rootRoll',
  'spineYaw', 'spinePitch', 'spineRoll', 'shrug', 'breath', 'headYaw', 'headPitch', 'headRoll',
] as const;
const ARM_FIELDS = ['swing', 'raise', 'elbow', 'twist'] as const;
const LEG_FIELDS = ['swing', 'spread', 'knee', 'ankle'] as const;

function applyPatch(patch: PosePatch): Pose {
  const pose = restPose();
  for (const field of SCALAR_FIELDS) if (patch[field] !== undefined) pose[field] = patch[field]!;
  pose.armRight = { ...pose.armRight, ...patch.arms, ...patch.armRight };
  pose.armLeft = { ...pose.armLeft, ...patch.arms, ...patch.armLeft };
  pose.legRight = { ...pose.legRight, ...patch.legs, ...patch.legRight };
  pose.legLeft = { ...pose.legLeft, ...patch.legs, ...patch.legLeft };
  return pose;
}

function flatten(pose: Pose): number[] {
  return [
    ...SCALAR_FIELDS.map((field) => pose[field]),
    ...ARM_FIELDS.map((field) => pose.armRight[field]),
    ...ARM_FIELDS.map((field) => pose.armLeft[field]),
    ...LEG_FIELDS.map((field) => pose.legRight[field]),
    ...LEG_FIELDS.map((field) => pose.legLeft[field]),
  ];
}

function unflatten(values: number[]): Pose {
  let index = 0;
  const pose = restPose();
  for (const field of SCALAR_FIELDS) pose[field] = values[index++];
  for (const field of ARM_FIELDS) pose.armRight[field] = values[index++];
  for (const field of ARM_FIELDS) pose.armLeft[field] = values[index++];
  for (const field of LEG_FIELDS) pose.legRight[field] = values[index++];
  for (const field of LEG_FIELDS) pose.legLeft[field] = values[index++];
  return pose;
}

/** Swap sides and flip everything that turns or leans. */
export function mirrorPose(pose: Pose): Pose {
  return {
    ...pose,
    offsetRight: -pose.offsetRight,
    rootYaw: -pose.rootYaw, rootRoll: -pose.rootRoll,
    spineYaw: -pose.spineYaw, spineRoll: -pose.spineRoll,
    headYaw: -pose.headYaw, headRoll: -pose.headRoll,
    armRight: { ...pose.armLeft }, armLeft: { ...pose.armRight },
    legRight: { ...pose.legLeft }, legLeft: { ...pose.legRight },
  };
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

interface ResolvedKey { t: number; label?: string; values: number[] }

function resolveKeys(definition: AnimationDefinition): ResolvedKey[] {
  const keys = definition.keys.map((key) => ({ t: key.t, label: key.label, pose: applyPatch(key.pose) }));
  const all = definition.mirrorHalf
    ? [...keys, ...keys.map((key) => ({ t: key.t + 0.5, label: key.label ? mirrorLabel(key.label) : undefined, pose: mirrorPose(key.pose) }))]
    : keys;
  return all.sort((first, second) => first.t - second.t).map((key) => ({ t: key.t, label: key.label, values: flatten(key.pose) }));
}

function mirrorLabel(label: string): string {
  return label.replace(/\bR\b/, '§').replace(/\bL\b/, 'R').replace('§', 'L');
}

const cache = new Map<string, ResolvedKey[]>();
function keysFor(definition: AnimationDefinition): ResolvedKey[] {
  let keys = cache.get(definition.key);
  if (!keys) { keys = resolveKeys(definition); cache.set(definition.key, keys); }
  return keys;
}

export function samplePose(definition: AnimationDefinition, t: number, loop: boolean, intensity = 1): Pose {
  const keys = keysFor(definition);
  const count = keys.length;
  let values: number[];
  if (count === 1) {
    values = keys[0].values;
  } else if (loop) {
    const time = ((t % 1) + 1) % 1;
    let index = count - 1;
    for (let candidate = 0; candidate < count; candidate++) if (keys[candidate].t <= time + 1e-9) index = candidate;
    const next = (index + 1) % count;
    const start = keys[index].t;
    const end = next === 0 ? keys[0].t + 1 : keys[next].t;
    const local = time < start ? time + 1 : time;
    const u = end > start ? (local - start) / (end - start) : 0;
    const before = keys[(index - 1 + count) % count].values, from = keys[index].values;
    const to = keys[next].values, after = keys[(next + 1) % count].values;
    values = from.map((_, field) => catmullRom(before[field], from[field], to[field], after[field], u));
  } else {
    const time = Math.min(1, Math.max(0, t));
    let index = 0;
    for (let candidate = 0; candidate < count - 1; candidate++) if (keys[candidate].t <= time + 1e-9) index = candidate;
    const next = Math.min(count - 1, index + 1);
    const span = keys[next].t - keys[index].t;
    const u = span > 0 ? Math.min(1, Math.max(0, (time - keys[index].t) / span)) : 0;
    const before = keys[Math.max(0, index - 1)].values, from = keys[index].values;
    const to = keys[next].values, after = keys[Math.min(count - 1, next + 1)].values;
    values = from.map((_, field) => catmullRom(before[field], from[field], to[field], after[field], u));
  }
  if (intensity !== 1) {
    const rest = flatten(restPose());
    values = values.map((value, field) => rest[field] + (value - rest[field]) * intensity);
  }
  const pose = unflatten(values);
  pose.lift = Math.max(0, pose.lift);
  pose.shrug = Math.min(1, Math.max(0, pose.shrug));
  pose.breath = Math.max(0, pose.breath);
  return pose;
}

/** Timeline position of frame `index` of `frames`. Loops never repeat frame 0 at the end; one-shots include both ends. */
export function frameTime(index: number, frames: number, loop: boolean): number {
  if (loop) return index / frames;
  return frames > 1 ? index / (frames - 1) : 0;
}

/** The key-pose name a frame lands on, if it lands on one. */
export function frameLabel(definition: AnimationDefinition, index: number, frames: number, loop: boolean): string | undefined {
  const t = frameTime(index, frames, loop);
  const tolerance = (loop ? 1 / frames : 1 / Math.max(1, frames - 1)) * 0.25;
  for (const key of keysFor(definition)) {
    const distance = loop ? Math.min(Math.abs(key.t - t), 1 - Math.abs(key.t - t)) : Math.abs(key.t - t);
    if (distance < tolerance && key.label) return key.label;
  }
  return undefined;
}

// ── Library ─────────────────────────────────────────────────────────────────

export const ANIMATIONS: AnimationDefinition[] = [
  {
    key: 'idle', label: 'Idle', category: 'Locomotion',
    defaults: { frames: 4, fps: 3.5, loop: true },
    keys: [
      { t: 0, label: 'rest', pose: {} },
      { t: 0.25, label: 'inhale', pose: { breath: 0.7, arms: { raise: 7 } } },
      { t: 0.5, label: 'hold', pose: { breath: 1, headPitch: -2, arms: { raise: 8, elbow: 12 } } },
      { t: 0.75, label: 'exhale', pose: { breath: 0.4, arms: { raise: 7 } } },
    ],
  },
  {
    key: 'walk', label: 'Walk', category: 'Locomotion',
    defaults: { frames: 8, fps: 10, loop: true },
    mirrorHalf: true,
    keys: [
      { t: 0, label: 'contact R', pose: {
        rootPitch: 2, rootYaw: -4, spineYaw: 8,
        legRight: { swing: 20, knee: 4, ankle: 10 }, legLeft: { swing: -17, knee: 8, ankle: -12 },
        armRight: { swing: -20, elbow: 12 }, armLeft: { swing: 20, elbow: 20 },
      } },
      { t: 0.125, label: 'down', pose: {
        rootPitch: 3, rootYaw: -3, spineYaw: 5,
        legRight: { swing: 14, knee: 18, ankle: 0 }, legLeft: { swing: -10, knee: 30, ankle: -16 },
        armRight: { swing: -14, elbow: 12 }, armLeft: { swing: 14, elbow: 18 },
      } },
      { t: 0.25, label: 'passing', pose: {
        rootPitch: 2,
        legRight: { swing: 1, knee: 5, ankle: 0 }, legLeft: { swing: 6, knee: 46, ankle: -8 },
        armRight: { swing: 0, elbow: 12 }, armLeft: { swing: 0, elbow: 14 },
      } },
      { t: 0.375, label: 'up', pose: {
        rootPitch: 2, rootYaw: 3, spineYaw: -5,
        legRight: { swing: -12, knee: 2, ankle: -10 }, legLeft: { swing: 18, knee: 20, ankle: 5 },
        armRight: { swing: 14, elbow: 16 }, armLeft: { swing: -14, elbow: 12 },
      } },
    ],
  },
  {
    key: 'run', label: 'Run', category: 'Locomotion',
    defaults: { frames: 8, fps: 12, loop: true },
    mirrorHalf: true,
    keys: [
      { t: 0, label: 'contact R', pose: {
        rootPitch: 12, rootYaw: -6, spineYaw: 12, headPitch: -8,
        legRight: { swing: 26, knee: 14, ankle: 6 }, legLeft: { swing: -22, knee: 44, ankle: -22 },
        armRight: { swing: -38, elbow: 88 }, armLeft: { swing: 42, elbow: 92 },
      } },
      { t: 0.125, label: 'down', pose: {
        rootPitch: 13, rootYaw: -3, spineYaw: 6, headPitch: -9,
        legRight: { swing: 12, knee: 34, ankle: 0 }, legLeft: { swing: -4, knee: 84, ankle: -22 },
        armRight: { swing: -20, elbow: 86 }, armLeft: { swing: 24, elbow: 90 },
      } },
      { t: 0.25, label: 'push R', pose: {
        rootPitch: 13, rootYaw: 3, spineYaw: -6, headPitch: -9, lift: 0.015,
        legRight: { swing: -18, knee: 10, ankle: -24 }, legLeft: { swing: 40, knee: 86, ankle: 0 },
        armRight: { swing: 30, elbow: 90 }, armLeft: { swing: -30, elbow: 86 },
      } },
      { t: 0.375, label: 'flight', pose: {
        rootPitch: 12, rootYaw: 6, spineYaw: -12, headPitch: -8, lift: 0.06,
        legRight: { swing: -22, knee: 58, ankle: -20 }, legLeft: { swing: 36, knee: 40, ankle: 8 },
        armRight: { swing: 42, elbow: 92 }, armLeft: { swing: -38, elbow: 88 },
      } },
    ],
  },
  {
    key: 'jump', label: 'Jump', category: 'Locomotion',
    defaults: { frames: 10, fps: 12, loop: false },
    keys: [
      { t: 0, label: 'stand', pose: {} },
      { t: 0.14, label: 'anticipate', pose: {
        spinePitch: 26, headPitch: -16,
        legs: { swing: 58, knee: 100, ankle: 18 },
        arms: { swing: -55, raise: 10, elbow: 20 },
      } },
      { t: 0.27, label: 'take-off', pose: {
        spinePitch: -4, lift: 0.02,
        legs: { swing: -4, knee: 2, ankle: -42 },
        arms: { swing: 150, raise: 14, elbow: 12 },
      } },
      { t: 0.42, label: 'rise', pose: {
        lift: 0.24, spinePitch: 2,
        legs: { swing: 28, knee: 58, ankle: -22 },
        arms: { swing: 162, raise: 20, elbow: 10 },
      } },
      { t: 0.55, label: 'apex', pose: {
        lift: 0.3, spinePitch: 8,
        legs: { swing: 52, knee: 94, ankle: -10 },
        arms: { swing: 130, raise: 28, elbow: 22 },
      } },
      { t: 0.7, label: 'fall', pose: {
        lift: 0.16, spinePitch: 4,
        legs: { swing: 12, knee: 22, ankle: -14 },
        arms: { swing: 34, raise: 36, elbow: 24 },
      } },
      { t: 0.83, label: 'land', pose: {
        spinePitch: 22, headPitch: -6,
        legs: { swing: 52, knee: 90, ankle: 16 },
        arms: { swing: 30, raise: 34, elbow: 24 },
      } },
      { t: 1, label: 'recover', pose: {} },
    ],
  },
  {
    key: 'crouch', label: 'Crouch', category: 'Locomotion',
    defaults: { frames: 4, fps: 3.5, loop: true },
    keys: [
      { t: 0, label: 'low', pose: { spinePitch: 30, headPitch: -18, legs: { swing: 70, knee: 122, ankle: 26 }, legRight: { spread: 8 }, legLeft: { spread: 8 }, arms: { swing: 34, raise: 14, elbow: 34 } } },
      { t: 0.5, label: 'breathe', pose: { spinePitch: 28, headPitch: -18, breath: 0.8, legs: { swing: 68, knee: 118, ankle: 25 }, legRight: { spread: 8 }, legLeft: { spread: 8 }, arms: { swing: 32, raise: 15, elbow: 36 } } },
    ],
  },
  {
    key: 'sit', label: 'Sit', category: 'Locomotion',
    defaults: { frames: 4, fps: 3.5, loop: true },
    keys: [
      { t: 0, label: 'seated', pose: { spinePitch: -3, legs: { swing: 90, knee: 90, ankle: 0, spread: 5 }, arms: { swing: 42, raise: 10, elbow: 52 } } },
      { t: 0.5, label: 'breathe', pose: { spinePitch: -3, breath: 1, headPitch: -2, legs: { swing: 90, knee: 90, ankle: 0, spread: 5 }, arms: { swing: 42, raise: 11, elbow: 54 } } },
    ],
  },

  // ── Emotes ─────────────────────────────────────────────────────────────────
  {
    key: 'wave', label: 'Wave', category: 'Emotes',
    defaults: { frames: 8, fps: 8, loop: true },
    keys: [
      { t: 0, label: 'out', pose: { headRoll: 5, spineRoll: -3, armRight: { raise: 100, swing: 18, elbow: 42, twist: -90 } } },
      { t: 0.5, label: 'in', pose: { headRoll: 5, spineRoll: -3, armRight: { raise: 100, swing: 18, elbow: 82, twist: -90 } } },
    ],
  },
  {
    key: 'cheer', label: 'Cheer', category: 'Emotes',
    defaults: { frames: 6, fps: 8, loop: true },
    keys: [
      { t: 0, label: 'dip', pose: { headPitch: -10, legs: { swing: 14, knee: 26 }, arms: { raise: 138, swing: 10, elbow: 34 } } },
      { t: 0.5, label: 'up', pose: { lift: 0.04, headPitch: -16, legs: { ankle: -16 }, arms: { raise: 168, swing: 8, elbow: 6 } } },
    ],
  },
  {
    key: 'nod', label: 'Nod', category: 'Emotes',
    defaults: { frames: 6, fps: 8, loop: true },
    keys: [
      { t: 0, label: 'up', pose: { headPitch: -6 } },
      { t: 0.5, label: 'down', pose: { headPitch: 22, spinePitch: 3 } },
    ],
  },
  {
    key: 'shake', label: 'Head shake', category: 'Emotes',
    defaults: { frames: 6, fps: 8, loop: true },
    keys: [
      { t: 0, label: 'left', pose: { headYaw: -30, spineYaw: -3 } },
      { t: 0.5, label: 'right', pose: { headYaw: 30, spineYaw: 3 } },
    ],
  },
  {
    key: 'shrug', label: 'Shrug', category: 'Emotes',
    defaults: { frames: 6, fps: 8, loop: false },
    keys: [
      { t: 0, label: 'rest', pose: {} },
      { t: 0.4, label: 'shrug', pose: { shrug: 1, headRoll: 12, spinePitch: -3, arms: { raise: 26, swing: 22, elbow: 96, twist: -70 } } },
      { t: 0.7, label: 'hold', pose: { shrug: 0.9, headRoll: 12, spinePitch: -3, arms: { raise: 28, swing: 22, elbow: 98, twist: -72 } } },
      { t: 1, label: 'rest', pose: {} },
    ],
  },
  {
    key: 'point', label: 'Point', category: 'Emotes',
    defaults: { frames: 5, fps: 8, loop: false },
    keys: [
      { t: 0, label: 'rest', pose: {} },
      { t: 0.5, label: 'raise', pose: { spineYaw: -6, armRight: { swing: 70, raise: 8, elbow: 20 } } },
      { t: 1, label: 'point', pose: { spineYaw: -8, headPitch: -4, armRight: { swing: 88, raise: 6, elbow: 0 } } },
    ],
  },
  {
    key: 'bow', label: 'Bow', category: 'Emotes',
    defaults: { frames: 8, fps: 10, loop: false },
    keys: [
      { t: 0, label: 'rest', pose: {} },
      { t: 0.4, label: 'bow', pose: { spinePitch: 46, headPitch: 16, rootPitch: 4, arms: { swing: 14, raise: 4, elbow: 6 } } },
      { t: 0.65, label: 'hold', pose: { spinePitch: 48, headPitch: 18, rootPitch: 4, arms: { swing: 16, raise: 4, elbow: 6 } } },
      { t: 1, label: 'rest', pose: {} },
    ],
  },
  {
    key: 'talk', label: 'Talk', category: 'Emotes',
    defaults: { frames: 8, fps: 8, loop: true },
    keys: [
      { t: 0, label: 'gesture', pose: { headPitch: -3, headYaw: 4, armRight: { swing: 34, raise: 14, elbow: 64, twist: -14 }, armLeft: { swing: 8, elbow: 18 } } },
      { t: 0.33, label: 'open', pose: { headPitch: 2, headYaw: -2, armRight: { swing: 42, raise: 22, elbow: 86, twist: -30 }, armLeft: { swing: 10, elbow: 20 } } },
      { t: 0.66, label: 'beat', pose: { headPitch: -1, headYaw: 6, armRight: { swing: 28, raise: 16, elbow: 72, twist: -6 }, armLeft: { swing: 6, elbow: 16 } } },
    ],
  },

  // ── Actions ────────────────────────────────────────────────────────────────
  {
    key: 'cast', label: 'Cast', category: 'Actions',
    defaults: { frames: 8, fps: 10, loop: true },
    keys: [
      { t: 0, label: 'gather', pose: { spinePitch: -4, headPitch: -6, legRight: { swing: -10 }, legLeft: { swing: 12, knee: 8 }, arms: { swing: 74, raise: 22, elbow: 40, twist: -20 } } },
      { t: 0.5, label: 'release', pose: { spinePitch: -8, headPitch: -10, lift: 0.015, breath: 1, legRight: { swing: -10 }, legLeft: { swing: 12, knee: 8 }, arms: { swing: 92, raise: 30, elbow: 16, twist: -30 } } },
    ],
  },
  {
    key: 'slash', label: 'Slash', category: 'Actions',
    defaults: { frames: 6, fps: 14, loop: false },
    keys: [
      { t: 0, label: 'ready', pose: { legRight: { swing: -10 }, legLeft: { swing: 14, knee: 10 } } },
      { t: 0.25, label: 'wind-up', pose: { spineYaw: 26, spinePitch: -4, legRight: { swing: -12, knee: 8 }, legLeft: { swing: 16, knee: 14 }, armRight: { swing: 150, raise: 34, elbow: 44 }, armLeft: { swing: 20, raise: 20, elbow: 30 } } },
      { t: 0.5, label: 'strike', pose: { spineYaw: -22, spinePitch: 16, legRight: { swing: -16, knee: 4 }, legLeft: { swing: 24, knee: 26 }, armRight: { swing: 26, raise: 12, elbow: 6 }, armLeft: { swing: -20, raise: 18, elbow: 30 } } },
      { t: 0.75, label: 'follow', pose: { spineYaw: -30, spinePitch: 18, legRight: { swing: -16, knee: 6 }, legLeft: { swing: 24, knee: 28 }, armRight: { swing: -24, raise: 24, elbow: 10 }, armLeft: { swing: -24, raise: 20, elbow: 30 } } },
      { t: 1, label: 'ready', pose: { legRight: { swing: -10 }, legLeft: { swing: 14, knee: 10 } } },
    ],
  },
  {
    key: 'hurt', label: 'Hurt', category: 'Actions',
    defaults: { frames: 4, fps: 10, loop: false },
    keys: [
      { t: 0, label: 'rest', pose: {} },
      { t: 0.3, label: 'hit', pose: { offsetForward: -0.04, rootPitch: -10, spinePitch: -16, headPitch: -22, legRight: { swing: -8, knee: 10 }, legLeft: { swing: 16, knee: 18 }, arms: { raise: 38, swing: 22, elbow: 44 } } },
      { t: 0.65, label: 'reel', pose: { offsetForward: -0.04, rootPitch: -6, spinePitch: -8, headPitch: -10, legRight: { swing: -6, knee: 8 }, legLeft: { swing: 12, knee: 14 }, arms: { raise: 24, swing: 14, elbow: 30 } } },
      { t: 1, label: 'rest', pose: {} },
    ],
  },
  {
    key: 'fall', label: 'Knock-down', category: 'Actions',
    defaults: { frames: 8, fps: 10, loop: false },
    keys: [
      { t: 0, label: 'rest', pose: {} },
      { t: 0.25, label: 'stagger', pose: { offsetForward: -0.05, rootPitch: -24, spinePitch: -10, headPitch: -16, legs: { knee: 30, swing: 10 }, arms: { raise: 48, swing: 30, elbow: 30 } } },
      { t: 0.5, label: 'topple', pose: { offsetForward: -0.15, rootPitch: -60, spinePitch: -6, headPitch: -6, legs: { knee: 40, swing: 20 }, arms: { raise: 60, swing: 50, elbow: 30 } } },
      { t: 0.75, label: 'impact', pose: { offsetForward: -0.26, rootPitch: -88, headPitch: 6, legs: { knee: 16, swing: 10 }, arms: { raise: 66, swing: 30, elbow: 20 } } },
      { t: 1, label: 'down', pose: { offsetForward: -0.28, rootPitch: -90, headPitch: 4, legs: { knee: 8, swing: 4 }, arms: { raise: 72, swing: 14, elbow: 14 } } },
    ],
  },
];

export const ANIMATION_BY_KEY = new Map(ANIMATIONS.map((definition) => [definition.key, definition]));

export function defaultAnimationSettings(): Record<string, AnimationSettings> {
  return Object.fromEntries(ANIMATIONS.map((definition) => [definition.key, { ...definition.defaults, include: true, intensity: 1 }]));
}

