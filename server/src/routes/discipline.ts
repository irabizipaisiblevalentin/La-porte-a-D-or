import { Router } from "express"
import { z } from "zod"
import { can, canActOnMember } from "../auth/access.js"
import { all, one, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { id } from "../lib/security.js"
import { isValidDateString, nowIso } from "../lib/time.js"
import { assertGroupAccess, permittedGroupIds, requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js"
import { notify } from "../services/notifications.js"

export const disciplineRouter: Router = Router()

const DISCIPLINE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const
const CATEGORY_KINDS = ["negative", "positive"] as const
const STATUS_SET = new Set<string>(DISCIPLINE_STATUSES)
const KIND_SET = new Set<string>(CATEGORY_KINDS)

interface CategoryRow {
  id: string
  key: string
  label: string
  kind: string
  active: number
  sort_order: number
}

interface DisciplineRow {
  id: string
  member_id: string
  date: string
  category_id: string
  description: string
  action_taken: string | null
  status: string
  follow_up_notes: string | null
  recorded_by: string | null
  created_at: string
  updated_at: string
}

interface DisciplineListRow extends DisciplineRow {
  category_key: string
  category_label: string
  category_kind: string
  full_name: string
  member_no: string
  group_key: string
}

interface MemberRef {
  id: string
  group_id: string
  full_name: string
  member_no: string
}

function getCategory(categoryId: string): CategoryRow | undefined {
  return one<CategoryRow>("SELECT * FROM discipline_categories WHERE id = ?", categoryId)
}

function getDisciplineRecord(recordId: string): DisciplineRow | undefined {
  return one<DisciplineRow>("SELECT * FROM discipline_records WHERE id = ?", recordId)
}

function getMemberRef(memberId: string): MemberRef | undefined {
  return one<MemberRef>("SELECT id, group_id, full_name, member_no FROM members WHERE id = ?", memberId)
}

/** The permission a record requires depends on its category kind. */
function permissionForKind(kind: string): "discipline.write" | "recognition.write" {
  return kind === "positive" ? "recognition.write" : "discipline.write"
}

/**
 * Tells a member that a discipline or recognition record was created for them.
 *
 * A fault the member never hears about is not a correction, it is a note in a
 * drawer — so this is part of recording it, not an optional extra. The same call
 * also mirrors the message onto their own devices through the push service.
 *
 * A member without a sign-in account has nowhere to receive it; that is not an
 * error, it is simply a record kept on paper until they are given access.
 */
function notifyMemberOfDiscipline(
  memberId: string,
  detail: { kind: string; label: string; date: string; actionTaken: string | null },
): void {
  const account = one<{ id: string }>("SELECT user_id AS id FROM members WHERE user_id IS NOT NULL AND id = ?", memberId)
  if (!account?.id) return

  const positive = detail.kind === "positive"
  const title = positive ? "New recognition recorded" : "New discipline record"
  const consequence = detail.actionTaken?.trim().replace(/[.\s]+$/, "")
  const body = [
    `${detail.label} on ${detail.date}.`,
    consequence ? `${positive ? "Recognition" : "Action"}: ${consequence}.` : "",
    "Open your discipline page to see the full record.",
  ]
    .filter(Boolean)
    .join(" ")

  notify({
    userId: account.id,
    type: positive ? "recognition" : "discipline",
    title,
    body,
    link: "/app/discipline",
  })
}

function loadDisciplineDto(recordId: string) {
  const row = one<DisciplineListRow>(
    `SELECT d.*, c.key AS category_key, c.label AS category_label, c.kind AS category_kind,
            m.full_name, m.member_no, g.key AS group_key
       FROM discipline_records d
       JOIN discipline_categories c ON c.id = d.category_id
       JOIN members m ON m.id = d.member_id
       JOIN groups g ON g.id = m.group_id
      WHERE d.id = ?`,
    recordId,
  )
  return row ? disciplineDto(row) : null
}

function disciplineDto(row: DisciplineListRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    fullName: row.full_name,
    memberNo: row.member_no,
    groupKey: row.group_key,
    categoryId: row.category_id,
    categoryKey: row.category_key,
    categoryLabel: row.category_label,
    kind: row.category_kind,
    date: row.date,
    description: row.description,
    actionTaken: row.action_taken,
    status: row.status,
    followUpNotes: row.follow_up_notes,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

disciplineRouter.get("/categories", requireAuth, (_req, res) => {
  const categories = all<CategoryRow>(
    "SELECT id, label, kind FROM discipline_categories WHERE active = 1 ORDER BY sort_order, label",
  )
  res.json({ categories: categories.map((category) => ({ id: category.id, label: category.label, kind: category.kind })) })
})

disciplineRouter.get("/", requireAuth, requirePermission("discipline.read"), (req, res) => {
  const p = pagination(req)
  const memberFilter = queryString(req, "memberId")
  const groupFilter = queryString(req, "groupId")
  const kindFilter = queryString(req, "kind")
  const statusFilter = queryString(req, "status")
  const from = queryString(req, "from")
  const to = queryString(req, "to")

  const clauses: string[] = []
  const params: (string | number)[] = []
  const readable = permittedGroupIds(req.auth!, "discipline.read")

  if (readable === "all") {
    // organisation-wide reader
  } else if (readable.length > 0) {
    // Junior Admin and similarly-scoped roles only see the groups they hold.
    clauses.push(`m.group_id IN (${readable.map(() => "?").join(",")})`)
    params.push(...readable)
  } else if (can(req.auth!, "discipline.read", "own") && req.auth!.memberId) {
    clauses.push("d.member_id = ?")
    params.push(req.auth!.memberId)
  } else {
    clauses.push("0 = 1")
  }

  if (memberFilter) {
    if (readable !== "all") {
      const member = getMemberRef(memberFilter)
      if (!member) throw notFound("That member does not exist.")
      if (readable.length > 0) {
        if (!readable.includes(member.group_id)) throw forbidden()
      } else if (req.auth!.memberId !== memberFilter) {
        throw forbidden()
      }
    }
    clauses.push("d.member_id = ?")
    params.push(memberFilter)
  }
  if (groupFilter) {
    if (readable !== "all" && !readable.includes(groupFilter)) throw forbidden()
    clauses.push("m.group_id = ?")
    params.push(groupFilter)
  }
  if (kindFilter) {
    if (!KIND_SET.has(kindFilter)) throw badRequest("Unknown record kind.")
    clauses.push("c.kind = ?")
    params.push(kindFilter)
  }
  if (statusFilter) {
    if (!STATUS_SET.has(statusFilter)) throw badRequest("Unknown record status.")
    clauses.push("d.status = ?")
    params.push(statusFilter)
  }
  if (from) {
    clauses.push("d.date >= ?")
    params.push(from)
  }
  if (to) {
    clauses.push("d.date <= ?")
    params.push(to)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM discipline_records d
       JOIN discipline_categories c ON c.id = d.category_id
       JOIN members m ON m.id = d.member_id
       ${where}`,
    ...params,
  )?.c ?? 0

  const items = all<DisciplineListRow>(
    `SELECT d.*, c.key AS category_key, c.label AS category_label, c.kind AS category_kind,
            m.full_name, m.member_no, g.key AS group_key
       FROM discipline_records d
       JOIN discipline_categories c ON c.id = d.category_id
       JOIN members m ON m.id = d.member_id
       JOIN groups g ON g.id = m.group_id
       ${where}
       ORDER BY d.date DESC, d.created_at DESC
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items.map(disciplineDto), total, p))
})

disciplineRouter.get("/member/:memberId", requireAuth, requirePermission("discipline.read"), (req, res) => {
  const member = getMemberRef(String(req.params.memberId))
  if (!member) throw notFound("That member does not exist.")
  if (!canActOnMember(req.auth!, "discipline.read", member)) throw forbidden()

  const records = all<DisciplineListRow>(
    `SELECT d.*, c.key AS category_key, c.label AS category_label, c.kind AS category_kind,
            m.full_name, m.member_no, g.key AS group_key
       FROM discipline_records d
       JOIN discipline_categories c ON c.id = d.category_id
       JOIN members m ON m.id = d.member_id
       JOIN groups g ON g.id = m.group_id
      WHERE d.member_id = ?
      ORDER BY d.date DESC, d.created_at DESC`,
    member.id,
  )
  res.json({
    member: { id: member.id, fullName: member.full_name, memberNo: member.member_no, groupId: member.group_id },
    records: records.map(disciplineDto),
  })
})

const disciplineCreateSchema = z.object({
  memberId: z.string().trim().min(1, "Choose a member."),
  date: z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD)."),
  categoryId: z.string().trim().min(1, "Choose a category."),
  description: z.string().trim().min(2, "Describe what happened.").max(4000),
  actionTaken: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(DISCIPLINE_STATUSES).optional(),
  followUpNotes: z.string().trim().max(4000).nullable().optional(),
})

const disciplinePatchSchema = z.object({
  date: z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD).").optional(),
  categoryId: z.string().trim().min(1).optional(),
  description: z.string().trim().min(2).max(4000).optional(),
  actionTaken: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(DISCIPLINE_STATUSES).optional(),
  followUpNotes: z.string().trim().max(4000).nullable().optional(),
})

