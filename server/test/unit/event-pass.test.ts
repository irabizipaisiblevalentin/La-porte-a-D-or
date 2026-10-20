/**
 * Event audiences, contributions and the door.
 *
 * These are the three places in the events module where a mistake costs
 * something real: an event shown to the wrong group leaks what a group is
 * planning, a contribution ledger that miscounts means money is chased from the
 * wrong person, and a door that admits a cancelled pass lets someone in who has
 * not paid. Each is exercised here against a real database.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-event-pass-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "event-pass-test-secret-at-least-16"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const {
  audienceVisibilityClause,
  checkIn,
  confirmContribution,
  contributionSummary,
  ensureContributions,
  eventAudience,
  eventIsForGroup,
  issuePassesForPaid,
  listPasses,
  previewPass,
  setContributionAmount,
  setEventAudience,
  undoContribution,
} = await import("../../src/services/event-pass.js")

const ACTOR_ID = "usr_test_actor"
const ACTOR = { id: ACTOR_ID, displayName: "Events Coordinator" }

let sequence = 0
function makeMember(groupId: string, name: string): string {
  sequence += 1
  const memberId = `mbr_test_${sequence}`
  const suffix = String(sequence).padStart(4, "0")
  run(
    `INSERT INTO members (id, member_no, full_name, group_id, status, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    memberId, `CHR-2026-9${suffix}`, name, groupId,
  )
  return memberId
}

/** Creates an event with participants and an optional contribution. */
function makeEvent(options: {
  name: string
  requiresContribution?: boolean
  amount?: number
  members?: string[]
}): string {
  sequence += 1
  const eventId = `evt_test_${sequence}`
  run(
    `INSERT INTO events (id, name, event_type, date, status, is_public, audience_public,
                         requires_contribution, contribution_amount, created_at, updated_at)
     VALUES (?, ?, 'concert', '2026-12-01', 'planned', 0, 0, ?, ?, ?, ?)`,
    eventId, options.name,
    options.requiresContribution ? 1 : 0,
    options.requiresContribution ? (options.amount ?? 0) : null,
    "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
  )
  for (const memberId of options.members ?? []) {
    run(
      "INSERT INTO event_participants (event_id, member_id, role, added_at) VALUES (?, ?, NULL, ?)",
      eventId, memberId, "2026-01-01T00:00:00.000Z",
    )
  }
  return eventId
}

