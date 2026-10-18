import { config } from "../config.js"
import { sendMail } from "./email.js"
import { isPlaceholderEmail } from "./usernames.js"

export interface LoginDetails {
  fullName: string
  /** Sign-in name derived from the full name. */
  username: string | null
  /** Account email — a reserved placeholder when the applicant left the form blank. */
  email: string | null
  password: string
  /** Group the member was approved into. */
  groupName?: string | null
  /** Origin of the running site, e.g. https://la-porte-ador.onrender.com */
  signInUrl: string
}

/**
 * The message an approved member receives. Kept as text (not HTML) because the
 * content is short credentials that have to survive being forwarded by SMS.
 */
export function loginDetailsText(input: LoginDetails): string {
  const hasEmail = Boolean(input.email && !isPlaceholderEmail(input.email))
  const identifier = hasEmail ? (input.email as string) : (input.username ?? "")
  const lines = [
    `Muraho ${input.fullName},`,
    "",
    `Your application to join ${config.appName} has been approved${input.groupName ? ` for the ${input.groupName} group` : ""}.`,
    "",
    "Here are your sign-in details:",
    "",
    `  Sign-in page:   ${input.signInUrl.replace(/\/$/, "")}/login`,
    `  Sign in with:   ${identifier}`,
  ]
  // An account always carries a username, and a member who supplied an email can
  // use either one — spelling both out avoids "I only know my email".
  if (hasEmail && input.username) lines.push(`  or username:    ${input.username}`)
  lines.push(
    `  Password:       ${input.password}`,
    "",
    "Please change this password after your first sign-in (Account → Password).",
    "",
    config.appName,
  )
  return lines.join("\n")
}

export type DeliveryReason = "sent" | "no_email" | "not_configured" | "send_failed"

export interface DeliveryOutcome {
  /** True only when the relay accepted the message. */
  sent: boolean
  to: string | null
  reason: DeliveryReason
  error?: string
}

/**
 * Emails the generated credentials to the new member.
 *
 * Returns a reason instead of throwing, because approval has already committed
 * by the time this runs and a member record must never be rolled back by a mail
 * server. The administrator sees the outcome on screen and on the member record.
 */
export async function deliverLoginDetails(input: LoginDetails, trigger = "application.approve"): Promise<DeliveryOutcome> {
  const to = input.email && !isPlaceholderEmail(input.email) ? input.email : null
  if (!to) return { sent: false, to: null, reason: "no_email" }

  const result = await sendMail({
    to,
    subject: `Your ${config.appName} sign-in details`,
    text: loginDetailsText(input),
    trigger,
  })
  if (result.ok) return { sent: true, to, reason: "sent" }
  return {
    sent: false,
    to,
    reason: result.reason === "not_configured" ? "not_configured" : "send_failed",
    error: result.error,
  }
}
