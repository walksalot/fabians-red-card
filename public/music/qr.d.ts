/**
 * Types for the hand-rolled QR encoder. It ships as a plain ES module (the
 * browser and `scripts/music-server.mjs` load it verbatim, no build step), so
 * the types live beside it rather than in it: that way TypeScript callers such
 * as the vitest suite get real checking without the runtime file growing a
 * toolchain.
 */

export type QrEccLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrixOptions {
  /** Error correction level. Defaults to 'M'. */
  ecc?: QrEccLevel;
  /** Smallest version to consider (1-20, default 1). */
  minVersion?: number;
  /** Largest version to consider (1-20, default 20). */
  maxVersion?: number;
  /** Force a mask pattern (0-7). Default -1 picks the lowest-penalty mask. */
  mask?: number;
}

export interface QrMatrix {
  /** Width and height in modules (4 * version + 17). */
  size: number;
  /** `modules[row][col] === true` means a dark module. */
  modules: boolean[][];
  version: number;
  mask: number;
  ecc: QrEccLevel;
}

export interface QrSvgOptions extends QrMatrixOptions {
  /** Quiet zone in modules. Defaults to 4, the spec minimum. */
  margin?: number;
  /** Colour of dark modules; unrecognised values fall back to the default. */
  dark?: string;
  /** Colour of the background rect; unrecognised values fall back. */
  light?: string;
  /** Pixels per module; when omitted the SVG has no intrinsic size. */
  scale?: number;
}

export interface QrTerminalOptions {
  ecc?: QrEccLevel;
  /** Quiet zone in modules. Defaults to 4. */
  margin?: number;
  /** Wrap each line in ANSI black-on-white. Defaults to true. */
  ansi?: boolean;
}

export function qrMatrix(text: string, options?: QrMatrixOptions): QrMatrix;

export function qrSvg(text: string, options?: QrSvgOptions): string;

export function qrTerminal(text: string, options?: QrTerminalOptions): string[];

/** Exposed for the unit tests, which check these against the published tables. */
export const __internals: Readonly<{
  ECC_CODEWORDS_PER_BLOCK: Record<QrEccLevel, number[]>;
  NUM_ERROR_CORRECTION_BLOCKS: Record<QrEccLevel, number[]>;
  ALPHANUMERIC_CHARSET: string;
  alignmentPatternPositions(version: number): number[];
  countIndicatorBits(mode: 'NUMERIC' | 'ALPHANUMERIC' | 'BYTE', version: number): number;
  dataCodewords(version: number, ecc: QrEccLevel): number;
  formatInfoBits(ecc: QrEccLevel, mask: number): number;
  gfMultiply(a: number, b: number): number;
  maskPenalty(modules: boolean[][]): number;
  penaltyN1(modules: boolean[][]): number;
  penaltyN2(modules: boolean[][]): number;
  penaltyN3(modules: boolean[][]): number;
  penaltyN4(modules: boolean[][]): number;
  rawDataModules(version: number): number;
  rsGeneratorPolynomial(degree: number): number[];
  rsRemainder(data: number[], generator: number[]): number[];
  totalCodewords(version: number): number;
  versionInfoBits(version: number): number;
}>;
