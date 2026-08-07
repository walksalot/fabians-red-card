/**
 * From-scratch QR Code encoder (ISO/IEC 18004). No dependencies, no DOM.
 *
 * Why hand-rolled: the music game ships as static files with no bundler, no npm
 * runtime dependency and no CDN, yet the Play screen has to turn the host phone
 * into a scannable card. A remote chart API would need the internet, would leak
 * the card to a third party, and would be useless on a LAN with no route out.
 * So the encoder lives here, in ~700 lines we can audit.
 *
 * Why DOM-free: `scripts/music-server.mjs` imports this module directly to print
 * a QR into the terminal, so nothing in the matrix path may touch `document`.
 * Only `qrSvg` produces markup, and it produces it as a string.
 *
 * Scope: versions 1-20, ECC levels L/M/Q/H, numeric / alphanumeric / byte
 * (UTF-8) modes. That covers every URL this game can produce several times over;
 * omitting versions 21-40 keeps the capacity tables short enough to check by eye.
 */

/* -------------------------------------------------------------------------- *
 * Capacity tables (ISO/IEC 18004 tables 13-22), versions 1-20.
 * Index 0 is a placeholder so the array index is the version number.
 * -------------------------------------------------------------------------- */

const MIN_SUPPORTED_VERSION = 1;
const MAX_SUPPORTED_VERSION = 20;

/** Error correction codewords per block, [level][version]. */
const ECC_CODEWORDS_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
};

/** Number of error correction blocks, [level][version]. */
const NUM_ERROR_CORRECTION_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
};

/** The two bits that identify an ECC level inside the format information. */
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

const ECC_LEVELS = ['L', 'M', 'Q', 'H'];

/** Mode indicator + character-count-indicator widths for the three version groups. */
const MODES = {
  NUMERIC: { indicator: 1, countBits: [10, 12, 14] },
  ALPHANUMERIC: { indicator: 2, countBits: [9, 11, 13] },
  BYTE: { indicator: 4, countBits: [8, 16, 16] },
};

/** Alphanumeric mode's 45-character set; the index is the encoded value. */
const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/* -------------------------------------------------------------------------- *
 * GF(256) arithmetic, primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
 * -------------------------------------------------------------------------- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];

/** Multiply two field elements. */
function gfMultiply(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Coefficients of the Reed-Solomon generator polynomial of the given degree,
 * highest power first and with the leading (always 1) term left implicit:
 * g(x) = (x - a^0)(x - a^1)...(x - a^(degree-1)).
 */
function rsGeneratorPolynomial(degree) {
  if (degree < 1 || degree > 255) throw new RangeError('degree out of range: ' + degree);
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

/** The remainder of data(x) * x^degree divided by the generator: the ECC codewords. */
function rsRemainder(data, generator) {
  const result = new Array(generator.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= gfMultiply(generator[i], factor);
  }
  return result;
}

/* -------------------------------------------------------------------------- *
 * Structural helpers.
 * -------------------------------------------------------------------------- */

/**
 * Number of modules available for data + ECC + remainder bits, i.e. everything
 * except the function patterns. Derived rather than tabulated because the
 * closed form is easier to verify than 20 magic numbers.
 */
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    // Alignment patterns, minus the parts that overlap the timing patterns.
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36; // Two 3x6 version information blocks.
  }
  return result;
}

/** Total codewords in the symbol; the leftover 0-7 bits are the remainder bits. */
function totalCodewords(version) {
  return Math.floor(rawDataModules(version) / 8);
}

/** Data codewords available at a version/level, i.e. capacity minus ECC. */
function dataCodewords(version, ecc) {
  return (
    totalCodewords(version) -
    ECC_CODEWORDS_PER_BLOCK[ecc][version] * NUM_ERROR_CORRECTION_BLOCKS[ecc][version]
  );
}

/**
 * Row/column centres of the alignment patterns. Matches the table in the spec;
 * the formula is the standard one (evenly spaced, always including 6 and
 * size - 7, spacing rounded up to an even number).
 */
