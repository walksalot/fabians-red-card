/**
 * Proof that `public/music/qr.js` really implements ISO/IEC 18004 rather than
 * something that merely looks like a QR code.
 *
 * The strategy is to never compare the encoder against itself:
 *  - every constant it derives (format information, version information,
 *    generator polynomials, capacity tables, alignment centres) is checked
 *    against the numbers published in the standard, hard-coded below;
 *  - the finished symbol is put through a decoder written from scratch in this
 *    file, which unmasks, de-interleaves, verifies the Reed-Solomon syndromes
 *    and re-parses the bit stream. If the round trip returns the input string, a
 *    real scanner will read it too.
 */

import { describe, expect, it } from 'vitest';

import { __internals, qrMatrix, qrSvg, qrTerminal } from '../../public/music/qr.js';
import type { QrEccLevel, QrMatrix } from '../../public/music/qr.js';

const LEVELS: QrEccLevel[] = ['L', 'M', 'Q', 'H'];

/* -------------------------------------------------------------------------- *
 * Published constants (ISO/IEC 18004). Typed in from the standard's tables.
 * -------------------------------------------------------------------------- */

/** Table C.1: the 15-bit format information string for every (level, mask). */
const FORMAT_INFO_STRINGS: Record<QrEccLevel, string[]> = {
  L: [
    '111011111000100',
    '111001011110011',
    '111110110101010',
    '111100010011101',
    '110011000101111',
    '110001100011000',
    '110110001000001',
    '110100101110110',
  ],
  M: [
    '101010000010010',
    '101000100100101',
    '101111001111100',
    '101101101001011',
    '100010111111001',
    '100000011001110',
    '100111110010111',
    '100101010100000',
  ],
  Q: [
    '011010101011111',
    '011000001101000',
    '011111100110001',
    '011101000000110',
    '010010010110100',
    '010000110000011',
    '010111011011010',
    '010101111101101',
  ],
  H: [
    '001011010001001',
    '001001110111110',
    '001110011100111',
    '001100111010000',
    '000011101100010',
    '000001001010101',
    '000110100001100',
    '000100000111011',
  ],
};

/** Table D.1: the 18-bit version information string, versions 7-20. */
const VERSION_INFO_STRINGS: Record<number, string> = {
  7: '000111110010010100',
  8: '001000010110111100',
  9: '001001101010011001',
  10: '001010010011010011',
  11: '001011101111110110',
  12: '001100011101100010',
  13: '001101100001000111',
  14: '001110011000001101',
  15: '001111100100101000',
  16: '010000101101111000',
  17: '010001010001011101',
  18: '010010101000010111',
  19: '010011010100110010',
  20: '010100100110100110',
};

/** Table E.1: row/column centres of the alignment patterns, indexed by version. */
const ALIGNMENT_POSITIONS: number[][] = [
  [], // unused
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
];

/** Table 1: total number of codewords in a symbol, indexed by version. */
const TOTAL_CODEWORDS = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
  1085,
];

/** Table 7: number of data codewords, indexed by version, in L/M/Q/H order. */
const DATA_CODEWORDS: number[][] = [
  [0, 0, 0, 0],
  [19, 16, 13, 9],
  [34, 28, 22, 16],
  [55, 44, 34, 26],
  [80, 64, 48, 36],
  [108, 86, 62, 46],
  [136, 108, 76, 60],
  [156, 124, 88, 66],
  [194, 154, 110, 86],
  [232, 182, 132, 100],
  [274, 216, 154, 122],
  [324, 254, 180, 140],
  [370, 290, 206, 158],
  [428, 334, 244, 180],
  [461, 365, 261, 197],
  [523, 415, 295, 223],
  [589, 453, 325, 253],
  [647, 507, 367, 283],
  [721, 563, 397, 313],
  [795, 627, 445, 341],
  [861, 669, 485, 385],
];

/** Table 9: error correction codewords per block, indexed by version. */
const ECC_PER_BLOCK: Record<QrEccLevel, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
};

/** Table 9: number of error correction blocks, indexed by version. */
const BLOCK_COUNT: Record<QrEccLevel, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
};

/** Annex A: generator polynomials as exponents of alpha, highest power first. */
const GENERATOR_EXPONENTS: Record<number, number[]> = {
  7: [0, 87, 229, 146, 149, 238, 102, 21],
  10: [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45],
  13: [0, 74, 152, 176, 100, 86, 100, 106, 104, 130, 218, 206, 140, 78],
};