before(() => {
  migrate()
  seed()
  // The ledger and the pass both record *who* confirmed or issued them, with a
  // foreign key onto `users`, so the acting coordinator has to be a real account.
  run(
    `INSERT OR IGNORE INTO users (id, email, email_normalized, display_name, password_hash, status,
                                   must_change_password, created_at, updated_at)
     VALUES (?, 'events.coordinator@test.local', 'events.coordinator@test.local', 'Events Coordinator',
             'scrypt$test$hash', 'active', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ACTOR_ID,
  )
})

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

// --- Audiences ---------------------------------------------------------------

test("an event with no audience is for the whole choir", () => {
  const eventId = makeEvent({ name: "Whole choir rehearsal" })
  assert.equal(eventIsForGroup(eventId, "grp_senior"), true)
  assert.equal(eventIsForGroup(eventId, "grp_junior"), true)
  assert.equal(eventIsForGroup(eventId, "grp_members"), true)
  assert.deepEqual(eventAudience(eventId), [])
})

test("an audience narrows an event to exactly the groups chosen", () => {
  const eventId = makeEvent({ name: "Senior and Members concert" })
  setEventAudience(eventId, ["grp_senior", "grp_members"])

  assert.equal(eventIsForGroup(eventId, "grp_senior"), true)
  assert.equal(eventIsForGroup(eventId, "grp_members"), true)
  assert.equal(eventIsForGroup(eventId, "grp_junior"), false, "a junior must not see a senior-only event")

  const names = eventAudience(eventId).map((group) => group.key).sort()
  assert.deepEqual(names, ["members", "senior"])
})

test("setting an audience twice replaces it rather than accumulating", () => {
  const eventId = makeEvent({ name: "Re-aimed event" })
  setEventAudience(eventId, ["grp_senior"])
  setEventAudience(eventId, ["grp_junior"])

  assert.equal(eventIsForGroup(eventId, "grp_senior"), false)
  assert.equal(eventIsForGroup(eventId, "grp_junior"), true)
  assert.equal(eventAudience(eventId).length, 1)
})

test("an empty audience means the whole choir again", () => {
  const eventId = makeEvent({ name: "Opened back up" })
  setEventAudience(eventId, ["grp_junior"])
  setEventAudience(eventId, [])

  assert.equal(eventIsForGroup(eventId, "grp_senior"), true)
  assert.equal(eventIsForGroup(eventId, "grp_junior"), true)
})

test("an unknown group is refused rather than silently stored", () => {
  const eventId = makeEvent({ name: "Bad audience" })
  assert.throws(() => setEventAudience(eventId, ["grp_nonexistent"]), /not a group of this choir/)
  assert.deepEqual(eventAudience(eventId), [])
})

test("the legacy single-group column still narrows an event", () => {
  // Events created before audiences existed carry `target_group_id` and no
  // audience rows. They must keep meaning exactly what they meant.
  const eventId = makeEvent({ name: "Legacy junior event" })
  run("UPDATE events SET target_group_id = 'grp_junior' WHERE id = ?", eventId)

  assert.equal(eventIsForGroup(eventId, "grp_junior"), true)
  assert.equal(eventIsForGroup(eventId, "grp_senior"), false)
})

test("the visibility clause keeps a group out of events it is not addressed to", () => {
  const open = makeEvent({ name: "Open event" })
  const juniorOnly = makeEvent({ name: "Junior only" })
  setEventAudience(juniorOnly, ["grp_junior"])

  const clause = audienceVisibilityClause("e", "grp_senior")
  const visible = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM events e WHERE e.id IN (?, ?) AND ${clause.sql}`,
    open, juniorOnly, ...clause.params,
  )
  assert.equal(visible?.c, 1, "a senior should see only the open event")
})

// --- Contributions -----------------------------------------------------------

test("contributions are recorded per participant at the event's amount", () => {
  const alice = makeMember("grp_senior", "Alice Test")
  const bob = makeMember("grp_junior", "Bob Test")
  const eventId = makeEvent({
    name: "Concert with a contribution",
    requiresContribution: true,
    amount: 5000,
    members: [alice, bob],
  })

  assert.equal(ensureContributions(eventId, 5000), 2)

  const summary = contributionSummary(eventId)
  assert.equal(summary.required, true)
  assert.equal(summary.amount, 5000)
  assert.equal(summary.counts.due, 2)
  assert.equal(summary.counts.paid, 0)
  assert.equal(summary.outstanding, 10000)
  assert.equal(summary.collected, 0)
})

test("syncing the ledger twice does not duplicate or re-price anyone", () => {
  const alice = makeMember("grp_senior", "Carol Test")
  const eventId = makeEvent({
    name: "Idempotent ledger",
    requiresContribution: true,
    amount: 3000,
    members: [alice],
  })

  ensureContributions(eventId, 3000)
  // Somebody confirmed a payment at the original amount...
  confirmContribution(eventId, alice, ACTOR)
  // ...then the coordinator changes the price and presses sync again.
  run("UPDATE events SET contribution_amount = 9000 WHERE id = ?", eventId)
  const added = ensureContributions(eventId, 9000)

  assert.equal(added, 0, "an existing ledger row must not be added again")
  const row = one<{ amount: number; status: string }>(
    "SELECT amount, status FROM event_contributions WHERE event_id = ? AND member_id = ?",
    eventId, alice,
  )
  assert.equal(row?.amount, 3000, "a settled row must not be re-priced")
  assert.equal(row?.status, "paid", "a settled row must not be un-paid")
})

