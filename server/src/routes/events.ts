import { Router } from "express"
import { z } from "zod"
import { one, all, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { can, type AuthUser } from "../auth/access.js"
import { id } from "../lib/security.js"
import { isValidDateString, isValidTimeString, nowIso } from "../lib/time.js"
import { imageUpload } from "../middleware/upload.js"
import { deleteFile, saveUpload, type FileRow } from "../services/uploads.js"
import { notifyMany } from "../services/notifications.js"
import {
  audienceVisibilityClause,
  checkIn,
  confirmContribution,
  contributionSummary,
  ensureContributions,
  eventAudience,
  listCheckins,
  listContributions,
  listPasses,
  previewPass,
  setContributionAmount,
  setEventAudience,
  undoContribution,
  issuePassesForPaid,
  revokePass,
  ownContribution,
  ownPass,
} from "../services/event-pass.js"

export const eventsRouter: Router = Router()

const dateString = z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD).")
const timeString = z.string().trim().refine(isValidTimeString, "Enter a valid time (HH:MM).")

const eventSchema = z.object({
  name: z.string().trim().min(2, "Enter the event name.").max(200),
  eventType: z.enum([
    "rehearsal", "concert", "church_service", "retreat", "training",
    "meeting", "competition", "community", "other",
  ]),
  date: dateString,
  startTime: timeString.nullable().optional(),
  endTime: timeString.nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  locationId: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  targetGroupId: z.enum(["grp_senior", "grp_junior", "grp_members"]).nullable().optional(),
  status: z.enum(["planned", "completed", "cancelled"]).optional(),
  report: z.string().trim().max(8000).nullable().optional(),
  isPublic: z.boolean().optional(),

  // Who the event is for. Any combination of groups; empty means the whole choir.
  // Only someone with events.manage may set this (see `requireEventManager`).
  audienceGroupIds: z.array(z.enum(["grp_senior", "grp_junior", "grp_members"])).max(3).optional(),
  audiencePublic: z.boolean().optional(),

  // Whether it costs money. Whole francs only — the choir collects cash and
  // mobile money, so there are no minor units to track.
  requiresContribution: z.boolean().optional(),
  contributionAmount: z.number().int().min(0).max(100_000_000).nullable().optional(),
  contributionNote: z.string().trim().max(500).nullable().optional(),
  contributionDueDate: dateString.nullable().optional(),
})

const contributionSchema = z.object({
  memberId: z.string().trim().min(1),
  amount: z.number().int().min(0).max(100_000_000).optional(),
})