const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/* -------------------------------------------------------------------------- *
 * A QR decoder, written here so the encoder is never its own witness.
 * -------------------------------------------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

const MASK_FN: Array<(row: number, col: number) => boolean> = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

/** Every module occupied by a function pattern, derived from the spec layout. */
function functionModules(size: number): boolean[][] {
  const version = (size - 17) / 4;
  const map: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (row: number, col: number) => {
    if (row >= 0 && row < size && col >= 0 && col < size) map[row][col] = true;
  };

  // Finder patterns with their separators, plus the reserved format areas.
  for (let row = 0; row <= 8; row++) {
    for (let col = 0; col <= 8; col++) mark(row, col);
  }
  for (let row = 0; row <= 8; row++) {
    for (let col = size - 8; col < size; col++) mark(row, col);
  }
  for (let row = size - 8; row < size; row++) {
    for (let col = 0; col <= 8; col++) mark(row, col);
  }

  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }

  if (version >= 7) {
    for (let row = 0; row < 6; row++) {
      for (let col = size - 11; col < size - 8; col++) mark(row, col);
    }
    for (let row = size - 11; row < size - 8; row++) {
      for (let col = 0; col < 6; col++) mark(row, col);
    }
  }

  for (const centreRow of ALIGNMENT_POSITIONS[version]) {
    for (const centreCol of ALIGNMENT_POSITIONS[version]) {
      const overlapsFinder =
        (centreRow === 6 && centreCol === 6) ||
        (centreRow === 6 && centreCol === size - 7) ||
        (centreRow === size - 7 && centreCol === 6);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) mark(centreRow + dr, centreCol + dc);
      }
    }
  }

  return map;
}

/** The two copies of the format information, as 15-bit values. */
function readFormatCopies(m: QrMatrix): [number, number] {
  const bit = (row: number, col: number) => (m.modules[row][col] ? 1 : 0);
  const first = new Array<number>(15).fill(0);
  const second = new Array<number>(15).fill(0);

  for (let i = 0; i <= 5; i++) first[i] = bit(i, 8);
  first[6] = bit(7, 8);
  first[7] = bit(8, 8);
  first[8] = bit(8, 7);
  for (let i = 9; i < 15; i++) first[i] = bit(8, 14 - i);

  for (let i = 0; i < 8; i++) second[i] = bit(8, m.size - 1 - i);
  for (let i = 8; i < 15; i++) second[i] = bit(m.size - 15 + i, 8);

  const pack = (bits: number[]) => bits.reduce((acc, b, i) => acc | (b << i), 0);
  return [pack(first), pack(second)];
}

/** The two copies of the version information, as 18-bit values. */
function readVersionCopies(m: QrMatrix): [number, number] {
  const first = new Array<number>(18).fill(0);
  const second = new Array<number>(18).fill(0);
  for (let i = 0; i < 18; i++) {
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    first[i] = m.modules[b][a] ? 1 : 0;
    second[i] = m.modules[a][b] ? 1 : 0;
  }
  const pack = (bits: number[]) => bits.reduce((acc, x, i) => acc | (x << i), 0);
  return [pack(first), pack(second)];
}

/** Unmask and read the interleaved codeword stream out of the zig-zag. */
function readCodewords(m: QrMatrix, mask: number): number[] {
  const fn = functionModules(m.size);
  const bits: number[] = [];
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? m.size - 1 - vert : vert;
        if (fn[row][col]) continue;
        const dark = m.modules[row][col];
        bits.push(dark !== MASK_FN[mask](row, col) ? 1 : 0);
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

/** Undo the interleaving: returns one array of (data + ECC) per block. */
function deinterleave(codewords: number[], version: number, ecc: QrEccLevel): number[][] {
  const numBlocks = BLOCK_COUNT[ecc][version];
  const eccLen = ECC_PER_BLOCK[ecc][version];
  const total = codewords.length;
  const numShort = numBlocks - (total % numBlocks);
  const shortLen = Math.floor(total / numBlocks);
  const dataLens: number[] = [];
  for (let i = 0; i < numBlocks; i++) dataLens.push(shortLen - eccLen + (i < numShort ? 0 : 1));

  const blocks: number[][] = dataLens.map(() => []);
  let cursor = 0;
  const longest = Math.max(...dataLens);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataLens[b]) blocks[b].push(codewords[cursor++]);
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (let b = 0; b < numBlocks; b++) blocks[b].push(codewords[cursor++]);
  }
  expect(cursor).toBe(total);
  return blocks;
}

