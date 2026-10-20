/**
 * Event audiences, contributions, entrance passes and the door.
 *
 * Kept out of the route file so the rules live in one place: a route should say
 * *what* happened, not re-derive who owes what or whether a pass may be used.
 *
 * Money never moves through this application. A contribution is a record that the
 * choir received money the way it already collects it — cash, mobile money, a
 * bank transfer — and of who confirmed it. That is deliberate: it keeps the whole
 * feature free of payment providers, merchant accounts and cards.
 */
import { all, one, run, transaction } from "../db/index.js"
import { badRequest, notFound } from "../lib/errors.js"
import { id, token } from "../lib/security.js"
import { nowIso } from "../lib/time.js"

/** The three official groups. An event with no audience rows is for all of them. */
export const OFFICIAL_GROUP_IDS = ["grp_senior", "grp_junior", "grp_members"] as const

export interface AudienceGroup {
  id: string
  key: string
  name: string
}

/** The groups an event is addressed to; every official group when none is set. */
export function eventAudience(eventId: string): AudienceGroup[] {
  return all<AudienceGroup>(
    `SELECT g.id, g.key, g.name
       FROM event_audiences ea
       JOIN groups g ON g.id = ea.group_id
      WHERE ea.event_id = ?
      ORDER BY g.name COLLATE NOCASE`,
    eventId,
  )
}

/** Replaces the audience of an event. An empty list means the whole choir. */
export function setEventAudience(eventId: string, groupIds: string[]): AudienceGroup[] {
  const unique = Array.from(new Set(groupIds.filter((groupId) => groupId.trim().length > 0)))
  for (const groupId of unique) {
    if (!OFFICIAL_GROUP_IDS.includes(groupId as (typeof OFFICIAL_GROUP_IDS)[number])) {
      throw badRequest("That is not a group of this choir.", {
        fields: { groupIds: `Unknown group id: ${groupId}` },
      })
    }
  }

  const timestamp = nowIso()
  transaction(() => {
    run("DELETE FROM event_audiences WHERE event_id = ?", eventId)
    for (const groupId of unique) {
      run("INSERT INTO event_audiences (event_id, group_id, added_at) VALUES (?, ?, ?)", eventId, groupId, timestamp)
    }
    run("UPDATE events SET updated_at = ? WHERE id = ?", timestamp, eventId)
  })
  return eventAudience(eventId)
}

/**
 * Whether a group sees an event.
 *
 * No audience rows at all means the whole choir, which is how every event created
 * before audiences existed still means exactly what it meant: `target_group_id`
 * is consulted too, so a single-group event from the old form is still narrow.
 */
export function eventIsForGroup(eventId: string, groupId: string | null): boolean {
  const audience = all<{ group_id: string }>("SELECT group_id FROM event_audiences WHERE event_id = ?", eventId)
  if (audience.length > 0) return groupId !== null && audience.some((row) => row.group_id === groupId)

  const event = one<{ target_group_id: string | null }>("SELECT target_group_id FROM events WHERE id = ?", eventId)
  if (!event) return false
  if (event.target_group_id === null) return true
  return event.target_group_id === groupId
}

/** SQL fragment + params limiting a query to the events one group may see. */
export function audienceVisibilityClause(alias: string, groupId: string | null): { sql: string; params: string[] } {
  // Visible when: addressed to this group, OR addressed to nobody (whole choir),
  // OR the legacy single-group column names this group.
  return {
    sql: `(
      EXISTS (SELECT 1 FROM event_audiences ea WHERE ea.event_id = ${alias}.id AND ea.group_id = ?)
      OR (
        NOT EXISTS (SELECT 1 FROM event_audiences ea2 WHERE ea2.event_id = ${alias}.id)
        AND (${alias}.target_group_id IS NULL OR ${alias}.target_group_id = ?)
      )
    )`,
    params: [groupId ?? "", groupId ?? ""],
  }
}

// --- Contributions -----------------------------------------------------------