function alignmentPatternPositions(version) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Character count indicator width for a mode at a given version. */
function countIndicatorBits(mode, version) {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return MODES[mode].countBits[group];
}

/* -------------------------------------------------------------------------- *
 * Segment encoding.
 * -------------------------------------------------------------------------- */

const NUMERIC_RE = /^[0-9]+$/;
const ALPHANUMERIC_RE = /^[0-9A-Z $%*+\-./:]+$/;

const utf8Encoder = new TextEncoder();

/** Cheapest mode that can represent the whole string. */
function chooseMode(text) {
  if (text.length > 0 && NUMERIC_RE.test(text)) return 'NUMERIC';
  if (text.length > 0 && ALPHANUMERIC_RE.test(text)) return 'ALPHANUMERIC';
  return 'BYTE';
}

/** Push the low `count` bits of `value`, most significant first. */
function appendBits(bits, value, count) {
  for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

/** Number of payload bits (excluding mode + count indicators) for a segment. */
function segmentDataBits(mode, charCount) {
  if (mode === 'NUMERIC') {
    return 10 * Math.floor(charCount / 3) + [0, 4, 7][charCount % 3];
  }
  if (mode === 'ALPHANUMERIC') {
    return 11 * Math.floor(charCount / 2) + 6 * (charCount % 2);
  }
  return 8 * charCount;
}

/** Append the payload of a segment to the bit buffer. */
function appendSegmentData(bits, mode, text, bytes) {
  if (mode === 'NUMERIC') {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      appendBits(bits, Number(chunk), chunk.length * 3 + 1);
    }
    return;
  }
  if (mode === 'ALPHANUMERIC') {
    for (let i = 0; i < text.length; i += 2) {
      const first = ALPHANUMERIC_CHARSET.indexOf(text[i]);
      if (i + 1 < text.length) {
        const second = ALPHANUMERIC_CHARSET.indexOf(text[i + 1]);
        appendBits(bits, first * 45 + second, 11);
      } else {
        appendBits(bits, first, 6);
      }
    }
    return;
  }
  for (const byte of bytes) appendBits(bits, byte, 8);
}

/** Smallest version in range that can hold the text, plus the chosen mode. */
function planSegment(text, ecc, minVersion, maxVersion) {
  const mode = chooseMode(text);
  const bytes = mode === 'BYTE' ? Array.from(utf8Encoder.encode(text)) : [];
  const charCount = mode === 'BYTE' ? bytes.length : text.length;
  const payloadBits = segmentDataBits(mode, charCount);

  for (let version = minVersion; version <= maxVersion; version++) {
    const countBits = countIndicatorBits(mode, version);
    if (charCount >= 1 << countBits) continue; // Count indicator would overflow.
    const needed = 4 + countBits + payloadBits;
    if (needed <= dataCodewords(version, ecc) * 8) {
      return { version, mode, bytes, charCount, countBits };
    }
  }
  throw new RangeError(
    'QR: data too long (' +
      charCount +
      ' ' +
      mode.toLowerCase() +
      ' units) for version ' +
      maxVersion +
      ' at ECC level ' +
      ecc
  );
}

/** Build the padded data codewords: segment, terminator, bit padding, pad bytes. */
function buildDataCodewords(plan, text, ecc) {
  const capacityBits = dataCodewords(plan.version, ecc) * 8;
  const bits = [];
  appendBits(bits, MODES[plan.mode].indicator, 4);
  appendBits(bits, plan.charCount, plan.countBits);
  appendSegmentData(bits, plan.mode, text, plan.bytes);

  // Terminator: up to four zero bits, truncated if the symbol is nearly full.
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  // Pad to a byte boundary, then alternate the two prescribed pad codewords.
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) {
    appendBits(bits, pad, 8);
  }

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

/**
 * Split the data into blocks, append each block's ECC, then interleave both
 * halves the way the spec requires (all first data codewords, then all second,
 * ... then the same for the ECC codewords).
 */