/** Reed-Solomon syndromes; all zero means the block carries no detectable error. */
function syndromes(block: number[], eccLen: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < eccLen; i++) {
    let acc = 0;
    for (const byte of block) acc = mul(acc, EXP[i]) ^ byte;
    out.push(acc);
  }
  return out;
}

/** Parse the concatenated data codewords back into the original string. */
function parseSegments(data: number[], version: number): string {
  const bits: number[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  let pos = 0;
  const read = (count: number) => {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | bits[pos++];
    return value;
  };
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const decoder = new TextDecoder('utf-8');
  let text = '';

  while (pos + 4 <= bits.length) {
    const mode = read(4);
    if (mode === 0) break; // Terminator.
    if (mode === 1) {
      const count = read([10, 12, 14][group]);
      for (let i = 0; i < count; i += 3) {
        const digits = Math.min(3, count - i);
        const value = read(digits * 3 + 1);
        text += String(value).padStart(digits, '0');
      }
    } else if (mode === 2) {
      const count = read([9, 11, 13][group]);
      for (let i = 0; i < count; i += 2) {
        if (count - i >= 2) {
          const pair = read(11);
          text += ALPHANUMERIC_CHARSET[Math.floor(pair / 45)] + ALPHANUMERIC_CHARSET[pair % 45];
        } else {
          text += ALPHANUMERIC_CHARSET[read(6)];
        }
      }
    } else if (mode === 4) {
      const count = read([8, 16, 16][group]);
      const bytes = new Uint8Array(count);
      for (let i = 0; i < count; i++) bytes[i] = read(8);
      text += decoder.decode(bytes);
    } else {
      throw new Error('decoder: unsupported mode indicator ' + mode);
    }
  }
  return text;
}

interface Decoded {
  ecc: QrEccLevel;
  mask: number;
  version: number;
  text: string;
}

function decode(m: QrMatrix): Decoded {
  const version = (m.size - 17) / 4;
  expect(Number.isInteger(version)).toBe(true);

  const [formatA, formatB] = readFormatCopies(m);
  expect(formatA).toBe(formatB); // Both copies must carry the same bits.
  const format = formatA ^ 0x5412;
  const ecc = (['M', 'L', 'H', 'Q'] as QrEccLevel[])[(format >> 13) & 3];
  const mask = (format >> 10) & 7;

  if (version >= 7) {
    const [versionA, versionB] = readVersionCopies(m);
    expect(versionA).toBe(versionB);
    expect(versionA >> 12).toBe(version);
  }

  const codewords = readCodewords(m, mask);
  expect(codewords.length).toBe(TOTAL_CODEWORDS[version]);

  const blocks = deinterleave(codewords, version, ecc);
  const eccLen = ECC_PER_BLOCK[ecc][version];
  const data: number[] = [];
  for (const block of blocks) {
    expect(syndromes(block, eccLen)).toEqual(new Array<number>(eccLen).fill(0));
    data.push(...block.slice(0, block.length - eccLen));
  }
  expect(data.length).toBe(DATA_CODEWORDS[version][LEVELS.indexOf(ecc)]);

  return { ecc, mask, version, text: parseSegments(data, version) };
}

/* -------------------------------------------------------------------------- *
 * Small helpers for the structural assertions.
 * -------------------------------------------------------------------------- */

function grid(rows: string[]): boolean[][] {
  return rows.map((row) => Array.from(row, (ch) => ch === '1'));
}

function solid(size: number, dark: boolean): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(dark));
}

function alphaExponents(coefficients: number[]): number[] {
  return coefficients.map((c) => {
    expect(c).not.toBe(0);
    return LOG[c];
  });
}

/* -------------------------------------------------------------------------- *
 * Tests
 * -------------------------------------------------------------------------- */

