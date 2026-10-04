// Dev aid: contact sheet in the guide layout (rows = 8 directions, columns = frames).
//   npx tsx test/preview.ts out.png [animations=idle,walk] [scale=4] [class=adult] [build=regular]
import { writeFileSync } from 'node:fs';
import { ANIMATION_BY_KEY } from '../src/core/animations';
import { blit, upscale } from '../src/core/compose';
import { newFigure } from '../src/core/document';
import { cachedLayout, figureContext, renderImage, settingsFor } from '../src/core/pipeline';
import type { Build, DirectionIndex, HeightClass } from '../src/core/types';
import { encodePng } from './png-node';

const [outputPath = 'preview.png', animationList = 'idle,walk', scaleText = '4', heightClass = 'adult', build = 'regular', colour = 'guide', fit = 'per-animation'] = process.argv.slice(2);
const document = newFigure('preview', heightClass as HeightClass, build as Build);
document.look.colourMode = colour as 'guide' | 'grey';
document.frame.fit = fit as 'shared' | 'per-animation';
const context = figureContext(document);
const keys = animationList.split(',');
const layouts = keys.map((key) => cachedLayout(context, key));
const layout = { width: Math.max(...layouts.map((l) => l.width)), height: Math.max(...layouts.map((l) => l.height)) };
const gap = 2;
const columns = keys.reduce((total, key) => total + settingsFor(document, key).frames, 0);
const directionList = (process.env.DIRS ?? '0,1,2,3,4,5,6,7').split(',').map(Number);
const sheetWidth = columns * (layout.width + gap), sheetHeight = directionList.length * (layout.height + gap);
const sheet = new Uint8ClampedArray(sheetWidth * sheetHeight * 4);
for (let index = 0; index < sheetWidth * sheetHeight; index++) sheet.set([245, 242, 236, 255], index * 4);
const started = performance.now();
let column = 0;
for (const key of keys) {
  if (!ANIMATION_BY_KEY.has(key)) throw new Error(`unknown animation ${key}`);
  const frames = settingsFor(document, key).frames;
  for (let frame = 0; frame < frames; frame++, column++) {
    for (const [row, direction] of directionList.entries()) {
      const image = renderImage(context, key, frame, direction as DirectionIndex);
      // Composite over the paper colour.
      const cell = new Uint8ClampedArray(image.rgba.length);
      for (let index = 0; index < image.width * image.height; index++) {
        const alpha = image.rgba[index * 4 + 3] / 255;
        for (let channel = 0; channel < 3; channel++) cell[index * 4 + channel] = image.rgba[index * 4 + channel] * alpha + [245, 242, 236][channel] * (1 - alpha);
        cell[index * 4 + 3] = 255;
      }
      blit(sheet, sheetWidth, cell, image.width, image.height, column * (layout.width + gap), row * (layout.height + gap));
    }
  }
}
console.log(`frame ${layout.width}×${layout.height}, ${columns * 8} frames in ${(performance.now() - started).toFixed(0)}ms`);
const scale = Number(scaleText);
writeFileSync(outputPath, encodePng(upscale(sheet, sheetWidth, sheetHeight, scale), sheetWidth * scale, sheetHeight * scale));