function interleaveBlocks(data, version, ecc) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const rawCodewords = totalCodewords(version);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const generator = rsGeneratorPolynomial(eccLen);

  const blocks = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + dataLen);
    offset += dataLen;
    const parity = rsRemainder(block, generator);
    // Short blocks get a hole so column-wise interleaving lines up; the hole is
    // skipped when reading back out below.
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(parity));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- *
 * Format and version information (BCH codes).
 * -------------------------------------------------------------------------- */

/**
 * 15-bit format information: 5 data bits (2 ECC level + 3 mask) extended by a
 * BCH(15,5) code, the whole thing XORed with 0x5412 so it is never all-zero.
 */
function formatInfoBits(ecc, mask) {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

/** 18-bit version information for versions 7+: 6 data bits + BCH(18,6). */
function versionInfoBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return ((version << 12) | rem) & 0x3ffff;
}

/* -------------------------------------------------------------------------- *
 * Matrix construction.
 * -------------------------------------------------------------------------- */

function makeGrid(size, value) {
  const grid = new Array(size);
  for (let r = 0; r < size; r++) grid[r] = new Array(size).fill(value);
  return grid;
}

/** Set a module that belongs to a function pattern (never masked, never data). */
function setFunction(m, row, col, dark) {
  m.modules[row][col] = dark;
  m.isFunction[row][col] = true;
}

function drawFinderPattern(m, centreRow, centreCol) {
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const row = centreRow + dr;
      const col = centreCol + dc;
      if (row < 0 || row >= m.size || col < 0 || col >= m.size) continue;
      const dist = Math.max(Math.abs(dr), Math.abs(dc)); // Chebyshev rings.
      setFunction(m, row, col, dist !== 2 && dist <= 3);
    }
  }
}

function drawAlignmentPattern(m, centreRow, centreCol) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      setFunction(m, centreRow + dr, centreCol + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
}

/** Write the 15 format bits into both copies (bit 0 is the least significant). */
function drawFormatBits(m, ecc, mask) {
  const bits = formatInfoBits(ecc, mask);
  const bit = (i) => ((bits >>> i) & 1) !== 0;

  // Copy 1, wrapped around the top-left finder.
  for (let i = 0; i <= 5; i++) setFunction(m, i, 8, bit(i));
  setFunction(m, 7, 8, bit(6));
  setFunction(m, 8, 8, bit(7));
  setFunction(m, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) setFunction(m, 8, 14 - i, bit(i));

  // Copy 2, split between the bottom-left and top-right finders.
  for (let i = 0; i < 8; i++) setFunction(m, 8, m.size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) setFunction(m, m.size - 15 + i, 8, bit(i));

  setFunction(m, m.size - 8, 8, true); // The dark module, always set.
}

function drawVersionBits(m, version) {
  if (version < 7) return;
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(m, b, a, dark); // Bottom-left of the top-right finder.
    setFunction(m, a, b, dark); // Top-right of the bottom-left finder.
  }
}

function drawFunctionPatterns(m, version, ecc) {
  // Timing patterns first; the finders overwrite their own corners.
  for (let i = 0; i < m.size; i++) {
    setFunction(m, 6, i, i % 2 === 0);
    setFunction(m, i, 6, i % 2 === 0);
  }

  drawFinderPattern(m, 3, 3);
  drawFinderPattern(m, 3, m.size - 4);
  drawFinderPattern(m, m.size - 4, 3);

  const positions = alignmentPatternPositions(version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      // The three finder corners have no alignment pattern.
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (!corner) drawAlignmentPattern(m, positions[i], positions[j]);
    }
  }

  // Reserve the format area (mask 0 is a placeholder, overwritten later) and
  // write the version blocks, which never change once the version is known.
  drawFormatBits(m, ecc, 0);
  drawVersionBits(m, version);
}