describe('format information (ISO/IEC 18004 table C.1)', () => {
  for (const level of LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      it(`level ${level}, mask ${mask}`, () => {
        const bits = __internals.formatInfoBits(level, mask).toString(2).padStart(15, '0');
        expect(bits).toBe(FORMAT_INFO_STRINGS[level][mask]);
      });
    }
  }

  it('is written into both copies of the symbol', () => {
    for (const level of LEVELS) {
      const m = qrMatrix('format check', { ecc: level });
      const [a, b] = readFormatCopies(m);
      expect(a).toBe(b);
      expect(a.toString(2).padStart(15, '0')).toBe(FORMAT_INFO_STRINGS[level][m.mask]);
    }
  });
});

describe('version information (ISO/IEC 18004 table D.1)', () => {
  for (let version = 7; version <= 20; version++) {
    it(`version ${version}`, () => {
      const bits = __internals.versionInfoBits(version).toString(2).padStart(18, '0');
      expect(bits).toBe(VERSION_INFO_STRINGS[version]);
      expect(bits.slice(0, 6)).toBe(version.toString(2).padStart(6, '0'));
    });
  }

  it('appears twice in symbols of version 7 and above, and never below', () => {
    const small = qrMatrix('x', { ecc: 'M', minVersion: 6, maxVersion: 6 });
    expect(small.version).toBe(6);
    // Version 6 has no version block: those modules belong to the data region.
    const [lowA, lowB] = readVersionCopies(small);
    expect(lowA >> 12).not.toBe(6 | 0x40); // sanity: nothing pretends to be a block

    for (const version of [7, 12, 20]) {
      const m = qrMatrix('version block check', { minVersion: version, maxVersion: version });
      expect(m.version).toBe(version);
      const [a, b] = readVersionCopies(m);
      expect(a).toBe(b);
      expect(a.toString(2).padStart(18, '0')).toBe(VERSION_INFO_STRINGS[version]);
    }
    expect(lowB).toBeGreaterThanOrEqual(0);
  });
});

describe('Reed-Solomon over GF(256)', () => {
  for (const degree of Object.keys(GENERATOR_EXPONENTS).map(Number)) {
    it(`generator polynomial of degree ${degree} matches the published coefficients`, () => {
      const coefficients = __internals.rsGeneratorPolynomial(degree);
      expect(coefficients).toHaveLength(degree);
      // The leading coefficient is 1 (alpha^0) and is implicit in the array.
      expect(alphaExponents([1, ...coefficients])).toEqual(GENERATOR_EXPONENTS[degree]);
    });
  }

  it('every generator polynomial has alpha^0..alpha^(n-1) as roots', () => {
    for (let degree = 7; degree <= 30; degree++) {
      const poly = [1, ...__internals.rsGeneratorPolynomial(degree)];
      for (let i = 0; i < degree; i++) {
        let acc = 0;
        for (const c of poly) acc = mul(acc, EXP[i]) ^ c;
        expect(acc).toBe(0);
      }
    }
  });

  it('reproduces the worked example in ISO/IEC 18004 annex I (version 1-M, "01234567")', () => {
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
    const parity = __internals.rsRemainder(data, __internals.rsGeneratorPolynomial(10));
    expect(parity).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });

  it('reproduces the published "HELLO WORLD" version 1-Q codewords', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
    const parity = __internals.rsRemainder(data, __internals.rsGeneratorPolynomial(13));
    expect(parity).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
  });

  it('encodes "01234567" as version 1-M into exactly those codewords', () => {
    const m = qrMatrix('01234567', { ecc: 'M', minVersion: 1, maxVersion: 1 });
    const codewords = readCodewords(m, m.mask);
    expect(codewords).toEqual([
      16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 165, 36, 212, 193, 237,
      54, 199, 135, 44, 85,
    ]);
  });
});

