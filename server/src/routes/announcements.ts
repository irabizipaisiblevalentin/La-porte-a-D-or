import { Router } from "express"
import { z } from "zod"
import { can, GROUP_KEY_BY_ID, type AuthUser } from "../auth/access.js"
import { one, all, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { audienceUserIds, notifyMany } from "../services/notifications.js"

export const announcementsRouter: Router = Router()

const createAnnouncementSchema = z.object({
  title: z.string().trim().min(2, "Enter a title.").max(200),
  message: z.string().trim().min(1, "Enter the message.").max(10000),
  audience: z.enum(["all", "senior", "junior", "members", "selected"]),
  priority: z.enum(["normal", "important", "urgent"]).optional(),
  scheduledAt: z.string().trim().nullable().optional(),
  recipientIds: z.array(z.string().trim().min(1)).max(5000).optional(),
})

const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(2, "Enter a title.").max(200).optional(),
  message: z.string().trim().min(1, "Enter the message.").max(10000).optional(),
  audience: z.enum(["all", "senior", "junior", "members", "selected"]).optional(),
  priority: z.enum(["normal", "important", "urgent"]).optional(),
  scheduledAt: z.string().trim().nullable().optional(),
  recipientIds: z.array(z.string().trim().min(1)).max(5000).optional(),
})

interface AnnouncementRow {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  status: string
  scheduled_at: string | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  created_by_name: string | null
  recipient_count: number
}

interface AnnouncementRecipientRow {
  user_id: string
  display_name: string
  email: string
}

interface AnnouncementTemplate {
  key: string
  title: string
  message: string
}

const TEMPLATES: AnnouncementTemplate[] = [
  {
    key: "vacation",
    title: "Choir vacation",
    message: "Dear choristers, the choir will be on vacation from <start date> to <end date>. Rehearsals resume on <resume date>. Enjoy your rest.",
  },
  {
    key: "rehearsal_reminder",
    title: "Rehearsal reminder",
    message: "Reminder: rehearsal holds on <date> at <time> in <venue>. Please arrive on time with your sheet music.",
  },
  {
    key: "event_notice",
    title: "Upcoming event",
    message: "We will be ministering at <event name> on <date> at <time>. Venue: <venue>. Attendance is <required/optional>. Kindly confirm availability.",
  },
  {
    key: "new_song",
    title: "New song added",
    message: "A new song, \"<song title>\", has been added to the library. Please listen to the practice track and begin learning your part before the next rehearsal.",
  },
  {
    key: "training",
    title: "Training session",
    message: "A training session on <topic> has been scheduled for <date> at <time>. Trainer: <name>. All selected members are expected to attend.",
  },
  {
    key: "goal_update",
    title: "Goal update",
    message: "Update on our goal \"<goal name>\": we have reached <current> of <target> <unit>. Thank you for your commitment — let us keep pressing on.",
  },
]

function getAnnouncement(announcementId: string): AnnouncementRow | undefined {
  return one<AnnouncementRow>(
    `SELECT a.*, u.display_name AS created_by_name,
            (SELECT COUNT(*) FROM announcement_recipients r WHERE r.announcement_id = a.id) AS recipient_count
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.id = ?`,
    announcementId,
  )
}

function listRecipients(announcementId: string): AnnouncementRecipientRow[] {
  return all<AnnouncementRecipientRow>(
    `SELECT r.user_id, u.display_name, u.email
       FROM announcement_recipients r
       JOIN users u ON u.id = r.user_id
      WHERE r.announcement_id = ?
      ORDER BY u.display_name COLLATE NOCASE`,
    announcementId,
  )
}

/** True when the viewer may see an announcement: writers see all, others only published ones addressed to them. */
function canViewAnnouncement(user: AuthUser, announcement: AnnouncementRow): boolean {
  if (can(user, "announcements.write")) return true
  if (announcement.status !== "published") return false
  if (announcement.audience === "all") return true
  const groupKey = user.groupId ? GROUP_KEY_BY_ID[user.groupId] : undefined
  if (groupKey && announcement.audience === groupKey) return true
  if (announcement.audience === "selected") {
    const row = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM announcement_recipients WHERE announcement_id = ? AND user_id = ?",
      announcement.id, user.id,
    )
    return (row?.c ?? 0) > 0
  }
  return false
}

/** Resolves a `scheduledAt` input to a status + stored timestamp. Returns null when unscheduled. */
function resolveSchedule(value: string | null | undefined): { scheduledAt: string | null; status: "draft" | "scheduled" } {
  if (!value) return { scheduledAt: null, status: "draft" }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw badRequest("Enter a valid schedule date and time.", { fields: { scheduledAt: "Enter a valid date and time." } })
  }
  if (parsed > Date.now()) return { scheduledAt: new Date(parsed).toISOString(), status: "scheduled" }
  return { scheduledAt: null, status: "draft" }
}

