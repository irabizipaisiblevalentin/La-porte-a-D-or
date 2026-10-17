import { Router } from "express"
import { z } from "zod"
import { one, all, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { id } from "../lib/security.js"
import { isValidDateString, isValidTimeString, nowIso } from "../lib/time.js"

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

function listParticipants(eventId: string): EventParticipantRow[] {
  return all<EventParticipantRow>(
    `SELECT ep.member_id, ep.role, ep.added_at, m.full_name, m.member_no, m.group_id, g.name AS group_name
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
  const p = pagination(req)
  const typeFilter = queryString(req, "type")
  const groupFilter = queryString(req, "groupId")
  const from = queryString(req, "from")
  const to = queryString(req, "to")
  const statusFilter = queryString(req, "status")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (typeFilter) { clauses.push("e.event_type = ?"); params.push(typeFilter) }
  if (groupFilter) { clauses.push("e.target_group_id = ?"); params.push(groupFilter) }
  if (from) { clauses.push("e.date >= ?"); params.push(from) }
  if (to) { clauses.push("e.date <= ?"); params.push(to) }
  if (statusFilter) { clauses.push("e.status = ?"); params.push(statusFilter) }
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
  const eventId = id()
  const timestamp = nowIso()
  run(
    `INSERT INTO events (id, name, event_type, date, start_time, end_time, location, location_id, description,
                         target_group_id, status, report, is_public, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId, input.name, input.eventType, input.date, input.startTime ?? null, input.endTime ?? null,
    input.location ?? null, input.locationId ?? null, input.description ?? null,
    input.targetGroupId ?? null, input.status ?? "planned", input.report ?? null,
    input.isPublic ? 1 : 0, req.auth!.id, timestamp, timestamp,
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.create", entityType: "event", entityId: eventId,
    summary: `Event "${input.name}" created for ${input.date}`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.status(201).json({ event: getEvent(eventId) })
})

eventsRouter.get("/:id", requireAuth, requirePermission("events.read"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  res.json({ event, participants: listParticipants(event.id), songs: listSongs(event.id) })
})

eventsRouter.patch("/:id", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
  const input = parse(eventSchema.partial(), req.body)

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
  if (fields.length === 0) throw badRequest("No changes were provided.")

  fields.push("updated_at = ?")
  params.push(nowIso())
  run(`UPDATE events SET ${fields.join(", ")} WHERE id = ?`, ...params, event.id)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "event.update", entityType: "event", entityId: event.id,
    summary: `Event "${event.name}" updated`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ event: getEvent(event.id) })
})

eventsRouter.delete("/:id", requireAuth, requirePermission("events.write"), (req, res) => {
  const event = getEvent(String(req.params.id))
  if (!event) throw notFound("That event does not exist.")
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