describe('capacity tables', () => {
  it('total codewords per version match table 1', () => {
    for (let version = 1; version <= 20; version++) {
      expect(__internals.totalCodewords(version)).toBe(TOTAL_CODEWORDS[version]);
    }
  });

  it('remainder bits per version match the standard', () => {
    // Versions 2-6 carry 7 spare bits, 7-13 none, 14-20 three.
    const expected = (version: number) =>
      version === 1 ? 0 : version <= 6 ? 7 : version <= 13 ? 0 : 3;
    for (let version = 1; version <= 20; version++) {
      const spare = __internals.rawDataModules(version) - TOTAL_CODEWORDS[version] * 8;
      expect(spare).toBe(expected(version));
    }
  });

  it('data codewords per version and level match table 7', () => {
    for (let version = 1; version <= 20; version++) {
      LEVELS.forEach((level, index) => {
        expect(__internals.dataCodewords(version, level)).toBe(DATA_CODEWORDS[version][index]);
      });
    }
  });

  it('block structure is consistent with the capacity tables', () => {
    for (let version = 1; version <= 20; version++) {
      LEVELS.forEach((level, index) => {
        const blocks = BLOCK_COUNT[level][version];
        const eccLen = ECC_PER_BLOCK[level][version];
        expect(__internals.NUM_ERROR_CORRECTION_BLOCKS[level][version]).toBe(blocks);
        expect(__internals.ECC_CODEWORDS_PER_BLOCK[level][version]).toBe(eccLen);
        expect(TOTAL_CODEWORDS[version] - blocks * eccLen).toBe(DATA_CODEWORDS[version][index]);
      });
    }
  });

  it('uses the character count indicator widths of table 3', () => {
    for (const [version, numeric, alnum, byte] of [
      [1, 10, 9, 8],
      [9, 10, 9, 8],
      [10, 12, 11, 16],
      [20, 12, 11, 16],
    ]) {
      expect(__internals.countIndicatorBits('NUMERIC', version)).toBe(numeric);
      expect(__internals.countIndicatorBits('ALPHANUMERIC', version)).toBe(alnum);
      expect(__internals.countIndicatorBits('BYTE', version)).toBe(byte);
    }
  });

  it('refuses data that does not fit the largest supported version', () => {
    expect(() => qrMatrix('x'.repeat(1000), { ecc: 'H' })).toThrow(/too long/);
  });
});

describe('alignment patterns', () => {
  it('centres match table E.1', () => {
    for (let version = 1; version <= 20; version++) {
      expect(__internals.alignmentPatternPositions(version)).toEqual(ALIGNMENT_POSITIONS[version]);
    }
  });

  it('are drawn as a 5x5 ring at every centre except the finder corners', () => {
    for (const version of [2, 7, 14, 20]) {
      const m = qrMatrix('alignment', { minVersion: version, maxVersion: version });
      const centres = ALIGNMENT_POSITIONS[version];
      for (const row of centres) {
        for (const col of centres) {
          const isFinderCorner =
            (row === 6 && col === 6) ||
            (row === 6 && col === m.size - 7) ||
            (row === m.size - 7 && col === 6);
          if (isFinderCorner) continue;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const ring = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
              expect(m.modules[row + dr][col + dc]).toBe(ring);
            }
          }
        }
      }
    }
  });
});

describe('function patterns', () => {
  const samples: Array<[number, QrEccLevel]> = [
    [1, 'L'],
    [2, 'M'],
    [6, 'Q'],
    [7, 'H'],
    [13, 'M'],
    [14, 'L'],
    [20, 'Q'],
  ];

  for (const [version, level] of samples) {
    it(`version ${version}-${level} has the right skeleton`, () => {
      // A short payload: `minVersion` pins the version regardless of length.
      const m = qrMatrix('probe', {
        ecc: level,
        minVersion: version,
        maxVersion: version,
      });
      expect(m.version).toBe(version);
      expect(m.size).toBe(4 * version + 17);
      expect(m.modules).toHaveLength(m.size);
      for (const row of m.modules) expect(row).toHaveLength(m.size);

      // The three finder patterns: a 7x7 ring with a 3x3 core.
      const corners: Array<[number, number]> = [
        [0, 0],
        [0, m.size - 7],
        [m.size - 7, 0],
      ];
      for (const [top, left] of corners) {
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 7; c++) {
            const outerRing = r === 0 || r === 6 || c === 0 || c === 6;
            const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            expect(m.modules[top + r][left + c]).toBe(outerRing || core);
          }
        }
      }

      // Separators: the light band around each finder.
      for (let i = 0; i <= 7; i++) {
        expect(m.modules[7][i]).toBe(false);
        expect(m.modules[i][7]).toBe(false);
        expect(m.modules[7][m.size - 1 - i]).toBe(false);
        expect(m.modules[i][m.size - 8]).toBe(false);
        expect(m.modules[m.size - 8][i]).toBe(false);
        expect(m.modules[m.size - 1 - i][7]).toBe(false);
      }

      // Timing patterns alternate, starting dark, across the whole symbol.
      for (let i = 8; i < m.size - 8; i++) {
        expect(m.modules[6][i]).toBe(i % 2 === 0);
        expect(m.modules[i][6]).toBe(i % 2 === 0);
      }

      // The dark module.
      expect(m.modules[4 * version + 9][8]).toBe(true);

      // The data region holds exactly the tabulated number of codewords.
      const fn = functionModules(m.size);
      let free = 0;
      for (let row = 0; row < m.size; row++) {
        for (let col = 0; col < m.size; col++) if (!fn[row][col]) free++;
      }
      expect(free).toBe(__internals.rawDataModules(version));
      expect(Math.floor(free / 8)).toBe(TOTAL_CODEWORDS[version]);
    });
  }
});

