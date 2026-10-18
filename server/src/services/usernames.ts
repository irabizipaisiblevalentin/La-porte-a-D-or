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
