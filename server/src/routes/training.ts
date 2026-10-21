import { Router } from "express"
import { z } from "zod"
import { one, all, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { id } from "../lib/security.js"
import { isValidDateString, nowIso } from "../lib/time.js"
import { notifyMany } from "../services/notifications.js"

export const trainingRouter: Router = Router()

const dateString = z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD).")

const trainingSchema = z.object({
  title: z.string().trim().min(2, "Enter the session title.").max(200),
  date: dateString,
  groupId: z.enum(["grp_senior", "grp_junior", "grp_members"]).nullable().optional(),
  trainer: z.string().trim().max(160).nullable().optional(),
  topics: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(["planned", "in_progress", "completed", "cancelled"]).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
})

const participantsSchema = z.object({
  participants: z.array(
    z.object({
      memberId: z.string().trim().min(1),
      attendance: z.enum(["pending", "present", "late", "absent", "excused"]).optional(),
      completed: z.boolean().optional(),
      notes: z.string().trim().max(1000).nullable().optional(),
    }),
  ).max(2000),
})

/** Plain words for a training mark, used in the message a member receives. */
const TRAINING_STATUS_LABELS: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
  pending: "Not yet marked",
}

/**
 * Tells each participant how their training was recorded.
 *
 * A member who is still `pending` and has not completed anything has nothing to
 * hear about, so they are skipped: a message saying "nothing happened" trains
 * people to ignore the next one. Everyone else gets exactly one message.
 */
function notifyTrainingParticipants(
  byMember: Map<string, { attendance: string; completed: number }>,
  training: { title: string; date: string },
): void {
  const messages = []
  for (const [memberId, record] of byMember) {
    if (record.attendance === "pending" && record.completed === 0) continue
    const account = one<{ id: string }>("SELECT user_id AS id FROM members WHERE user_id IS NOT NULL AND id = ?", memberId)
    if (!account?.id) continue
    const outcome =
      record.completed === 1
        ? "Completed"
        : (TRAINING_STATUS_LABELS[record.attendance] ?? "Updated")
    messages.push({
      userId: account.id,
      type: "training",
      title: "Training attendance updated",
      body: `${training.title} (${training.date}) — ${outcome}.`,
      link: "/app/training",
    })
  }
  notifyMany(messages)
}

interface TrainingRow {
  id: string
  title: string
  date: string
  group_id: string | null
  trainer: string | null
  topics: string | null
  status: string
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  group_name: string | null
  participant_count: number
}

interface TrainingParticipantRow {
  member_id: string
  attendance: string
  completed: number
  notes: string | null
  full_name: string
  member_no: string
  group_id: string
  group_name: string
}

function getTraining(trainingId: string): TrainingRow | undefined {
  return one<TrainingRow>(
    `SELECT t.*, g.name AS group_name,
            (SELECT COUNT(*) FROM training_participants tp WHERE tp.training_id = t.id) AS participant_count
       FROM training_sessions t
       LEFT JOIN groups g ON g.id = t.group_id
      WHERE t.id = ?`,
    trainingId,
  )
}

function listParticipants(trainingId: string): TrainingParticipantRow[] {
  return all<TrainingParticipantRow>(
    `SELECT tp.member_id, tp.attendance, tp.completed, tp.notes,
            m.full_name, m.member_no, m.group_id, g.name AS group_name
       FROM training_participants tp
       JOIN members m ON m.id = tp.member_id
       JOIN groups g ON g.id = m.group_id
      WHERE tp.training_id = ?
      ORDER BY m.full_name COLLATE NOCASE`,
    trainingId,
  )
}

/** Validates that every member id exists, throwing a field error naming the unknown ids. */
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
    fields: { participants: `Unknown member id(s): ${missing.join(", ")}` },
  })
}

trainingRouter.get("/", requireAuth, requirePermission("training.read"), (req, res) => {
  const p = pagination(req)
  const groupFilter = queryString(req, "groupId")
  const statusFilter = queryString(req, "status")
  const from = queryString(req, "from")
  const to = queryString(req, "to")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (groupFilter) { clauses.push("t.group_id = ?"); params.push(groupFilter) }
  if (statusFilter) { clauses.push("t.status = ?"); params.push(statusFilter) }
  if (from) { clauses.push("t.date >= ?"); params.push(from) }
  if (to) { clauses.push("t.date <= ?"); params.push(to) }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM training_sessions t ${where}`, ...params)?.c ?? 0
  const items = all<TrainingRow>(
    `SELECT t.*, g.name AS group_name,
            (SELECT COUNT(*) FROM training_participants tp WHERE tp.training_id = t.id) AS participant_count
       FROM training_sessions t
       LEFT JOIN groups g ON g.id = t.group_id
       ${where}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items, total, p))
})

