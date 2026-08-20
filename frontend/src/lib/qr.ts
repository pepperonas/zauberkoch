/** QR encoder — byte mode, error-correction level Q, versions 1–10.
 *
 * Hand-rolled rather than a dependency, for the same reason the rest of this
 * frontend is: the popular QR packages drag a tree behind them (arg parsers,
 * PNG encoders, canvas shims) for a handful of deterministic bit operations,
 * and this module is loaded lazily into a footer dialog. The algorithm is
 * fully specified in ISO/IEC 18004.
 *
 * It is not trusted, it is checked: `qr.test.ts` decodes the matrix back to
 * the input (reversing placement, mask and interleaving) and verifies the
 * Reed-Solomon syndromes are zero, and an e2e test lets Chrome's own
 * BarcodeDetector read the rendered SVG.
 *
 * Level Q (25 % recovery) instead of the usual M: this code gets photographed
 * off a screen at an angle, in a dark room, possibly through a smudge. At ~20
 * bytes of payload the extra redundancy is free — still version 2.
 *
 * Ported from celox-portal's server/qr.js (same author, same tests).
 */

/* ── GF(256), primitive polynomial x⁸+x⁴+x³+x²+1 (0x11D) ─────────────────── */
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
const gmul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial of degree n: ∏ (x − α^i). Index 0 = highest degree. */
function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]; // g · x
      next[j + 1] ^= gmul(g[j], EXP[i]); // g · α^i
    }
    g = next;
  }
  return g;
}

/** Error-correction codewords of one block (polynomial division in GF). */
function rsEncode(data: number[], ecCount: number): number[] {
  const gen = rsGenerator(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 1; j < gen.length; j++) res[i + j] ^= gmul(gen[j], factor);
  }
  return Array.from(res.slice(data.length));
}

/* ── Version tables (level Q only) ────────────────────────────────────────
   [total codewords, EC codewords per block, [[blocks, data codewords], …]] */
type VersionSpec = [number, number, [number, number][]];
const VERSIONS: Record<number, VersionSpec> = {
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
/** Alignment-pattern centres per version. */
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
export const MAX_VERSION = 10;

const dataCodewords = (v: number): number =>
  VERSIONS[v][2].reduce((n, [blocks, count]) => n + blocks * count, 0);

/** Payload in bytes: total minus mode (4 bit) + length field (8 bit up to V9,
 *  16 bit from V10). The remainder has to fit whole bytes. */
export const capacity = (v: number): number =>
  Math.floor((dataCodewords(v) * 8 - 4 - (v < 10 ? 8 : 16)) / 8);

function pickVersion(byteLength: number): number {
  for (let v = 1; v <= MAX_VERSION; v++) if (byteLength <= capacity(v)) return v;
  throw new Error(`QR: ${byteLength} bytes exceed version ${MAX_VERSION} (max ${capacity(MAX_VERSION)}).`);
}

/* ── BCH check bits for format and version information ───────────────────── */
const bitLength = (n: number): number => {
  let l = 0;
  while (n !== 0) {
    l++;
    n >>>= 1;
  }
  return l;
};
function bch(value: number, shift: number, poly: number): number {
  let d = value << shift;
  while (bitLength(d) - bitLength(poly) >= 0) d ^= poly << (bitLength(d) - bitLength(poly));
  return (value << shift) | d;
}
/** Level Q = indicator 0b11; 15 bit, masked with 0x5412 (never an all-zero word). */
const formatBits = (mask: number): number => bch((0b11 << 3) | mask, 10, 0x537) ^ 0x5412;
const versionBits = (v: number): number => bch(v, 12, 0x1f25);

/* ── Mask formulas ───────────────────────────────────────────────────────── */
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

/* ── Bit stream ──────────────────────────────────────────────────────────── */
function bitStream(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // mode: byte
  push(bytes.length, version < 10 ? 8 : 16); // length field
  for (const b of bytes) push(b, 8);
  const total = dataCodewords(version) * 8;
  for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0); // pad to whole bytes
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    words.push(b);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; words.length < dataCodewords(version); i++) words.push(PAD[i % 2]);
  return words;
}

