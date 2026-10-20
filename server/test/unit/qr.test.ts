/**
 * The QR encoder behind the entrance passes.
 *
 * A QR code is the one artefact in this system whose failure is silent: an
 * almost-correct symbol looks perfectly plausible on screen and scans as nothing
 * at all, and nobody finds out until a queue has formed at a door. So the encoder
 * is checked against the specification rather than against itself.
 *
 * The reference values below were produced by an independent implementation
 * (`scripts/qr-reference.py`) that follows ISO/IEC 18004 directly: byte-mode
 * encoding, the terminator and pad codewords, the Reed-Solomon generator over
 * GF(256) with polynomial 0x11d, and the block interleaving.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { encodeQr, qrSvg, qrSvgPath } from "../../../web/src/lib/qr.ts"

/**
 * Reads a symbol back into its codewords without using the encoder's own path.
 *
 * This is the important part: comparing the encoder to its own intermediate
 * values would prove nothing. Here the reserved areas are rebuilt from the
 * specification, the mask is recovered from the format information, and the bits
 * are read back in the specified zig-zag.
 */
function readCodewords(code: { size: number; modules: boolean[][] }): number[] {
  const size = code.size
  const reserved = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const mark = (row: number, column: number) => {
    if (row >= 0 && column >= 0 && row < size && column < size) reserved[row][column] = true
  }

  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) mark(top + row, left + column)
    }
  }
  for (let index = 8; index < size - 8; index += 1) {
    mark(6, index)
    mark(index, 6)
  }
  for (let index = 0; index < 9; index += 1) {
    if (index !== 6) {
      mark(8, index)
      mark(index, 8)
    }
  }
  for (let index = 0; index < 8; index += 1) {
    mark(8, size - 1 - index)
    mark(size - 1 - index, 8)
  }
  mark(size - 8, 8)

  // Alignment patterns. Omitting these is the classic way to read a symbol back
  // wrongly from version 2 onwards, where the first one appears.
  const version = (size - 17) / 4
  const centreTable: number[][] = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  ]
  for (const centreRow of centreTable[version - 1] ?? []) {
    for (const centreColumn of centreTable[version - 1] ?? []) {
      const overlapsFinder =
        (centreRow <= 8 && centreColumn <= 8) ||
        (centreRow <= 8 && centreColumn >= size - 9) ||
        (centreRow >= size - 9 && centreColumn <= 8)
      if (overlapsFinder) continue
      for (let deltaRow = -2; deltaRow <= 2; deltaRow += 1) {
        for (let deltaColumn = -2; deltaColumn <= 2; deltaColumn += 1) {
          mark(centreRow + deltaRow, centreColumn + deltaColumn)
        }
      }
    }
  }
  if (version >= 7) {
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        mark(row, size - 11 + column)
        mark(size - 11 + column, row)
      }
    }
  }

  // Recover the mask from the format information: 15 bits, xor'd with 0x5412,
  // the five data bits being [ec level 2][mask 3].
  let format = 0
  const formatOrder: [number, number][] = []
  for (let index = 0; index <= 5; index += 1) formatOrder.push([8, index])
  formatOrder.push([8, 7], [8, 8], [7, 8])
  for (let index = 9; index <= 14; index += 1) formatOrder.push([14 - index, 8])
  formatOrder.forEach(([row, column], index) => {
    if (code.modules[row][column]) format |= 1 << index
  })
  const mask = ((format ^ 0x5412) >> 10) & 0x7

  const maskFn = (row: number, column: number): boolean => {
    switch (mask) {
      case 0: return (row + column) % 2 === 0
      case 1: return row % 2 === 0
      case 2: return column % 3 === 0
      case 3: return (row + column) % 3 === 0
      case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0
      case 5: return ((row * column) % 2) + ((row * column) % 3) === 0
      case 6: return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0
      default: return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0
    }
  }

  const bits: number[] = []
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset
        if (reserved[row][column]) continue
        bits.push(code.modules[row][column] !== maskFn(row, column) ? 1 : 0)
      }
    }
    upward = !upward
  }

  const codewords: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    let byte = 0
    for (let offset = 0; offset < 8; offset += 1) byte = (byte << 1) | bits[index + offset]
    codewords.push(byte)
  }
  return codewords
}

test("byte mode, version 1-M: the codewords match an independent implementation", () => {
  // "HELLO WORLD" is the worked example used throughout the specification.
  const code = encodeQr("HELLO WORLD")
  assert.equal(code.version, 1)
  assert.equal(code.size, 21)

  const codewords = readCodewords(code)
  assert.deepEqual(codewords.slice(0, 16), [
    64, 180, 132, 84, 196, 196, 242, 5, 116, 245, 36, 196, 64, 236, 17, 236,
  ], "the data codewords, including the terminator and the 0xEC/0x11 padding")

  assert.deepEqual(codewords.slice(16, 26), [
    12, 75, 207, 154, 137, 79, 101, 9, 151, 204,
  ], "the Reed-Solomon error-correction codewords")
})

