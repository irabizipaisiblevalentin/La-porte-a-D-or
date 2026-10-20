/**
 * A minimal PDF writer, for the sheet of entrance passes.
 *
 * The choir needs one printable document holding every attendee's QR code, the
 * day before an event. Doing it in the browser keeps the deployment free: no
 * server-side PDF library to install, and nothing to pay per document.
 *
 * This writes PDF 1.4 by hand rather than pretending to be a typesetting engine.
 * Only what a pass sheet needs is supported:
 *
 *   - **A standard font, not embedded.** Helvetica is one of the fourteen fonts
 *     every reader already has, so there is no font file and no licensing.
 *   - **Text is WinAnsi-encoded.** Names are drawn with an escape for anything
 *     outside Latin-1 rather than being silently dropped.
 *   - **The QR code is drawn as filled rectangles.** It is a grid; a rectangle
 *     per dark module is exactly what it is, and it avoids embedding an image
 *     codec. The rectangles are merged into runs across each row, which cuts a
 *     version-6 symbol from ~1400 operators to a few hundred.
 *
 * Everything is measured in PDF points (72 per inch), with the origin at the
 * bottom-left corner.
 */

/** The fourteen standard fonts; Helvetica and its bold face are all we need. */
export type StandardFont = "Helvetica" | "Helvetica-Bold"

const PAGE_WIDTH = 595.28 // A4 at 72 dpi
const PAGE_HEIGHT = 841.89

export interface PassCard {
  /** The person's full name, printed beside their code. */
  name: string
  /** Their member number, printed under the name. */
  memberNo: string
  /** Their group, for a steward sorting a stack of sheets. */
  group: string
  /** The value the QR encodes — the pass URL, including its token. */
  qrText: string
  /** The short code a steward can type if the camera will not read. */
  passcode: string
}

export interface PassSheetOptions {
  eventName: string
  eventDate: string
  eventTime?: string | null
  eventLocation?: string | null
  /** Shown as a footer line, e.g. the cancellation note. */
  footnote?: string
  /** Injected so this module stays testable and free of a QR dependency. */
  encode: (text: string) => { size: number; modules: boolean[][] }
}

/** A single element of the content stream, kept as text until assembly. */
type Operation = string

/**
 * Escapes a string for a PDF literal.
 *
 * WinAnsiEncoding matches Latin-1 for 32–126 and 160–255, but a handful of
 * punctuation characters live in the 128–159 block where Latin-1 has control
 * codes — the em-dash and the curly quotes, which an event name typed in a word
 * processor will absolutely contain. Those are mapped by hand so a name like
 * "Tuzahorana Edition 3 — Grand Concert" prints as written instead of as a
 * question mark.
 *
 * Anything genuinely outside WinAnsi becomes `?`: a sheet with one odd character
 * is far better than a document that will not open.
 */
const WIN_ANSI_PUNCTUATION: Record<string, number> = {
  "\u20AC": 128, // euro
  "\u201A": 130, // single low quote
  "\u0192": 131, // florin
  "\u201E": 132, // double low quote
  "\u2026": 133, // ellipsis
  "\u2020": 134, // dagger
  "\u2021": 135, // double dagger
  "\u02C6": 136, // circumflex
  "\u2030": 137, // per mille
  "\u0160": 138, // S caron
  "\u2039": 139, // single left angle quote
  "\u0152": 140, // OE
  "\u017D": 142, // Z caron
  "\u2018": 145, // left single quote
  "\u2019": 146, // right single quote
  "\u201C": 147, // left double quote
  "\u201D": 148, // right double quote
  "\u2022": 149, // bullet
  "\u2013": 150, // en dash
  "\u2014": 151, // em dash
  "\u02DC": 152, // small tilde
  "\u2122": 153, // trademark
  "\u0161": 154, // s caron
  "\u203A": 155, // single right angle quote
  "\u0153": 156, // oe
  "\u017E": 158, // z caron
  "\u0178": 159, // Y diaeresis
}

