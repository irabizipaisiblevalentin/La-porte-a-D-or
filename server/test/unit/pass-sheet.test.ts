/**
 * The printable sheet of entrance passes.
 *
 * A PDF that is subtly malformed is worse than no PDF: the coordinator
 * downloads it the day before an event, and if it does not open there is no time
 * to recover. So the document is checked structurally — the cross-reference
 * offsets are followed, the pages are counted, and the text is read back — rather
 * than merely asserted to be non-empty.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildPassSheet,
  passSheetFilename,
  type PassCard,
} from "../../../web/src/lib/pass-sheet.js"
import { encodeQr } from "../../../web/src/lib/qr.js"

function card(index: number, overrides: Partial<PassCard> = {}): PassCard {
  return {
    name: `Singer ${index}`,
    memberNo: `CHR-2026-00${String(index).padStart(2, "0")}`,
    group: "Senior",
    qrText: `https://la-porte-ador.onrender.com/checkin/TOKEN-${index}-ABCDEFGHIJKLMNOPQRSTUVWXYZ`,
    passcode: `K7QP-3M${index}Z-9XYZ`,
    ...overrides,
  }
}

const options = {
  eventName: "Grand Concert",
  eventDate: "2026-12-10",
  eventTime: "18:30",
  eventLocation: "Kigali",
  encode: encodeQr,
}

function asText(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes)
}

/**
 * Decodes a byte range as WinAnsi-ish text for assertions that look for content.
 *
 * The document contains a binary comment whose characters are outside Latin-1, so
 * decoding the *whole* file as UTF-8 would be wrong and decoding it as UTF-16
 * meaningless. Assertions about text use this; assertions about structure work on
 * the raw bytes.
 */
function textOf(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder("latin1").decode(bytes.subarray(start, end))
}

test("the document is a well-formed PDF with the expected trailer", () => {
  const text = asText(buildPassSheet([card(1)], options))
  assert.match(text, /^%PDF-1\.4\n/, "a version header must be the first bytes")
  assert.match(text, /%%EOF\n$/, "the end-of-file marker must be last")
  assert.match(text, /\/Type \/Catalog/, "a reader finds the pages through the catalogue")
  assert.match(text, /\/Root 1 0 R/)
})

test("the cross-reference offsets actually point at their objects", () => {
  // This is the check that catches the classic hand-written PDF bug: a table that
  // looks right but sends the reader to the wrong byte, so the file "opens" in
  // one viewer and fails in another.
  //
  // Offsets in a PDF are byte offsets, and the binary comment near the top is
  // eight bytes for four characters — so this test works on the raw bytes
  // throughout, exactly as a reader does.
  const bytes = buildPassSheet([card(1), card(2)], options)
  const text = asText(bytes)

  const startxref = /startxref\n(\d+)/.exec(text)
  assert.ok(startxref, "the trailer must carry the xref offset")
  const xrefOffset = Number(startxref[1])
  assert.ok(xrefOffset > 0 && xrefOffset < bytes.length, "the xref offset must be inside the file")
  assert.equal(textOf(bytes, xrefOffset, xrefOffset + 4), "xref", "the offset must land on the xref table")

  const size = /\/Size (\d+)/.exec(text)
  assert.ok(size)
  const objectCount = Number(size[1]) - 1

  // Each entry is 20 bytes: a 10-digit offset, a 5-digit generation, a type flag
  // and two terminators. The first entry is the free-list head, then one entry per
  // object. Read the offsets back and confirm each lands on "N 0 obj".
  const table = text.slice(xrefOffset)
  const lines = table.split("\n")
  assert.equal(lines[0], "xref")
  assert.equal(lines[1], `0 ${objectCount + 1}`, "the table header declares one free entry plus the objects")
  const entries = lines.slice(3, 3 + objectCount)
  assert.equal(entries.length, objectCount, "the table must have one entry per object")
  entries.forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10))
    assert.ok(offset > 0, `object ${index + 1} has a valid offset`)
    const at = textOf(bytes, offset, offset + 24)
    assert.match(at, new RegExp(`^${index + 1} 0 obj`), `offset for object ${index + 1} points at it`)
  })
})

