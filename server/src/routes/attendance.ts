import { Router } from "express"
import { z } from "zod"
import { can, groupScope, type AuthUser } from "../auth/access.js"
import { all, one, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { id } from "../lib/security.js"
import { isValidDateString, nowIso } from "../lib/time.js"
import { assertGroupAccess, permittedGroupIds, requireAuth, requirePermission } from "../middleware/auth.js"
import { notifyMany } from "../services/notifications.js"

export const attendanceRouter: Router = Router()

const ACTIVITY_TYPES = ["rehearsal", "performance", "church_service", "meeting", "training", "concert", "other"] as const
const ATTENDANCE_STATUSES = ["present", "late", "absent", "excused"] as const
const GROUP_IDS = ["grp_senior", "grp_junior", "grp_members"] as const

interface SessionRow {
  id: string
  title: string
  activity_type: string
  date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  location_id: string | null
  target_group_id: string | null
  recorder_id: string | null
  notes: string | null
  event_id: string | null
  created_at: string
  updated_at: string
}

interface SessionListRow extends SessionRow {
  target_group_key: string | null
  target_group_name: string | null
  marked_count: number
}

interface ParticipantRow {
  member_id: string
  full_name: string
  member_no: string
  group_key: string
  status: string | null
  notes: string | null
}

function getSession(sessionId: string): SessionRow | undefined {
  return one<SessionRow>("SELECT * FROM attendance_sessions WHERE id = ?", sessionId)
}

/** A user may reach a group when they hold `key` globally or at that group's scope. */
function canReachGroup(user: AuthUser, key: string, groupId: string | null): boolean {
  if (can(user, key, "global")) return true
  const scope = groupScope(groupId)
  return Boolean(scope && can(user, key, scope))
}

/** Plain words for a status, used in the message a member receives. */
const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
}

/**
 * Tells each member how they were marked, so the mark reaches them instead of
 * waiting to be discovered. Sends at most one message per member — a roll-call
 * that corrects the same person twice in one save must not notify twice.
 *
 * A member with no sign-in account is skipped: there is nowhere to deliver it.
 */
function notifyMembersOfAttendance(
  marks: { memberId: string; status: string }[],
  session: { title: string; date: string },
): void {
  const seen = new Set<string>()
  const messages = []
  for (const mark of marks) {
    if (seen.has(mark.memberId)) continue
    seen.add(mark.memberId)
    const account = one<{ id: string }>("SELECT user_id AS id FROM members WHERE user_id IS NOT NULL AND id = ?", mark.memberId)
    if (!account?.id) continue
    messages.push({
      userId: account.id,
      type: "attendance",
      title: "Attendance marked",
      body: `${session.title} (${session.date}) — ${STATUS_LABELS[mark.status] ?? mark.status}.`,
      link: "/app/attendance",
    })
  }
  notifyMany(messages)
}

/**
 * Group-scoped writes are checked against the session's target group. A session with no
 * target group is organisation-wide and therefore requires global scope.
 */
function assertSessionAccess(user: AuthUser, session: SessionRow, key: "attendance.read" | "attendance.write"): void {
  if (session.target_group_id) {
    assertGroupAccess(user, key, session.target_group_id)
    return
  }
  if (!can(user, key, "global")) throw forbidden("Organisation-wide sessions require organisation-wide access.")
}

/** Read access for a single session, allowing an `own` holder to see sessions they appear in. */
function canReadSession(user: AuthUser, session: SessionRow): boolean {
  if (session.target_group_id) return canReachGroup(user, "attendance.read", session.target_group_id)
  if (can(user, "attendance.read", "global")) return true
  if (can(user, "attendance.read", "own") && user.memberId) {
    const row = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM attendance_records WHERE session_id = ? AND member_id = ?",
      session.id, user.memberId,
    )
    return (row?.c ?? 0) > 0
  }
  return false
}