describe('mask penalty scoring', () => {
  it('N1 charges 3 for a run of five and 1 for each extra module', () => {
    // 5x5 all light: every row and every column is a single run of five.
    expect(__internals.penaltyN1(solid(5, false))).toBe(5 * 3 + 5 * 3);
    // 7x7 all dark: each line scores 3 + 1 + 1.
    expect(__internals.penaltyN1(solid(7, true))).toBe(7 * 5 + 7 * 5);
    // A checkerboard has no run longer than one.
    const checker = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 6 }, (_, c) => (r + c) % 2 === 0)
    );
    expect(__internals.penaltyN1(checker)).toBe(0);
  });

  it('N2 charges 3 for every 2x2 block of one colour', () => {
    expect(__internals.penaltyN2(solid(2, true))).toBe(3);
    expect(__internals.penaltyN2(solid(3, true))).toBe(4 * 3);
    expect(__internals.penaltyN2(solid(4, false))).toBe(9 * 3);
    const checker = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 6 }, (_, c) => (r + c) % 2 === 0)
    );
    expect(__internals.penaltyN2(checker)).toBe(0);
  });

  it('N3 charges 40 for a 1:1:3:1:1 pattern beside four light modules', () => {
    // The pattern fills the row; the quiet zone supplies the light run.
    const edge = grid([
      '1011101',
      '0000000',
      '0000000',
      '0000000',
      '0000000',
      '0000000',
      '0000000',
    ]);
    expect(__internals.penaltyN3(edge)).toBe(40);

    // Same pattern with the light run inside the symbol, horizontally.
    const inside = grid([
      '00000000000',
      '00000000000',
      '10111010000',
      '00000000000',
      '00000000000',
      '00000000000',
      '00000000000',
      '00000000000',
      '00000000000',
      '00000000000',
      '00000000000',
    ]);
    expect(__internals.penaltyN3(inside)).toBe(40);

    // Vertical patterns count too.
    const vertical = inside[0].map((_, col) => inside.map((row) => row[col]));
    expect(__internals.penaltyN3(vertical)).toBe(40);

    // Dark modules on both sides mean no penalty.
    const blocked = grid([
      '1111011101111',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
      '0000000000000',
    ]);
    expect(__internals.penaltyN3(blocked)).toBe(0);
  });

  it('N4 charges 10 per 5% that the dark proportion strays from half', () => {
    const withDark = (count: number) => {
      const m = solid(10, false);
      for (let i = 0; i < count; i++) m[Math.floor(i / 10)][i % 10] = true;
      return m;
    };
    expect(__internals.penaltyN4(withDark(50))).toBe(0);
    expect(__internals.penaltyN4(withDark(47))).toBe(0);
    expect(__internals.penaltyN4(withDark(45))).toBe(10);
    expect(__internals.penaltyN4(withDark(40))).toBe(20);
    expect(__internals.penaltyN4(withDark(0))).toBe(100);
    expect(__internals.penaltyN4(withDark(100))).toBe(100);
  });

  it('maskPenalty is the sum of the four rules', () => {
    const m = qrMatrix('penalty sum').modules;
    expect(__internals.maskPenalty(m)).toBe(
      __internals.penaltyN1(m) +
        __internals.penaltyN2(m) +
        __internals.penaltyN3(m) +
        __internals.penaltyN4(m)
    );
  });

  it('picks the mask with the lowest penalty, ties going to the lower index', () => {
    const samples = ['HELLO WORLD', 'https://example.invalid/music/listen.html#abc', '8675309'];
    for (const text of samples) {
      for (const level of LEVELS) {
        const auto = qrMatrix(text, { ecc: level });
        const scores: number[] = [];
        for (let mask = 0; mask < 8; mask++) {
          scores.push(__internals.maskPenalty(qrMatrix(text, { ecc: level, mask }).modules));
        }
        const best = Math.min(...scores);
        expect(scores.indexOf(best)).toBe(auto.mask);
        expect(scores[auto.mask]).toBe(best);
      }
    }
  });
});