const confirmSchema = z.object({
  memberId: z.string().trim().min(1),
  status: z.enum(["paid", "waived"]).optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

const checkinSchema = z.object({
  credential: z.string().trim().min(1, "Scan a QR code or type a passcode.").max(200),
})

const participantsSchema = z.object({
  memberIds: z.array(z.string().trim().min(1)).max(2000),
})

const songsSchema = z.object({
  songIds: z.array(z.string().trim().min(1)).min(1, "Select at least one song.").max(500),
})

interface EventRow {
  id: string
  name: string
  event_type: string
  date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  location_id: string | null
  description: string | null
  target_group_id: string | null
  status: string
  report: string | null
  is_public: number
  audience_public: number
  requires_contribution: number
  contribution_amount: number | null
  contribution_note: string | null
  contribution_due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  group_name: string | null
  participant_count: number
}

interface EventParticipantRow {
  member_id: string
  role: string | null
  added_at: string
  rsvp: string | null
  rsvp_at: string | null
  rsvp_note: string | null
  full_name: string
  member_no: string
  group_id: string
  group_name: string
}

interface EventSongRow {
  song_id: string
  added_at: string
  title: string
  composer: string | null
  status: string
}

function getEvent(eventId: string): EventRow | undefined {
  return one<EventRow>(
    `SELECT e.*, g.name AS group_name,
            (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) AS participant_count
       FROM events e
       LEFT JOIN groups g ON g.id = e.target_group_id
      WHERE e.id = ?`,
    eventId,
  )
}

/**
 * The groups whose events this viewer may see.
 *
 * A member sees their own group's events. A group administrator sees the group
 * they lead, taken from the scope their permissions were granted at — not from
 * `user.groupId`, which is null for administrators because they are not
 * themselves choristers. The Chairman and the Events Coordinator hold
 * `events.manage` and see everything.
 */
function visibleGroupIds(user: { groupId: string | null; permissions: Record<string, string[]> }): string[] | "all" {
  if (user.permissions["events.manage"]?.includes("global")) return "all"
  if (user.permissions["events.read"]?.includes("global")) {
    // A global read grant means every group's events.
    return "all"
  }

  const groups: string[] = []
  for (const [scope, groupId] of [["senior", "grp_senior"], ["junior", "grp_junior"], ["members", "grp_members"]] as const) {
    if (user.permissions["events.read"]?.includes(scope)) groups.push(groupId)
  }
  if (groups.length > 0) return groups
  return user.groupId ? [user.groupId] : []
}

/**
 * Whether an event falls inside what this viewer is allowed to see.
 *
 * The rule is the same for reading and for writing, so it is written once. An
 * event with no audience and no target group is the whole choir's, and is open to
 * anyone who may touch events at all; an event addressed to a group belongs to
 * that group.
 */
function eventIsVisibleTo(user: AuthUser, event: EventRow): boolean {
  const visible = visibleGroupIds(user)
  if (visible === "all") return true
  const audience = eventAudience(event.id)
  const target = audience.length > 0 ? audience.map((group) => group.id) : [event.target_group_id]
  return target.some((groupId) => groupId === null || visible.includes(groupId))
}

/** Whether this viewer may open a particular event. */
function canReadEvent(user: AuthUser, event: EventRow): boolean {
  if (!can(user, "events.read")) return false
  if (can(user, "events.manage")) return true
  return eventIsVisibleTo(user, event)
}

/**
 * Whether this viewer may change a *particular* event.
 *
 * `events.write` is granted per group, so holding it means "my group's events"
 * rather than "every event" — which is what stops a senior administrator from
 * editing a junior retreat. Someone with `events.manage` (the coordinator and the
 * Chairman) may change any event.
 */
function canWriteEvent(user: AuthUser, event: EventRow): boolean {
  if (!can(user, "events.write")) return false
  if (can(user, "events.manage")) return true
  return eventIsVisibleTo(user, event)
}

function listParticipants(eventId: string): EventParticipantRow[] {
  return all<EventParticipantRow>(
    `SELECT ep.member_id, ep.role, ep.added_at, ep.rsvp, ep.rsvp_at, ep.rsvp_note,
            m.full_name, m.member_no, m.group_id, g.name AS group_name
       FROM event_participants ep
       JOIN members m ON m.id = ep.member_id
       JOIN groups g ON g.id = m.group_id
      WHERE ep.event_id = ?
      ORDER BY m.full_name COLLATE NOCASE`,
    eventId,
  )
}

function listSongs(eventId: string): EventSongRow[] {
  return all<EventSongRow>(
    `SELECT es.song_id, es.added_at, s.title, s.composer, s.status
       FROM event_songs es
       JOIN songs s ON s.id = es.song_id
      WHERE es.event_id = ?
      ORDER BY s.title COLLATE NOCASE`,
    eventId,
  )
}

/** Validates that every id exists, throwing a field error naming the unknown ids. */
function assertMembersExist(memberIds: string[]): void {
  if (memberIds.length === 0) return
  const found = all<{ id: string }>(
    `SELECT id FROM members WHERE id IN (${memberIds.map(() => "?").join(",")})`,
    ...memberIds,
  )
  if (found.length === memberIds.length) return
  const known = new Set(found.map((row) => row.id))
  const missing = memberIds.filter((memberId) => !known.has(memberId))
  throw badRequest("Some selected members do not exist.", {
    fields: { memberIds: `Unknown member id(s): ${missing.join(", ")}` },
  })
}

function assertSongsExist(songIds: string[]): void {
  if (songIds.length === 0) return
  const found = all<{ id: string }>(
    `SELECT id FROM songs WHERE id IN (${songIds.map(() => "?").join(",")})`,
    ...songIds,
  )
  if (found.length === songIds.length) return
  const known = new Set(found.map((row) => row.id))
  const missing = songIds.filter((songId) => !known.has(songId))
  throw badRequest("Some selected songs do not exist.", {
    fields: { songIds: `Unknown song id(s): ${missing.join(", ")}` },
  })
}

eventsRouter.get("/", requireAuth, requirePermission("events.read"), (req, res) => {
  // The calendar asks for a whole month, which can exceed the default page. The
  // bound is raised rather than removed so a page is still a page.
  const p = pagination(req, 25, 200)
  const typeFilter = queryString(req, "type")
  const groupFilter = queryString(req, "groupId")
  const from = queryString(req, "from")
  const to = queryString(req, "to")
  const statusFilter = queryString(req, "status")
  const search = queryString(req, "search")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (typeFilter) { clauses.push("e.event_type = ?"); params.push(typeFilter) }
  if (groupFilter) { clauses.push("e.target_group_id = ?"); params.push(groupFilter) }
  if (from) { clauses.push("e.date >= ?"); params.push(from) }
  if (to) { clauses.push("e.date <= ?"); params.push(to) }
  if (statusFilter) { clauses.push("e.status = ?"); params.push(statusFilter) }
  if (search) { clauses.push("e.name LIKE ?"); params.push(`%${search}%`) }

  // An event is only listed for the groups it is addressed to. The Chairman and
  // the Events Coordinator are unscoped; everyone else is narrowed to the groups
  // their permissions cover, so a junior never sees a senior-only event.
  const visible = visibleGroupIds(req.auth!)
  if (visible !== "all") {
    if (visible.length === 0) {
      // No group at all: only events addressed to the whole choir.
      clauses.push(
        `NOT EXISTS (SELECT 1 FROM event_audiences ea WHERE ea.event_id = e.id)
         AND e.target_group_id IS NULL`,
      )
    } else {
      const placeholders = visible.map(() => "?").join(",")
      clauses.push(
        `(
          EXISTS (SELECT 1 FROM event_audiences ea WHERE ea.event_id = e.id AND ea.group_id IN (${placeholders}))
          OR (
            NOT EXISTS (SELECT 1 FROM event_audiences ea2 WHERE ea2.event_id = e.id)
            AND (e.target_group_id IS NULL OR e.target_group_id IN (${placeholders}))
          )
        )`,
      )
      params.push(...visible, ...visible)
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM events e ${where}`, ...params)?.c ?? 0
  const items = all<EventRow>(
    `SELECT e.*, g.name AS group_name,
            (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) AS participant_count
       FROM events e
       LEFT JOIN groups g ON g.id = e.target_group_id
       ${where}
       ORDER BY e.date DESC, e.start_time DESC, e.created_at DESC
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items, total, p))
})

eventsRouter.post("/", requireAuth, requirePermission("events.write"), (req, res) => {
  const input = parse(eventSchema, req.body)
  // The audience and the contribution are the Events Coordinator's call, not a
  // group administrator's: they decide who an event is for and what it costs.
  const canManage = can(req.auth!, "events.manage")
  if (!canManage && (input.audienceGroupIds !== undefined || input.requiresContribution)) {
    throw forbidden("Only an Events Coordinator can set who an event is for or whether it costs money.")
  }

  const eventId = id()
  const timestamp = nowIso()
  run(
    `INSERT INTO events (id, name, event_type, date, start_time, end_time, location, location_id, description,
                         target_group_id, status, report, is_public, audience_public,
                         requires_contribution, contribution_amount, contribution_note, contribution_due_date,
                         created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId, input.name, input.eventType, input.date, input.startTime ?? null, input.endTime ?? null,
    input.location ?? null, input.locationId ?? null, input.description ?? null,
    input.targetGroupId ?? null, input.status ?? "planned", input.report ?? null,
    input.isPublic ? 1 : 0, input.audiencePublic ? 1 : 0,
    input.requiresContribution ? 1 : 0,
    input.requiresContribution ? (input.contributionAmount ?? 0) : null,
    input.contributionNote ?? null, input.contributionDueDate ?? null,
    req.auth!.id, timestamp, timestamp,
  )
  if (canManage && input.audienceGroupIds) setEventAudience(eventId, input.audienceGroupIds)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.create", entityType: "event", entityId: eventId,
    summary: `Event "${input.name}" created for ${input.date}`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.status(201).json({ event: getEvent(eventId), audience: eventAudience(eventId) })
})

eventsRouter.get("/:id", requireAuth, requirePermission("events.read"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")

  // A group may only open the events addressed to it. Without this the audience
  // would be a display setting rather than a rule, and a junior could read a
  // senior-only event by guessing its id.
  if (!canReadEvent(req.auth!, event)) throw notFound("That event does not exist.")

  const canManage = can(req.auth!, "events.manage")
  res.json({
    event,
    audience: eventAudience(event.id),
    participants: listParticipants(event.id),
    songs: listSongs(event.id),
    // The ledger and the door are for whoever runs the event, and for the person
    // it is about: a member may see their own contribution and pass, never the
    // whole paid list.
    contribution: contributionSummary(event.id),
    contributions: canManage ? listContributions(event.id) : ownContribution(event.id, req.auth!.memberId),
    passes: canManage ? listPasses(event.id) : [],
    myPass: req.auth!.memberId ? ownPass(event.id, req.auth!.memberId) : null,
    checkins: canManage ? listCheckins(event.id) : [],
    photos: listEventPhotos(event.id),
  })
})

eventsRouter.patch("/:id", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  // A group writes its own group's events. Without this a senior administrator
  // could edit a junior retreat by guessing its id.
  if (!canWriteEvent(req.auth!, event)) throw notFound("That event does not exist.")
  const input = parse(eventSchema.partial(), req.body)

  // Audience and money are the Events Coordinator's to change; a group
  // administrator edits the event itself without touching who it is for.
  const canManage = can(req.auth!, "events.manage")
  const managesAudience =
    input.audienceGroupIds !== undefined ||
    input.audiencePublic !== undefined ||
    input.requiresContribution !== undefined ||
    input.contributionAmount !== undefined ||
    input.contributionNote !== undefined ||
    input.contributionDueDate !== undefined
  if (!canManage && managesAudience) {
    throw forbidden("Only an Events Coordinator can set who an event is for or whether it costs money.")
  }

  const fields: string[] = []
  const params: (string | number | null)[] = []
  if (input.name !== undefined) { fields.push("name = ?"); params.push(input.name) }
  if (input.eventType !== undefined) { fields.push("event_type = ?"); params.push(input.eventType) }
  if (input.date !== undefined) { fields.push("date = ?"); params.push(input.date) }
  if (input.startTime !== undefined) { fields.push("start_time = ?"); params.push(input.startTime) }
  if (input.endTime !== undefined) { fields.push("end_time = ?"); params.push(input.endTime) }
  if (input.location !== undefined) { fields.push("location = ?"); params.push(input.location) }
  if (input.locationId !== undefined) { fields.push("location_id = ?"); params.push(input.locationId) }
  if (input.description !== undefined) { fields.push("description = ?"); params.push(input.description) }
  if (input.targetGroupId !== undefined) { fields.push("target_group_id = ?"); params.push(input.targetGroupId) }
  if (input.status !== undefined) { fields.push("status = ?"); params.push(input.status) }
  if (input.report !== undefined) { fields.push("report = ?"); params.push(input.report) }
  if (input.isPublic !== undefined) { fields.push("is_public = ?"); params.push(input.isPublic ? 1 : 0) }
  if (input.audiencePublic !== undefined) { fields.push("audience_public = ?"); params.push(input.audiencePublic ? 1 : 0) }
  if (input.requiresContribution !== undefined) {
    fields.push("requires_contribution = ?"); params.push(input.requiresContribution ? 1 : 0)
    // Turning the contribution off clears the amount, so a free event cannot keep
    // a stale figure that the ledger would still be measured against.
    if (!input.requiresContribution && input.contributionAmount === undefined) {
      fields.push("contribution_amount = ?"); params.push(null)
    }
  }
  if (input.contributionAmount !== undefined) { fields.push("contribution_amount = ?"); params.push(input.contributionAmount) }
  if (input.contributionNote !== undefined) { fields.push("contribution_note = ?"); params.push(input.contributionNote) }
  if (input.contributionDueDate !== undefined) { fields.push("contribution_due_date = ?"); params.push(input.contributionDueDate) }
  if (fields.length === 0 && input.audienceGroupIds === undefined) throw badRequest("No changes were provided.")

  fields.push("updated_at = ?")
  params.push(nowIso())
  run(`UPDATE events SET ${fields.join(", ")} WHERE id = ?`, ...params, event.id)

  let audienceAdded = 0
  const updated = getEvent(event.id)!
  if (canManage && input.audienceGroupIds !== undefined) setEventAudience(event.id, input.audienceGroupIds)
  // Once an event costs something and has participants, put them on the ledger at
  // the stated amount. Existing rows are never re-priced (see ensureContributions).
  if (canManage && updated.requires_contribution === 1 && updated.contribution_amount !== null) {
    audienceAdded = ensureContributions(event.id, updated.contribution_amount)
  }

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.update", entityType: "event", entityId: event.id,
    summary: `Event "${event.name}" updated`, detail: { fields: Object.keys(input), audienceAdded }, ip: req.ip,
  })
  res.json({ event: updated, audience: eventAudience(event.id), contribution: contributionSummary(event.id) })
})

eventsRouter.delete("/:id", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canWriteEvent(req.auth!, event)) throw notFound("That event does not exist.")
  run("DELETE FROM events WHERE id = ?", event.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.delete", entityType: "event", entityId: event.id,
    summary: `Event "${event.name}" deleted`, ip: req.ip,
  })
  res.json({ ok: true })
})

eventsRouter.put("/:id/participants", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canWriteEvent(req.auth!, event)) throw notFound("That event does not exist.")
  const input = parse(participantsSchema, req.body)
  const memberIds = Array.from(new Set(input.memberIds))
  assertMembersExist(memberIds)

  const timestamp = nowIso()
  transaction(() => {
    run("DELETE FROM event_participants WHERE event_id = ?", event.id)
    for (const memberId of memberIds) {
      run(
        "INSERT INTO event_participants (event_id, member_id, role, added_at) VALUES (?, ?, NULL, ?)",
        event.id, memberId, timestamp,
      )
    }
    run("UPDATE events SET updated_at = ? WHERE id = ?", timestamp, event.id)
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.participants_update", entityType: "event", entityId: event.id,
    summary: `Participants for event "${event.name}" replaced (${memberIds.length})`, ip: req.ip,
  })
  res.json({ event: getEvent(event.id), participants: listParticipants(event.id) })
})

eventsRouter.post("/:id/songs", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canWriteEvent(req.auth!, event)) throw notFound("That event does not exist.")
  const input = parse(songsSchema, req.body)
  const songIds = Array.from(new Set(input.songIds))
  assertSongsExist(songIds)

  const timestamp = nowIso()
  transaction(() => {
    for (const songId of songIds) {
      run(
        "INSERT OR IGNORE INTO event_songs (event_id, song_id, added_at) VALUES (?, ?, ?)",
        event.id, songId, timestamp,
      )
    }
    run("UPDATE events SET updated_at = ? WHERE id = ?", timestamp, event.id)
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.songs_add", entityType: "event", entityId: event.id,
    summary: `Songs linked to event "${event.name}" (${songIds.length})`, detail: { songIds }, ip: req.ip,
  })
  res.status(201).json({ event: getEvent(event.id), songs: listSongs(event.id) })
})

eventsRouter.delete("/:id/songs/:songId", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canWriteEvent(req.auth!, event)) throw notFound("That event does not exist.")
  const songId = String(req.params.songId)
  const link = one<{ song_id: string }>(
    "SELECT song_id FROM event_songs WHERE event_id = ? AND song_id = ?",
    event.id, songId,
  )
  if (!link) throw notFound("That song is not linked to this event.")
  run("DELETE FROM event_songs WHERE event_id = ? AND song_id = ?", event.id, songId)
  run("UPDATE events SET updated_at = ? WHERE id = ?", nowIso(), event.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.song_remove", entityType: "event", entityId: event.id,
    summary: `Song removed from event "${event.name}"`, detail: { songId }, ip: req.ip,
  })
  res.json({ ok: true })
})

// --- Who an event is for -----------------------------------------------------

eventsRouter.put("/:id/audience", requireAuth, requirePermission("events.manage"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const input = parse(z.object({ groupIds: z.array(z.enum(["grp_senior", "grp_junior", "grp_members"])).max(3) }), req.body)
  const audience = setEventAudience(event.id, input.groupIds)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.audience_set", entityType: "event", entityId: event.id,
    summary: audience.length === 0
      ? `Event "${event.name}" is now for the whole choir`
      : `Event "${event.name}" is now for ${audience.map((g) => g.name).join(", ")}`,
    detail: { groupIds: input.groupIds }, ip: req.ip,
  })
  res.json({ audience })
})

// --- Contributions -----------------------------------------------------------

eventsRouter.get("/:id/contributions", requireAuth, requirePermission("events.payment.approve"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  res.json({ contribution: contributionSummary(event.id), contributions: listContributions(event.id) })
})

/** Puts every participant on the ledger. Idempotent, so it is safe to press again. */
eventsRouter.post("/:id/contributions/sync", requireAuth, requirePermission("events.manage"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (event.requires_contribution !== 1 || event.contribution_amount === null) {
    throw badRequest("This event does not ask for a contribution. Set an amount first.")
  }

  const added = ensureContributions(event.id, event.contribution_amount)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.contributions_sync", entityType: "event", entityId: event.id,
    summary: `Contribution list for "${event.name}" updated (${added} added)`, detail: { added }, ip: req.ip,
  })
  res.json({ added, contribution: contributionSummary(event.id), contributions: listContributions(event.id) })
})

eventsRouter.patch("/:id/contributions", requireAuth, requirePermission("events.manage"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const input = parse(contributionSchema, req.body)
  if (input.amount === undefined) throw badRequest("Provide an amount.")
  setContributionAmount(event.id, input.memberId, input.amount)
  res.json({ contribution: contributionSummary(event.id), contributions: listContributions(event.id) })
})

/**
 * Confirms a contribution. This is the payment gate: confirming issues the
 * entrance pass in the same breath, so nobody can be marked paid without a pass
 * or hold a pass without having paid.
 */
eventsRouter.post("/:id/contributions/confirm", requireAuth, requirePermission("events.payment.approve"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const input = parse(confirmSchema, req.body)
  const result = confirmContribution(event.id, input.memberId, { id: req.auth!.id, displayName: req.auth!.displayName }, {
    status: input.status, reference: input.reference, note: input.note,
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.contribution_confirmed", entityType: "event", entityId: event.id,
    summary: `${result.contribution.full_name ?? "Member"} marked ${result.contribution.status} for "${event.name}"`,
    detail: { memberId: input.memberId, status: result.contribution.status, amount: result.contribution.amount }, ip: req.ip,
  })
  res.json({ contribution: contributionSummary(event.id), contributions: listContributions(event.id), pass: result.pass })
})

eventsRouter.post("/:id/contributions/undo", requireAuth, requirePermission("events.payment.approve"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const input = parse(z.object({ memberId: z.string().trim().min(1) }), req.body)
  undoContribution(event.id, input.memberId, req.auth!.displayName)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.contribution_undone", entityType: "event", entityId: event.id,
    summary: `Payment for "${event.name}" returned to unpaid`, detail: { memberId: input.memberId }, ip: req.ip,
  })
  res.json({ contribution: contributionSummary(event.id), contributions: listContributions(event.id) })
})

// --- Entrance passes ---------------------------------------------------------

eventsRouter.get("/:id/passes", requireAuth, requirePermission("events.manage"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  res.json({ passes: listPasses(event.id), contribution: contributionSummary(event.id) })
})

/** Issues passes for everyone paid who has none — safe to press again. */
eventsRouter.post("/:id/passes/issue", requireAuth, requirePermission("events.payment.approve"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const passes = issuePassesForPaid(event.id, { id: req.auth!.id, displayName: req.auth!.displayName })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.passes_issued", entityType: "event", entityId: event.id,
    summary: `Entrance passes issued for "${event.name}" (${passes.length})`, detail: { count: passes.length }, ip: req.ip,
  })
  res.json({ passes })
})

eventsRouter.post("/:id/passes/revoke", requireAuth, requirePermission("events.payment.approve"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const input = parse(z.object({ memberId: z.string().trim().min(1) }), req.body)
  revokePass(event.id, input.memberId)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.pass_revoked", entityType: "event", entityId: event.id,
    summary: `Entrance pass revoked for "${event.name}"`, detail: { memberId: input.memberId }, ip: req.ip,
  })
  res.json({ passes: listPasses(event.id) })
})

// --- The door ----------------------------------------------------------------

eventsRouter.post("/:id/checkin", requireAuth, requirePermission("events.checkin"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const input = parse(checkinSchema, req.body)
  const result = checkIn(event.id, input.credential, { id: req.auth!.id, displayName: req.auth!.displayName })
  res.json(result)
})

// --- A member's own answer ---------------------------------------------------

/**
 * A member's own RSVP. Scoped to the person signed in: this is deliberately not
 * an administrator route, so nobody can answer on someone else's behalf.
 */
eventsRouter.put("/:id/rsvp", requireAuth, requirePermission("events.read"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const memberId = req.auth!.memberId
  if (!memberId) throw forbidden("Only members can reply to an event.")

  const input = parse(
    z.object({
      rsvp: z.enum(["yes", "no", "maybe"]),
      note: z.string().trim().max(300).nullable().optional(),
    }),
    req.body,
  )

  const timestamp = nowIso()
  const existing = one<{ member_id: string }>(
    "SELECT member_id FROM event_participants WHERE event_id = ? AND member_id = ?",
    event.id, memberId,
  )
  if (existing) {
    run(
      "UPDATE event_participants SET rsvp = ?, rsvp_at = ?, rsvp_note = ? WHERE event_id = ? AND member_id = ?",
      input.rsvp, timestamp, input.note ?? null, event.id, memberId,
    )
  } else {
    run(
      `INSERT INTO event_participants (event_id, member_id, role, added_at, rsvp, rsvp_at, rsvp_note)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      event.id, memberId, timestamp, input.rsvp, timestamp, input.note ?? null,
    )
  }
  run("UPDATE events SET updated_at = ? WHERE id = ?", timestamp, event.id)

  // Answering "yes" to an event that costs money puts you on the ledger, at the
  // event's amount, as owing — the coordinator then confirms the payment.
  if (input.rsvp === "yes" && event.requires_contribution === 1 && event.contribution_amount !== null) {
    ensureContributions(event.id, event.contribution_amount)
  }

  res.json({ participants: listParticipants(event.id), contribution: contributionSummary(event.id) })
})

// --- Photographs of an event -------------------------------------------------

/**
 * A photograph taken at an event.
 *
 * Photos live in the same `file_uploads` table as the gallery and member pictures,
 * under their own entity type, so they are backed up, served from the bucket and
 * cached exactly like everything else. The bucket is *public*, because an event
 * photograph is part of what the choir shows the world — and the events list
 * already says which of them are public.
 */
eventsRouter.get("/:id/photos", requireAuth, requirePermission("events.read"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canReadEvent(req.auth!, event)) throw notFound("That event does not exist.")
  res.json({ photos: listEventPhotos(event.id) })
})

