// Layered PSD writer (8-bit RGB + alpha, PackBits) with layer groups.
//
// Why groups: Procreate's Animation Assist treats every top-level layer *or
// group* as one frame. Writing each frame as a group of its part layers
// (Shadow, Left leg … Head, Lines) gives an animation that plays in Procreate
// straight after import while keeping every limb on its own layer.
//
// Spec: Adobe Photoshop File Format Specification — layer records are stored
// bottom-to-top; a group is a "bounding section divider" record (lsct type 3),
// then its children, then the folder record itself (lsct type 1 = open,
// 2 = closed).

export interface PsdLayer {
  name: string;
  rgba: Uint8ClampedArray;
  hidden?: boolean;
}

export interface PsdGroup {
  name: string;
  children: PsdNode[];
  hidden?: boolean;
  open?: boolean;
}

export type PsdNode = PsdLayer | PsdGroup;

const isGroup = (node: PsdNode): node is PsdGroup => 'children' in node;

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private current = new Uint8Array(1 << 16);
  private offset = 0;
  length = 0;
  private ensure(size: number): void {
    if (this.offset + size <= this.current.length) return;
    this.chunks.push(this.current.subarray(0, this.offset));
    this.current = new Uint8Array(Math.max(1 << 16, size));
    this.offset = 0;
  }
  u8(value: number): void { this.ensure(1); this.current[this.offset++] = value & 0xff; this.length += 1; }
  u16(value: number): void { this.u8(value >>> 8); this.u8(value); }
  i16(value: number): void { this.u16(value & 0xffff); }
  u32(value: number): void { this.u16((value >>> 16) & 0xffff); this.u16(value & 0xffff); }
  ascii(text: string): void { for (let index = 0; index < text.length; index++) this.u8(text.charCodeAt(index)); }
  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.current.set(data, this.offset);
    this.offset += data.length;
    this.length += data.length;
  }
  finish(): Uint8Array {
    this.chunks.push(this.current.subarray(0, this.offset));
    const output = new Uint8Array(this.length);
    let position = 0;
    for (const chunk of this.chunks) { output.set(chunk, position); position += chunk.length; }
    return output;
  }
}

export function packBits(row: Uint8Array): Uint8Array {
  const output: number[] = [];
  let index = 0;
  while (index < row.length) {
    let run = 1;
    while (index + run < row.length && run < 128 && row[index + run] === row[index]) run++;
    if (run >= 2) {
      output.push(257 - run, row[index]);
      index += run;
      continue;
    }
    let literal = 1;
    while (
      index + literal < row.length &&
      literal < 128 &&
      !(index + literal + 1 < row.length && row[index + literal] === row[index + literal + 1])
    ) literal++;
    output.push(literal - 1);
    for (let offset = 0; offset < literal; offset++) output.push(row[index + offset]);
    index += literal;
  }
  return Uint8Array.from(output);
}

function planes(rgba: Uint8ClampedArray, size: number): Uint8Array[] {
  const red = new Uint8Array(size), green = new Uint8Array(size), blue = new Uint8Array(size), alpha = new Uint8Array(size);
  for (let index = 0; index < size; index++) {
    red[index] = rgba[index * 4];
    green[index] = rgba[index * 4 + 1];
    blue[index] = rgba[index * 4 + 2];
    alpha[index] = rgba[index * 4 + 3];
  }
  return [red, green, blue, alpha];
}

interface EncodedChannel { rowLengths: number[]; rows: Uint8Array[]; byteLength: number }

function encodeChannel(plane: Uint8Array, width: number, height: number): EncodedChannel {
  const rows: Uint8Array[] = [];
  const rowLengths: number[] = [];
  let byteLength = 0;
  for (let y = 0; y < height; y++) {
    const packed = packBits(plane.subarray(y * width, (y + 1) * width));
    rows.push(packed);
    rowLengths.push(packed.length);
    byteLength += packed.length;
  }
  return { rows, rowLengths, byteLength };
}

function pascalName(name: string): Uint8Array {
  const ascii = name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255);
  const total = Math.ceil((ascii.length + 1) / 4) * 4;
  const output = new Uint8Array(total);
  output[0] = ascii.length;
  for (let index = 0; index < ascii.length; index++) output[index + 1] = ascii.charCodeAt(index);
  return output;
}

/** One flattened record: a pixel layer, a group's divider, or a group's folder. */
type Record =
  | { kind: 'pixels'; name: string; hidden: boolean; channels: EncodedChannel[] }
  | { kind: 'divider' }
  | { kind: 'folder'; name: string; hidden: boolean; open: boolean };

