/**
 * Usernames for accounts that have no email address.
 *
 * The Google Form's email question is optional. When an applicant leaves it
 * blank, the approved member still gets an account, and signs in with a
 * username derived from their full name (e.g. "Irabizi Valentin"). The same
 * normalization is applied when the user types it at the login screen, so
 * "Irabizi Valentin", "irabizi valentin" and "irabizi.valentin" all match.
 *
 * Accounts that DO have an email keep it as their primary sign-in and simply
 * also receive a username, so either one works.
 */

/** Reserved, non-routable domain used as the stored "email" of a name-only account. */
export const NO_EMAIL_DOMAIN = "no-email.invalid"

/**
 * Canonical lookup key for a username: lowercase ASCII (accents folded), every
 * run of non-alphanumeric characters collapsed to a single hyphen. Must be
 * applied to both the stored username and whatever the user types.
 */
export function normalizeUsername(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Human-readable form kept for display: spaces collapsed, trimmed, case preserved. */
export function cleanDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** True when `email` is the placeholder we store for a name-only account. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${NO_EMAIL_DOMAIN}`)
}

/** The stored placeholder "email" for a name-only account (unique, never sent to). */
export function placeholderEmail(normalizedUsername: string): string {
  return `${normalizedUsername}@${NO_EMAIL_DOMAIN}`
}

/**
 * A reserved, never-mailed "email" for an account whose real address is already
 * used by someone else.
 *
 * A family often applies with one address — two siblings, or a parent enrolling a
 * child. Both are real members and both must receive their own credentials at that
 * address, but the `users` table allows an email to belong to exactly one login,
 * and rightly so: sign-in by email has to resolve to one person. Two accounts
 * sharing the literal address would make "sign in with this email" ambiguous.
 *
 * So the second account keeps a unique reserved form derived from the real
 * address: `shared@example.org` becomes `shared+sibling-2@example.org`. It is
 * still recognisably the same mailbox to a human reading the row, it is unique in
 * the database, and it is never sent to — the member signs in with the username
 * they are given, and every visible record (the member's contact details, the
 * admin lists, the credential message) carries the real address.
 *
 * The `+` local-part form is deliberate: if anything ever did send to it, every
 * mainstream mail provider delivers `local+tag@domain` to `local@domain`.
 */
export function sharedEmailAlias(email: string, attempt: number): string {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf("@")
  const local = at === -1 ? trimmed : trimmed.slice(0, at)
  const domain = at === -1 ? NO_EMAIL_DOMAIN : trimmed.slice(at + 1)
  const suffix = attempt <= 1 ? "shared" : `shared-${attempt}`
  return `${local}+${suffix}@${domain}`
}