/** Lay the codewords out in the two-module-wide upward/downward zig-zag. */
function drawCodewords(m, codewords) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Skip the vertical timing column entirely.
    for (let vert = 0; vert < m.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? m.size - 1 - vert : vert;
        if (!m.isFunction[row][col] && bitIndex < totalBits) {
          m.modules[row][col] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
        // Anything left over is a remainder bit and stays light.
      }
    }
  }
}

const MASK_FUNCTIONS = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

/** XOR a mask over every non-function module. Self-inverse, so it also undoes. */
function applyMask(m, mask) {
  const fn = MASK_FUNCTIONS[mask];
  for (let row = 0; row < m.size; row++) {
    for (let col = 0; col < m.size; col++) {
      if (!m.isFunction[row][col] && fn(row, col)) m.modules[row][col] = !m.modules[row][col];
    }
  }
}

/* -------------------------------------------------------------------------- *
 * Mask penalty scoring (ISO/IEC 18004 table 11).
 *
 * Two details the standard leaves room to argue about, decided here and tested:
 * the quiet zone counts as light when looking for the 1:1:3:1:1 pattern at the
 * symbol edge (the quiet zone is mandatory, so it really is light), and a
 * pattern flanked by light on both sides scores once, not twice.
 * -------------------------------------------------------------------------- */

/** N1: runs of five or more modules of the same colour, in rows and columns. */
function penaltyN1(modules) {
  const size = modules.length;
  let score = 0;
  for (let a = 0; a < size; a++) {
    let rowRun = 1;
    let colRun = 1;
    for (let b = 1; b < size; b++) {
      if (modules[a][b] === modules[a][b - 1]) rowRun++;
      else rowRun = 1;
      if (rowRun >= 5) score += rowRun === 5 ? PENALTY_N1 : 1;

      if (modules[b][a] === modules[b - 1][a]) colRun++;
      else colRun = 1;
      if (colRun >= 5) score += colRun === 5 ? PENALTY_N1 : 1;
    }
  }
  return score;
}

/** N2: every 2x2 block of a single colour. */
function penaltyN2(modules) {
  const size = modules.length;
  let score = 0;
  for (let row = 0; row + 1 < size; row++) {
    for (let col = 0; col + 1 < size; col++) {
      const colour = modules[row][col];
      if (
        colour === modules[row][col + 1] &&
        colour === modules[row + 1][col] &&
        colour === modules[row + 1][col + 1]
      ) {
        score += PENALTY_N2;
      }
    }
  }
  return score;
}

const FINDER_LIKE = [true, false, true, true, true, false, true];

/** N3: the finder-like 1:1:3:1:1 pattern with four light modules beside it. */
function penaltyN3(modules) {
  const size = modules.length;
  // Out of bounds is quiet zone, which is light.
  const at = (row, col) =>
    row >= 0 && row < size && col >= 0 && col < size ? modules[row][col] : false;
  const clear = (row, col, dRow, dCol) => {
    for (let i = 0; i < 4; i++) if (at(row + dRow * i, col + dCol * i)) return false;
    return true;
  };

  let count = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      for (const [dRow, dCol] of [
        [0, 1],
        [1, 0],
      ]) {
        let matches = true;
        for (let i = 0; i < 7 && matches; i++) {
          const r = row + dRow * i;
          const c = col + dCol * i;
          if (r >= size || c >= size || at(r, c) !== FINDER_LIKE[i]) matches = false;
        }
        if (!matches) continue;
        const before = clear(row - dRow, col - dCol, -dRow, -dCol);
        const after = clear(row + dRow * 7, col + dCol * 7, dRow, dCol);
        if (before || after) count++;
      }
    }
  }
  return count * PENALTY_N3;
}

/** N4: how far the proportion of dark modules strays from 50%, in 5% steps. */
function penaltyN4(modules) {
  const size = modules.length;
  let dark = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (modules[row][col]) dark++;
  }
  const total = size * size;
  const steps = Math.floor((Math.abs(dark * 2 - total) * 10) / total);
  return steps * PENALTY_N4;
}

