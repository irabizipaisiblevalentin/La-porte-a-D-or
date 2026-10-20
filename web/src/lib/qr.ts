/**
 * A QR code encoder, written out rather than depended on.
 *
 * The choir's entrance passes are the point of this: a pass code has to become a
 * square a phone camera can read, and the PDF of all passes has to be built in
 * the browser so the deployment stays free of both a paid QR service and a server
 * PDF library. A dependency would also have to be trusted with the pass tokens,
 * which is not something worth doing for 300 lines of arithmetic.
 *
 * Scope is deliberately narrow and exact:
 *
 *   - **Byte mode only.** A pass URL is ASCII; alphanumeric or numeric modes would
 *     save a few modules and add several ways to be subtly wrong.
 *   - **Error-correction level M** (~15%), the level a printed sheet photographed
 *     at an angle needs. It is not configurable, so there is one code path.
 *   - **Versions 1–10** (up to 213 bytes). A pass URL is around 70 characters, so
 *     this is comfortable; the encoder throws rather than silently truncating if
 *     it is ever handed more.
 *
 * Correctness is checked in `web/test` against the published specification's own
 * worked example, because a QR code that is *almost* right scans as nothing at
 * all and would only be discovered at the door.
 */

/** Error-correction level M, as specified: ~15% of codewords may be restored. */
const EC_LEVEL_M = 0

/** Number of data codewords for versions 1–10 at level M. */
const DATA_CODEWORDS_M = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216]

/** Number of error-correction codewords per block for versions 1–10 at level M. */
const EC_CODEWORDS_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]

/** Block structure for versions 1–10 at level M: [blocks in group 1, data per block in group 1]. */
const BLOCKS_M: [number, number][] = [
  [1, 16], [1, 28], [1, 44], [2, 32], [2, 43],
  [4, 27], [4, 31], [2, 38], [3, 36], [4, 43],
]

/** Module coordinates of the alignment-pattern centres, by version. */
const ALIGNMENT_CENTRES: number[][] = [
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
]

// --- Galois field arithmetic -------------------------------------------------
//
// Reed-Solomon works over GF(256) with the primitive polynomial 0x11d, which is
// what the QR specification names. The tables are built once and shared.

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let value = 1
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value
    LOG[value] = index
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255]
})()

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** The generator polynomial for `degree` error-correction codewords. */
function generatorPolynomial(degree: number): Uint8Array {
  let polynomial = new Uint8Array([1])
  for (let index = 0; index < degree; index += 1) {
    const next = new Uint8Array(polynomial.length + 1)
    for (let position = 0; position < polynomial.length; position += 1) {
      next[position] ^= polynomial[position]
      next[position + 1] ^= gfMultiply(polynomial[position], EXP[index])
    }
    polynomial = next
  }
  return polynomial
}

/** The remainder of `data · x^degree` divided by the generator — the EC codewords. */
function errorCorrectionCodewords(data: Uint8Array, degree: number): Uint8Array {
  const generator = generatorPolynomial(degree)
  const remainder = new Uint8Array(degree)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.copyWithin(0, 1)
    remainder[degree - 1] = 0
    if (factor !== 0) {
      for (let index = 0; index < degree; index += 1) {
        remainder[index] ^= gfMultiply(generator[index + 1], factor)
      }
    }
  }
  return remainder
}

// --- Bit stream --------------------------------------------------------------

class BitStream {
  private readonly bits: number[] = []

  push(value: number, length: number): void {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.bits.push((value >>> index) & 1)
    }
  }

  get length(): number {
    return this.bits.length
  }

  /** Packs the bits into bytes; the final byte is padded with zeroes as specified. */
  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8))
    this.bits.forEach((bit, index) => {
      if (bit) bytes[index >> 3] |= 0x80 >> (index & 7)
    })
    return bytes
  }
}

// --- Encoding ----------------------------------------------------------------

export interface QrCode {
  /** Side length in modules, excluding the quiet zone. */
  size: number
  version: number
  /** `true` at a dark module. Indexed `[row][column]`. */
  modules: boolean[][]
}