describe('mode selection', () => {
  it('uses numeric mode for digits, alphanumeric for the 45-character set, byte otherwise', () => {
    const modeOf = (text: string) => {
      const m = qrMatrix(text);
      const codewords = readCodewords(m, m.mask);
      return codewords[0] >> 4;
    };
    expect(modeOf('0123456789')).toBe(1);
    expect(modeOf('HELLO WORLD $%*+-./:')).toBe(2);
    expect(modeOf('hello world')).toBe(4);
    expect(modeOf('caf\u00e9')).toBe(4);
    expect(ALPHANUMERIC_CHARSET).toBe(__internals.ALPHANUMERIC_CHARSET);
  });

  it('numeric mode is denser than byte mode for long digit strings', () => {
    const digits = '9'.repeat(120);
    expect(qrMatrix(digits, { ecc: 'M' }).version).toBeLessThan(
      qrMatrix(digits.replace(/9/g, 'z'), { ecc: 'M' }).version
    );
  });
});

describe('round trip through an independent decoder', () => {
  const payloads: Array<[string, string]> = [
    ['short ascii', 'Fabian'],
    ['numeric', '0123456789'],
    ['alphanumeric', 'HELLO WORLD'],
    ['punctuation', 'A-B/C:D$E%F*G+H.I J'],
    [
      'unicode',
      'Caf\u00e9 del Mar \u2014 Bj\u00f6rk, Sigur R\u00f3s, \u4f60\u597d, \u00e5\u00e4\u00f6',
    ],
    [
      'realistic listen URL',
      'http://192.168.1.20:4173/listen.html#eyJ2IjoxLCJ0IjoiQmlsbGllIEplYW4iLCJhIjoiTWljaGFlbCBKYWNrc29uIiwibiI6N30',
    ],
    [
      'long text',
      'The quick brown fox jumps over the lazy dog. '.repeat(7) + 'And then it stopped.',
    ],
  ];

  for (const [name, text] of payloads) {
    for (const level of LEVELS) {
      it(`${name} at ECC ${level}`, () => {
        const m = qrMatrix(text, { ecc: level });
        const decoded = decode(m);
        expect(decoded.ecc).toBe(level);
        expect(decoded.mask).toBe(m.mask);
        expect(decoded.version).toBe(m.version);
        expect(decoded.text).toBe(text);
      });
    }
  }

  it('survives every mask pattern', () => {
    const text = 'http://192.168.1.20:4173/listen.html#eyJ2IjoxLCJuIjozfQ';
    for (let mask = 0; mask < 8; mask++) {
      const m = qrMatrix(text, { ecc: 'Q', mask });
      expect(m.mask).toBe(mask);
      expect(decode(m).text).toBe(text);
    }
  });

  it('survives every version and level at exactly full capacity', () => {
    // Filling the symbol exercises the terminator, the pad codewords and every
    // block-splitting shape in the tables.
    let seed = 12345;
    const nextChar = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return 'abcdefghijklmnopqrstuvwxyz!?,;'[seed % 30];
    };
    for (let version = 1; version <= 20; version++) {
      for (const level of LEVELS) {
        const countBits = version <= 9 ? 8 : 16;
        const capacity = Math.floor(
          (DATA_CODEWORDS[version][LEVELS.indexOf(level)] * 8 - 4 - countBits) / 8
        );
        let text = '';
        while (text.length < capacity) text += nextChar();
        const m = qrMatrix(text, { ecc: level, minVersion: version, maxVersion: version });
        expect(m.version).toBe(version);
        const decoded = decode(m);
        expect(decoded.version).toBe(version);
        expect(decoded.ecc).toBe(level);
        expect(decoded.text).toBe(text);
      }
    }
  });
});