function sessionDto(row: SessionRow | SessionListRow) {
  const listRow = row as Partial<SessionListRow>
  return {
    id: row.id,
    title: row.title,
    activityType: row.activity_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    locationId: row.location_id,
    targetGroupId: row.target_group_id,
    targetGroupKey: listRow.target_group_key ?? null,
    targetGroupName: listRow.target_group_name ?? null,
    markedCount: listRow.marked_count ?? null,
    recorderId: row.recorder_id,
    notes: row.notes,
    eventId: row.event_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readSetting(key: string, fallback: string): string {
  const row = one<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", key)
  return row?.value ?? fallback
}

attendanceRouter.get("/activity-types", requireAuth, (_req, res) => {
  res.json({ activityTypes: ACTIVITY_TYPES })
})

attendanceRouter.get("/sessions", requireAuth, requirePermission("attendance.read"), (req, res) => {
  const p = pagination(req)
  const activityType = queryString(req, "activityType")
  const groupFilter = queryString(req, "groupId")
  const from = queryString(req, "from")
  const to = queryString(req, "to")

  const clauses: string[] = []
  const params: (string | number)[] = []

  const readable = permittedGroupIds(req.auth!, "attendance.read")
  if (readable === "all") {
    // organisation-wide reader
  } else if (readable.length > 0) {
    clauses.push(`s.target_group_id IN (${readable.map(() => "?").join(",")})`)
    params.push(...readable)
  } else if (can(req.auth!, "attendance.read", "own") && req.auth!.memberId) {
    clauses.push("EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.session_id = s.id AND ar.member_id = ?)")
    params.push(req.auth!.memberId)
  } else {
    clauses.push("0 = 1")
  }

  if (activityType) {
    if (!ACTIVITY_TYPES.includes(activityType as (typeof ACTIVITY_TYPES)[number])) throw badRequest("Unknown activity type.")
    clauses.push("s.activity_type = ?")
    params.push(activityType)
  }
  if (groupFilter) {
    if (readable !== "all" && !readable.includes(groupFilter)) throw forbidden()
    clauses.push("s.target_group_id = ?")
    params.push(groupFilter)
  }
  if (from) {
    clauses.push("s.date >= ?")
    params.push(from)
  }
  if (to) {
    clauses.push("s.date <= ?")
    params.push(to)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM attendance_sessions s ${where}`, ...params)?.c ?? 0
  const items = all<SessionListRow>(
    `SELECT s.*, g.key AS target_group_key, g.name AS target_group_name,
            (SELECT COUNT(*) FROM attendance_records r WHERE r.session_id = s.id) AS marked_count
       FROM attendance_sessions s
       LEFT JOIN groups g ON g.id = s.target_group_id
       ${where}
       ORDER BY s.date DESC, s.start_time DESC, s.created_at DESC
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items.map(sessionDto), total, p))
})

const sessionInputSchema = z.object({
  title: z.string().trim().min(2, "Enter a session title.").max(200),
  activityType: z.enum(ACTIVITY_TYPES),
  date: z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD)."),
  startTime: z.string().trim().max(8).nullable().optional(),
  endTime: z.string().trim().max(8).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  locationId: z.string().trim().max(80).nullable().optional(),
  targetGroupId: z.enum(GROUP_IDS).nullable().optional(),
  eventId: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
})

const sessionPatchSchema = sessionInputSchema.partial()

/**
 * Ensures a session attached to an event points at a real event, and that the
 * chosen group is one the event was actually addressed to.
 *
 * An event already knows who it is for: `event_audiences` lists the groups it was
 * sent to (no rows means the whole choir), with `events.target_group_id` as the
 * older single-group form. Letting a session pick a group the event does not reach
 * would produce a roll-call of people who were never invited, and the mismatch
 * would only surface later as "why is this member missing?".
 *
 * Returns the event's name and its audience, so the caller can use both.
 */
function assertEventForSession(
  eventId: string,
  targetGroupId: string | null,
): { name: string; groupIds: string[] } {
  const event = one<{ id: string; name: string; target_group_id: string | null }>(
    "SELECT id, name, target_group_id FROM events WHERE id = ?",
    eventId,
  )
  if (!event) throw notFound("That event does not exist.")

  const audienceRows = all<{ group_id: string }>(
    "SELECT group_id FROM event_audiences WHERE event_id = ?",
    eventId,
  )
  let groupIds = audienceRows.map((row) => row.group_id)
  // No audience rows means the whole choir; the single-group column is a fallback
  // so events created before audiences existed still scope correctly.
  if (groupIds.length === 0 && event.target_group_id) groupIds = [event.target_group_id]

  // An event addressing specific groups must not take a roll-call for a group it
  // never invited. A whole-choir event (no group list) reaches everyone.
  if (targetGroupId && groupIds.length > 0 && !groupIds.includes(targetGroupId)) {
    throw badRequest("This event was not addressed to that group. Choose a group the event is for.")
  }
  return { name: event.name, groupIds }
}

