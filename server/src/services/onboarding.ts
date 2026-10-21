import { config } from "../config.js"
import { sendMail } from "./email.js"
import { isPlaceholderEmail } from "./usernames.js"

export interface LoginDetails {
  fullName: string
  /** Sign-in name derived from the full name. */
  username: string | null
  /**
   * The address to send to, and the member's real contact address — a reserved
   * placeholder only when the applicant left the form blank. This is never the
   * internal alias of a shared address; that alias is not a working sign-in.
   */
  email: string | null
  password: string
  /** Group the member was approved into. */
  groupName?: string | null
  /** Origin of the running site, e.g. https://la-porte-ador.onrender.com */
  signInUrl: string
  /**
   * True when another member already signs in with this same email address.
   *
   * The account can still be reached, but not by email: an email identifies
   * exactly one login, and this inbox already identifies someone else. So the
   * member is told plainly to use their username, and the message is marked so
   * the two people sharing an inbox can tell their messages apart.
   */
  sharedMailbox?: boolean
}

/**
 * The message an approved member receives. Kept as text (not HTML) because the
 * content is short credentials that have to survive being forwarded by SMS.
 */
export function loginDetailsText(input: LoginDetails): string {
  const hasEmail = Boolean(input.email && !isPlaceholderEmail(input.email))
  // With a shared inbox the email cannot single out this member at sign-in, so
  // the username is the identifier — the one thing that is theirs alone.
  const signInWithUsernameOnly = Boolean(input.sharedMailbox) || !hasEmail
  const identifier = signInWithUsernameOnly ? (input.username ?? "") : (input.email as string)
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
  if (input.sharedMailbox) {
    // Say why the email is not the sign-in, so nobody wastes a try on it.
    lines.push(
      "  (use your username above — this email address is already used by",
      "   another member in your family, and an email signs in one person)",
    )
  } else if (hasEmail && input.username) {
    // An account always carries a username, and a member who supplied an email
    // can use either one — spelling both out avoids "I only know my email".
    lines.push(`  or username:    ${input.username}`)
  }
  lines.push(
    `  Password:       ${input.password}`,
    "",
    "Please change this password after your first sign-in (Account -> Password).",
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
    // Two members sharing one inbox each get their own message; the name in the
    // subject is what tells them apart at a glance.
    subject: input.sharedMailbox
      ? `Your ${config.appName} sign-in details — ${input.fullName}`
      : `Your ${config.appName} sign-in details`,
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