trainingRouter.post("/", requireAuth, requirePermission("training.write"), (req, res) => {
  const input = parse(trainingSchema, req.body)
  const trainingId = id()
  const timestamp = nowIso()
  run(
    `INSERT INTO training_sessions (id, title, date, group_id, trainer, topics, status, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    trainingId, input.title, input.date, input.groupId ?? null, input.trainer ?? null,
    input.topics ?? null, input.status ?? "planned", input.notes ?? null, req.auth!.id, timestamp, timestamp,
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "training.create", entityType: "training", entityId: trainingId,
    summary: `Training session "${input.title}" created for ${input.date}`,
    detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.status(201).json({ training: getTraining(trainingId) })
})

trainingRouter.get("/:id", requireAuth, requirePermission("training.read"), (req, res) => {
  const training = getTraining(String(req.params.id))
  if (!training) throw notFound("That training session does not exist.")
  res.json({ training, participants: listParticipants(training.id) })
})

trainingRouter.patch("/:id", requireAuth, requirePermission("training.write"), (req, res) => {
  const training = getTraining(String(req.params.id))
  if (!training) throw notFound("That training session does not exist.")
  const input = parse(trainingSchema.partial(), req.body)

  const fields: string[] = []
  const params: (string | number | null)[] = []
  if (input.title !== undefined) { fields.push("title = ?"); params.push(input.title) }
  if (input.date !== undefined) { fields.push("date = ?"); params.push(input.date) }
  if (input.groupId !== undefined) { fields.push("group_id = ?"); params.push(input.groupId) }
  if (input.trainer !== undefined) { fields.push("trainer = ?"); params.push(input.trainer) }
  if (input.topics !== undefined) { fields.push("topics = ?"); params.push(input.topics) }
  if (input.status !== undefined) { fields.push("status = ?"); params.push(input.status) }
  if (input.notes !== undefined) { fields.push("notes = ?"); params.push(input.notes) }
  if (fields.length === 0) throw badRequest("No changes were provided.")

  fields.push("updated_at = ?")
  params.push(nowIso())
  run(`UPDATE training_sessions SET ${fields.join(", ")} WHERE id = ?`, ...params, training.id)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "training.update", entityType: "training", entityId: training.id,
    summary: `Training session "${training.title}" updated`,
    detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ training: getTraining(training.id) })
})

trainingRouter.delete("/:id", requireAuth, requirePermission("training.write"), (req, res) => {
  const training = getTraining(String(req.params.id))
  if (!training) throw notFound("That training session does not exist.")
  run("DELETE FROM training_sessions WHERE id = ?", training.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "training.delete", entityType: "training", entityId: training.id,
    summary: `Training session "${training.title}" deleted`, ip: req.ip,
  })
  res.json({ ok: true })
})

trainingRouter.put("/:id/participants", requireAuth, requirePermission("training.write"), (req, res) => {
  const training = getTraining(String(req.params.id))
  if (!training) throw notFound("That training session does not exist.")
  const input = parse(participantsSchema, req.body)

  // A member may only appear once; keep the last entry supplied for each member.
  const byMember = new Map<string, { attendance: string; completed: number; notes: string | null }>()
  for (const participant of input.participants) {
    byMember.set(participant.memberId, {
      attendance: participant.attendance ?? "pending",
      completed: (participant.completed ?? false) ? 1 : 0,
      notes: participant.notes ?? null,
    })
  }
  const memberIds = Array.from(byMember.keys())
  assertMembersExist(memberIds)

  transaction(() => {
    if (memberIds.length === 0) {
      run("DELETE FROM training_participants WHERE training_id = ?", training.id)
    } else {
      run(
        `DELETE FROM training_participants
          WHERE training_id = ? AND member_id NOT IN (${memberIds.map(() => "?").join(",")})`,
        training.id, ...memberIds,
      )
    }
    for (const [memberId, record] of byMember) {
      run(
        `INSERT INTO training_participants (training_id, member_id, attendance, completed, notes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(training_id, member_id) DO UPDATE SET
           attendance = excluded.attendance,
           completed = excluded.completed,
           notes = excluded.notes`,
        training.id, memberId, record.attendance, record.completed, record.notes,
      )
    }
    run("UPDATE training_sessions SET updated_at = ? WHERE id = ?", nowIso(), training.id)
  })

  // Tell each participant how they were marked, so training attendance reaches
  // them the same way rehearsal attendance does. One message per member.
  notifyTrainingParticipants(byMember, { title: training.title, date: training.date })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "training.participants_update", entityType: "training", entityId: training.id,
    summary: `Participants for training "${training.title}" replaced (${memberIds.length})`, ip: req.ip,
  })
  res.json({ training: getTraining(training.id), participants: listParticipants(training.id) })
})
