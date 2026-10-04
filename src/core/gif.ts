// Animated GIF encoder (GIF89a, LZW, global palette, binary transparency).
//
// Mannequin frames use a few dozen colours, so an exact palette always fits in
// 256 entries — no quantisation, no dithering, pixels stay true. If a frame
// set ever exceeds 255 colours, colours are snapped to a coarser grid until it
// fits. Semi-transparent pixels (the shadow) are composited onto `matte`
// because GIF has no partial alpha.

export interface GifOptions {
  /** Seconds per frame. GIF stores centiseconds, so this rounds to 10 ms. */
  frameDuration: number;
  loop: boolean;
  /** Colour to composite partial alpha onto; null keeps transparency (partial alpha < 50% drops out). */
  matte: readonly [number, number, number] | null;
}

function flattenAlpha(rgba: Uint8ClampedArray, matte: GifOptions['matte']): Uint8ClampedArray {
  const output = new Uint8ClampedArray(rgba.length);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3];
    if (matte) {
      const a = alpha / 255;
      output[offset] = rgba[offset] * a + matte[0] * (1 - a);
      output[offset + 1] = rgba[offset + 1] * a + matte[1] * (1 - a);
      output[offset + 2] = rgba[offset + 2] * a + matte[2] * (1 - a);
      output[offset + 3] = 255;
    } else if (alpha >= 128) {
      output[offset] = rgba[offset]; output[offset + 1] = rgba[offset + 1]; output[offset + 2] = rgba[offset + 2];
      output[offset + 3] = 255;
    } else if (alpha > 0 && rgba[offset] === 0 && rgba[offset + 1] === 0 && rgba[offset + 2] === 0) {
      // Translucent black (shadow) → a fixed grey so it survives binary transparency.
      output[offset] = 168; output[offset + 1] = 166; output[offset + 2] = 160; output[offset + 3] = 255;
    }
  }
  return output;
}

function buildPalette(frames: Uint8ClampedArray[]): { palette: number[]; indexOf: (r: number, g: number, b: number) => number; shift: number } {
  for (let shift = 0; shift <= 4; shift++) {
    const colours = new Map<number, number>();
    let overflow = false;
    outer: for (const frame of frames) {
      for (let offset = 0; offset < frame.length; offset += 4) {
        if (!frame[offset + 3]) continue;
        const key = ((frame[offset] >> shift) << 16) | ((frame[offset + 1] >> shift) << 8) | (frame[offset + 2] >> shift);
        if (!colours.has(key)) {
          if (colours.size >= 255) { overflow = true; break outer; }
          colours.set(key, colours.size + 1); // index 0 is transparent
        }
      }
    }
    if (overflow) continue;
    const palette = [0, 0, 0];
    for (const key of colours.keys()) {
      const restore = (value: number) => (shift ? (value << shift) | (1 << (shift - 1)) : value);
      palette.push(restore((key >> 16) & 0xff), restore((key >> 8) & 0xff), restore(key & 0xff));
    }
    return {
      palette,
      shift,
      indexOf: (r, g, b) => colours.get(((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift)) ?? 0,
    };
  }
  throw new Error('palette overflow');
}

class BitWriter {
  bytes: number[] = [];
  private accumulator = 0;
  private bitCount = 0;
  write(code: number, size: number): void {
    this.accumulator |= code << this.bitCount;
    this.bitCount += size;
    while (this.bitCount >= 8) {
      this.bytes.push(this.accumulator & 0xff);
      this.accumulator >>>= 8;
      this.bitCount -= 8;
    }
  }
  flush(): void {
    if (this.bitCount > 0) this.bytes.push(this.accumulator & 0xff);
    this.accumulator = 0;
    this.bitCount = 0;
  }
}

function lzw(indices: Uint8Array, minimumCodeSize: number): number[] {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  const writer = new BitWriter();
  let codeSize = minimumCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map<number, number>();
  writer.write(clearCode, codeSize);
  let prefix = indices[0];
  for (let position = 1; position < indices.length; position++) {
    const value = indices[position];
    const key = (prefix << 8) | value;
    const existing = dictionary.get(key);
    if (existing !== undefined) { prefix = existing; continue; }
    writer.write(prefix, codeSize);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++);
      if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      writer.write(clearCode, codeSize);
      dictionary = new Map();
      codeSize = minimumCodeSize + 1;
      nextCode = endCode + 1;
    }
    prefix = value;
  }
  writer.write(prefix, codeSize);
  writer.write(endCode, codeSize);
  writer.flush();
  return writer.bytes;
}

export function encodeGif(width: number, height: number, frames: Uint8ClampedArray[], options: GifOptions): Uint8Array {
  const flattened = frames.map((frame) => flattenAlpha(frame, options.matte));
  const { palette, indexOf } = buildPalette(flattened);
  let tableBits = 1;
  while (1 << tableBits < palette.length / 3) tableBits++;
  const tableSize = 1 << tableBits;
  const output: number[] = [];
  const u16 = (value: number) => output.push(value & 0xff, (value >> 8) & 0xff);
  const ascii = (text: string) => { for (const character of text) output.push(character.charCodeAt(0)); };

  ascii('GIF89a');
  u16(width); u16(height);
  output.push(0x80 | ((tableBits - 1) << 4) | (tableBits - 1), 0, 0);
  for (let index = 0; index < tableSize; index++) output.push(palette[index * 3] ?? 0, palette[index * 3 + 1] ?? 0, palette[index * 3 + 2] ?? 0);
  if (options.loop) {
    output.push(0x21, 0xff, 0x0b); ascii('NETSCAPE2.0'); output.push(0x03, 0x01); u16(0); output.push(0);
  }
  const delay = Math.max(2, Math.round(options.frameDuration * 100));
  const minimumCodeSize = Math.max(2, tableBits);
  for (const frame of flattened) {
    // Graphic control: disposal 2 (restore to background) so transparent areas clear between frames.
    output.push(0x21, 0xf9, 0x04, (2 << 2) | 1); u16(delay); output.push(0, 0);
    output.push(0x2c); u16(0); u16(0); u16(width); u16(height); output.push(0);
    const indices = new Uint8Array(width * height);
    for (let index = 0; index < indices.length; index++) {
      const offset = index * 4;
      indices[index] = frame[offset + 3] ? indexOf(frame[offset], frame[offset + 1], frame[offset + 2]) : 0;
    }
    output.push(minimumCodeSize);
    const data = lzw(indices, minimumCodeSize);
    for (let start = 0; start < data.length; start += 255) {
      const block = data.slice(start, start + 255);
      output.push(block.length, ...block);
    }
    output.push(0);
  }
  output.push(0x3b);
  return Uint8Array.from(output);
}
