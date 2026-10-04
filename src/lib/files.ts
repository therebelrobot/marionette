// Browser side of exporting: PNG via canvas, and handing files to the user.

import type { PngEncoder } from '../core/exporting';

export function rgbaToCanvas(rgba: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas;
}

export const encodePngInBrowser: PngEncoder = (rgba, width, height) =>
  new Promise((resolve, reject) => {
    rgbaToCanvas(rgba, width, height).toBlob(async (blob) => {
      if (!blob) return reject(new Error('PNG encoding failed'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });

/**
 * iPad: the share sheet lists Procreate and "Save to Files". Desktop: download.
 * navigator.share needs HTTPS, so over plain-HTTP LAN it falls back to download.
 */
export async function deliverFile(bytes: Uint8Array | Blob, filename: string, type: string, preferShare: boolean): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const file = new File([blob], filename, { type });
  if (preferShare && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

export function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}
