// Pose → posed primitives (forward kinematics).
//
// A pose is a handful of joint angles in degrees, all relative to the body:
//   swing  — limb forward (+) / back (−) about the shoulder or hip
//   raise  — arm out to the side (abduction); legs use `spread`
//   elbow / knee — bend (elbows fold forward, knees fold back)
//   twist  — turns the plane the elbow bends in (lets a forearm point up for a wave)
//   ankle  — toe up (+) / toe down (−)
// Root/spine/head take yaw (turn right +), pitch (lean forward +), roll (lean right +).
// Positive values on a left limb mean the same thing as on a right limb, so a
// pose mirrors by swapping sides and negating yaw/roll.
//
// After FK the whole figure is dropped so its lowest point touches z = 0
// (ground contact), then raised by `lift`. Bending a stance knee therefore
// lowers the body by itself — walk-cycle bob falls out of the leg angles — and
// crouches, sits and falls stay on the floor at any proportions.

import {
  add, addScaled, cross, normalize, perpendicular, pitchForward, radians, rollRight, rotateAbout,
  scale, toWorld, yawRight, type Frame, type Vec3,
} from './math';
import type { BodyDimensions } from './proportions';
import type { DirectionIndex } from './types';

export interface ArmPose { swing: number; raise: number; elbow: number; twist: number }
export interface LegPose { swing: number; spread: number; knee: number; ankle: number }

export interface Pose {
  /** Height off the ground after contact, as a fraction of figure height. */
  lift: number;
  /** Body offset as a fraction of height (forward / right of the facing). */
  offsetForward: number;
  offsetRight: number;
  rootYaw: number;
  rootPitch: number;
  rootRoll: number;
  spineYaw: number;
  spinePitch: number;
  spineRoll: number;
  /** 0–1: shoulders up. */
  shrug: number;
  /** 0–1: chest expands and lifts ~1px. */
  breath: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  armRight: ArmPose;
  armLeft: ArmPose;
  legRight: LegPose;
  legLeft: LegPose;
}

export const Part = {
  Pelvis: 0, Chest: 1, Neck: 2, Head: 3,
  RightUpperArm: 4, RightForearm: 5, RightHand: 6,
  LeftUpperArm: 7, LeftForearm: 8, LeftHand: 9,
  RightThigh: 10, RightShin: 11, RightFoot: 12,
  LeftThigh: 13, LeftShin: 14, LeftFoot: 15,
} as const;
export type Part = (typeof Part)[keyof typeof Part];

export type PartGroup = 'body' | 'head' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';

export const PART_GROUP: PartGroup[] = [
  'body', 'body', 'body', 'head',
  'rightArm', 'rightArm', 'rightArm',
  'leftArm', 'leftArm', 'leftArm',
  'rightLeg', 'rightLeg', 'rightLeg',
  'leftLeg', 'leftLeg', 'leftLeg',
];

export type Primitive =
  | { kind: 'capsule'; part: Part; a: Vec3; b: Vec3; radius: number }
  | { kind: 'ellipsoid'; part: Part; center: Vec3; frame: Frame; radii: Vec3 }
  /** `rounding` > 1 intersects the box with an ellipsoid of half·rounding, softening edges and corners. */
  | { kind: 'box'; part: Part; center: Vec3; frame: Frame; half: Vec3; rounding?: number };

export interface PosedFigure {
  primitives: Primitive[];
  /** Ground point under the hips, for the shadow. */
  groundCenter: Vec3;
  shadowRadius: number;
  /** Height of the lowest point above the floor (the lift). */
  lift: number;
}

export function restPose(): Pose {
  return {
    lift: 0, offsetForward: 0, offsetRight: 0,
    rootYaw: 0, rootPitch: 0, rootRoll: 0,
    spineYaw: 0, spinePitch: 0, spineRoll: 0,
    shrug: 0, breath: 0,
    headYaw: 0, headPitch: 0, headRoll: 0,
    armRight: { swing: 0, raise: 6, elbow: 10, twist: 0 },
    armLeft: { swing: 0, raise: 6, elbow: 10, twist: 0 },
    legRight: { swing: 0, spread: 2, knee: 0, ankle: 0 },
    legLeft: { swing: 0, spread: 2, knee: 0, ankle: 0 },
  };
}

/** Facing for direction 0 S … 7 SE: S looks toward the viewer (world +x+y). */
// Note: right = up × forward, so (right, forward, up) is a *left*-handed basis
// in world coordinates — world cross products of body axes come out mirrored
// relative to the local-coordinate algebra. The hinge cross products below are
// written for that and pinned by tests (knees fold back, elbows fold forward).
export function facingFrame(direction: DirectionIndex): Frame {
  const angle = radians(45 + 45 * direction);
  const forward: Vec3 = [Math.cos(angle), Math.sin(angle), 0];
  const up: Vec3 = [0, 0, 1];
  return { forward, up, right: cross(up, forward) };
}

