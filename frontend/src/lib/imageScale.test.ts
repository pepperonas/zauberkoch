// @vitest-environment happy-dom
/**
 * The fridge scan uploads a photo to a vision model. Phones hand us 12 MP
 * files; sending those unchanged costs the user upload time and costs us
 * tokens for detail no model needs. This module is the guard, and the parts
 * worth pinning are: never upscale, keep the aspect ratio, hand back bare
 * base64 (the API rejects a full data URL), and release the bitmap.
 *
 * happy-dom has no canvas implementation, so the canvas and createImageBitmap
 * are stubbed — the arithmetic is what is under test, not the browser's raster.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downscaleToJpegBase64 } from './imageScale';

type DrawCall = { w: number; h: number };

let drawn: DrawCall[];
let canvases: { width: number; height: number; quality?: number }[];
let closed: number;
let contextAvailable: boolean;

/** A stand-in for the decoded image. */
function fakeBitmap(width: number, height: number) {
  return { width, height, close: () => void (closed += 1) };
}

beforeEach(() => {
  drawn = [];
  canvases = [];
  closed = 0;
  contextAvailable = true;

  vi.stubGlobal('createImageBitmap', vi.fn(async (file: unknown) => (file as { bitmap: unknown }).bitmap));

  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () =>
        contextAvailable
          ? { drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => drawn.push({ w, h }) }
          : null,
      toDataURL: (_type: string, quality: number) => {
        canvases.push({ width: canvas.width, height: canvas.height, quality });
        return 'data:image/jpeg;base64,QUJD';
      },
    };
    return canvas as unknown as HTMLElement;
  }) as typeof document.createElement);
});

afterEach(() => vi.unstubAllGlobals());

/** Run the module against a fake file carrying a bitmap of the given size. */
const scale = (w: number, h: number, maxEdge?: number, quality?: number) =>
  downscaleToJpegBase64({ bitmap: fakeBitmap(w, h) } as unknown as File, maxEdge, quality);

describe('sizing', () => {
  it('caps the long edge of a landscape photo', async () => {
    await scale(4032, 3024);
    expect(canvases[0]).toMatchObject({ width: 1024, height: 768 });
  });

  it('caps the long edge of a portrait photo', async () => {
    await scale(3024, 4032);
    expect(canvases[0]).toMatchObject({ width: 768, height: 1024 });
  });

  it('preserves the aspect ratio', async () => {
    await scale(4000, 2000);
    const { width, height } = canvases[0];
    expect(width / height).toBeCloseTo(2, 5);
  });

  it('never upscales a small image', async () => {
    // Blowing a 320px thumbnail up to 1024 adds bytes and no information.
    await scale(320, 240);
    expect(canvases[0]).toMatchObject({ width: 320, height: 240 });
  });

  it('leaves an image that is exactly at the limit alone', async () => {
    await scale(1024, 512);
    expect(canvases[0]).toMatchObject({ width: 1024, height: 512 });
  });

  it('honours a custom max edge', async () => {
    await scale(2048, 1024, 512);
    expect(canvases[0]).toMatchObject({ width: 512, height: 256 });
  });

  it('rounds to whole pixels', async () => {
    await scale(1000, 333, 100);
    const { width, height } = canvases[0];
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(height).toBe(33);
  });

  it('draws at the computed size, not at the original one', async () => {
    await scale(4032, 3024);
    expect(drawn).toEqual([{ w: 1024, h: 768 }]);
  });
});

describe('output', () => {
  it('returns bare base64 without the data-URL prefix', async () => {
    // The backend decodes this straight into the vision block; a "data:..."
    // prefix would make it invalid base64.
    await expect(scale(100, 100)).resolves.toBe('QUJD');
  });

  it('passes the default JPEG quality through', async () => {
    await scale(100, 100);
    expect(canvases[0].quality).toBe(0.8);
  });

  it('honours a custom quality', async () => {
    await scale(100, 100, 1024, 0.5);
    expect(canvases[0].quality).toBe(0.5);
  });
});

describe('resource handling', () => {
  it('closes the bitmap so the decoded image is not held', async () => {
    await scale(4032, 3024);
    expect(closed).toBe(1);
  });

  it('throws a clear error when no 2D context is available', async () => {
    contextAvailable = false;
    await expect(scale(100, 100)).rejects.toThrow('canvas unavailable');
  });
});