function assertRecipientsExist(userIds: string[]): void {
  if (userIds.length === 0) return
  const found = all<{ id: string }>(
    `SELECT id FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
    ...userIds,
  )
  if (found.length === userIds.length) return
  const known = new Set(found.map((row) => row.id))
  const missing = userIds.filter((userId) => !known.has(userId))
  throw badRequest("Some selected recipients do not exist.", {
    fields: { recipientIds: `Unknown user id(s): ${missing.join(", ")}` },
  })
}

announcementsRouter.get("/templates", requireAuth, requirePermission("announcements.read"), (_req, res) => {
  res.json({ templates: TEMPLATES })
})

announcementsRouter.get("/", requireAuth, requirePermission("announcements.read"), (req, res) => {
  const p = pagination(req)
  const audienceFilter = queryString(req, "audience")
  const priorityFilter = queryString(req, "priority")
  const statusFilter = queryString(req, "status")
  const isWriter = can(req.auth!, "announcements.write")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (isWriter) {
    if (statusFilter) { clauses.push("a.status = ?"); params.push(statusFilter) }
  } else {
    // Non-writers only see published announcements addressed to them.
    clauses.push("a.status = 'published'")
    const groupKey = req.auth!.groupId ? GROUP_KEY_BY_ID[req.auth!.groupId] : undefined
    if (groupKey) {
      clauses.push(
        "(a.audience = 'all' OR a.audience = ? OR (a.audience = 'selected' AND EXISTS " +
        "(SELECT 1 FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.user_id = ?)))",
      )
      params.push(groupKey, req.auth!.id)
    } else {
      clauses.push(
        "(a.audience = 'all' OR (a.audience = 'selected' AND EXISTS " +
        "(SELECT 1 FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.user_id = ?)))",
      )
      params.push(req.auth!.id)
    }
  }
  if (audienceFilter) { clauses.push("a.audience = ?"); params.push(audienceFilter) }
  if (priorityFilter) { clauses.push("a.priority = ?"); params.push(priorityFilter) }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM announcements a ${where}`, ...params)?.c ?? 0
  const rows = all<AnnouncementRow>(
    `SELECT a.*, u.display_name AS created_by_name,
            (SELECT COUNT(*) FROM announcement_recipients r WHERE r.announcement_id = a.id) AS recipient_count
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
       ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )

  const readSet = new Set<string>()
  if (rows.length > 0) {
    const ids = rows.map((row) => row.id)
    const readRows = all<{ announcement_id: string }>(
      `SELECT announcement_id FROM announcement_reads
        WHERE user_id = ? AND announcement_id IN (${ids.map(() => "?").join(",")})`,
      req.auth!.id, ...ids,
    )
    for (const row of readRows) readSet.add(row.announcement_id)
  }
  const items = rows.map((row) => ({ ...row, read: readSet.has(row.id) }))

  res.json(makePage(items, total, p))
})

announcementsRouter.post("/", requireAuth, requirePermission("announcements.write"), (req, res) => {
  const input = parse(createAnnouncementSchema, req.body)
  const priority = input.priority ?? "normal"
  const schedule = resolveSchedule(input.scheduledAt)

  let recipientIds: string[] = []
  if (input.audience === "selected") {
    recipientIds = Array.from(new Set(input.recipientIds ?? []))
    if (recipientIds.length === 0) {
      throw badRequest("Select at least one recipient.", { fields: { recipientIds: "Select at least one recipient." } })
    }
    assertRecipientsExist(recipientIds)
  }

  const announcementId = id()
  const timestamp = nowIso()
  transaction(() => {
    run(
      `INSERT INTO announcements (id, title, message, audience, priority, status, scheduled_at, published_at,
                                  created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      announcementId, input.title, input.message, input.audience, priority, schedule.status,
      schedule.scheduledAt, req.auth!.id, timestamp, timestamp,
    )
    for (const userId of recipientIds) {
      run(
        "INSERT INTO announcement_recipients (announcement_id, user_id, added_at) VALUES (?, ?, ?)",
        announcementId, userId, timestamp,
      )
    }
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "announcement.create", entityType: "announcement", entityId: announcementId,
    summary: `Announcement "${input.title}" ${schedule.status} (${input.audience})`,
    detail: { audience: input.audience, priority, status: schedule.status }, ip: req.ip,
  })
  res.status(201).json({ announcement: getAnnouncement(announcementId), recipients: listRecipients(announcementId) })
})

announcementsRouter.get("/:id", requireAuth, requirePermission("announcements.read"), (req, res) => {
  const announcement = getAnnouncement(String(req.params.id))
  if (!announcement) throw notFound("That announcement does not exist.")
  if (!canViewAnnouncement(req.auth!, announcement)) throw forbidden("That announcement is not addressed to you.")
  res.json({ announcement, recipients: listRecipients(announcement.id) })
})