attendanceRouter.post("/sessions", requireAuth, requirePermission("attendance.write"), (req, res) => {
  const input = parse(sessionInputSchema, req.body)
  if (input.targetGroupId) {
    assertGroupAccess(req.auth!, "attendance.write", input.targetGroupId)
  } else if (!can(req.auth!, "attendance.write", "global")) {
    throw forbidden("Organisation-wide sessions require organisation-wide access.")
  }

  const eventId = input.eventId || null
  let eventName: string | null = null
  if (eventId) {
    eventName = assertEventForSession(eventId, input.targetGroupId ?? null).name
    // One roll-call per event: reusing the event must reuse its existing session.
    const existing = one<{ id: string }>(
      "SELECT id FROM attendance_sessions WHERE event_id = ?",
      eventId,
    )
    if (existing) {
      throw badRequest(`"${eventName}" already has a roll-call. Open it instead of creating a second one.`)
    }
  }

  const timestamp = nowIso()
  const sessionId = id()
  run(
    `INSERT INTO attendance_sessions (id, title, activity_type, date, start_time, end_time, location, location_id,
                                      target_group_id, recorder_id, notes, event_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId, input.title, input.activityType, input.date, input.startTime ?? null, input.endTime ?? null,
    input.location ?? null, input.locationId ?? null, input.targetGroupId ?? null, req.auth!.id,
    input.notes ?? null, eventId, timestamp, timestamp,
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "attendance.session_create", entityType: "attendance_session", entityId: sessionId,
    summary: `Attendance session "${input.title}" (${input.activityType}) created for ${input.targetGroupId ?? "the whole choir"}${eventName ? ` for event "${eventName}"` : ""}`,
    detail: { date: input.date, targetGroupId: input.targetGroupId ?? null, eventId }, ip: req.ip,
  })
  res.status(201).json({ session: sessionDto(getSession(sessionId)!) })
})

attendanceRouter.get("/sessions/:id", requireAuth, requirePermission("attendance.read"), (req, res) => {
  const session = getSession(String(req.params.id))
  if (!session) throw notFound("That attendance session does not exist.")
  if (!canReadSession(req.auth!, session)) throw forbidden()

  const participants = session.target_group_id
    ? all<ParticipantRow>(
        `SELECT m.id AS member_id, m.full_name, m.member_no, g.key AS group_key, r.status, r.notes
           FROM members m
           JOIN groups g ON g.id = m.group_id
           LEFT JOIN attendance_records r ON r.session_id = ? AND r.member_id = m.id
          WHERE m.group_id = ? AND m.status = 'active'
          ORDER BY m.full_name COLLATE NOCASE`,
        session.id, session.target_group_id,
      )
    : all<ParticipantRow>(
        `SELECT m.id AS member_id, m.full_name, m.member_no, g.key AS group_key, r.status, r.notes
           FROM attendance_records r
           JOIN members m ON m.id = r.member_id
           JOIN groups g ON g.id = m.group_id
          WHERE r.session_id = ?
          ORDER BY m.full_name COLLATE NOCASE`,
        session.id,
      )

  const canSeeEveryone = session.target_group_id
    ? canReachGroup(req.auth!, "attendance.read", session.target_group_id)
    : can(req.auth!, "attendance.read", "global")
  const visible = canSeeEveryone || !req.auth!.memberId
    ? participants
    : participants.filter((row) => row.member_id === req.auth!.memberId)

  res.json({
    session: sessionDto(session),
    participants: visible.map((row) => ({
      memberId: row.member_id,
      fullName: row.full_name,
      memberNo: row.member_no,
      groupKey: row.group_key,
      status: row.status ?? "unmarked",
      notes: row.notes ?? null,
    })),
  })
})

attendanceRouter.patch("/sessions/:id", requireAuth, requirePermission("attendance.write"), (req, res) => {
  const session = getSession(String(req.params.id))
  if (!session) throw notFound("That attendance session does not exist.")
  assertSessionAccess(req.auth!, session, "attendance.write")

  const input = parse(sessionPatchSchema, req.body)
  if (input.targetGroupId !== undefined) {
    if (input.targetGroupId) {
      assertGroupAccess(req.auth!, "attendance.write", input.targetGroupId)
    } else if (!can(req.auth!, "attendance.write", "global")) {
      throw forbidden("Organisation-wide sessions require organisation-wide access.")
    }
  }

  const fields: string[] = []
  const params: (string | number | null)[] = []
  if (input.title !== undefined) { fields.push("title = ?"); params.push(input.title) }
  if (input.activityType !== undefined) { fields.push("activity_type = ?"); params.push(input.activityType) }
  if (input.date !== undefined) { fields.push("date = ?"); params.push(input.date) }
  if (input.startTime !== undefined) { fields.push("start_time = ?"); params.push(input.startTime ?? null) }
  if (input.endTime !== undefined) { fields.push("end_time = ?"); params.push(input.endTime ?? null) }
  if (input.location !== undefined) { fields.push("location = ?"); params.push(input.location ?? null) }
  if (input.locationId !== undefined) { fields.push("location_id = ?"); params.push(input.locationId ?? null) }
  if (input.targetGroupId !== undefined) { fields.push("target_group_id = ?"); params.push(input.targetGroupId) }
  if (input.notes !== undefined) { fields.push("notes = ?"); params.push(input.notes ?? null) }
  if (input.eventId !== undefined) {
    const nextEventId = input.eventId || null
    if (nextEventId) {
      assertEventForSession(nextEventId, (input.targetGroupId ?? session.target_group_id) || null)
      const clash = one<{ id: string }>(
        "SELECT id FROM attendance_sessions WHERE event_id = ? AND id <> ?",
        nextEventId, session.id,
      )
      if (clash) throw badRequest("That event already has a roll-call. Open it instead.")
    }
    fields.push("event_id = ?")
    params.push(nextEventId)
  }
  if (fields.length === 0) throw badRequest("Provide at least one field to update.")

  fields.push("updated_at = ?")
  params.push(nowIso())
  run(`UPDATE attendance_sessions SET ${fields.join(", ")} WHERE id = ?`, ...params, session.id)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "attendance.session_update", entityType: "attendance_session", entityId: session.id,
    summary: `Attendance session "${session.title}" updated`,
    detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ session: sessionDto(getSession(session.id)!) })
})

attendanceRouter.delete("/sessions/:id", requireAuth, requirePermission("attendance.write"), (req, res) => {
  const session = getSession(String(req.params.id))
  if (!session) throw notFound("That attendance session does not exist.")
  assertSessionAccess(req.auth!, session, "attendance.write")

  run("DELETE FROM attendance_sessions WHERE id = ?", session.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "attendance.session_delete", entityType: "attendance_session", entityId: session.id,
    summary: `Attendance session "${session.title}" deleted`, ip: req.ip,
  })
  res.json({ ok: true })
})

const recordEntrySchema = z.object({
  memberId: z.string().trim().min(1, "Choose a member."),
  status: z.enum(ATTENDANCE_STATUSES),
  notes: z.string().trim().max(1000).nullable().optional(),
})

const recordsSchema = z.object({
  records: z.array(recordEntrySchema).max(500),
})

attendanceRouter.put("/sessions/:id/records", requireAuth, requirePermission("attendance.write"), (req, res) => {
  const session = getSession(String(req.params.id))
  if (!session) throw notFound("That attendance session does not exist.")
  assertSessionAccess(req.auth!, session, "attendance.write")
  const input = parse(recordsSchema, req.body)

  const timestamp = nowIso()
  let changed = 0

  transaction(() => {
    const existing = new Map<string, { status: string; notes: string | null }>()
    for (const row of all<{ member_id: string; status: string; notes: string | null }>(
      "SELECT member_id, status, notes FROM attendance_records WHERE session_id = ?", session.id,
    )) {
      existing.set(row.member_id, { status: row.status, notes: row.notes })
    }

    for (const entry of input.records) {
      const member = one<{ id: string; group_id: string }>(
        "SELECT id, group_id FROM members WHERE id = ?", entry.memberId,
      )
      if (!member) throw badRequest(`Member ${entry.memberId} does not exist.`)
      if (session.target_group_id && member.group_id !== session.target_group_id) {
        throw badRequest("A member does not belong to this session's target group.")
      }

      const prior = existing.get(entry.memberId)
      const notes = entry.notes ?? null
      if (!prior || prior.status !== entry.status || prior.notes !== notes) changed += 1
      existing.set(entry.memberId, { status: entry.status, notes })

      run(
        `INSERT INTO attendance_records (id, session_id, member_id, status, notes, recorded_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, member_id) DO UPDATE SET
           status = excluded.status,
           notes = excluded.notes,
           recorded_by = excluded.recorded_by,
           updated_at = excluded.updated_at`,
        id(), session.id, entry.memberId, entry.status, notes, req.auth!.id, timestamp, timestamp,
      )
    }
  })

  // Tell each marked member, so they see the mark on their own attendance page
  // rather than having to ask. The same call mirrors it onto their devices.
  const marked = input.records.map((entry) => ({
    memberId: entry.memberId,
    status: entry.status,
  }))
  notifyMembersOfAttendance(marked, session)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "attendance.records_update", entityType: "attendance_session", entityId: session.id,
    summary: `Attendance for "${session.title}" recorded: ${changed} of ${input.records.length} record(s) changed`,
    detail: { submitted: input.records.length, changed }, ip: req.ip,
  })
  res.json({ ok: true, changed, total: input.records.length })
})

/*
 * Attendance rate formula
 * -----------------------
 * Only records joined to sessions in the requested window are counted.
 *
 *   sessions    = COUNT(DISTINCT session_id)
 *   present     = records with status 'present'
 *   late        = records with status 'late'
 *   absent      = records with status 'absent'
 *   excused     = records with status 'excused'
 *   marked      = present + late + absent + excused
 *
 *   numerator   = present + (late_policy === 'counts_as_present' ? late : 0)
 *   denominator = marked - (excused_policy === 'excluded_from_denominator' ? excused : 0)
 *   rate        = denominator === 0 ? null : round(numerator / denominator * 100, 1)
 *
 * A late member was still expected to attend, so 'late' always stays in the denominator;
 * the policy only decides whether it counts towards the numerator. Excused records leave
 * the denominator when the policy excludes them. When there are no sessions the rate is
 * null (never 0 or NaN) and a note explains why.
 */
attendanceRouter.get("/summary", requireAuth, requirePermission("attendance.read"), (req, res) => {
  const from = queryString(req, "from")
  const to = queryString(req, "to")
  const memberFilter = queryString(req, "memberId")
  const groupFilter = queryString(req, "groupId")

  const clauses: string[] = []
  const params: (string | number)[] = []

  const readable = permittedGroupIds(req.auth!, "attendance.read")
  if (readable === "all") {
    // organisation-wide reader
  } else if (readable.length > 0) {
    clauses.push(`s.target_group_id IN (${readable.map(() => "?").join(",")})`)
    params.push(...readable)
  } else if (can(req.auth!, "attendance.read", "own") && req.auth!.memberId) {
    clauses.push("r.member_id = ?")
    params.push(req.auth!.memberId)
  } else {
    clauses.push("0 = 1")
  }

  if (groupFilter) {
    if (readable !== "all" && !readable.includes(groupFilter)) throw forbidden()
    clauses.push("s.target_group_id = ?")
    params.push(groupFilter)
  }
  if (memberFilter) {
    if (readable !== "all") {
      const member = one<{ group_id: string }>("SELECT group_id FROM members WHERE id = ?", memberFilter)
      if (!member) throw notFound("That member does not exist.")
      if (readable.length > 0) {
        if (!readable.includes(member.group_id)) throw forbidden()
      } else if (req.auth!.memberId !== memberFilter) {
        throw forbidden()
      }
    }
    clauses.push("r.member_id = ?")
    params.push(memberFilter)
  }
  if (from) {
    clauses.push("s.date >= ?")
    params.push(from)
  }
  if (to) {
    clauses.push("s.date <= ?")
    params.push(to)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const row = one<{
    sessions: number
    marked: number
    present: number
    late: number
    absent: number
    excused: number
  }>(
    `SELECT COUNT(DISTINCT s.id) AS sessions,
            COUNT(*) AS marked,
            COALESCE(SUM(CASE WHEN r.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
            COALESCE(SUM(CASE WHEN r.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
            COALESCE(SUM(CASE WHEN r.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
            COALESCE(SUM(CASE WHEN r.status = 'excused' THEN 1 ELSE 0 END), 0) AS excused
       FROM attendance_records r
       JOIN attendance_sessions s ON s.id = r.session_id
       ${where}`,
    ...params,
  )

  const latePolicy = readSetting("attendance.late_policy", "counts_as_present")
  const excusedPolicy = readSetting("attendance.excused_policy", "excluded_from_denominator")

  const sessions = row?.sessions ?? 0
  const marked = row?.marked ?? 0
  const present = row?.present ?? 0
  const late = row?.late ?? 0
  const absent = row?.absent ?? 0
  const excused = row?.excused ?? 0

  const numerator = present + (latePolicy === "counts_as_present" ? late : 0)
  const denominator = marked - (excusedPolicy === "excluded_from_denominator" ? excused : 0)

  let rate: number | null = null
  let note: string | null = null
  if (sessions === 0) {
    note = "No attendance sessions were found for the selected period, so no attendance rate can be calculated."
  } else if (denominator === 0) {
    note = "Every marked attendance was excused under the current policy, so no attendance rate can be calculated."
  } else {
    rate = Math.round((numerator / denominator) * 1000) / 10
  }

  res.json({
    sessions,
    present,
    late,
    absent,
    excused,
    marked,
    denominator,
    rate,
    policy: { late: latePolicy, excused: excusedPolicy },
    note,
  })
})
