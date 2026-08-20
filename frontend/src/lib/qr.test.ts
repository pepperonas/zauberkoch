/** The QR encoder is verified by DECODING ITS OWN OUTPUT, not by eyeballing a
 * picture: reverse the mask and the zigzag placement, de-interleave the blocks,
 * check the Reed-Solomon syndromes are zero, and read the payload back. A
 * wrong bit anywhere in the pipeline fails here — an eyeballed screenshot
 * would not, because a broken QR still looks exactly like a QR.
 *
 * The complementary check lives in e2e/share.spec.ts, where Chrome's own
 * BarcodeDetector reads the rendered SVG: this suite proves the bits are
 * right, that one proves a real scanner agrees.
 */
import { describe, expect, it } from 'vitest';

import { capacity, functionModules, MAX_VERSION, qrMatrix, qrPath } from './qr';

/* ── A minimal decoder, written independently of the encoder's helpers ──── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const VERSIONS: Record<number, [number, number, [number, number][]]> = {
  1: [26, 13, [[1, 13]]],
  2: [44, 22, [[1, 22]]],
  3: [70, 18, [[2, 17]]],
  4: [100, 26, [[2, 24]]],
  5: [134, 18, [[2, 15], [2, 16]]],
  6: [172, 24, [[4, 19]]],
  7: [196, 18, [[2, 14], [4, 15]]],
  8: [242, 22, [[4, 18], [2, 19]]],
  9: [292, 20, [[4, 16], [4, 17]]],
  10: [346, 24, [[6, 19], [2, 20]]],
};

/** Walk the zigzag exactly as the encoder does, but only to collect the
 *  addresses of the data cells. */
function dataCells(version: number): [number, number][] {
  const reserved = functionModules(version);
  const size = reserved.length;
  const cells: [number, number][] = [];
  let row = size - 1;
  let inc = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) if (reserved[row][col - c] === null) cells.push([row, col - c]);
      row += inc;
      if (row < 0 || row >= size) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
  return cells;
}

/** Syndromes of a codeword block; all-zero means "no detectable error". */
function syndromes(block: number[], ecCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ecCount; i++) {
    let s = 0;
    for (const b of block) s = gmul(s, EXP[i]) ^ b;
    out.push(s);
  }
  return out;
}

interface Decoded {
  text: string;
  syndromesClean: boolean;
}

function decode(code: ReturnType<typeof qrMatrix>): Decoded {
  const { matrix, version, mask } = code;
  const [, ecCount, groups] = VERSIONS[version];

  // 1. unmask the data cells and read the interleaved codeword stream
  const bits: number[] = [];
  for (const [r, c] of dataCells(version)) {
    const bit = MASKS[mask](r, c) ? matrix[r][c] ^ 1 : matrix[r][c];
    bits.push(bit);
  }
  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    stream.push(b);
  }

  // 2. de-interleave into blocks (data first, then EC — reverse of the encoder)
  const sizes: number[] = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i++) sizes.push(len);
  const data: number[][] = sizes.map(() => []);
  let at = 0;
  const maxData = Math.max(...sizes);
  for (let i = 0; i < maxData; i++)
    for (let b = 0; b < sizes.length; b++) if (i < sizes[b]) data[b].push(stream[at++]);
  const ec: number[][] = sizes.map(() => []);
  for (let i = 0; i < ecCount; i++) for (let b = 0; b < sizes.length; b++) ec[b].push(stream[at++]);

  const syndromesClean = data.every((d, i) => syndromes([...d, ...ec[i]], ecCount).every((s) => s === 0));

  // 3. read mode + length + payload out of the concatenated data blocks
  const payloadBits: number[] = [];
  for (const d of data) for (const byte of d) for (let i = 7; i >= 0; i--) payloadBits.push((byte >>> i) & 1);
  const take = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | payloadBits.shift()!;
    return v;
  };
  const mode = take(4);
  expect(mode).toBe(0b0100); // byte mode
  const len = take(version < 10 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), syndromesClean };
}

/* ── The tests ──────────────────────────────────────────────────────────── */

describe('qrMatrix', () => {
  it('encodes the app URL so it decodes back byte for byte', () => {
    const text = 'https://zauberkoch.de';
    const decoded = decode(qrMatrix(text));
    expect(decoded.text).toBe(text);
    expect(decoded.syndromesClean).toBe(true);
  });

  it('round-trips payloads across every version boundary it claims to support', () => {
    // One string at exactly the capacity of each version: the version picker,
    // the length field and the block interleaving all change along the way,
    // and a table typo would only ever show up at one specific size.
    for (let v = 1; v <= MAX_VERSION; v++) {
      const text = 'x'.repeat(capacity(v));
      const code = qrMatrix(text);
      expect(code.version, `capacity(${v}) should still fit version ${v}`).toBe(v);
      const decoded = decode(code);
      expect(decoded.text, `version ${v}`).toBe(text);
      expect(decoded.syndromesClean, `version ${v} syndromes`).toBe(true);
    }
  });

  it('survives UTF-8 beyond ASCII', () => {
    // The length field counts BYTES, not characters — an emoji is four of them.
    const text = 'Zauberkoch 🧑‍🍳 — Rezepte für alle';
    expect(decode(qrMatrix(text)).text).toBe(text);
  });

  it('refuses payloads it cannot encode instead of truncating them', () => {
    // Silent truncation would produce a perfectly scannable code pointing at
    // the wrong URL — the worst possible failure for a share feature.
    expect(() => qrMatrix('x'.repeat(capacity(MAX_VERSION) + 1))).toThrow(/version/i);
  });

  it('places the three finder patterns', () => {
    const { matrix, size } = qrMatrix('https://zauberkoch.de');
    for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(matrix[br + 3][bc + 3], 'finder core').toBe(1);
      expect(matrix[br + 1][bc + 1], 'finder ring gap').toBe(0);
    }
    // …and NOT a fourth one bottom right, which is what tells a scanner the
    // orientation of the code.
    expect(matrix[size - 4][size - 4]).not.toBe(matrix[3][3] === 1 ? 1 : 0);
  });

  it('keeps the app URL small enough to scan comfortably', () => {
    // 21 bytes lands in version 3 (29 modules a side) — level Q fits exactly
    // 20 into version 2, so the URL misses it by one character. At the 220px
    // the dialog renders, that is still ~7.5px per module; a phone camera
    // wants ~2. The pin exists so a longer share URL (a campaign parameter,
    // say) cannot quietly push the code to a size that needs a bigger canvas.
    expect(qrMatrix('https://zauberkoch.de').version).toBeLessThanOrEqual(3);
  });
});

describe('qrPath', () => {
  it('adds a quiet zone on both sides', () => {
    const { dim } = qrPath('https://zauberkoch.de', 4);
    expect(dim).toBe(qrMatrix('https://zauberkoch.de').size + 8);
  });

  it('draws every dark module and nothing else', () => {
    const { matrix } = qrMatrix('hello');
    const dark = matrix.flat().filter((v) => v === 1).length;
    const { d } = qrPath('hello', 0);
    // Each run contributes `h<w>` — the widths must add up to the module count.
    // Off by one anywhere in the run-merging and this diverges immediately.
    const widths = [...d.matchAll(/h(\d+)/g)].map((m) => Number(m[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(dark);
  });
});