announcementsRouter.patch("/:id", requireAuth, requirePermission("announcements.write"), (req, res) => {
  const announcement = getAnnouncement(String(req.params.id))
  if (!announcement) throw notFound("That announcement does not exist.")
  const input = parse(updateAnnouncementSchema, req.body)

  const fields: string[] = []
  const params: (string | number | null)[] = []
  if (input.title !== undefined) { fields.push("title = ?"); params.push(input.title) }
  if (input.message !== undefined) { fields.push("message = ?"); params.push(input.message) }
  if (input.priority !== undefined) { fields.push("priority = ?"); params.push(input.priority) }

  let recipientIds: string[] | undefined
  if (input.audience !== undefined) {
    fields.push("audience = ?")
    params.push(input.audience)
    if (input.audience === "selected") {
      recipientIds = input.recipientIds !== undefined
        ? Array.from(new Set(input.recipientIds))
        : all<{ user_id: string }>("SELECT user_id FROM announcement_recipients WHERE announcement_id = ?", announcement.id).map((row) => row.user_id)
      if (recipientIds.length === 0) {
        throw badRequest("Select at least one recipient.", { fields: { recipientIds: "Select at least one recipient." } })
      }
    } else {
      recipientIds = []
    }
  } else if (input.recipientIds !== undefined && announcement.audience === "selected") {
    recipientIds = Array.from(new Set(input.recipientIds))
    if (recipientIds.length === 0) {
      throw badRequest("Select at least one recipient.", { fields: { recipientIds: "Select at least one recipient." } })
    }
  }
  if (recipientIds !== undefined && recipientIds.length > 0) assertRecipientsExist(recipientIds)

  // Scheduling may only be changed while the announcement has not been published.
  if (input.scheduledAt !== undefined && (announcement.status === "draft" || announcement.status === "scheduled")) {
    const schedule = resolveSchedule(input.scheduledAt)
    fields.push("scheduled_at = ?")
    params.push(schedule.scheduledAt)
    fields.push("status = ?")
    params.push(schedule.status)
  }

  if (fields.length === 0 && recipientIds === undefined) throw badRequest("No changes were provided.")
  fields.push("updated_at = ?")
  params.push(nowIso())

  transaction(() => {
    run(`UPDATE announcements SET ${fields.join(", ")} WHERE id = ?`, ...params, announcement.id)
    if (recipientIds !== undefined) {
      run("DELETE FROM announcement_recipients WHERE announcement_id = ?", announcement.id)
      const timestamp = nowIso()
      for (const userId of recipientIds) {
        run(
          "INSERT OR IGNORE INTO announcement_recipients (announcement_id, user_id, added_at) VALUES (?, ?, ?)",
          announcement.id, userId, timestamp,
        )
      }
    }
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "announcement.update", entityType: "announcement", entityId: announcement.id,
    summary: `Announcement "${announcement.title}" updated`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ announcement: getAnnouncement(announcement.id), recipients: listRecipients(announcement.id) })
})

announcementsRouter.post("/:id/publish", requireAuth, requirePermission("announcements.write"), (req, res) => {
  const announcement = getAnnouncement(String(req.params.id))
  if (!announcement) throw notFound("That announcement does not exist.")
  if (announcement.status === "published") throw conflict("This announcement has already been published.")
  if (announcement.status === "archived") throw conflict("An archived announcement cannot be published.")

  const recipients = announcement.audience === "selected"
    ? all<{ user_id: string }>("SELECT user_id FROM announcement_recipients WHERE announcement_id = ?", announcement.id).map((row) => row.user_id)
    : audienceUserIds(announcement.audience)

  const timestamp = nowIso()
  run(
    "UPDATE announcements SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?",
    timestamp, timestamp, announcement.id,
  )
  notifyMany(recipients.map((userId) => ({
    userId,
    type: "announcement",
    title: announcement.title,
    body: announcement.message.slice(0, 240),
    link: `/announcements/${announcement.id}`,
  })))

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "announcement.publish", entityType: "announcement", entityId: announcement.id,
    summary: `Announcement "${announcement.title}" published to ${recipients.length} recipient(s)`, ip: req.ip,
  })
  res.json({ announcement: getAnnouncement(announcement.id) })
})

announcementsRouter.post("/:id/read", requireAuth, requirePermission("announcements.read"), (req, res) => {
  const announcement = getAnnouncement(String(req.params.id))
  if (!announcement) throw notFound("That announcement does not exist.")
  if (!canViewAnnouncement(req.auth!, announcement)) throw forbidden("That announcement is not addressed to you.")
  run(
    `INSERT INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)
     ON CONFLICT(announcement_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
    announcement.id, req.auth!.id, nowIso(),
  )
  res.json({ ok: true })
})