test("adding a participant after a sync puts only the new person on the ledger", () => {
  const alice = makeMember("grp_senior", "Dora Test")
  const eventId = makeEvent({
    name: "Late joiner",
    requiresContribution: true,
    amount: 2000,
    members: [alice],
  })
  ensureContributions(eventId, 2000)

  const late = makeMember("grp_senior", "Eve Test")
  run(
    "INSERT INTO event_participants (event_id, member_id, role, added_at) VALUES (?, ?, NULL, ?)",
    eventId, late, "2026-01-02T00:00:00.000Z",
  )

  assert.equal(ensureContributions(eventId, 2000), 1)
  assert.equal(contributionSummary(eventId).counts.total, 2)
})

test("a confirmed payment cannot be re-priced until it is undone", () => {
  const alice = makeMember("grp_senior", "Fiona Test")
  const eventId = makeEvent({ name: "Priced", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)
  confirmContribution(eventId, alice, ACTOR)

  assert.throws(() => setContributionAmount(eventId, alice, 2000), /cannot be re-priced/)
})

test("confirming a payment issues the entrance pass in the same breath", () => {
  const alice = makeMember("grp_senior", "Grace Test")
  const eventId = makeEvent({ name: "Paid pass", requiresContribution: true, amount: 4000, members: [alice] })
  ensureContributions(eventId, 4000)

  const result = confirmContribution(eventId, alice, ACTOR)
  assert.equal(result.contribution.status, "paid")
  assert.ok(result.pass, "a paid person must hold a pass")
  assert.ok(result.pass!.token.length > 20, "the QR token must be unguessable")
  assert.match(result.pass!.passcode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

  const summary = contributionSummary(eventId)
  assert.equal(summary.counts.paid, 1)
  assert.equal(summary.collected, 4000)
  assert.equal(summary.outstanding, 0)
})

test("an unpaid person gets no pass", () => {
  const alice = makeMember("grp_senior", "Henry Test")
  const eventId = makeEvent({ name: "Unpaid", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)

  assert.deepEqual(issuePassesForPaid(eventId, ACTOR), [])
  assert.equal(listPasses(eventId).length, 0)
})

test("a waived person is admitted like a paid one", () => {
  const alice = makeMember("grp_senior", "Iris Test")
  const eventId = makeEvent({ name: "Waived", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)

  const result = confirmContribution(eventId, alice, ACTOR, { status: "waived", note: "Sponsor covered it" })
  assert.equal(result.contribution.status, "waived")
  assert.ok(result.pass)
  // A waiver is not money: it must not be counted as collected.
  assert.equal(contributionSummary(eventId).collected, 0)
  assert.equal(contributionSummary(eventId).counts.waived, 1)
})

test("undoing a payment closes the door again", () => {
  const alice = makeMember("grp_senior", "Jack Test")
  const eventId = makeEvent({ name: "Reversed", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)
  const issued = confirmContribution(eventId, alice, ACTOR).pass!

  undoContribution(eventId, alice, ACTOR.displayName)

  assert.equal(contributionSummary(eventId).counts.due, 1)
  assert.equal(
    one<{ status: string }>("SELECT status FROM event_passes WHERE id = ?", issued.id)?.status,
    "revoked",
    "a pass issued on a payment that was reversed must not admit anyone",
  )
})

// --- The door ----------------------------------------------------------------

test("a scanned token admits the holder exactly once", () => {
  const alice = makeMember("grp_senior", "Kim Test")
  const eventId = makeEvent({ name: "Door", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)
  const pass = confirmContribution(eventId, alice, ACTOR).pass!

  const first = checkIn(eventId, pass.token, ACTOR)
  assert.equal(first.outcome, "admitted")
  assert.match(first.message, /Kim Test/)

  const second = checkIn(eventId, pass.token, ACTOR)
  assert.equal(second.outcome, "repeat", "a shared QR must be visible, not silently accepted")
})

test("a typed passcode admits the holder, and is case-insensitive", () => {
  const alice = makeMember("grp_senior", "Liam Test")
  const eventId = makeEvent({ name: "Typed door", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)
  const pass = confirmContribution(eventId, alice, ACTOR).pass!

  const result = checkIn(eventId, pass.passcode.toLowerCase(), ACTOR)
  assert.equal(result.outcome, "admitted")
})

test("a passcode from another event is refused", () => {
  const alice = makeMember("grp_senior", "Mona Test")
  const firstEvent = makeEvent({ name: "First night", requiresContribution: true, amount: 1000, members: [alice] })
  const secondEvent = makeEvent({ name: "Second night", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(firstEvent, 1000)
  ensureContributions(secondEvent, 1000)
  const pass = confirmContribution(firstEvent, alice, ACTOR).pass!

  const result = checkIn(secondEvent, pass.passcode, ACTOR)
  assert.equal(result.outcome, "refused", "a pass must not admit anyone at a different event")
})

test("a revoked pass is refused", () => {
  const alice = makeMember("grp_senior", "Nina Test")
  const eventId = makeEvent({ name: "Revoked pass", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)
  const pass = confirmContribution(eventId, alice, ACTOR).pass!
  undoContribution(eventId, alice, ACTOR.displayName)

  const result = checkIn(eventId, pass.token, ACTOR)
  assert.equal(result.outcome, "refused")
  assert.match(result.message, /cancelled/)
})

test("an unknown code is refused and nothing is admitted", () => {
  const eventId = makeEvent({ name: "No such pass" })
  const result = checkIn(eventId, "ZZZZ-ZZZZ-ZZZZ", ACTOR)
  assert.equal(result.outcome, "refused")
  assert.equal(result.pass, null)
})

test("every attempt is written to the door log", () => {
  const alice = makeMember("grp_senior", "Olive Test")
  const eventId = makeEvent({ name: "Logged door", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)
  const pass = confirmContribution(eventId, alice, ACTOR).pass!

  checkIn(eventId, pass.token, ACTOR)
  checkIn(eventId, pass.token, ACTOR)
  checkIn(eventId, "WRONG-CODE-XX", ACTOR)

  const outcomes = one<{ admitted: number; repeat: number; refused: number }>(
    `SELECT
       SUM(CASE WHEN outcome = 'admitted' THEN 1 ELSE 0 END) AS admitted,
       SUM(CASE WHEN outcome = 'repeat' THEN 1 ELSE 0 END) AS repeat,
       SUM(CASE WHEN outcome = 'refused' THEN 1 ELSE 0 END) AS refused
     FROM event_checkins WHERE event_id = ?`,
    eventId,
  )
  assert.equal(outcomes?.admitted, 1)
  assert.equal(outcomes?.repeat, 1)
  assert.equal(outcomes?.refused, 1)
})

test("a scanned QR previews the holder without admitting anyone", () => {
  const alice = makeMember("grp_senior", "Prisca Test")
  const eventId = makeEvent({ name: "Preview", requiresContribution: true, amount: 1000, members: [alice] })
  ensureContributions(eventId, 1000)
  const pass = confirmContribution(eventId, alice, ACTOR).pass!

  const preview = previewPass(pass.token)
  assert.equal(preview.pass?.full_name, "Prisca Test")
  assert.equal(preview.event?.name, "Preview")
  assert.equal(preview.alreadyIn, false, "opening the page must not admit anyone")
  assert.equal(
    one<{ status: string }>("SELECT status FROM event_passes WHERE id = ?", pass.id)?.status,
    "issued",
    "the pass is untouched by a preview",
  )
})

test("an unknown token previews as nothing at all", () => {
  const preview = previewPass("not-a-real-token")
  assert.equal(preview.pass, null)
  assert.equal(preview.event, null)
})