function maskPenalty(modules) {
  return penaltyN1(modules) + penaltyN2(modules) + penaltyN3(modules) + penaltyN4(modules);
}

/* -------------------------------------------------------------------------- *
 * Public API.
 * -------------------------------------------------------------------------- */

/**
 * Encode text as a QR Code matrix.
 *
 * @param {string} text
 * @param {{ecc?:string, minVersion?:number, maxVersion?:number, mask?:number}} [options]
 * @returns {{size:number, modules:boolean[][], version:number, mask:number, ecc:string}}
 *          `modules[row][col] === true` means a dark module.
 */
export function qrMatrix(text, options = {}) {
  const {
    ecc = 'M',
    minVersion = MIN_SUPPORTED_VERSION,
    maxVersion = MAX_SUPPORTED_VERSION,
    mask = -1,
  } = options;

  if (typeof text !== 'string') throw new TypeError('QR: text must be a string');
  if (!ECC_LEVELS.includes(ecc)) throw new RangeError('QR: unknown ECC level ' + String(ecc));
  if (
    !Number.isInteger(minVersion) ||
    !Number.isInteger(maxVersion) ||
    minVersion < MIN_SUPPORTED_VERSION ||
    maxVersion > MAX_SUPPORTED_VERSION ||
    minVersion > maxVersion
  ) {
    throw new RangeError('QR: version range must lie within 1-20');
  }
  if (!Number.isInteger(mask) || mask < -1 || mask > 7) {
    throw new RangeError('QR: mask must be -1 (auto) or 0-7');
  }

  const plan = planSegment(text, ecc, minVersion, maxVersion);
  const version = plan.version;
  const codewords = interleaveBlocks(buildDataCodewords(plan, text, ecc), version, ecc);

  const size = version * 4 + 17;
  const m = { size, modules: makeGrid(size, false), isFunction: makeGrid(size, false) };
  drawFunctionPatterns(m, version, ecc);
  drawCodewords(m, codewords);

  let chosen = mask;
  if (chosen < 0) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(m, candidate);
      drawFormatBits(m, ecc, candidate);
      const score = maskPenalty(m.modules);
      if (score < best) {
        best = score;
        chosen = candidate;
      }
      applyMask(m, candidate); // XOR again to undo.
    }
  }
  applyMask(m, chosen);
  drawFormatBits(m, ecc, chosen);

  return { size, modules: m.modules, version, mask: chosen, ecc };
}

/**
 * Colours reach the markup, so they are whitelisted rather than escaped: hex,
 * rgb()/rgba() with numeric arguments, or one of a handful of keywords. Anything
 * else falls back to the default, which keeps `qrSvg` safe to hand to innerHTML.
 */
const COLOR_KEYWORDS = new Set([
  'black',
  'white',
  'transparent',
  'none',
  'currentColor',
  'red',
  'green',
  'blue',
  'gray',
  'grey',
]);
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,4})\s*)?\)$/;

function safeColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (HEX_COLOR_RE.test(trimmed) || RGB_COLOR_RE.test(trimmed)) return trimmed;
  if (COLOR_KEYWORDS.has(trimmed)) return trimmed;
  return fallback;
}

/**
 * Standalone SVG markup for a QR Code.
 *
 * The default 4-module quiet zone is the spec minimum and it stays: phones scan
 * this off a glowing screen across a table, and shaving the margin is the first
 * thing that makes a code unreadable.
 *
 * @param {string} text
 * @param {{ecc?:string, margin?:number, dark?:string, light?:string, scale?:number,
 *          minVersion?:number, maxVersion?:number, mask?:number}} [options]
 * @returns {string}
 */
