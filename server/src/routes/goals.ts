import { Router } from "express"
import { z } from "zod"
import { all, one, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { id } from "../lib/security.js"
import { isValidDateString, nowIso, today } from "../lib/time.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { groupExists } from "../services/groups.js"

export const goalsRouter: Router = Router()

const GOAL_PERIODS = ["annual", "monthly", "custom"] as const
const GOAL_STATUSES = ["active", "completed", "cancelled"] as const
const GROUP_IDS = ["grp_senior", "grp_junior", "grp_members"] as const
const STATUS_SET = new Set<string>(GOAL_STATUSES)
const PERIOD_SET = new Set<string>(GOAL_PERIODS)

interface GoalRow {
  id: string
  name: string
  description: string | null
  target_value: number
  unit: string
  start_date: string
  deadline: string | null
  group_id: string | null
  period: string
  status: string
  created_by: string | null
  created_at: string
  updated_at: string
}

interface GoalWithGroup extends GoalRow {
  group_key: string | null
  group_name: string | null
}

interface ProgressRow {
  id: string
  goal_id: string
  period_date: string
  value: number
  notes: string | null
  recorded_by: string | null
  created_at: string
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

/**
 * Goals store a running total in `goal_progress`: the value of the row with the greatest
 * `period_date` is the current value. `percent` is the current value clamped to 0..100 against
 * the target. A goal is overdue when its deadline is in the past, it is still active and it is
 * not yet at 100%.
 */
function goalDto(goal: GoalWithGroup, history: ProgressRow[]) {
  const latest = history.length > 0 ? history[history.length - 1] : undefined
  const current = latest ? latest.value : 0
  const percent = goal.target_value > 0
    ? clampPercent((current / goal.target_value) * 100)
    : current >= goal.target_value ? 100 : 0
  const overdue = Boolean(goal.deadline && goal.deadline < today() && goal.status === "active" && percent < 100)

  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    targetValue: goal.target_value,
    unit: goal.unit,
    startDate: goal.start_date,
    deadline: goal.deadline,
    groupId: goal.group_id,
    groupKey: goal.group_key,
    groupName: goal.group_name,
    period: goal.period,
    status: goal.status,
    current,
    percent,
    overdue,
    progress: history.map((point) => ({
      periodDate: point.period_date,
      value: point.value,
      notes: point.notes,
      recordedAt: point.created_at,
    })),
    createdAt: goal.created_at,
    updatedAt: goal.updated_at,
  }
}

function loadGoalDto(goalId: string) {
  const goal = one<GoalWithGroup>(
    `SELECT g.*, grp.key AS group_key, grp.name AS group_name
       FROM goals g
       LEFT JOIN groups grp ON grp.id = g.group_id
      WHERE g.id = ?`,
    goalId,
  )
  if (!goal) throw notFound("That goal does not exist.")
  const history = all<ProgressRow>(
    "SELECT * FROM goal_progress WHERE goal_id = ? ORDER BY period_date ASC, created_at ASC",
    goalId,
  )
  return goalDto(goal, history)
}

const goalCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter a goal name.").max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  targetValue: z.coerce.number().finite("Enter a target value.").positive("Enter a target greater than zero."),
  unit: z.string().trim().min(1, "Enter a unit.").max(60),
  startDate: z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD)."),
  deadline: z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD).").nullable().optional(),
  groupId: z.enum(GROUP_IDS).nullable().optional(),
  period: z.enum(GOAL_PERIODS).optional(),
  status: z.enum(GOAL_STATUSES).optional(),
})

const goalPatchSchema = goalCreateSchema.partial()

const progressSchema = z.object({
  periodDate: z.string().trim().refine(isValidDateString, "Enter a valid date (YYYY-MM-DD)."),
  value: z.coerce.number().finite("Enter a progress value."),
  notes: z.string().trim().max(2000).nullable().optional(),
})

goalsRouter.get("/", requireAuth, requirePermission("goals.read"), (req, res) => {
  const p = pagination(req)
  const groupFilter = queryString(req, "groupId")
  const statusFilter = queryString(req, "status")
  const periodFilter = queryString(req, "period")

  const clauses: string[] = []
  const params: (string | number)[] = []

  if (groupFilter) {
    if (groupFilter === "none") {
      clauses.push("g.group_id IS NULL")
    } else {
      clauses.push("g.group_id = ?")
      params.push(groupFilter)
    }
  }
  if (statusFilter) {
    if (!STATUS_SET.has(statusFilter)) throw badRequest("Unknown goal status.")
    clauses.push("g.status = ?")
    params.push(statusFilter)
  }
  if (periodFilter) {
    if (!PERIOD_SET.has(periodFilter)) throw badRequest("Unknown goal period.")
    clauses.push("g.period = ?")
    params.push(periodFilter)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM goals g ${where}`, ...params)?.c ?? 0
  const goals = all<GoalWithGroup>(
    `SELECT g.*, grp.key AS group_key, grp.name AS group_name
       FROM goals g
       LEFT JOIN groups grp ON grp.id = g.group_id
       ${where}
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )

  const historyByGoal = new Map<string, ProgressRow[]>()
  if (goals.length > 0) {
    const ids = goals.map((goal) => goal.id)
    const points = all<ProgressRow>(
      `SELECT * FROM goal_progress WHERE goal_id IN (${ids.map(() => "?").join(",")})
        ORDER BY period_date ASC, created_at ASC`,
      ...ids,
    )
    for (const point of points) {
      const list = historyByGoal.get(point.goal_id) ?? []
      list.push(point)
      historyByGoal.set(point.goal_id, list)
    }
  }

  const items = goals.map((goal) => goalDto(goal, historyByGoal.get(goal.id) ?? []))
  res.json(makePage(items, total, p))
})