test("twenty passes fit one sheet; the twenty-first starts the next", () => {
  const one = asText(buildPassSheet(Array.from({ length: 20 }, (_, index) => card(index)), options))
  assert.equal((one.match(/\/Type \/Page[^s]/g) ?? []).length, 1)
  assert.match(one, /Page 1 of 1/)

  const twentyOne = asText(buildPassSheet(Array.from({ length: 21 }, (_, index) => card(index)), options))
  assert.equal((twentyOne.match(/\/Type \/Page[^s]/g) ?? []).length, 2, "a 21st pass needs a second sheet")
  assert.match(twentyOne, /Page 1 of 2/)
  assert.match(twentyOne, /Page 2 of 2/)
})

test("every card's name, member number and passcode are printed", () => {
  const cards = [
    card(1, { name: "Uwizihiwe Josiane", memberNo: "CHR-2026-0014", passcode: "ABCD-EFGH-JKLM" }),
    card(2, { name: "Happy Chris", memberNo: "CHR-2026-0015", passcode: "NPRS-TUVW-XYZ2" }),
  ]
  const text = asText(buildPassSheet(cards, options))

  for (const value of ["Uwizihiwe Josiane", "Happy Chris", "CHR-2026-0014", "CHR-2026-0015", "ABCD-EFGH-JKLM", "NPRS-TUVW-XYZ2"]) {
    assert.ok(text.includes(value), `the sheet must print "${value}"`)
  }
})

test("the header carries the event, and an empty sheet is still a valid document", () => {
  const text = asText(buildPassSheet([], options))
  assert.ok(text.includes("Grand Concert"))
  assert.ok(text.includes("2026-12-10"))
  assert.match(text, /%%EOF\n$/)
  assert.equal((text.match(/\/Type \/Page[^s]/g) ?? []).length, 1, "an empty sheet is one blank page")
})

test("a character outside WinAnsi does not break the document", () => {
  // A name copied from a phone can carry punctuation a PDF literal must escape,
  // and parentheses or a backslash would otherwise end the string early.
  const text = asText(
    buildPassSheet([card(1, { name: "Test (Junior) \\ Backslash", passcode: "AB(C)-DE" })], options),
  )
  assert.ok(text.includes("\\(Junior\\)"), "parentheses must be escaped")
  assert.ok(text.includes("\\\\"), "a backslash must be escaped")
  assert.match(text, /%%EOF\n$/, "the document must still be complete")
})

test("an em-dash in the event name prints as an em-dash", () => {
  const text = asText(
    buildPassSheet([card(1)], { ...options, eventName: "Tuzahorana Edition 3 — Grand Concert" }),
  )
  // WinAnsi places the em-dash at code 151, written as an octal escape.
  assert.ok(text.includes("\\227"), "the em-dash must be mapped, not replaced with a question mark")
  assert.equal(text.includes("Edition 3 ? Grand"), false, "the name must not be mangled")
})

test("the codes are drawn as rectangles, not embedded as an image", () => {
  const text = asText(buildPassSheet([card(1)], options))
  assert.match(text, /re f/, "dark modules are filled rectangles")
  assert.equal(text.includes("/Subtype /Image"), false, "no image codec is involved")
  // Runs across a row are merged, so a large symbol stays a small stream.
  const rectangles = (text.match(/re f/g) ?? []).length
  const darkModules = encodeQr(card(1).qrText).modules.flat().filter(Boolean).length
  assert.ok(
    rectangles < darkModules,
    `merging runs should emit fewer rectangles (${rectangles}) than dark modules (${darkModules})`,
  )
})

test("the filename is safe on every platform", () => {
  assert.equal(passSheetFilename("Grand Concert", "2026-12-10"), "entrance-passes-grand-concert-2026-12-10.pdf")
  assert.equal(passSheetFilename("Tuzahorana Edition 3 — Grand Concert", "2026-12-10"),
    "entrance-passes-tuzahorana-edition-3-grand-concert-2026-12-10.pdf")
  // A name that is only punctuation must still produce a usable filename.
  assert.equal(passSheetFilename("!!!", "2026-12-10"), "entrance-passes-event-2026-12-10.pdf")
  // And a very long name must not produce a filename the filesystem rejects.
  const long = passSheetFilename("A".repeat(300), "2026-12-10")
  assert.ok(long.length < 120, `filename must stay short, got ${long.length}`)
})