/** Depth-first, bottom-to-top, the order PSD stores records. Input lists are bottom-to-top too. */
function flattenNodes(nodes: PsdNode[], width: number, height: number, records: Record[]): void {
  for (const node of nodes) {
    if (isGroup(node)) {
      records.push({ kind: 'divider' });
      flattenNodes(node.children, width, height, records);
      records.push({ kind: 'folder', name: node.name, hidden: !!node.hidden, open: node.open ?? false });
    } else {
      records.push({
        kind: 'pixels', name: node.name, hidden: !!node.hidden,
        channels: planes(node.rgba, width * height).map((plane) => encodeChannel(plane, width, height)),
      });
    }
  }
}

function flattenVisible(nodes: PsdNode[], size: number, output: Uint8ClampedArray): void {
  for (const node of nodes) {
    if (node.hidden) continue;
    if (isGroup(node)) { flattenVisible(node.children, size, output); continue; }
    for (let index = 0; index < size; index++) {
      const offset = index * 4;
      const alpha = node.rgba[offset + 3] / 255;
      if (alpha === 0) continue;
      const below = output[offset + 3] / 255;
      const outAlpha = alpha + below * (1 - alpha);
      for (let channel = 0; channel < 3; channel++) {
        output[offset + channel] = (node.rgba[offset + channel] * alpha + output[offset + channel] * below * (1 - alpha)) / outAlpha;
      }
      output[offset + 3] = outAlpha * 255;
    }
  }
}

export interface PsdOptions {
  /** Pixels for the merged preview; defaults to flattening visible layers. */
  composite?: Uint8ClampedArray;
}

export function encodePsd(width: number, height: number, nodes: PsdNode[], options: PsdOptions = {}): Uint8Array {
  const size = width * height;
  const writer = new ByteWriter();
  writer.ascii('8BPS');
  writer.u16(1);
  for (let index = 0; index < 6; index++) writer.u8(0);
  writer.u16(4);
  writer.u32(height);
  writer.u32(width);
  writer.u16(8);
  writer.u16(3);
  writer.u32(0); // colour mode data
  writer.u32(0); // image resources

  const records: Record[] = [];
  flattenNodes(nodes, width, height, records);

  const info = new ByteWriter();
  info.i16(records.length);
  const channelIds = [0, 1, 2, -1];
  for (const record of records) {
    const isPixels = record.kind === 'pixels';
    if (isPixels) { info.u32(0); info.u32(0); info.u32(height); info.u32(width); }
    else { info.u32(0); info.u32(0); info.u32(0); info.u32(0); }
    info.u16(4);
    for (let channel = 0; channel < 4; channel++) {
      info.i16(channelIds[channel]);
      // Pixel layers: RLE header + row table + data. Group records: a bare raw header.
      info.u32(isPixels ? 2 + height * 2 + record.channels[channel].byteLength : 2);
    }
    info.ascii('8BIM');
    info.ascii(record.kind === 'folder' ? 'pass' : 'norm');
    info.u8(255);
    info.u8(0);
    const hidden = record.kind !== 'divider' && record.hidden;
    info.u8(hidden ? 0b10 : 0);
    info.u8(0);
    const name = pascalName(record.kind === 'divider' ? '</Layer group>' : record.name);
    // Additional info: lsct marks group structure.
    const sectionType = record.kind === 'divider' ? 3 : record.kind === 'folder' ? (record.open ? 1 : 2) : -1;
    const lsctLength = sectionType >= 0 ? 4 + 4 + 4 + 4 : 0;
    info.u32(4 + 4 + name.length + lsctLength);
    info.u32(0); // mask
    info.u32(0); // blending ranges
    info.bytes(name);
    if (sectionType >= 0) {
      info.ascii('8BIM');
      info.ascii('lsct');
      info.u32(4);
      info.u32(sectionType);
    }
  }
  for (const record of records) {
    if (record.kind === 'pixels') {
      for (const channel of record.channels) {
        info.u16(1);
        for (const length of channel.rowLengths) info.u16(length);
        for (const row of channel.rows) info.bytes(row);
      }
    } else {
      for (let channel = 0; channel < 4; channel++) info.u16(0);
    }
  }
  if (info.length % 2 === 1) info.u8(0);
  const infoBytes = info.finish();

  writer.u32(4 + infoBytes.length + 4);
  writer.u32(infoBytes.length);
  writer.bytes(infoBytes);
  writer.u32(0); // global layer mask

  let composite = options.composite;
  if (!composite) {
    composite = new Uint8ClampedArray(size * 4);
    flattenVisible(nodes, size, composite);
  }
  const merged = planes(composite, size).map((plane) => encodeChannel(plane, width, height));
  writer.u16(1);
  for (const channel of merged) for (const length of channel.rowLengths) writer.u16(length);
  for (const channel of merged) for (const row of channel.rows) writer.bytes(row);
  return writer.finish();
}