goalsRouter.post("/", requireAuth, requirePermission("goals.write"), (req, res) => {
  const input = parse(goalCreateSchema, req.body)
  if (input.groupId && !groupExists(input.groupId)) throw badRequest("Unknown group.")

  const timestamp = nowIso()
  const goalId = id()
  run(
    `INSERT INTO goals (id, name, description, target_value, unit, start_date, deadline, group_id, period, status,
                        created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    goalId, input.name, input.description ?? null, input.targetValue, input.unit, input.startDate,
    input.deadline ?? null, input.groupId ?? null, input.period ?? "annual", input.status ?? "active",
    req.auth!.id, timestamp, timestamp,
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "goal.create", entityType: "goal", entityId: goalId,
    summary: `Goal "${input.name}" created for ${input.groupId ?? "the whole organisation"}`,
    detail: { targetValue: input.targetValue, unit: input.unit, period: input.period ?? "annual" }, ip: req.ip,
  })
  res.status(201).json({ goal: loadGoalDto(goalId) })
})

goalsRouter.patch("/:id", requireAuth, requirePermission("goals.write"), (req, res) => {
  const goal = one<GoalRow>("SELECT * FROM goals WHERE id = ?", String(req.params.id))
  if (!goal) throw notFound("That goal does not exist.")

  const input = parse(goalPatchSchema, req.body)
  if (input.groupId && !groupExists(input.groupId)) throw badRequest("Unknown group.")

  const fields: string[] = []
  const params: (string | number | null)[] = []
  if (input.name !== undefined) { fields.push("name = ?"); params.push(input.name) }
  if (input.description !== undefined) { fields.push("description = ?"); params.push(input.description ?? null) }
  if (input.targetValue !== undefined) { fields.push("target_value = ?"); params.push(input.targetValue) }
  if (input.unit !== undefined) { fields.push("unit = ?"); params.push(input.unit) }
  if (input.startDate !== undefined) { fields.push("start_date = ?"); params.push(input.startDate) }
  if (input.deadline !== undefined) { fields.push("deadline = ?"); params.push(input.deadline ?? null) }
  if (input.groupId !== undefined) { fields.push("group_id = ?"); params.push(input.groupId) }
  if (input.period !== undefined) { fields.push("period = ?"); params.push(input.period) }
  if (input.status !== undefined) { fields.push("status = ?"); params.push(input.status) }
  if (fields.length === 0) throw badRequest("Provide at least one field to update.")

  fields.push("updated_at = ?")
  params.push(nowIso())
  run(`UPDATE goals SET ${fields.join(", ")} WHERE id = ?`, ...params, goal.id)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "goal.update", entityType: "goal", entityId: goal.id,
    summary: `Goal "${goal.name}" updated`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ goal: loadGoalDto(goal.id) })
})

goalsRouter.post("/:id/progress", requireAuth, requirePermission("goals.write"), (req, res) => {
  const goal = one<GoalRow>("SELECT * FROM goals WHERE id = ?", String(req.params.id))
  if (!goal) throw notFound("That goal does not exist.")

  const input = parse(progressSchema, req.body)
  const timestamp = nowIso()
  let completed = false

  transaction(() => {
    run(
      `INSERT INTO goal_progress (id, goal_id, period_date, value, notes, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(goal_id, period_date) DO UPDATE SET
         value = excluded.value,
         notes = excluded.notes,
         recorded_by = excluded.recorded_by`,
      id(), goal.id, input.periodDate, input.value, input.notes ?? null, req.auth!.id, timestamp,
    )
    const latest = one<{ value: number }>(
      "SELECT value FROM goal_progress WHERE goal_id = ? ORDER BY period_date DESC, created_at DESC LIMIT 1",
      goal.id,
    )
    const current = latest?.value ?? 0
    if (goal.status === "active" && current >= goal.target_value) {
      run("UPDATE goals SET status = 'completed', updated_at = ? WHERE id = ?", timestamp, goal.id)
      completed = true
    } else {
      run("UPDATE goals SET updated_at = ? WHERE id = ?", timestamp, goal.id)
    }
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "goal.progress", entityType: "goal", entityId: goal.id,
    summary: completed
      ? `Goal "${goal.name}" reached its target of ${goal.target_value} ${goal.unit} and was completed`
      : `Progress recorded for goal "${goal.name}"`,
    detail: { periodDate: input.periodDate, value: input.value, completed }, ip: req.ip,
  })
  res.json({ goal: loadGoalDto(goal.id) })
})
