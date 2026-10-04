import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANIMATIONS, ANIMATION_BY_KEY, frameLabel, frameTime, samplePose } from '../src/core/animations';
import { newFigure } from '../src/core/document';
import { dot, sub, toLocal } from '../src/core/math';
import { cachedLayout, figureContext, posedFrame, renderBuffers } from '../src/core/pipeline';
import { bodyDimensions, defaultShape } from '../src/core/proportions';
import { NO_PART } from '../src/core/render';
import { facingFrame, lowestPoint, Part, poseFigure, restPose, type Primitive } from '../src/core/skeleton';
import type { DirectionIndex } from '../src/core/types';

const projection = { tileWidthPixels: 32, levelHeightPixels: 16 };
const dimensions = bodyDimensions(defaultShape('adult'), projection);

function capsule(primitives: Primitive[], part: number) {
  const found = primitives.find((primitive) => primitive.part === part);
  assert.ok(found && found.kind === 'capsule');
  return found;
}

test('knees fold backward and elbows fold forward', () => {
  const pose = restPose();
  pose.legRight = { swing: 0, spread: 0, knee: 90, ankle: 0 };
  pose.armRight = { swing: 0, raise: 0, elbow: 90, twist: 0 };
  const figure = poseFigure(dimensions, pose, 0);
  const facing = facingFrame(0);
  const shin = capsule(figure.primitives, Part.RightShin);
  const forearm = capsule(figure.primitives, Part.RightForearm);
  assert.ok(dot(sub(shin.b, shin.a), facing.forward) < -0.9 * dimensions.shinLength, 'shin points back');
  assert.ok(dot(sub(forearm.b, forearm.a), facing.forward) > 0.9 * dimensions.forearmLength, 'forearm points forward');
});

test('sitting: level thighs fold the shins straight down', () => {
  const pose = restPose();
  pose.legRight = { swing: 90, spread: 5, knee: 90, ankle: 0 };
  const shin = capsule(poseFigure(dimensions, pose, 3).primitives, Part.RightShin);
  const direction = sub(shin.b, shin.a);
  assert.ok(direction[2] < -0.95 * dimensions.shinLength, `shin z ${direction[2]}`);
});

test('the character’s right side is on screen-left when facing S (as in the guides)', () => {
  const figure = poseFigure(dimensions, restPose(), 0);
  const right = capsule(figure.primitives, Part.RightUpperArm).a;
  const left = capsule(figure.primitives, Part.LeftUpperArm).a;
  const screenX = (point: number[]) => point[0] - point[1];
  assert.ok(screenX(right) < screenX(left));
});

test('ground contact: every pose rests on z = 0 unless lifted', () => {
  for (const definition of ANIMATIONS) {
    for (let frame = 0; frame < definition.defaults.frames; frame++) {
      const pose = samplePose(definition, frameTime(frame, definition.defaults.frames, definition.defaults.loop), definition.defaults.loop);
      const figure = poseFigure(dimensions, pose, 0);
      const lowest = Math.min(...figure.primitives.map(lowestPoint));
      assert.ok(Math.abs(lowest - pose.lift * dimensions.height) < 1e-9, `${definition.key} frame ${frame}`);
    }
  }
});

test('height classes are 1 / 2 / 3 levels and build widens the body', () => {
  for (const [heightClass, levels] of [['child', 1], ['adult', 2], ['tall', 3]] as const) {
    const figure = poseFigure(bodyDimensions(defaultShape(heightClass), projection), restPose(), 0);
    const head = figure.primitives.find((primitive) => primitive.part === Part.Head)!;
    assert.ok(head.kind === 'ellipsoid');
    const top = head.center[2] + head.radii[2];
    assert.ok(Math.abs(top - levels) / levels < 0.08, `${heightClass} top ${top}`);
  }
  const thin = bodyDimensions(defaultShape('adult', 'thin'), projection);
  const wide = bodyDimensions(defaultShape('adult', 'wide'), projection);
  assert.ok(wide.chestWidth > thin.chestWidth * 1.4 && wide.thighRadius > thin.thighRadius);
});

test('walk: 8 frames land on the guide key poses; any frame count samples smoothly', () => {
  const walk = ANIMATION_BY_KEY.get('walk')!;
  const labels = Array.from({ length: 8 }, (_, frame) => frameLabel(walk, frame, 8, true));
  assert.deepEqual(labels, ['contact R', 'down', 'passing', 'up', 'contact L', 'down', 'passing', 'up']);
  // Mirrored half: frame 4 is frame 0 with sides swapped.
  const first = samplePose(walk, 0, true), half = samplePose(walk, 0.5, true);
  assert.ok(Math.abs(first.legRight.swing - half.legLeft.swing) < 1e-9);
  // 12 frames: in-betweens stay within the key extremes (no wild overshoot).
  for (let frame = 0; frame < 12; frame++) {
    const pose = samplePose(walk, frameTime(frame, 12, true), true);
    assert.ok(Math.abs(pose.legRight.swing) < 26);
  }
});

test('the figure faces each of the 8 directions', () => {
  const figure = newFigure();
  const context = figureContext(figure);
  for (let direction = 0; direction < 8; direction++) {
    const posed = posedFrame(context, 'idle', 0, direction as DirectionIndex);
    const head = posed.primitives.find((primitive) => primitive.part === Part.Head)!;
    assert.ok(head.kind === 'ellipsoid');
    const local = toLocal(facingFrame(direction as DirectionIndex), head.frame.forward);
    assert.ok(local[1] > 0.99, `direction ${direction}`);
  }
});

test('frames: auto layout fits every frame; outline wraps the silhouette', () => {
  const figure = newFigure();
  const context = figureContext(figure);
  const layout = cachedLayout(context, 'walk');
  assert.equal(layout.width % 2, 0);
  for (const key of ['walk', 'jump', 'fall', 'cheer']) {
    for (let direction = 0; direction < 8; direction++) {
      const buffers = renderBuffers(context, key, 0, direction as DirectionIndex);
      // Nothing touches the frame edge (there's always room for the outline).
      for (let x = 0; x < buffers.width; x++) {
        assert.equal(buffers.part[x], NO_PART);
        assert.equal(buffers.part[(buffers.height - 1) * buffers.width + x], NO_PART);
      }
    }
  }
  const buffers = renderBuffers(context, 'idle', 0, 0);
  let outlineOnBackground = 0;
  for (let index = 0; index < buffers.part.length; index++) if (buffers.outline[index] && buffers.part[index] === NO_PART) outlineOnBackground++;
  assert.ok(outlineOnBackground > 20, 'outside outline sits on background pixels');
});

test('fps and frame count are independent', () => {
  const figure = newFigure();
  figure.animations.walk = { ...figure.animations.walk, frames: 12, fps: 15 };
  const context = figureContext(figure);
  const twelfth = posedFrame(context, 'walk', 11, 0);
  assert.equal(twelfth.primitives.length, 16);
  assert.equal(figure.animations.walk.fps, 15);
});