export interface ContributionRow {
  event_id: string
  member_id: string
  amount: number
  status: "due" | "paid" | "waived"
  reference: string | null
  note: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
  full_name?: string
  member_no?: string
  group_name?: string
  confirmed_by_name?: string | null
}

export interface ContributionSummary {
  required: boolean
  amount: number | null
  dueDate: string | null
  counts: { due: number; paid: number; waived: number; total: number }
  collected: number
  outstanding: number
}

/**
 * The contribution ledger for an event, with each person's name.
 *
 * A participant who has no ledger row yet is not invented here — the ledger is
 * created deliberately (`ensureContributions`), so the coordinator sees who has
 * been asked to pay rather than an implied list.
 */
export function listContributions(eventId: string): ContributionRow[] {
  return all<ContributionRow>(
    `SELECT c.*, m.full_name, m.member_no, g.name AS group_name, u.display_name AS confirmed_by_name
       FROM event_contributions c
       JOIN members m ON m.id = c.member_id
       LEFT JOIN groups g ON g.id = m.group_id
       LEFT JOIN users u ON u.id = c.confirmed_by
      WHERE c.event_id = ?
      ORDER BY m.full_name COLLATE NOCASE`,
    eventId,
  )
}

export function contributionSummary(eventId: string): ContributionSummary {
  const event = one<{
    requires_contribution: number
    contribution_amount: number | null
    contribution_due_date: string | null
  }>(
    "SELECT requires_contribution, contribution_amount, contribution_due_date FROM events WHERE id = ?",
    eventId,
  )
  const rows = all<{ status: string; amount: number }>(
    "SELECT status, amount FROM event_contributions WHERE event_id = ?",
    eventId,
  )

  let paid = 0
  let waived = 0
  let due = 0
  let collected = 0
  let outstanding = 0
  for (const row of rows) {
    if (row.status === "paid") {
      paid += 1
      collected += row.amount
    } else if (row.status === "waived") {
      waived += 1
    } else {
      due += 1
      outstanding += row.amount
    }
  }

  return {
    required: (event?.requires_contribution ?? 0) === 1,
    amount: event?.contribution_amount ?? null,
    dueDate: event?.contribution_due_date ?? null,
    counts: { due, paid, waived, total: rows.length },
    collected,
    outstanding,
  }
}

/**
 * Puts every participant on the ledger at the event's amount.
 *
 * Idempotent and non-destructive: someone already marked paid keeps their status
 * and amount, so running this again after adding a participant only adds the new
 * person. That is what makes it safe to press whenever the list changes.
 */
export function ensureContributions(eventId: string, amount: number): number {
  const participants = all<{ member_id: string }>(
    "SELECT member_id FROM event_participants WHERE event_id = ?",
    eventId,
  )
  const timestamp = nowIso()
  let added = 0

  transaction(() => {
    for (const participant of participants) {
      const existing = one<{ member_id: string }>(
        "SELECT member_id FROM event_contributions WHERE event_id = ? AND member_id = ?",
        eventId, participant.member_id,
      )
      if (existing) continue
      run(
        `INSERT INTO event_contributions (event_id, member_id, amount, status, reference, note,
                                          confirmed_by, confirmed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'due', NULL, NULL, NULL, NULL, ?, ?)`,
        eventId, participant.member_id, amount, timestamp, timestamp,
      )
      added += 1
    }
  })

  return added
}

/** Sets what one person owes, or waives them. */
export function setContributionAmount(eventId: string, memberId: string, amount: number): void {
  const existing = one<{ status: string }>(
    "SELECT status FROM event_contributions WHERE event_id = ? AND member_id = ?",
    eventId, memberId,
  )
  if (!existing) throw notFound("That member is not on this event's contribution list.")
  if (existing.status === "paid") throw badRequest("A confirmed payment cannot be re-priced. Undo it first.")

  run(
    "UPDATE event_contributions SET amount = ?, updated_at = ? WHERE event_id = ? AND member_id = ?",
    amount, nowIso(), eventId, memberId,
  )
}