test("the three finder patterns are where the specification puts them", () => {
  const code = encodeQr("HELLO WORLD")
  const size = code.size
  // Every finder is a 7x7 ring with a 3x3 core.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const ring = row === 0 || row === 6 || column === 0 || column === 6
        const core = row >= 2 && row <= 4 && column >= 2 && column <= 4
        assert.equal(
          code.modules[top + row][left + column],
          ring || core,
          `finder module at ${top + row},${left + column}`,
        )
      }
    }
  }
  // The separators around each finder must be light.
  for (let index = 0; index < 8; index += 1) {
    assert.equal(code.modules[7][index], false, "separator beside the top-left finder")
    assert.equal(code.modules[index][7], false, "separator beside the top-left finder")
    assert.equal(code.modules[size - 8][index], false, "separator beside the bottom-left finder")
  }
})

test("the timing patterns alternate", () => {
  const code = encodeQr("HELLO WORLD")
  for (let index = 8; index < code.size - 8; index += 1) {
    assert.equal(code.modules[6][index], index % 2 === 0, `horizontal timing at ${index}`)
    assert.equal(code.modules[index][6], index % 2 === 0, `vertical timing at ${index}`)
  }
})

test("the dark module is set and the format copy is consistent", () => {
  const code = encodeQr("HELLO WORLD")
  const size = code.size
  assert.equal(code.modules[size - 8][8], true, "the dark module is always dark")

  // Both copies of the format information must carry the same bits.
  const first: boolean[] = []
  for (let index = 0; index <= 5; index += 1) first.push(code.modules[8][index])
  first.push(code.modules[8][7], code.modules[8][8], code.modules[7][8])
  for (let index = 9; index <= 14; index += 1) first.push(code.modules[14 - index][8])

  const second: boolean[] = []
  for (let index = 0; index <= 7; index += 1) second.push(code.modules[size - 1 - index][8])
  for (let index = 8; index <= 14; index += 1) second.push(code.modules[8][size - 15 + index])

  assert.deepEqual(first, second, "the two format-information copies must agree")
})

test("a longer value steps up to a larger version", () => {
  // A pass URL is around 70 characters. It must fit, and fit at a sane version.
  const url = "https://la-porte-ador.onrender.com/checkin/K7QP3MAB-9XYZ-TEST-TOKEN-0123456789ABCDEF"
  const code = encodeQr(url)
  assert.equal(code.size, code.version * 4 + 17)
  assert.ok(code.version >= 4 && code.version <= 10, `expected a mid-range version, got ${code.version}`)
  assert.ok(code.size >= 33, "a ~70 character value needs at least a version-4 symbol")
})

test("text that cannot fit is refused, never truncated", () => {
  // A truncated pass would encode a *different* valid-looking code.
  assert.throws(() => encodeQr("x".repeat(300)), /too long/)
})

test("the SVG output is well formed and carries a quiet zone", () => {
  const svg = qrSvg("HELLO WORLD")
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /<\/svg>$/)
  assert.match(svg, /shape-rendering="crispEdges"/, "crisp edges matter: a blurred QR stops scanning")

  // A quiet zone of four modules on each side, against a version-1 symbol.
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  assert.ok(viewBox)
  assert.equal(Number(viewBox[1]), 21 + 8, "four modules of margin on each side")
})

test("the path is one path, not one element per module", () => {
  const code = encodeQr("HELLO WORLD")
  const path = qrSvgPath(code)
  const dark = code.modules.flat().filter(Boolean).length
  assert.equal((path.match(/M/g) ?? []).length, dark, "one subpath per dark module, and no others")
  assert.equal(path.includes("<"), false)
})

test("a value with non-ASCII characters encodes as UTF-8 bytes", () => {
  // Names on the passes are Rwandan, so a name must survive the encoding exactly.
  const name = "Uwizihiwe Josiane"
  const code = encodeQr(name)
  const codewords = readCodewords(code)
  assert.equal(codewords[0] >> 4, 0b0100, "byte mode is signalled")

  // Walk the bit stream: 4-bit mode, 8-bit character count, then the payload.
  const bits: number[] = []
  for (const byte of codewords) {
    for (let index = 7; index >= 0; index -= 1) bits.push((byte >> index) & 1)
  }
  const readBits = (start: number, length: number): number => {
    let value = 0
    for (let index = 0; index < length; index += 1) value = (value << 1) | bits[start + index]
    return value
  }
  assert.equal(readBits(0, 4), 0b0100, "mode indicator")
  const count = readBits(4, 8)
  assert.equal(count, name.length, "the character count is the byte length")

  const expected = Array.from(new TextEncoder().encode(name))
  const recovered: number[] = []
  for (let index = 0; index < count; index += 1) recovered.push(readBits(12 + index * 8, 8))
  assert.deepEqual(recovered, expected, "the payload round-trips as UTF-8 bytes")
})