function escapeText(value: string): string {
  let out = ""
  for (const character of value) {
    const code = character.codePointAt(0)!
    const mapped = WIN_ANSI_PUNCTUATION[character]
    if (character === "\\") out += "\\\\"
    else if (character === "(") out += "\\("
    else if (character === ")") out += "\\)"
    else if (code >= 32 && code <= 126) out += character
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`
    else if (mapped !== undefined) out += `\\${mapped.toString(8).padStart(3, "0")}`
    else out += "?"
  }
  return out
}

/**
 * Approximates Helvetica's advance width, in thousandths of the font size.
 *
 * A real metrics table would be exact; this is deliberately generous, because the
 * cost of being slightly wrong in one direction is a name that wraps early, and
 * in the other a name that runs off the page. Only used to decide where to clip.
 */
function approximateWidth(text: string, size: number): number {
  let width = 0
  for (const character of text) {
    if ("iljIfrtJ".includes(character)) width += 280
    else if ("mwMW".includes(character)) width += 830
    else if (character === " ") width += 278
    else if (character >= "A" && character <= "Z") width += 667
    else width += 556
  }
  return (width / 1000) * size
}

/** Truncates with an ellipsis so a long name never runs off the card. */
function fitText(text: string, size: number, maxWidth: number): string {
  if (approximateWidth(text, size) <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && approximateWidth(`${cut}…`, size) > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return `${cut}…`
}

/**
 * Builds the content stream for one page: a header, then a grid of pass cards.
 *
 * Four cards across and five down fits twenty per A4 sheet with room to breathe,
 * which is what a choir of a few hundred needs — a dozen sheets, not a hundred.
 */
function pageContent(
  cards: PassCard[],
  page: number,
  pageCount: number,
  options: PassSheetOptions,
): Operation[] {
  const operations: Operation[] = []
  const margin = 36
  const columns = 4
  const rows = 5
  const cardWidth = (PAGE_WIDTH - margin * 2) / columns
  const cardHeight = (PAGE_HEIGHT - margin * 2 - 60) / rows

  const text = (value: string, x: number, y: number, size: number, font: StandardFont = "Helvetica"): void => {
    operations.push(`BT /${font === "Helvetica-Bold" ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapeText(value)}) Tj ET`)
  }

  const line = (x1: number, y1: number, x2: number, y2: number, grey = 0.8): void => {
    operations.push(`${grey} ${grey} ${grey} RG 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`)
  }

  const fillRect = (x: number, y: number, width: number, height: number): void => {
    operations.push(`0 0 0 rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`)
  }

  // Header.
  let cursor = PAGE_HEIGHT - margin
  text(fitText(options.eventName, 16, PAGE_WIDTH - margin * 2), margin, cursor - 14, 16, "Helvetica-Bold")
  cursor -= 20
  const details = [
    options.eventDate,
    options.eventTime ?? "",
    options.eventLocation ?? "",
  ].filter((part) => part.length > 0).join("  ·  ")
  text(details, margin, cursor - 10, 10)
  cursor -= 18
  text("Entrance passes — one per attendee. Scan the code at the door, or type the passcode.", margin, cursor - 10, 9)
  text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - margin - 70, cursor - 10, 9)
  cursor -= 8
  line(margin, cursor, PAGE_WIDTH - margin, cursor)

  // Cards.
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    const column = index % columns
    const row = Math.floor(index / columns)
    const left = margin + column * cardWidth
    // Rows are laid out from the top of the sheet down.
    const bottom = cursor - 16 - (row + 1) * cardHeight

    line(left, bottom, left + cardWidth - 6, bottom, 0.88)

    // The code sits across the top of the card with the name beside it, and the
    // passcode underneath. A four-across A4 grid is only ~130 points wide, so the
    // code has to stay small enough to leave the text a readable column.
    const cardInner = cardWidth - 12
    const qrBox = Math.min(cardHeight - 42, cardInner * 0.42)
    const qrX = left + 6
    const qrY = bottom + cardHeight - 12 - qrBox
    const code = options.encode(card.qrText)
    const module = qrBox / code.size

    // Draw each row as runs of dark modules: far fewer operators than one
    // rectangle per module, and visibly identical.
    for (let rowIndex = 0; rowIndex < code.size; rowIndex += 1) {
      let runStart = -1
      for (let columnIndex = 0; columnIndex <= code.size; columnIndex += 1) {
        const dark = columnIndex < code.size && code.modules[rowIndex][columnIndex]
        if (dark && runStart === -1) runStart = columnIndex
        if (!dark && runStart !== -1) {
          const width = (columnIndex - runStart) * module
          // PDF y grows upward, so the first module row is drawn at the top.
          const y = qrY + (code.size - rowIndex - 1) * module
          fillRect(qrX + runStart * module, y, width, module)
          runStart = -1
        }
      }
    }

    // Name, member number and group, in the column beside the code. The name is
    // repeated at full width under the code below, because a four-across grid
    // only leaves ~50 points here and a Rwandan name needs more than that.
    const textX = qrX + qrBox + 6
    const available = left + cardWidth - 6 - textX
    let textY = qrY + qrBox - 10
    text(fitText(card.memberNo, 8, available), textX, textY, 8)
    textY -= 10
    text(fitText(card.group, 8, available), textX, textY, 8)

    // The name and the passcode run the full card width underneath: both are read
    // by a person, and both are the reason the sheet exists.
    text(fitText(card.name, 9.5, cardInner), left + 6, bottom + 24, 9.5, "Helvetica-Bold")
    text(fitText(card.passcode, 11, cardInner), left + 6, bottom + 12, 11, "Helvetica-Bold")
  }

  if (options.footnote) {
    text(fitText(options.footnote, 8, PAGE_WIDTH - margin * 2), margin, margin - 10, 8)
  }

  return operations
}

/**
 * Assembles the pages into a PDF document.
 *
 * Objects are written in order and their byte offsets recorded for the cross
 * reference table, which is what a reader needs to find them. The final `startxref`
 * is the offset of that table.
 */
export function buildPassSheet(cards: PassCard[], options: PassSheetOptions): Uint8Array {
  const perPage = 20
  const pages: PassCard[][] = []
  for (let index = 0; index < cards.length; index += perPage) {
    pages.push(cards.slice(index, index + perPage))
  }
  if (pages.length === 0) pages.push([])

  const objects: string[] = []
  const pageObjectNumbers: number[] = []

  // 1: catalogue, 2: pages tree, 3: Helvetica, 4: Helvetica-Bold.
  // Page objects and their content streams follow, two objects per page.
  const firstPageObject = 5
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectNumbers.push(firstPageObject + index * 2)
  }

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  const kids = pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")
  objects.push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`)

  pages.forEach((pageCards, index) => {
    const contentNumber = firstPageObject + index * 2 + 1
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    )
    const stream = pageContent(pageCards, index + 1, pages.length, options).join("\n")
    // Everything in a content stream is ASCII — non-Latin-1 characters are
    // replaced when the text is escaped — so the character count is the byte count.
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })

  // Assemble, recording each object's byte offset as it is written.
  //
  // The offsets must be **bytes**, not characters: the binary comment below is
  // four characters that encode to eight bytes, so counting characters would
  // shift every offset by four and send a strict reader to the wrong place. The
  // chunks are therefore measured as UTF-8 lengths.
  const encoder = new TextEncoder()
  const chunks: string[] = []
  let offset = 0
  const offsets: number[] = []
  const write = (value: string): void => {
    chunks.push(value)
    offset += encoder.encode(value).length
  }

  write("%PDF-1.4\n")
  // A binary comment marks the file as binary for tools that sniff the first bytes.
  write("%\xE2\xE3\xCF\xD3\n")

  objects.forEach((body, index) => {
    offsets.push(offset)
    write(`${index + 1} 0 obj\n${body}\nendobj\n`)
  })

  const xrefOffset = offset
  write(`xref\n0 ${objects.length + 1}\n`)
  write("0000000000 65535 f \n")
  for (const objectOffset of offsets) {
    write(`${objectOffset.toString().padStart(10, "0")} 00000 n \n`)
  }
  write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  return encoder.encode(chunks.join(""))
}

/** A filename safe for every platform, e.g. `entrance-passes-gala-concert-2026-12-10.pdf`. */
export function passSheetFilename(eventName: string, eventDate: string): string {
  const slug = eventName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `entrance-passes-${slug || "event"}-${eventDate}.pdf`
}