/**
 * Limb direction from a joint, plus its hinge axis. Start pointing down, abduct
 * sideways by `out`, then swing forward by `swing`. The hinge (the axis an
 * elbow or knee folds about) starts as the body's right axis and goes through
 * the same two rotations, so it stays well-defined at any angle — a thigh
 * swung level for sitting still folds its knee straight down.
 */
function limbFrame(frame: Frame, side: 1 | -1, out: number, swing: number): { direction: Vec3; hinge: Vec3 } {
  const a = radians(out), w = radians(swing);
  const sinA = Math.sin(a), cosA = Math.cos(a), sinW = Math.sin(w), cosW = Math.cos(w);
  return {
    direction: normalize(toWorld(frame, [side * sinA, cosA * sinW, -cosA * cosW])),
    hinge: normalize(toWorld(frame, [cosA, -side * sinA * sinW, side * sinA * cosW])),
  };
}

export function poseFigure(dimensions: BodyDimensions, pose: Pose, direction: DirectionIndex): PosedFigure {
  const d = dimensions;
  const height = d.height;
  const primitives: Primitive[] = [];
  const facing = facingFrame(direction);

  // ── Root (pelvis) ─────────────────────────────────────────────────────────
  const root = rollRight(pitchForward(yawRight(facing, pose.rootYaw), pose.rootPitch), pose.rootRoll);
  let hip: Vec3 = [0, 0, d.hipHeight];
  hip = addScaled(hip, facing.forward, pose.offsetForward * height);
  hip = addScaled(hip, facing.right, pose.offsetRight * height);
  primitives.push({
    kind: 'box', part: Part.Pelvis, frame: root,
    center: addScaled(hip, root.up, d.pelvisHeight * 0.22),
    half: [d.pelvisWidth / 2, d.pelvisDepth / 2, d.pelvisHeight / 2],
    rounding: 1.3,
  });

  // ── Spine / chest ─────────────────────────────────────────────────────────
  const waistLift = d.pelvisHeight * 0.55;
  const waist = addScaled(hip, root.up, waistLift);
  const chest = rollRight(pitchForward(yawRight(root, pose.spineYaw), pose.spinePitch), pose.spineRoll);
  const chestLength = d.shoulderHeight - d.hipHeight - waistLift - d.upperArmRadius * 0.2;
  const breathGrow = 1 + 0.05 * pose.breath;
  const shoulderLift = pose.shrug * d.headHeight * 0.32 + pose.breath * d.pixel * 1.1;
  primitives.push({
    kind: 'box', part: Part.Chest, frame: chest,
    center: addScaled(waist, chest.up, (chestLength + pose.breath * d.pixel) / 2),
    half: [(d.chestWidth / 2) * breathGrow, (d.chestDepth / 2) * breathGrow, (chestLength + pose.breath * d.pixel) / 2],
    rounding: 1.28,
  });
  const chestTop = addScaled(waist, chest.up, chestLength);

  // ── Neck / head ───────────────────────────────────────────────────────────
  const head = rollRight(pitchForward(yawRight(chest, pose.headYaw), pose.headPitch), pose.headRoll);
  const neckBase = addScaled(chestTop, chest.up, pose.breath * d.pixel - d.neckRadius * 0.4);
  const neckTop = addScaled(neckBase, head.up, d.neckLength + d.neckRadius * 0.4);
  primitives.push({ kind: 'capsule', part: Part.Neck, a: neckBase, b: neckTop, radius: d.neckRadius });
  primitives.push({
    kind: 'ellipsoid', part: Part.Head, frame: head,
    center: addScaled(addScaled(neckTop, head.up, d.headHeight * 0.42), head.forward, d.headDepth * 0.04),
    radii: [d.headWidth / 2, d.headDepth / 2, d.headHeight / 2],
  });

  // ── Arms ──────────────────────────────────────────────────────────────────
  const arm = (side: 1 | -1, armPose: Pose['armRight'], parts: [Part, Part, Part]) => {
    const shoulder = addScaled(
      addScaled(addScaled(chestTop, chest.up, -d.upperArmRadius * 0.9 + shoulderLift), chest.right, side * d.shoulderOffset),
      chest.forward, 0,
    );
    const { direction: upper, hinge } = limbFrame(chest, side, armPose.raise, armPose.swing);
    const elbow = addScaled(shoulder, upper, d.upperArmLength);
    // Elbows fold toward the front of the arm; twist turns that fold plane about the upper arm.
    const bend = rotateAbout(normalize(cross(upper, hinge)), upper, radians(side * armPose.twist));
    const elbowAngle = radians(armPose.elbow);
    const fore = normalize(add(scale(upper, Math.cos(elbowAngle)), scale(bend, Math.sin(elbowAngle))));
    const wrist = addScaled(elbow, fore, d.forearmLength);
    primitives.push({ kind: 'capsule', part: parts[0], a: shoulder, b: elbow, radius: d.upperArmRadius });
    primitives.push({ kind: 'capsule', part: parts[1], a: elbow, b: wrist, radius: d.forearmRadius });
    primitives.push({ kind: 'capsule', part: parts[2], a: wrist, b: addScaled(wrist, fore, d.handRadius * 0.9), radius: d.handRadius });
  };
  arm(1, pose.armRight, [Part.RightUpperArm, Part.RightForearm, Part.RightHand]);
  arm(-1, pose.armLeft, [Part.LeftUpperArm, Part.LeftForearm, Part.LeftHand]);

  // ── Legs ──────────────────────────────────────────────────────────────────
  const leg = (side: 1 | -1, legPose: Pose['legRight'], parts: [Part, Part, Part]) => {
    const hipJoint = addScaled(hip, root.right, side * d.hipOffset);
    const { direction: thigh, hinge } = limbFrame(root, side, legPose.spread, legPose.swing);
    const knee = addScaled(hipJoint, thigh, d.thighLength);
    const kneeBend = normalize(cross(hinge, thigh)); // knees fold backward
    const kneeAngle = radians(legPose.knee);
    const shin = normalize(add(scale(thigh, Math.cos(kneeAngle)), scale(kneeBend, Math.sin(kneeAngle))));
    const ankle = addScaled(knee, shin, d.shinLength);
    primitives.push({ kind: 'capsule', part: parts[0], a: hipJoint, b: knee, radius: d.thighRadius });
    primitives.push({ kind: 'capsule', part: parts[1], a: knee, b: ankle, radius: d.shinRadius });

    const toeUp = radians(legPose.ankle);
    // Foot points along the leg's forward (the hinge × shin), toe up/down by ankle.
    const footBase = normalize(cross(shin, hinge));
    const footForward = normalize(add(scale(footBase, Math.cos(toeUp)), scale(shin, -Math.sin(toeUp))));
    const footUp = perpendicular(scale(shin, -1), footForward, root.up);
    const footFrame: Frame = { forward: footForward, up: footUp, right: cross(footUp, footForward) };
    const footHeight = Math.max(d.footHeight, d.shinRadius * 1.3);
    const center = addScaled(addScaled(ankle, footForward, d.footLength * 0.28), footUp, d.shinRadius * 0.3 - footHeight / 2);
    primitives.push({ kind: 'box', part: parts[2], frame: footFrame, center, half: [d.footWidth / 2, d.footLength / 2, footHeight / 2] });
  };
  leg(1, pose.legRight, [Part.RightThigh, Part.RightShin, Part.RightFoot]);
  leg(-1, pose.legLeft, [Part.LeftThigh, Part.LeftShin, Part.LeftFoot]);

  // ── Ground contact ────────────────────────────────────────────────────────
  const lowest = Math.min(...primitives.map(lowestPoint));
  const lift = pose.lift * height;
  const shift = -lowest + lift;
  for (const primitive of primitives) translateZ(primitive, shift);

  const shadowRadius = Math.max(d.chestWidth * 0.62, d.footLength * 0.9) * (1 - 0.35 * Math.min(1, lift / (0.5 * height)));
  return { primitives, groundCenter: [hip[0], hip[1], 0], shadowRadius, lift };
}