export function qrSvg(text, options = {}) {
  const { ecc = 'M', margin = 4, dark = '#000', light = '#fff', scale } = options;
  const quiet = Number.isFinite(margin) && margin >= 0 ? Math.floor(margin) : 4;

  const { size, modules } = qrMatrix(text, {
    ecc,
    minVersion: options.minVersion,
    maxVersion: options.maxVersion,
    mask: options.mask,
  });
  const extent = size + quiet * 2;

  // One path, with horizontal runs merged, so the DOM stays small on a phone.
  let path = '';
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!modules[row][col]) {
        col++;
        continue;
      }
      let run = 1;
      while (col + run < size && modules[row][col + run]) run++;
      path += 'M' + (col + quiet) + ' ' + (row + quiet) + 'h' + run + 'v1h-' + run + 'z';
      col += run;
    }
  }

  const px = Number.isFinite(scale) && scale > 0 ? Math.floor(extent * scale) : null;
  const dimensions = px === null ? '' : ' width="' + px + '" height="' + px + '"';

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    extent +
    ' ' +
    extent +
    '"' +
    dimensions +
    ' shape-rendering="crispEdges" role="img" aria-label="QR code">' +
    '<rect width="' +
    extent +
    '" height="' +
    extent +
    '" fill="' +
    safeColor(light, '#fff') +
    '"/>' +
    '<path fill="' +
    safeColor(dark, '#000') +
    '" d="' +
    path +
    '"/>' +
    '</svg>'
  );
}

// Written as escapes so this file stays pure ASCII on disk.
const FULL_BLOCK = '\u2588';
const UPPER_HALF_BLOCK = '\u2580';
const LOWER_HALF_BLOCK = '\u2584';
const ANSI_ON = '\u001b[47m\u001b[30m'; // White background, black foreground.
const ANSI_OFF = '\u001b[0m';

/**
 * A QR Code drawn with half-block characters, two module rows per text row so
 * the code stays square in a terminal.
 *
 * Rendered dark-on-light via ANSI colours by default: terminal themes vary, and
 * an inverted code is a coin flip on whether a phone will read it. Pass
 * `{ansi:false}` for plain characters (useful in tests and in pipes).
 *
 * @param {string} text
 * @param {{ecc?:string, margin?:number, ansi?:boolean}} [options]
 * @returns {string[]}
 */
export function qrTerminal(text, options = {}) {
  const { ecc = 'M', margin = 4, ansi = true } = options;
  const quiet = Number.isFinite(margin) && margin >= 0 ? Math.floor(margin) : 4;
  const { size, modules } = qrMatrix(text, { ecc });
  const extent = size + quiet * 2;

  const isDark = (row, col) => {
    const r = row - quiet;
    const c = col - quiet;
    return r >= 0 && c >= 0 && r < size && c < size && modules[r][c];
  };

  const lines = [];
  for (let row = 0; row < extent; row += 2) {
    let line = '';
    for (let col = 0; col < extent; col++) {
      const top = isDark(row, col);
      const bottom = row + 1 < extent ? isDark(row + 1, col) : false;
      if (top && bottom) line += FULL_BLOCK;
      else if (top) line += UPPER_HALF_BLOCK;
      else if (bottom) line += LOWER_HALF_BLOCK;
      else line += ' ';
    }
    lines.push(ansi ? ANSI_ON + line + ANSI_OFF : line);
  }
  return lines;
}

/**
 * Internals exposed for `tests/unit/music-qr.test.ts` only. The tests check
 * these against the published constants in ISO/IEC 18004 (format/version
 * information strings, generator polynomials, capacity tables), which is the
 * only way to prove the encoder is right rather than merely self-consistent.
 */
export const __internals = Object.freeze({
  ECC_CODEWORDS_PER_BLOCK,
  NUM_ERROR_CORRECTION_BLOCKS,
  ALPHANUMERIC_CHARSET,
  alignmentPatternPositions,
  countIndicatorBits,
  dataCodewords,
  formatInfoBits,
  gfMultiply,
  maskPenalty,
  penaltyN1,
  penaltyN2,
  penaltyN3,
  penaltyN4,
  rawDataModules,
  rsGeneratorPolynomial,
  rsRemainder,
  totalCodewords,
  versionInfoBits,
});
