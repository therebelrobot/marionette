import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { newFigure } from '../src/core/document';
import { animationGif, animationPsd, buildExport } from '../src/core/exporting';
import { encodeGif } from '../src/core/gif';
import { packBits } from '../src/core/psd';
import { cachedLayout, figureContext } from '../src/core/pipeline';
import { createZip } from '../src/core/zip';
import { encodePng } from './png-node';

const directory = mkdtempSync(join(tmpdir(), 'marionette-'));

function python(script: string, ...args: string[]): string | null {
  try {
    return execFileSync('python3', ['-c', script, ...args], { encoding: 'utf8' });
  } catch (error) {
    const message = String((error as { stderr?: string }).stderr ?? error);
    if (message.includes('ModuleNotFoundError')) return null;
    throw new Error(message);
  }
}

function unpackBits(packed: Uint8Array, expected: number): Uint8Array {
  const output: number[] = [];
  let index = 0;
  while (output.length < expected) {
    const header = packed[index++];
    if (header < 128) { for (let count = 0; count <= header; count++) output.push(packed[index++]); }
    else if (header > 128) { const value = packed[index++]; for (let count = 0; count < 257 - header; count++) output.push(value); }
  }
  return Uint8Array.from(output);
}

test('packBits round-trips', () => {
  for (const sample of [Uint8Array.from([1, 1, 1, 2, 3, 3]), new Uint8Array(300).fill(4), Uint8Array.from({ length: 300 }, (_, i) => i % 7)]) {
    assert.deepEqual(unpackBits(packBits(sample), sample.length), sample);
  }
});

test('Procreate animation PSD: one group per frame, part layers inside', (context) => {
  const figure = newFigure();
  const ctx = figureContext(figure);
  const path = join(directory, 'walk.psd');
  writeFileSync(path, animationPsd(ctx, 'walk', 0, 1));
  const output = python(
    `import sys
from psd_tools import PSDImage
psd = PSDImage.open(sys.argv[1])
print(psd.width, psd.height, len(psd))
for group in psd:
    print(group.kind, group.name, '|', ','.join(layer.name for layer in group), '|', sum(1 for layer in group if layer.topil() is not None and layer.topil().getbbox()))
psd.composite()`,
    path,
  );
  if (output === null) return context.skip('psd-tools not installed');
  const lines = output.trim().split('\n');
  const layout = cachedLayout(ctx, 'walk');
  assert.equal(lines[0], `${layout.width} ${layout.height} 8`);
  assert.match(lines[1], /^group Frame 1 - contact R \| Shadow,Left leg,Right leg,Left arm,Right arm,Body,Head,Lines \| 8$/);
  assert.match(lines[5], /^group Frame 5 - contact L /);
});

test('GIF decodes to exactly the rendered frames', (context) => {
  const width = 6, height = 4;
  const frames = [0, 1, 2].map((shift) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index++) {
      if ((index + shift) % 3 === 0) continue; // transparent
      rgba.set([(index * 40 + shift * 10) % 256, 100, 200 - shift * 20, 255], index * 4);
    }
    return rgba;
  });
  const path = join(directory, 'test.gif');
  writeFileSync(path, encodeGif(width, height, frames, { frameDuration: 0.1, loop: true, matte: null }));
  const output = python(
    `import sys
from PIL import Image
im = Image.open(sys.argv[1])
out = []
for i in range(im.n_frames):
    im.seek(i)
    rgba = im.convert('RGBA')
    out.append(','.join('%d.%d.%d.%d' % p if p[3] else 't' for p in rgba.getdata()))
    out.append(str(im.info.get('duration')))
print('\\n'.join(out))`,
    path,
  );
  if (output === null) return context.skip('Pillow not installed');
  const lines = output.trim().split('\n');
  frames.forEach((frame, index) => {
    const expected = Array.from({ length: width * height }, (_, pixel) =>
      frame[pixel * 4 + 3] ? `${frame[pixel * 4]}.${frame[pixel * 4 + 1]}.${frame[pixel * 4 + 2]}.255` : 't').join(',');
    assert.equal(lines[index * 2], expected, `frame ${index}`);
    assert.equal(lines[index * 2 + 1], '100');
  });
});

test('real animation GIF (8-way compass) is readable', (context) => {
  const ctx = figureContext(newFigure());
  const path = join(directory, 'walk8.gif');
  writeFileSync(path, animationGif(ctx, 'walk', 'compass', 2));
  const output = python(`import sys
from PIL import Image
im = Image.open(sys.argv[1]); print(im.n_frames, im.size, im.info.get('duration'), im.info.get('loop'))`, path);
  if (output === null) return context.skip('Pillow not installed');
  const layout = cachedLayout(ctx, 'walk');
  assert.equal(output.trim(), `8 (${layout.width * 6}, ${layout.height * 6}) 100 0`);
});

test('full export bundle matches the guide folder layout and is a valid zip', async (context) => {
  const figure = newFigure();
  const entries = await buildExport(figure, { animations: ['idle', 'walk'], directions: [0, 1, 2, 3, 4, 5, 6, 7], scale: 1, formats: ['frames', 'sheet', 'psd', 'gif'] },
    async (rgba, width, height) => new Uint8Array(encodePng(rgba, width, height)));
  const names = entries.map((entry) => entry.name);
  for (const expected of ['walk_frames/0_S_walk_0.png', 'walk_frames/7_SE_walk_7.png', 'idle_strips/4_N_idle_strip.png', 'sheets/walk_sheet.png', 'sheets/walk_sheet.json', 'procreate/walk/2_W_walk.psd', 'previews/walk_8way.gif', 'figure.json']) {
    assert.ok(names.includes(expected), expected);
  }
  assert.equal(names.filter((name) => name.startsWith('walk_frames/')).length, 64);
  const sheet = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === 'sheets/walk_sheet.json')!.data));
  assert.equal(sheet.fps, 10);
  assert.equal(sheet.frameDurationMs, 100);
  const path = join(directory, 'bundle.zip');
  writeFileSync(path, createZip(entries));
  const output = python(`import sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist()))`, path);
  if (output === null) return context.skip('python unavailable');
  assert.equal(Number(output.trim()), entries.length);
});