export function lowestPoint(primitive: Primitive): number {
  switch (primitive.kind) {
    case 'capsule':
      return Math.min(primitive.a[2], primitive.b[2]) - primitive.radius;
    case 'ellipsoid': {
      const { frame, radii } = primitive;
      const extent = Math.hypot(frame.right[2] * radii[0], frame.forward[2] * radii[1], frame.up[2] * radii[2]);
      return primitive.center[2] - extent;
    }
    case 'box': {
      const { frame, half } = primitive;
      const extent = Math.abs(frame.right[2]) * half[0] + Math.abs(frame.forward[2]) * half[1] + Math.abs(frame.up[2]) * half[2];
      return primitive.center[2] - extent;
    }
  }
}

function translateZ(primitive: Primitive, dz: number): void {
  if (primitive.kind === 'capsule') {
    primitive.a = [primitive.a[0], primitive.a[1], primitive.a[2] + dz];
    primitive.b = [primitive.b[0], primitive.b[1], primitive.b[2] + dz];
  } else {
    primitive.center = [primitive.center[0], primitive.center[1], primitive.center[2] + dz];
  }
}

/** Bounding sphere, for screen-space culling and frame fitting. */
export function boundingSphere(primitive: Primitive): { center: Vec3; radius: number } {
  switch (primitive.kind) {
    case 'capsule':
      return {
        center: scale(add(primitive.a, primitive.b), 0.5),
        radius: Math.hypot(primitive.a[0] - primitive.b[0], primitive.a[1] - primitive.b[1], primitive.a[2] - primitive.b[2]) / 2 + primitive.radius,
      };
    case 'ellipsoid':
      return { center: primitive.center, radius: Math.max(...primitive.radii) };
    case 'box':
      return { center: primitive.center, radius: Math.hypot(...primitive.half) };
  }
}