/**
 * Confirms a contribution was received, and **issues the entrance pass**.
 *
 * Issuing here rather than behind a second button is deliberate: a paid pass is
 * the point at which someone may come in, so the two must not be able to drift
 * apart. A pass already used at the door is left alone.
 */
export function confirmContribution(
  eventId: string,
  memberId: string,
  actor: { id: string; displayName: string },
  options: { status?: "paid" | "waived"; reference?: string | null; note?: string | null } = {},
): { contribution: ContributionRow; pass: PassRow | null } {
  const existing = one<ContributionRow>(
    "SELECT * FROM event_contributions WHERE event_id = ? AND member_id = ?",
    eventId, memberId,
  )
  if (!existing) throw notFound("That member is not on this event's contribution list.")

  const status = options.status ?? "paid"
  const timestamp = nowIso()

  transaction(() => {
    run(
      `UPDATE event_contributions
          SET status = ?, reference = ?, note = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ?
        WHERE event_id = ? AND member_id = ?`,
      status, options.reference ?? existing.reference, options.note ?? existing.note,
      actor.id, timestamp, timestamp, eventId, memberId,
    )
    run(
      `UPDATE event_participants SET rsvp = COALESCE(rsvp, 'yes') WHERE event_id = ? AND member_id = ?`,
      eventId, memberId,
    )
  })

  const pass = issuePassFor(eventId, memberId, actor)
  return {
    contribution: one<ContributionRow>(
      `SELECT c.*, m.full_name, m.member_no, u.display_name AS confirmed_by_name
         FROM event_contributions c
         JOIN members m ON m.id = c.member_id
         LEFT JOIN users u ON u.id = c.confirmed_by
        WHERE c.event_id = ? AND c.member_id = ?`,
      eventId, memberId,
    )!,
    pass,
  }
}

/** Returns a contribution to 'due' — for a payment that was recorded in error. */
export function undoContribution(eventId: string, memberId: string, actorName: string): void {
  const existing = one<{ status: string }>(
    "SELECT status FROM event_contributions WHERE event_id = ? AND member_id = ?",
    eventId, memberId,
  )
  if (!existing) throw notFound("That member is not on this event's contribution list.")

  const timestamp = nowIso()
  transaction(() => {
    run(
      `UPDATE event_contributions SET status = 'due', confirmed_by = NULL, confirmed_at = NULL, updated_at = ?
        WHERE event_id = ? AND member_id = ?`,
      timestamp, eventId, memberId,
    )
    // The door closes again: a pass issued on a payment that did not happen must
    // not still admit anyone. A pass already used stays used — it is history.
    run(
      `UPDATE event_passes SET status = 'revoked'
        WHERE event_id = ? AND member_id = ? AND status = 'issued'`,
      eventId, memberId,
    )
  })
}

// --- Entrance passes ---------------------------------------------------------

export interface PassRow {
  id: string
  event_id: string
  member_id: string
  token: string
  passcode: string
  status: "issued" | "checked_in" | "revoked"
  issued_by: string | null
  issued_at: string
  checked_in_at: string | null
  checked_in_by: string | null
  full_name?: string
  member_no?: string
  group_name?: string
}

/**
 * A short passcode a person can read off a sheet and a steward can type.
 *
 * Ambiguous characters are left out (no O/0, I/1/L): these are read aloud across
 * a noisy door and typed on a phone, and a passcode that can be misheard is worse
 * than a shorter one. Twelve characters of this alphabet is ~10^18 possibilities.
 */
const PASSCODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