/** Build blocks, compute EC, interleave (data first, then EC). */
function codewords(bytes: number[], version: number): number[] {
  const [, ecCount, groups] = VERSIONS[version];
  const words = bitStream(bytes, version);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let at = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const data = words.slice(at, at + size);
      at += size;
      blocks.push({ data, ec: rsEncode(data, ecCount) });
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecCount; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

/* ── Matrix ──────────────────────────────────────────────────────────────── */
type Cell = 0 | 1 | null;

export function functionModules(version: number): Cell[][] {
  const size = version * 4 + 17;
  const m: Cell[][] = Array.from({ length: size }, () => new Array<Cell>(size).fill(null));
  const set = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = dark ? 1 : 0;
  };

  // Finder patterns (7×7) including the light separator ring.
  for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inRing = (r === 0 || r === 6) && c >= 0 && c <= 6;
        const inSide = (c === 0 || c === 6) && r >= 0 && r <= 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(br + r, bc + c, inRing || inSide || inCore);
      }
    }
  }
  // Timing patterns (row/column 6) — alternating, starting dark.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns (5×5), except where they would overlap a finder.
  const centers = ALIGN[version];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  // Always-dark module + reserved format-information areas.
  set(size - 8, 8, true);
  for (let i = 0; i <= 8; i++) {
    if (m[8][i] === null) set(8, i, false);
    if (m[i][8] === null) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) set(8, size - 1 - i, false);
    if (m[size - 1 - i][8] === null) set(size - 1 - i, 8, false);
  }
  // Version information (two 6×3 blocks) from version 7.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      set(Math.floor(i / 3), (i % 3) + size - 11, dark);
      set((i % 3) + size - 11, Math.floor(i / 3), dark);
    }
  }
  return m;
}

/** Data bits zigzag from bottom right to top left; column 6 (timing) is
 *  skipped. Returns the occupied positions in placement order — the mask is
 *  applied afterwards. */
function placeData(m: Cell[][], words: number[]): [number, number][] {
  const size = m.length;
  const cells: [number, number][] = [];
  let row = size - 1;
  let inc = -1;
  let bit = 7;
  let byte = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (m[row][col - c] !== null) continue;
        const dark = byte < words.length && ((words[byte] >>> bit) & 1) === 1;
        m[row][col - c] = dark ? 1 : 0;
        cells.push([row, col - c]);
        if (--bit < 0) {
          byte++;
          bit = 7;
        }
      }
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

/** The four penalty rules from ISO/IEC 18004. */
function penalty(m: number[][]): number {
  const size = m.length;
  let score = 0;
  // Rule 1: runs of five or more same-coloured modules.
  for (let i = 0; i < size; i++) {
    for (const read of [(k: number) => m[i][k], (k: number) => m[k][i]]) {
      let run = 1;
      for (let k = 1; k < size; k++) {
        if (read(k) === read(k - 1)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }
  // Rule 2: solid 2×2 blocks.
  for (let r = 0; r < size - 1; r++)
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  // Rule 3: finder-like sequences (1011101 with four light modules beside).
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < size; i++) {
    for (let k = 0; k + 11 <= size; k++) {
      let h1 = true, h2 = true, v1 = true, v2 = true;
      for (let j = 0; j < 11; j++) {
        if (m[i][k + j] !== P1[j]) h1 = false;
        if (m[i][k + j] !== P2[j]) h2 = false;
        if (m[k + j][i] !== P1[j]) v1 = false;
        if (m[k + j][i] !== P2[j]) v2 = false;
      }
      score += 40 * ((h1 ? 1 : 0) + (h2 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0));
    }
  }
  // Rule 4: deviation from a 50 % dark ratio, per started 5 percentage points.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

function applyFormat(m: number[][], mask: number): void {
  const size = m.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >>> i) & 1) === 1 ? 1 : 0;
    if (i < 6) m[i][8] = dark;
    else if (i < 8) m[i + 1][8] = dark;
    else m[size - 15 + i][8] = dark;
    if (i < 8) m[8][size - 1 - i] = dark;
    else if (i === 8) m[8][7] = dark;
    else m[8][14 - i] = dark;
  }
  m[size - 8][8] = 1; // always-dark module
}

export interface QrCode {
  /** `matrix[row][col]`, 1 = dark. */
  matrix: number[][];
  version: number;
  mask: number;
  /** Modules per side, without the quiet zone. */
  size: number;
}

/** Module matrix of a QR code (without the quiet zone). */
export function qrMatrix(text: string): QrCode {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  const words = codewords(bytes, version);
  const base = functionModules(version);
  const cells = placeData(base, words);
  const placed = base as number[][]; // placeData filled every remaining null

  let best: { score: number; mask: number; matrix: number[][] } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = placed.map((row) => row.slice());
    for (const [r, c] of cells) if (MASKS[mask](r, c)) m[r][c] ^= 1;
    applyFormat(m, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { score, mask, matrix: m };
  }
  const chosen = best!;
  return { matrix: chosen.matrix, version, mask: chosen.mask, size: placed.length };
}

/** The dark modules as one SVG path in module units, plus the side length
 *  including the quiet zone — so the caller can render at any size without
 *  re-encoding.
 *
 * The quiet zone is part of the picture and not the caller's business: many
 * cameras simply fail to see a code that runs to the edge, and this app is
 * dark-themed, so the light plate has to come from here too.
 */
export function qrPath(text: string, margin = 4): { d: string; dim: number } {
  const { matrix: m, size } = qrMatrix(text);
  let d = '';
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!m[r][c]) {
        c++;
        continue;
      }
      let w = 1;
      while (c + w < size && m[r][c + w]) w++;
      d += `M${c + margin} ${r + margin}h${w}v1h-${w}z`;
      c += w;
    }
  }
  return { d, dim: size + margin * 2 };
}