/**
 * Encodes `text` as a QR code at error-correction level M.
 *
 * Throws when the text does not fit a version-10 symbol rather than truncating:
 * an entrance pass that encodes to something else is worse than a visible error.
 */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text)

  // Byte mode needs a 4-bit mode indicator plus the character count: 8 bits up to
  // version 9, 16 bits from version 10.
  let version = 0
  for (let candidate = 1; candidate <= 10; candidate += 1) {
    const countBits = candidate <= 9 ? 8 : 16
    const needed = 4 + countBits + bytes.length * 8
    if (needed <= DATA_CODEWORDS_M[candidate - 1] * 8) {
      version = candidate
      break
    }
  }
  if (version === 0) {
    throw new Error(`This text is too long for a QR code (${bytes.length} bytes).`)
  }

  const stream = new BitStream()
  stream.push(0b0100, 4) // byte mode
  stream.push(bytes.length, version <= 9 ? 8 : 16)
  for (const byte of bytes) stream.push(byte, 8)

  const capacityBits = DATA_CODEWORDS_M[version - 1] * 8
  // Terminator: up to four zero bits, then pad to a byte boundary.
  stream.push(0, Math.min(4, capacityBits - stream.length))
  while (stream.length % 8 !== 0) stream.push(0, 1)

  const data = Array.from(stream.toBytes())
  // Pad codewords alternate 0xEC / 0x11 until the capacity is filled, as specified.
  const padBytes = [0xec, 0x11]
  let padIndex = 0
  while (data.length < DATA_CODEWORDS_M[version - 1]) {
    data.push(padBytes[padIndex % 2])
    padIndex += 1
  }

  const codewords = interleave(new Uint8Array(data), version)
  return buildMatrix(codewords, version)
}

/** Splits the data into blocks, adds EC bytes, and interleaves both as specified. */
function interleave(data: Uint8Array, version: number): Uint8Array {
  const [groupCount, groupDataLength] = BLOCKS_M[version - 1]
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK_M[version - 1]
  const totalData = DATA_CODEWORDS_M[version - 1]
  // Group 2 blocks hold one more data codeword each than group 1.
  const group2Count = totalData - groupCount * groupDataLength > 0
    ? (totalData - groupCount * groupDataLength) / (groupDataLength + 1)
    : 0
  const group1Count = groupCount - group2Count

  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  let offset = 0
  for (let index = 0; index < groupCount; index += 1) {
    const length = index < group1Count ? groupDataLength : groupDataLength + 1
    const block = data.subarray(offset, offset + length)
    offset += length
    dataBlocks.push(new Uint8Array(block))
    ecBlocks.push(errorCorrectionCodewords(block, ecPerBlock))
  }

  const result: number[] = []
  const longestData = Math.max(...dataBlocks.map((block) => block.length))
  for (let index = 0; index < longestData; index += 1) {
    for (const block of dataBlocks) {
      if (index < block.length) result.push(block[index])
    }
  }
  for (let index = 0; index < ecPerBlock; index += 1) {
    for (const block of ecBlocks) result.push(block[index])
  }
  return new Uint8Array(result)
}

/** Applies the eight data masks and returns the one with the lowest penalty. */
function buildMatrix(codewords: Uint8Array, version: number): QrCode {
  const size = version * 4 + 17
  const reserved: boolean[][] = emptyMatrix(size)
  const modules: boolean[][] = emptyMatrix(size)

  placeFunctionPatterns(modules, reserved, size, version)
  placeData(modules, reserved, codewords, size)

  let best: boolean[][] | null = null
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row) => [...row])
    applyMask(candidate, reserved, size, mask)
    placeFormatInfo(candidate, size, mask)
    const penalty = penaltyScore(candidate, size)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      best = candidate
    }
  }

  return { size, version, modules: best! }
}

function emptyMatrix(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => false))
}