eventsRouter.post(
  "/:id/photos",
  requireAuth,
  requirePermission("events.write"),
  imageUpload.single("file"),
  (req, res) => {
    const event = getEvent(String(req.params.id))
    if (!event) throw notFound("That event does not exist.")
    // Another group's event is not acknowledged at all: a 403 would confirm it
    // exists, which is exactly what the audience rule is meant to prevent.
    if (!canWriteEvent(req.auth!, event)) throw notFound("That event does not exist.")
    if (!req.file) throw badRequest("Choose an image file to upload.")

    const saved = saveUpload({
      bucket: "public",
      entityType: "event_photo",
      entityId: event.id,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      data: req.file.buffer,
      uploadedBy: req.auth!.id,
    })
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "event.photo_add", entityType: "event", entityId: event.id,
      summary: `Photograph added to event "${event.name}"`, ip: req.ip,
    })
    res.status(201).json({ photos: listEventPhotos(event.id) })
  },
)

eventsRouter.delete("/:id/photos/:photoId", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canWriteEvent(req.auth!, event)) throw notFound("That event does not exist.")

  const file = one<FileRow>(
    "SELECT * FROM file_uploads WHERE id = ? AND entity_type = 'event_photo' AND entity_id = ?",
    String(req.params.photoId), event.id,
  )
  if (!file) throw notFound("That photograph is not on this event.")

  deleteFile(file)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.photo_remove", entityType: "event", entityId: event.id,
    summary: `Photograph removed from event "${event.name}"`, ip: req.ip,
  })
  res.json({ photos: listEventPhotos(event.id) })
})