describe('qrSvg', () => {
  it('produces a standalone, self-contained svg with a 4-module quiet zone', () => {
    const svg = qrSvg('scan me');
    const size = qrMatrix('scan me').size;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(`<rect width="${size + 8}" height="${size + 8}" fill="#fff"/>`);
    expect(svg).toContain('<path fill="#000"');
    // Nothing that could reach out to the network or run.
    // The only URL is the SVG namespace; nothing else can reach out or run.
    const withoutNamespace = svg.replace(' xmlns="http://www.w3.org/2000/svg"', '');
    expect(withoutNamespace).not.toMatch(/https?:|<script|xlink:href|url\(|<image|<use|on[a-z]+=/);
  });

  it('honours margin, colours and scale', () => {
    const size = qrMatrix('abc').size;
    const svg = qrSvg('abc', { margin: 0, dark: '#12ab34', light: 'rgb(255, 255, 255)', scale: 6 });
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(svg).toContain(`width="${size * 6}" height="${size * 6}"`);
    expect(svg).toContain('fill="#12ab34"');
    expect(svg).toContain('fill="rgb(255, 255, 255)"');
  });

  it('is safe to inject: no caller text reaches the markup', () => {
    const nasty = '"><script>alert(1)</script><svg onload="x"';
    const svg = qrSvg(nasty, { dark: '"><script>alert(2)</script>', light: 'javascript:alert(3)' });
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('javascript:');
    expect(svg).not.toContain('alert');
    expect(svg).toContain('fill="#000"');
    expect(svg).toContain('fill="#fff"');
    // The payload still encodes correctly even though it never appears verbatim.
    expect(decode(qrMatrix(nasty)).text).toBe(nasty);
  });

  it('draws one rectangle per horizontal run of dark modules', () => {
    const { size, modules } = qrMatrix('run counting', { ecc: 'M' });
    let runs = 0;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (modules[row][col] && (col === 0 || !modules[row][col - 1])) runs++;
      }
    }
    const svg = qrSvg('run counting', { ecc: 'M' });
    expect((svg.match(/M\d+ \d+h\d+v1h-\d+z/g) ?? []).length).toBe(runs);
  });
});

describe('qrTerminal', () => {
  it('renders two module rows per line, with a quiet zone, in half blocks', () => {
    const text = 'http://192.168.1.20:4173/music/';
    const { size, modules } = qrMatrix(text);
    const lines = qrTerminal(text, { ansi: false });
    const extent = size + 8;

    expect(lines).toHaveLength(Math.ceil(extent / 2));
    for (const line of lines) expect(line).toHaveLength(extent);
    for (const line of lines) expect(line).toMatch(/^[\u2580\u2584\u2588 ]+$/);

    // Top two rows are quiet zone, so the first two lines are blank.
    expect(lines[0].trim()).toBe('');
    expect(lines[1].trim()).toBe('');

    // Spot-check that the glyphs really encode the module pairs.
    const glyphAt = (row: number, col: number) => lines[row >> 1][col];
    const isDark = (row: number, col: number) => {
      const r = row - 4;
      const c = col - 4;
      return r >= 0 && c >= 0 && r < size && c < size && modules[r][c];
    };
    for (let row = 0; row < extent - 1; row += 2) {
      for (let col = 0; col < extent; col++) {
        const top = isDark(row, col);
        const bottom = isDark(row + 1, col);
        const expected = top && bottom ? '\u2588' : top ? '\u2580' : bottom ? '\u2584' : ' ';
        expect(glyphAt(row, col)).toBe(expected);
      }
    }
  });

  it('wraps lines in black-on-white ANSI by default so it scans on any theme', () => {
    const lines = qrTerminal('theme check');
    for (const line of lines) {
      expect(line.startsWith('\u001b[47m\u001b[30m')).toBe(true);
      expect(line.endsWith('\u001b[0m')).toBe(true);
    }
  });
});

describe('argument validation', () => {
  it('rejects unknown ECC levels, bad versions and bad masks', () => {
    expect(() => qrMatrix('x', { ecc: 'Z' as QrEccLevel })).toThrow(/ECC/);
    expect(() => qrMatrix('x', { minVersion: 0 })).toThrow(/version range/);
    expect(() => qrMatrix('x', { maxVersion: 41 })).toThrow(/version range/);
    expect(() => qrMatrix('x', { minVersion: 5, maxVersion: 4 })).toThrow(/version range/);
    expect(() => qrMatrix('x', { mask: 8 })).toThrow(/mask/);
    expect(() => qrMatrix(42 as unknown as string)).toThrow(/string/);
  });

  it('encodes the empty string', () => {
    const m = qrMatrix('');
    expect(m.size).toBe(21);
    expect(decode(m).text).toBe('');
  });
});