disciplineRouter.post("/", requireAuth, requireAnyPermission("discipline.write", "recognition.write"), (req, res) => {
  const input = parse(disciplineCreateSchema, req.body)
  const member = getMemberRef(input.memberId)
  if (!member) throw notFound("That member does not exist.")

  const category = getCategory(input.categoryId)
  if (!category || category.active !== 1) throw notFound("That discipline category does not exist.")

  // Positive categories are recognition and require recognition.write; everything else is discipline.write.
  assertGroupAccess(req.auth!, permissionForKind(category.kind), member.group_id)

  const timestamp = nowIso()
  const recordId = id()
  run(
    `INSERT INTO discipline_records (id, member_id, date, category_id, description, action_taken, status,
                                     follow_up_notes, recorded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    recordId, member.id, input.date, category.id, input.description, input.actionTaken ?? null,
    input.status ?? "open", input.followUpNotes ?? null, req.auth!.id, timestamp, timestamp,
  )

  // Tell the member, so the fault (or the praise) appears on their own dashboard
  // and discipline page instead of only in an administrator's list.
  notifyMemberOfDiscipline(member.id, {
    kind: category.kind,
    label: category.label,
    date: input.date,
    actionTaken: input.actionTaken ?? null,
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: category.kind === "positive" ? "discipline.recognition_create" : "discipline.create",
    entityType: "discipline_record", entityId: recordId,
    summary: `${category.kind === "positive" ? "Recognition" : "Discipline"} record "${category.label}" created for ${member.full_name}`,
    detail: { memberId: member.id, categoryId: category.id, status: input.status ?? "open" }, ip: req.ip,
  })
  res.status(201).json({ record: loadDisciplineDto(recordId) })
})

disciplineRouter.patch("/:id", requireAuth, requireAnyPermission("discipline.write", "recognition.write"), (req, res) => {
  const record = getDisciplineRecord(String(req.params.id))
  if (!record) throw notFound("That discipline record does not exist.")
  const member = getMemberRef(record.member_id)
  if (!member) throw notFound("That member does not exist.")
  const currentCategory = getCategory(record.category_id)
  if (!currentCategory) throw notFound("That discipline category does not exist.")

  // Modifying a record demands the permission matching its current category kind.
  assertGroupAccess(req.auth!, permissionForKind(currentCategory.kind), member.group_id)

  const input = parse(disciplinePatchSchema, req.body)

  let effectiveCategory = currentCategory
  if (input.categoryId && input.categoryId !== record.category_id) {
    const next = getCategory(input.categoryId)
    if (!next || next.active !== 1) throw notFound("That discipline category does not exist.")
    // Changing to a category of another kind requires the permission matching that kind.
    if (next.kind !== currentCategory.kind) {
      assertGroupAccess(req.auth!, permissionForKind(next.kind), member.group_id)
    }
    effectiveCategory = next
  }

  const changes: string[] = []
  if (input.date !== undefined && input.date !== record.date) changes.push(`date ${record.date} to ${input.date}`)
  if (input.description !== undefined && input.description !== record.description) changes.push("description updated")
  if (input.actionTaken !== undefined && (input.actionTaken ?? null) !== record.action_taken) changes.push("action taken updated")
  if (input.status !== undefined && input.status !== record.status) changes.push(`status ${record.status} to ${input.status}`)
  if (input.followUpNotes !== undefined && (input.followUpNotes ?? null) !== record.follow_up_notes) changes.push("follow-up notes updated")
  if (effectiveCategory.id !== currentCategory.id) {
    changes.push(`category ${currentCategory.label} to ${effectiveCategory.label}`)
  }
  const summary = changes.length > 0 ? changes.join("; ") : "No field changes"

  const timestamp = nowIso()
  const fields: string[] = []
  const params: (string | number | null)[] = []
  if (input.date !== undefined) { fields.push("date = ?"); params.push(input.date) }
  if (effectiveCategory.id !== currentCategory.id) { fields.push("category_id = ?"); params.push(effectiveCategory.id) }
  if (input.description !== undefined) { fields.push("description = ?"); params.push(input.description) }
  if (input.actionTaken !== undefined) { fields.push("action_taken = ?"); params.push(input.actionTaken ?? null) }
  if (input.status !== undefined) { fields.push("status = ?"); params.push(input.status) }
  if (input.followUpNotes !== undefined) { fields.push("follow_up_notes = ?"); params.push(input.followUpNotes ?? null) }

  if (fields.length > 0) {
    fields.push("updated_at = ?")
    params.push(timestamp)
  }
  transaction(() => {
    if (fields.length > 0) {
      run(`UPDATE discipline_records SET ${fields.join(", ")} WHERE id = ?`, ...params, record.id)
    }
    run(
      "INSERT INTO discipline_history (id, record_id, actor_id, change_summary, created_at) VALUES (?, ?, ?, ?, ?)",
      id(), record.id, req.auth!.id, summary, timestamp,
    )
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: effectiveCategory.kind === "positive" ? "discipline.recognition_update" : "discipline.update",
    entityType: "discipline_record", entityId: record.id,
    summary: `Record for ${member.full_name} updated: ${summary}`,
    detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ record: loadDisciplineDto(record.id) })
})