interface EventPhoto {
  id: string
  url: string
  originalName: string
  createdAt: string
}

function listEventPhotos(eventId: string): EventPhoto[] {
  return all<FileRow>(
    `SELECT * FROM file_uploads
      WHERE entity_type = 'event_photo' AND entity_id = ?
      ORDER BY created_at ASC, id ASC`,
    eventId,
  ).map((row) => ({
    id: row.id,
    url: `/media/${row.path.replace("public/", "")}`,
    originalName: row.original_name,
    createdAt: row.created_at,
  }))
}

// --- Roll-call ---------------------------------------------------------------
//
// Who actually came, as opposed to who said they would. Answering an event is a
// promise; the roll-call is the record. It is kept in the choir's ordinary
// attendance tables (`attendance_sessions` / `attendance_records`) with the
// event's id on the session, so a performance's attendance sits beside every
// rehearsal's and reports the same way.
//
// Working the roll-call is the door's counterpart, so it takes `events.checkin`
// rather than inventing another permission: whoever may let people in may say who
// came.

const ROLL_CALL_STATUSES = ["present", "late", "absent", "excused"] as const

/** The attendance session for an event, if one has been started. */
function eventAttendanceSession(eventId: string): { id: string } | undefined {
  return one<{ id: string }>("SELECT id FROM attendance_sessions WHERE event_id = ?", eventId)
}