function generatePasscode(): string {
  const raw = token(24)
  let out = ""
  for (let index = 0; index < 12; index += 1) {
    const byte = raw.charCodeAt(index)
    out += PASSCODE_ALPHABET[byte % PASSCODE_ALPHABET.length]
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

/** Issues (or refreshes) the pass for one person. Only paid or waived people get one. */
export function issuePassFor(
  eventId: string,
  memberId: string,
  actor: { id: string; displayName: string },
): PassRow | null {
  const contribution = one<{ status: string }>(
    "SELECT status FROM event_contributions WHERE event_id = ? AND member_id = ?",
    eventId, memberId,
  )
  if (!contribution) return null
  if (contribution.status !== "paid" && contribution.status !== "waived") return null

  const existing = one<PassRow>(
    "SELECT * FROM event_passes WHERE event_id = ? AND member_id = ?",
    eventId, memberId,
  )
  // A pass already admitted this person: leave it exactly as it is.
  if (existing && existing.status === "checked_in") return existing

  const timestamp = nowIso()
  if (existing) {
    run(
      `UPDATE event_passes SET status = 'issued', issued_by = ?, issued_at = ? WHERE id = ?`,
      actor.id, timestamp, existing.id,
    )
    return one<PassRow>("SELECT * FROM event_passes WHERE id = ?", existing.id)!
  }

  const passId = id()
  run(
    `INSERT INTO event_passes (id, event_id, member_id, token, passcode, status, issued_by, issued_at,
                               checked_in_at, checked_in_by)
     VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, NULL, NULL)`,
    passId, eventId, memberId, token(32), generatePasscode(), actor.id, timestamp,
  )
  return one<PassRow>("SELECT * FROM event_passes WHERE id = ?", passId)!
}

/** Issues passes for everyone who has paid and has none yet. */
export function issuePassesForPaid(eventId: string, actor: { id: string; displayName: string }): PassRow[] {
  const paid = all<{ member_id: string }>(
    "SELECT member_id FROM event_contributions WHERE event_id = ? AND status IN ('paid','waived')",
    eventId,
  )
  for (const row of paid) issuePassFor(eventId, row.member_id, actor)
  return listPasses(eventId)
}

export function listPasses(eventId: string): PassRow[] {
  return all<PassRow>(
    `SELECT p.*, m.full_name, m.member_no, g.name AS group_name
       FROM event_passes p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN groups g ON g.id = m.group_id
      WHERE p.event_id = ? AND p.status <> 'revoked'
      ORDER BY m.full_name COLLATE NOCASE`,
    eventId,
  )
}

export function revokePass(eventId: string, memberId: string): void {
  run(
    "UPDATE event_passes SET status = 'revoked' WHERE event_id = ? AND member_id = ? AND status = 'issued'",
    eventId, memberId,
  )
}

// --- The door ----------------------------------------------------------------

export type CheckinOutcome = "admitted" | "repeat" | "refused" | "unknown"

export interface CheckinResult {
  outcome: CheckinOutcome
  message: string
  pass: PassRow | null
  event: { id: string; name: string; date: string; location: string | null } | null
}

function recordCheckin(
  eventId: string | null,
  memberId: string | null,
  passId: string | null,
  outcome: CheckinOutcome,
  detail: string,
  actor?: { id: string; displayName: string },
): void {
  if (!eventId) return
  run(
    `INSERT INTO event_checkins (id, event_id, member_id, pass_id, outcome, detail, actor_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id(), eventId, memberId, passId, outcome, detail, actor?.id ?? null, actor?.displayName ?? null, nowIso(),
  )
}

/**
 * Admits someone at the door from a scanned QR token or a typed passcode.
 *
 * Both lookups are scoped to the event, so a passcode from another event is
 * refused rather than quietly admitting the wrong person. A second scan of an
 * already-admitted pass is reported as 'repeat', not silently accepted — the door
 * log is what makes a shared pass visible.
 */
export function checkIn(
  eventId: string,
  credential: string,
  actor?: { id: string; displayName: string },
): CheckinResult {
  const cleaned = credential.trim()
  const event = one<{ id: string; name: string; date: string; location: string | null }>(
    "SELECT id, name, date, location FROM events WHERE id = ?",
    eventId,
  )
  if (!event) throw notFound("That event does not exist.")

  const pass = one<PassRow>(
    `SELECT p.*, m.full_name, m.member_no, g.name AS group_name
       FROM event_passes p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN groups g ON g.id = m.group_id
      WHERE p.event_id = ?
        AND (p.token = ? OR p.passcode = ? COLLATE NOCASE)`,
    eventId, cleaned, cleaned.toUpperCase(),
  )

  if (!pass || pass.status === "revoked") {
    recordCheckin(eventId, pass?.member_id ?? null, pass?.id ?? null, "refused",
      pass ? "pass revoked" : "no matching pass", actor)
    return {
      outcome: "refused",
      message: pass ? "This pass has been cancelled." : "No pass matches that code for this event.",
      pass: pass ?? null,
      event,
    }
  }

  if (pass.status === "checked_in") {
    recordCheckin(eventId, pass.member_id, pass.id, "repeat", "already checked in", actor)
    return {
      outcome: "repeat",
      message: `${pass.full_name} was already admitted at ${pass.checked_in_at ?? "an earlier time"}.`,
      pass,
      event,
    }
  }

  const timestamp = nowIso()
  run(
    "UPDATE event_passes SET status = 'checked_in', checked_in_at = ?, checked_in_by = ? WHERE id = ?",
    timestamp, actor?.id ?? null, pass.id,
  )
  recordCheckin(eventId, pass.member_id, pass.id, "admitted", "admitted", actor)

  return {
    outcome: "admitted",
    message: `Welcome, ${pass.full_name}.`,
    pass: one<PassRow>(
      `SELECT p.*, m.full_name, m.member_no, g.name AS group_name
         FROM event_passes p
         JOIN members m ON m.id = p.member_id
         LEFT JOIN groups g ON g.id = m.group_id
        WHERE p.id = ?`,
      pass.id,
    )!,
    event,
  }
}

/** Looks a pass up without admitting anyone — for the page a scanned QR opens. */
export function previewPass(passToken: string): {
  pass: PassRow | null
  event: { id: string; name: string; date: string; start_time: string | null; location: string | null } | null
  alreadyIn: boolean
} {
  const pass = one<PassRow>(
    `SELECT p.*, m.full_name, m.member_no, g.name AS group_name
       FROM event_passes p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN groups g ON g.id = m.group_id
      WHERE p.token = ?`,
    passToken,
  )
  if (!pass) return { pass: null, event: null, alreadyIn: false }

  const eventRow = one<{ id: string; name: string; date: string; start_time: string | null; location: string | null }>(
    "SELECT id, name, date, start_time, location FROM events WHERE id = ?",
    pass.event_id,
  )
  return { pass, event: eventRow ?? null, alreadyIn: pass.status === "checked_in" }
}

export function listCheckins(eventId: string): {
  id: string
  member_id: string | null
  outcome: CheckinOutcome
  detail: string | null
  actor_name: string | null
  created_at: string
  full_name: string | null
}[] {
  return all(
    `SELECT c.id, c.member_id, c.outcome, c.detail, c.actor_name, c.created_at, m.full_name
       FROM event_checkins c
       LEFT JOIN members m ON m.id = c.member_id
      WHERE c.event_id = ?
      ORDER BY c.created_at DESC
      LIMIT 200`,
    eventId,
  )
}

/** One person's own ledger row — never the whole list, which is a coordinator's view. */
export function ownContribution(eventId: string, memberId: string | null): ContributionRow[] {
  if (!memberId) return []
  const row = one<ContributionRow>(
    `SELECT c.*, m.full_name, m.member_no, u.display_name AS confirmed_by_name
       FROM event_contributions c
       JOIN members m ON m.id = c.member_id
       LEFT JOIN users u ON u.id = c.confirmed_by
      WHERE c.event_id = ? AND c.member_id = ?`,
    eventId, memberId,
  )
  return row ? [row] : []
}

/** One person's own entrance pass, with the token they need to be admitted. */
export function ownPass(eventId: string, memberId: string): PassRow | null {
  return (
    one<PassRow>(
      `SELECT p.*, m.full_name, m.member_no, g.name AS group_name
         FROM event_passes p
         JOIN members m ON m.id = p.member_id
         LEFT JOIN groups g ON g.id = m.group_id
        WHERE p.event_id = ? AND p.member_id = ? AND p.status <> 'revoked'`,
      eventId, memberId,
    ) ?? null
  )
}