/** Finder patterns, separators, timing patterns, alignment patterns and the dark module. */
function placeFunctionPatterns(
  modules: boolean[][],
  reserved: boolean[][],
  size: number,
  version: number,
): void {
  const set = (row: number, column: number, dark: boolean) => {
    if (row < 0 || column < 0 || row >= size || column >= size) return
    modules[row][column] = dark
    reserved[row][column] = true
  }

  // Finder patterns with their separators, in three corners.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const inRing =
          (row >= 0 && row <= 6 && (column === 0 || column === 6)) ||
          (column >= 0 && column <= 6 && (row === 0 || row === 6))
        const inCore = row >= 2 && row <= 4 && column >= 2 && column <= 4
        set(top + row, left + column, inRing || inCore)
      }
    }
  }

  // Timing patterns.
  for (let index = 8; index < size - 8; index += 1) {
    set(6, index, index % 2 === 0)
    set(index, 6, index % 2 === 0)
  }

  // Alignment patterns, skipping the three corners the finders occupy.
  const centres = ALIGNMENT_CENTRES[version - 1]
  for (const row of centres) {
    for (const column of centres) {
      const overlapsFinder =
        (row <= 8 && column <= 8) ||
        (row <= 8 && column >= size - 9) ||
        (row >= size - 9 && column <= 8)
      if (overlapsFinder) continue
      for (let deltaRow = -2; deltaRow <= 2; deltaRow += 1) {
        for (let deltaColumn = -2; deltaColumn <= 2; deltaColumn += 1) {
          const ring = Math.max(Math.abs(deltaRow), Math.abs(deltaColumn))
          set(row + deltaRow, column + deltaColumn, ring !== 1)
        }
      }
    }
  }

  // Reserve the format areas (filled in per mask later) and the version block.
  for (let index = 0; index < 9; index += 1) {
    if (index !== 6) {
      reserved[8][index] = true
      reserved[index][8] = true
    }
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][size - 1 - index] = true
    reserved[size - 1 - index][8] = true
  }
  reserved[size - 8][8] = true
  if (version >= 7) {
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        reserved[row][size - 11 + column] = true
        reserved[size - 11 + column][row] = true
      }
    }
    placeVersionInfo(modules, size, version)
  }
}

/** Version information, for versions 7 and above: an 18-bit BCH code. */
function placeVersionInfo(modules: boolean[][], size: number, version: number): void {
  let remainder = version
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
  }
  const bits = (version << 12) | remainder
  for (let index = 0; index < 18; index += 1) {
    const dark = ((bits >>> index) & 1) === 1
    const row = Math.floor(index / 3)
    const column = index % 3
    modules[row][size - 11 + column] = dark
    modules[size - 11 + column][row] = dark
  }
}

/** The 15-bit format information: 5 data bits, 10 BCH bits, xor'd with 0x5412. */
function placeFormatInfo(modules: boolean[][], size: number, mask: number): void {
  const data = (EC_LEVEL_M << 3) | mask
  let remainder = data
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  }
  const bits = (((data << 10) | remainder) ^ 0x5412) & 0x7fff

  const bit = (index: number) => ((bits >>> index) & 1) === 1

  // First copy, around the top-left finder.
  for (let index = 0; index <= 5; index += 1) modules[8][index] = bit(index)
  modules[8][7] = bit(6)
  modules[8][8] = bit(7)
  modules[7][8] = bit(8)
  for (let index = 9; index <= 14; index += 1) modules[14 - index][8] = bit(index)

  // Second copy, split between the other two finders.
  for (let index = 0; index <= 7; index += 1) modules[size - 1 - index][8] = bit(index)
  for (let index = 8; index <= 14; index += 1) modules[8][size - 15 + index] = bit(index)
  modules[size - 8][8] = true // the dark module
}

/** Fills the data codewords in the specification's two-module-wide zig-zag. */
function placeData(
  modules: boolean[][],
  reserved: boolean[][],
  codewords: Uint8Array,
  size: number,
): void {
  let bitIndex = 0
  let upward = true

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern and is skipped entirely.
    if (right === 6) right = 5
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset
        if (reserved[row][column]) continue
        const byte = codewords[bitIndex >> 3]
        const dark = byte !== undefined && ((byte >>> (7 - (bitIndex & 7))) & 1) === 1
        modules[row][column] = dark
        bitIndex += 1
      }
    }
    upward = !upward
  }
}