/** The roll-call as it stands: everyone who should be there, and how they are marked. */
function eventRollCall(event: EventRow) {
  const session = eventAttendanceSession(event.id)
  const audience = eventAudience(event.id)
  const groupIds = audience.length > 0 ? audience.map((group) => group.id) : [event.target_group_id]

  // Everyone the event is for is on the roll — an audience with no group means the
  // whole choir. Someone marked once keeps their mark; everyone else shows as
  // unmarked, which is what a coordinator scanning the list needs to see.
  const rows = all<{ member_id: string; full_name: string; member_no: string; group_id: string; group_name: string; status: string | null; notes: string | null }>(
    `SELECT m.id AS member_id, m.full_name, m.member_no, m.group_id, g.name AS group_name, r.status, r.notes
       FROM members m
       JOIN groups g ON g.id = m.group_id
       LEFT JOIN attendance_records r ON r.session_id = ? AND r.member_id = m.id
      WHERE m.status = 'active'
        AND (? = 1 OR m.group_id IN (SELECT value FROM json_each(?)))
      ORDER BY m.full_name COLLATE NOCASE`,
    session?.id ?? "", groupIds.some((groupId) => groupId === null) ? 1 : 0,
    JSON.stringify(groupIds.filter((groupId): groupId is string => groupId !== null)),
  )

  return {
    sessionId: session?.id ?? null,
    counts: {
      present: rows.filter((row) => row.status === "present").length,
      late: rows.filter((row) => row.status === "late").length,
      absent: rows.filter((row) => row.status === "absent").length,
      excused: rows.filter((row) => row.status === "excused").length,
      unmarked: rows.filter((row) => row.status === null).length,
      total: rows.length,
    },
    entries: rows.map((row) => ({
      member_id: row.member_id,
      full_name: row.full_name,
      member_no: row.member_no,
      group_id: row.group_id,
      group_name: row.group_name,
      status: row.status ?? "unmarked",
      notes: row.notes,
    })),
  }
}

