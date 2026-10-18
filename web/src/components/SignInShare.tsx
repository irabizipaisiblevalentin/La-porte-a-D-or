import { useState } from "react"
import { Check, Copy, MessageCircle, Smartphone } from "lucide-react"
import { Button, useToast } from "./ui"

/**
 * Credentials an administrator has to get to a new member.
 *
 * These are the same details the approval email carries. When email is not
 * configured (or the applicant left the form's email question blank) somebody
 * still has to deliver them, and the two channels that cost nothing and work on
 * every Rwandan phone are the phone's own SMS app and WhatsApp. Both are plain
 * links, so there is no provider, no account, no quota and no bill.
 */
export interface SignInShareDetails {
  fullName: string
  /** Sign-in name derived from the full name. */
  username: string | null
  /** Account email; null when the applicant gave none. */
  email: string | null
  password: string
  /** Contact number as stored on the member record. */
  phone?: string | null
}

/** Rwandan numbers are written 07… locally; the international form needs the code. */
const DEFAULT_COUNTRY_CODE = "250"

/**
 * Digits-only international form of a stored phone number, or null when there is
 * nothing usable. `0788123456` → `250788123456`, `+250 788 123 456` → `250788123456`.
 */
export function toInternationalPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "")
  if (digits.length < 7) return null
  if (digits.startsWith("00")) return digits.slice(2)
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return digits
  if (digits.startsWith("0")) return `${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`
  return digits
}

/** The message an administrator sends, copies or reads out. */
export function signInMessage(details: SignInShareDetails, origin: string): string {
  const identifier = details.email ?? details.username ?? ""
  const lines = [
    `Muraho ${details.fullName},`,
    "",
    "Your application to join Chorale La Porte d'Or has been approved. Here are your sign-in details:",
    "",
    `Sign-in page: ${origin}/login`,
    `Sign in with: ${identifier}`,
  ]
  // An account always carries a username, and a member who supplied an email can
  // use either — spelling both out avoids "I only know my email".
  if (details.email && details.username) lines.push(`or username: ${details.username}`)
  lines.push(
    `Password: ${details.password}`,
    "",
    "Please change this password after your first sign-in.",
    "",
    "Chorale La Porte d'Or",
  )
  return lines.join("\n")
}

export interface SignInShareProps extends SignInShareDetails {
  /** Set false where the caller must not give the details to the member. */
  showPhoneActions?: boolean
}

/**
 * Copy / WhatsApp / SMS actions for one member's sign-in details, rendered
 * wherever the credentials appear (member record and approval result).
 */
export function SignInShare({ showPhoneActions = true, ...details }: SignInShareProps) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const message = signInMessage(details, origin)
  const international = toInternationalPhone(details.phone)
  const whatsapp = showPhoneActions && international
    ? `https://wa.me/${international}?text=${encodeURIComponent(message)}`
    : null
  const sms = showPhoneActions && international
    ? `sms:+${international}?body=${encodeURIComponent(message)}`
    : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      toast.success("Sign-in details copied.")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy automatically. Select the text and copy it manually.")
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        icon={copied ? <Check size={15} /> : <Copy size={15} />}
        onClick={copy}
      >
        {copied ? "Copied" : "Copy details"}
      </Button>
      {whatsapp ? (
        <a className="btn btn-outline btn-sm" href={whatsapp} target="_blank" rel="noreferrer">
          <MessageCircle size={15} /> WhatsApp
        </a>
      ) : null}
      {sms ? (
        <a className="btn btn-outline btn-sm" href={sms}>
          <Smartphone size={15} /> SMS
        </a>
      ) : null}
    </div>
  )
}
