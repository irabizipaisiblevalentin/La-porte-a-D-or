import { buildPassSheet, passSheetFilename, type PassCard } from "../../lib/pass-sheet"
import { encodeQr } from "../../lib/qr"

/**
 * Downloads the sheet of entrance passes for an event.
 *
 * Built and saved entirely in the browser: the pass tokens never leave the page to
 * be turned into a document, and there is no server-side PDF library to install or
 * pay for. The object URL is revoked immediately after the click so the bytes do
 * not sit in memory holding pass tokens.
 */

/** The value a pass QR encodes. Kept in one place so the check-in page agrees. */
export function passUrl(token: string): string {
  return `${window.location.origin}/checkin/${token}`
}

export interface SheetPass {
  full_name?: string
  member_no?: string
  group_name?: string
  token: string
  passcode: string
}

export function downloadPassSheet({
  eventName,
  eventDate,
  eventTime,
  eventLocation,
  passes,
}: {
  eventName: string
  eventDate: string
  eventTime?: string | null
  eventLocation?: string | null
  passes: SheetPass[]
}): void {
  const cards: PassCard[] = passes.map((pass) => ({
    name: pass.full_name ?? "Member",
    memberNo: pass.member_no ?? "",
    group: pass.group_name ?? "",
    qrText: passUrl(pass.token),
    passcode: pass.passcode,
  }))

  const bytes = buildPassSheet(cards, {
    eventName,
    eventDate,
    eventTime,
    eventLocation,
    footnote: "If a code will not scan, type the passcode shown beside it.",
    encode: encodeQr,
  })

  // A `Blob` needs a plain `ArrayBuffer`, and a `Uint8Array` may be a view into a
  // larger one, so the bytes are copied rather than passed through.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = passSheetFilename(eventName, eventDate)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