eventsRouter.get("/:id/roll-call", requireAuth, requirePermission("events.checkin"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canReadEvent(req.auth!, event)) throw notFound("That event does not exist.")
  res.json({ rollCall: eventRollCall(event) })
})

eventsRouter.put("/:id/roll-call", requireAuth, requirePermission("events.checkin"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  if (!canReadEvent(req.auth!, event)) throw notFound("That event does not exist.")

  const input = parse(
    z.object({
      records: z
        .array(
          z.object({
            memberId: z.string().trim().min(1),
            status: z.enum(ROLL_CALL_STATUSES),
            notes: z.string().trim().max(500).nullable().optional(),
          }),
        )
        .max(500),
    }),
    req.body,
  )
  if (input.records.length === 0) throw badRequest("Provide at least one member to mark.")

  const timestamp = nowIso()
  // The session is created the first time somebody marks the roll, so an event
  // that never needed one leaves no empty attendance session behind.
  let session = eventAttendanceSession(event.id)
  if (!session) {
    const sessionId = id()
    run(
      `INSERT INTO attendance_sessions (id, title, activity_type, date, start_time, end_time, location,
                                        location_id, target_group_id, recorder_id, notes, event_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      sessionId, event.name, rollCallActivityType(event.event_type), event.date,
      event.start_time, event.end_time, event.location, event.location_id, event.target_group_id,
      req.auth!.id, event.id, timestamp, timestamp,
    )
    session = { id: sessionId }
  }

  transaction(() => {
    for (const entry of input.records) {
      const member = one<{ id: string; group_id: string }>(
        "SELECT id, group_id FROM members WHERE id = ?", entry.memberId,
      )
      if (!member) throw badRequest(`Member ${entry.memberId} does not exist.`)
      // Only people the event is for may be marked. Otherwise a roll-call could
      // quietly become a way of recording attendance for someone who was never
      // part of the event.
      const audience = eventAudience(event.id)
      const groupIds = audience.length > 0 ? audience.map((group) => group.id) : [event.target_group_id]
      const wholeChoir = groupIds.some((groupId) => groupId === null)
      if (!wholeChoir && !groupIds.includes(member.group_id)) {
        throw badRequest("That member is not part of this event's audience.")
      }
      run(
        `INSERT INTO attendance_records (id, session_id, member_id, status, notes, recorded_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, member_id) DO UPDATE SET
           status = excluded.status,
           notes = excluded.notes,
           recorded_by = excluded.recorded_by,
           updated_at = excluded.updated_at`,
        id(), session!.id, entry.memberId, entry.status, entry.notes ?? null, req.auth!.id, timestamp, timestamp,
      )
    }
    run("UPDATE attendance_sessions SET updated_at = ? WHERE id = ?", timestamp, session!.id)
  })

  // Tell each marked member, so a roll-call reaches them just as a rehearsal's
  // attendance does. One message per member.
  const accountRows = new Map<string, string>()
  const messages = []
  const seen = new Set<string>()
  for (const entry of input.records) {
    if (seen.has(entry.memberId)) continue
    seen.add(entry.memberId)
    let accountId = accountRows.get(entry.memberId)
    if (accountId === undefined) {
      accountId = one<{ id: string }>("SELECT user_id AS id FROM members WHERE user_id IS NOT NULL AND id = ?", entry.memberId)?.id ?? ""
      accountRows.set(entry.memberId, accountId)
    }
    if (!accountId) continue
    const label = entry.status === "present" ? "Present" : entry.status === "late" ? "Late" : entry.status === "excused" ? "Excused" : "Absent"
    messages.push({
      userId: accountId,
      type: "attendance",
      title: "Attendance marked",
      body: `${event.name} (${event.date}) — ${label}.`,
      link: "/app/attendance",
    })
  }
  notifyMany(messages)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.roll_call", entityType: "event", entityId: event.id,
    summary: `Roll-call taken for "${event.name}" (${input.records.length} marked)`,
    detail: { sessionId: session.id }, ip: req.ip,
  })
  res.json({ rollCall: eventRollCall(event) })
})

/** The attendance activity type that best describes an event, for the reports. */
function rollCallActivityType(eventType: string): string {
  const known = ["rehearsal", "performance", "church_service", "meeting", "training", "concert"]
  if (known.includes(eventType)) return eventType
  return "other"
}