function applyMask(modules: boolean[][], reserved: boolean[][], size: number, mask: number): void {
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (reserved[row][column]) continue
      let invert = false
      switch (mask) {
        case 0: invert = (row + column) % 2 === 0; break
        case 1: invert = row % 2 === 0; break
        case 2: invert = column % 3 === 0; break
        case 3: invert = (row + column) % 3 === 0; break
        case 4: invert = (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0; break
        case 5: invert = ((row * column) % 2) + ((row * column) % 3) === 0; break
        case 6: invert = (((row * column) % 2) + ((row * column) % 3)) % 2 === 0; break
        case 7: invert = (((row + column) % 2) + ((row * column) % 3)) % 2 === 0; break
      }
      if (invert) modules[row][column] = !modules[row][column]
    }
  }
}

/**
 * The specification's mask-selection penalty: runs of like modules, blocks of like
 * modules, finder-like patterns, and overall dark/light imbalance.
 */
function penaltyScore(modules: boolean[][], size: number): number {
  let penalty = 0

  const runScore = (line: boolean[]): number => {
    let score = 0
    let run = 1
    for (let index = 1; index < line.length; index += 1) {
      if (line[index] === line[index - 1]) {
        run += 1
      } else {
        if (run >= 5) score += run - 2
        run = 1
      }
    }
    if (run >= 5) score += run - 2
    return score
  }

  for (let index = 0; index < size; index += 1) {
    penalty += runScore(modules[index])
    penalty += runScore(modules.map((row) => row[index]))
  }

  // 2x2 blocks of one colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = modules[row][column]
      if (
        value === modules[row][column + 1] &&
        value === modules[row + 1][column] &&
        value === modules[row + 1][column + 1]
      ) {
        penalty += 3
      }
    }
  }

  // Finder-like 1:1:3:1:1 patterns with a four-module light margin.
  const pattern = [true, false, true, true, true, false, true]
  const matches = (line: boolean[], start: number): boolean => {
    for (let index = 0; index < pattern.length; index += 1) {
      if (line[start + index] !== pattern[index]) return false
    }
    const leadingClear = line.slice(Math.max(0, start - 4), start).every((value) => !value)
    const trailingClear = line.slice(start + 7, start + 11).every((value) => !value)
    return leadingClear || trailingClear
  }
  for (let index = 0; index < size; index += 1) {
    const row = modules[index]
    const column = modules.map((line) => line[index])
    for (let start = 0; start + 7 <= size; start += 1) {
      if (matches(row, start)) penalty += 40
      if (matches(column, start)) penalty += 40
    }
  }

  const dark = modules.flat().filter(Boolean).length
  const percent = (dark * 100) / (size * size)
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10

  return penalty
}

/**
 * An SVG path for the code, one `<path>` of unit squares.
 *
 * A path rather than one `<rect>` per dark module — a version-10 symbol has over
 * a thousand modules, and a single path keeps the DOM small enough that a page of
 * 300 passes still renders.
 */
export function qrSvgPath(code: QrCode): string {
  const parts: string[] = []
  for (let row = 0; row < code.size; row += 1) {
    for (let column = 0; column < code.size; column += 1) {
      if (code.modules[row][column]) parts.push(`M${column} ${row}h1v1h-1z`)
    }
  }
  return parts.join("")
}

/**
 * A standalone SVG string, for embedding in a PDF or saving as a file.
 *
 * The quiet zone is included: a QR code with no margin around it is one of the
 * most common reasons a printed code will not scan.
 */
export function qrSvg(text: string, options: { scale?: number; margin?: number } = {}): string {
  const code = encodeQr(text)
  const margin = options.margin ?? 4
  const scale = options.scale ?? 8
  const extent = (code.size + margin * 2) * scale
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${extent}" height="${extent}" viewBox="0 0 ${code.size + margin * 2} ${code.size + margin * 2}" shape-rendering="crispEdges">`,
    `<rect width="${code.size + margin * 2}" height="${code.size + margin * 2}" fill="#ffffff"/>`,
    `<path d="${qrSvgPath(code)}" fill="#000000" transform="translate(${margin} ${margin})"/>`,
    `</svg>`,
  ].join("")
}
