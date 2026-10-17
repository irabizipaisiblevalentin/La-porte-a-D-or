import { Router } from "express"
import { can } from "../auth/access.js"
import { all, one } from "../db/index.js"
import { forbidden } from "../lib/errors.js"
import { queryString } from "../lib/http.js"
import { today } from "../lib/time.js"
import { permittedGroupIds, requireAuth, requirePermission } from "../middleware/auth.js"
import { listGroups } from "../services/groups.js"

export const reportsRouter: Router = Router()

interface CountRow {
  c: number
}

interface AttendanceTotals {
  present: number
  late: number
  absent: number
  excused: number
}

interface AttendancePolicy {
  latePolicy: string
  excusedPolicy: string
}

interface GroupAttendanceRow {
  group_id: string
  sessions: number
  present: number
  late: number
  absent: number
  excused: number
}

interface GoalRow {
  id: string
  name: string
  target_value: number
  unit: string
  deadline: string | null
  status: string
  period: string
  group_id: string | null
  current: number
}

/** Reads the configured attendance policy; falls back to the documented defaults. */
function attendancePolicy(): AttendancePolicy {
  const latePolicy = one<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'attendance.late_policy'",
  )?.value ?? "counts_as_present"
  const excusedPolicy = one<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'attendance.excused_policy'",
  )?.value ?? "excluded_from_denominator"
  return { latePolicy, excusedPolicy }
}

/** Attendance rate as a percentage (one decimal), or null when the denominator is empty. */
function computeRate(totals: AttendanceTotals, policy: AttendancePolicy): number | null {
  const numerator = totals.present + (policy.latePolicy === "counts_as_present" ? totals.late : 0)
  let denominator = totals.present + totals.late + totals.absent + totals.excused
  if (policy.excusedPolicy === "excluded_from_denominator") denominator -= totals.excused
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function requireGroupScope(scope: string[] | "all"): void {
  if (scope !== "all" && scope.length === 0) {
    throw forbidden("You do not have permission to view this report.")
  }
}

function attendanceByGroup(groupIds: string[], from?: string, to?: string): GroupAttendanceRow[] {
  const clauses = [`m.group_id IN (${groupIds.map(() => "?").join(", ")})`]
  const params: (string | number)[] = [...groupIds]
  if (from) {
    clauses.push("s.date >= ?")
    params.push(from)
  }
  if (to) {
    clauses.push("s.date <= ?")
    params.push(to)
  }
  return all<GroupAttendanceRow>(
    `SELECT m.group_id AS group_id,
            COUNT(DISTINCT s.id) AS sessions,
            COALESCE(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
            COALESCE(SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
            COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
            COALESCE(SUM(CASE WHEN ar.status = 'excused' THEN 1 ELSE 0 END), 0) AS excused
       FROM attendance_records ar
       JOIN attendance_sessions s ON s.id = ar.session_id
       JOIN members m ON m.id = ar.member_id
      WHERE ${clauses.join(" AND ")}
      GROUP BY m.group_id`,
    ...params,
  )
}

function attendanceSessionCount(groupIds: string[], from?: string, to?: string): number {
  const clauses = [`m.group_id IN (${groupIds.map(() => "?").join(", ")})`]
  const params: (string | number)[] = [...groupIds]
  if (from) {
    clauses.push("s.date >= ?")
    params.push(from)
  }
  if (to) {
    clauses.push("s.date <= ?")
    params.push(to)
  }
  return one<CountRow>(
    `SELECT COUNT(DISTINCT s.id) AS c
       FROM attendance_records ar
       JOIN attendance_sessions s ON s.id = ar.session_id
       JOIN members m ON m.id = ar.member_id
      WHERE ${clauses.join(" AND ")}`,
    ...params,
  )?.c ?? 0
}

function goalPercent(target: number, current: number): number {
  if (target <= 0) return 0
  return Math.min(100, Math.round((current / target) * 100))
}

// ---------------------------------------------------------------------------
// GET /reports/membership — counts by group, by status and new admissions.
// ---------------------------------------------------------------------------
reportsRouter.get("/membership", requireAuth, requirePermission("reports.read"), (req, res) => {
  const scope = permittedGroupIds(req.auth!, "reports.read")
  requireGroupScope(scope)
  const groupIds = scope === "all" ? listGroups().map((g) => g.id) : scope
  const placeholders = groupIds.map(() => "?").join(", ")

  const byGroup = all<{
    group_id: string
    group_key: string
    group_name: string
    total: number
    active: number
    inactive: number
    suspended: number
    withdrawn: number
  }>(
    `SELECT g.id AS group_id, g.key AS group_key, g.name AS group_name,
            COUNT(m.id) AS total,
            COALESCE(SUM(CASE WHEN m.status = 'active' THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN m.status = 'inactive' THEN 1 ELSE 0 END), 0) AS inactive,
            COALESCE(SUM(CASE WHEN m.status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended,
            COALESCE(SUM(CASE WHEN m.status = 'withdrawn' THEN 1 ELSE 0 END), 0) AS withdrawn
       FROM groups g
       LEFT JOIN members m ON m.group_id = g.id
      WHERE g.id IN (${placeholders})
      GROUP BY g.id, g.key, g.name
      ORDER BY CASE g.key WHEN 'senior' THEN 1 WHEN 'junior' THEN 2 ELSE 3 END`,
    ...groupIds,
  )

  const byStatus = all<{ status: string; c: number }>(
    `SELECT m.status AS status, COUNT(*) AS c
       FROM members m
      WHERE m.group_id IN (${placeholders})
      GROUP BY m.status
      ORDER BY m.status`,
    ...groupIds,
  )

  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - 11)
  since.setUTCDate(1)
  const sinceMonth = since.toISOString().slice(0, 7)

  const admissions = all<{ month: string; c: number }>(
    `SELECT substr(m.joined_at, 1, 7) AS month, COUNT(*) AS c
       FROM members m
      WHERE m.group_id IN (${placeholders}) AND substr(m.joined_at, 1, 7) >= ?
      GROUP BY month
      ORDER BY month`,
    ...groupIds, sinceMonth,
  )

  res.json({
    byGroup: byGroup.map((row) => ({
      groupId: row.group_id,
      groupKey: row.group_key,
      groupName: row.group_name,
      total: row.total,
      active: row.active,
      inactive: row.inactive,
      suspended: row.suspended,
      withdrawn: row.withdrawn,
    })),
    byStatus: byStatus.map((row) => ({ status: row.status, count: row.c })),
    admissionsByMonth: admissions.map((row) => ({ month: row.month, count: row.c })),
    total: byGroup.reduce((sum, row) => sum + row.total, 0),
  })
})

// ---------------------------------------------------------------------------
// GET /reports/attendance — attendance aggregates using the configured policy.
// ---------------------------------------------------------------------------
reportsRouter.get("/attendance", requireAuth, requirePermission("reports.read"), (req, res) => {
  const scope = permittedGroupIds(req.auth!, "reports.read")
  requireGroupScope(scope)
  const requestedGroup = queryString(req, "groupId")
  if (requestedGroup && scope !== "all" && !scope.includes(requestedGroup)) throw forbidden()
  const groupIds = requestedGroup
    ? [requestedGroup]
    : scope === "all" ? listGroups().map((g) => g.id) : scope
  const from = queryString(req, "from")
  const to = queryString(req, "to")
  const policy = attendancePolicy()

  const rows = attendanceByGroup(groupIds, from, to)
  const sessions = attendanceSessionCount(groupIds, from, to)
  const totals = rows.reduce<AttendanceTotals>(
    (acc, row) => ({
      present: acc.present + row.present,
      late: acc.late + row.late,
      absent: acc.absent + row.absent,
      excused: acc.excused + row.excused,
    }),
    { present: 0, late: 0, absent: 0, excused: 0 },
  )
  const groupsById = new Map(listGroups().map((group) => [group.id, group]))

  res.json({
    range: { from: from ?? null, to: to ?? null },
    groupId: requestedGroup ?? null,
    policy,
    sessions,
    present: totals.present,
    late: totals.late,
    absent: totals.absent,
    excused: totals.excused,
    totalRecords: totals.present + totals.late + totals.absent + totals.excused,
    rate: computeRate(totals, policy),
    byGroup: rows.map((row) => ({
      groupId: row.group_id,
      groupKey: groupsById.get(row.group_id)?.key ?? null,
      groupName: groupsById.get(row.group_id)?.name ?? null,
      sessions: row.sessions,
      present: row.present,
      late: row.late,
      absent: row.absent,
      excused: row.excused,
      rate: computeRate(row, policy),
    })),
  })
})

// ---------------------------------------------------------------------------
// GET /reports/discipline — scoped to the caller's discipline.read groups.
// ---------------------------------------------------------------------------
reportsRouter.get("/discipline", requireAuth, requirePermission("reports.read"), (req, res) => {
  const reportScope = permittedGroupIds(req.auth!, "reports.read")
  requireGroupScope(reportScope)
  if (!can(req.auth!, "discipline.read")) {
    throw forbidden("You do not have permission to view discipline reports.")
  }
  const disciplineScope = permittedGroupIds(req.auth!, "discipline.read")
  if (disciplineScope !== "all" && disciplineScope.length === 0) {
    throw forbidden("You do not have permission to view discipline reports.")
  }

  const requestedGroup = queryString(req, "groupId")
  if (requestedGroup) {
    if (disciplineScope !== "all" && !disciplineScope.includes(requestedGroup)) throw forbidden()
    if (reportScope !== "all" && !reportScope.includes(requestedGroup)) throw forbidden()
  }
  const groupIds = requestedGroup
    ? [requestedGroup]
    : disciplineScope === "all" ? listGroups().map((g) => g.id) : disciplineScope
  const placeholders = groupIds.map(() => "?").join(", ")

  const from = queryString(req, "from")
  const to = queryString(req, "to")
  const dateClauses: string[] = []
  const dateParams: (string | number)[] = []
  if (from) {
    dateClauses.push("d.date >= ?")
    dateParams.push(from)
  }
  if (to) {
    dateClauses.push("d.date <= ?")
    dateParams.push(to)
  }
  const dateWhere = dateClauses.length ? ` AND ${dateClauses.join(" AND ")}` : ""

  const byStatusKind = all<{ status: string; kind: string; c: number }>(
    `SELECT d.status AS status, c.kind AS kind, COUNT(*) AS c
       FROM discipline_records d
       JOIN members m ON m.id = d.member_id
       JOIN discipline_categories c ON c.id = d.category_id
      WHERE m.group_id IN (${placeholders})${dateWhere}
      GROUP BY d.status, c.kind`,
    ...groupIds, ...dateParams,
  )

  const statusMap = new Map<string, number>()
  let negative = 0
  let positive = 0
  for (const row of byStatusKind) {
    statusMap.set(row.status, (statusMap.get(row.status) ?? 0) + row.c)
    if (row.kind === "negative") negative += row.c
    else positive += row.c
  }

  const byCategory = all<{ id: string; key: string; label: string; kind: string; c: number }>(
    `SELECT c.id AS id, c.key AS key, c.label AS label, c.kind AS kind, COUNT(*) AS c
       FROM discipline_records d
       JOIN members m ON m.id = d.member_id
       JOIN discipline_categories c ON c.id = d.category_id
      WHERE m.group_id IN (${placeholders})${dateWhere}
      GROUP BY c.id, c.key, c.label, c.kind, c.sort_order
      ORDER BY c.sort_order`,
    ...groupIds, ...dateParams,
  )

  const groupKind = all<{ group_id: string; kind: string; c: number }>(
    `SELECT m.group_id AS group_id, c.kind AS kind, COUNT(*) AS c
       FROM discipline_records d
       JOIN members m ON m.id = d.member_id
       JOIN discipline_categories c ON c.id = d.category_id
      WHERE m.group_id IN (${placeholders})${dateWhere}
      GROUP BY m.group_id, c.kind`,
    ...groupIds, ...dateParams,
  )

  const groupsById = new Map(listGroups().map((group) => [group.id, group]))
  const groupTotals = new Map<string, { negative: number; positive: number }>()
  for (const row of groupKind) {
    const entry = groupTotals.get(row.group_id) ?? { negative: 0, positive: 0 }
    if (row.kind === "negative") entry.negative += row.c
    else entry.positive += row.c
    groupTotals.set(row.group_id, entry)
  }

  res.json({
    range: { from: from ?? null, to: to ?? null },
    groupId: requestedGroup ?? null,
    total: negative + positive,
    negative,
    positive,
    byStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
    byCategory: byCategory.map((row) => ({
      categoryId: row.id,
      key: row.key,
      label: row.label,
      kind: row.kind,
      count: row.c,
    })),
    byGroup: [...groupTotals.entries()].map(([groupId, value]) => ({
      groupId,
      groupKey: groupsById.get(groupId)?.key ?? null,
      groupName: groupsById.get(groupId)?.name ?? null,
      negative: value.negative,
      positive: value.positive,
      total: value.negative + value.positive,
    })),
  })
})

// ---------------------------------------------------------------------------
// GET /reports/music — catalogue health, stage distribution, performances.
// ---------------------------------------------------------------------------
reportsRouter.get("/music", requireAuth, requirePermission("reports.read"), (req, res) => {
  requireGroupScope(permittedGroupIds(req.auth!, "reports.read"))
  if (!can(req.auth!, "music.read")) {
    throw forbidden("You do not have permission to view music reports.")
  }

  const songStatus = all<{ status: string; c: number }>(
    "SELECT status, COUNT(*) AS c FROM songs GROUP BY status",
  )
  const videoStatus = all<{ status: string; c: number }>(
    "SELECT status, COUNT(*) AS c FROM videos GROUP BY status",
  )
  const statusCount = (rows: { status: string; c: number }[], key: string): number =>
    rows.find((row) => row.status === key)?.c ?? 0

  const byStage = all<{ stage_id: string; key: string; name: string; c: number }>(
    `SELECT s.learning_stage_id AS stage_id, ls.key AS key, ls.name AS name, COUNT(*) AS c
       FROM songs s
       JOIN learning_stages ls ON ls.id = s.learning_stage_id
      WHERE s.status = 'active' AND s.learning_stage_id IS NOT NULL
      GROUP BY s.learning_stage_id, ls.key, ls.name, ls.sort_order
      ORDER BY ls.sort_order`,
  )

  const byCategory = all<{ category_id: string; key: string; name: string; c: number }>(
    `SELECT s.category_id AS category_id, sc.key AS key, sc.name AS name, COUNT(*) AS c
       FROM songs s
       JOIN song_categories sc ON sc.id = s.category_id
      WHERE s.status = 'active' AND s.category_id IS NOT NULL
      GROUP BY s.category_id, sc.key, sc.name, sc.sort_order
      ORDER BY sc.sort_order`,
  )

  const readyForPerformance = one<CountRow>(
    `SELECT COUNT(*) AS c
       FROM songs s
       JOIN learning_stages ls ON ls.id = s.learning_stage_id
      WHERE s.status = 'active' AND ls.key = 'ready_for_performance'`,
  )?.c ?? 0

  const performances = one<{ events: number; completed_events: number; song_assignments: number }>(
    `SELECT
       (SELECT COUNT(DISTINCT es.event_id) FROM event_songs es) AS events,
       (SELECT COUNT(DISTINCT es.event_id) FROM event_songs es JOIN events e ON e.id = es.event_id WHERE e.status = 'completed') AS completed_events,
       (SELECT COUNT(*) FROM event_songs) AS song_assignments`,
  ) ?? { events: 0, completed_events: 0, song_assignments: 0 }

  res.json({
    catalogue: {
      total: songStatus.reduce((sum, row) => sum + row.c, 0),
      active: statusCount(songStatus, "active"),
      archived: statusCount(songStatus, "archived"),
    },
    videos: {
      total: videoStatus.reduce((sum, row) => sum + row.c, 0),
      approved: statusCount(videoStatus, "approved"),
      discovered: statusCount(videoStatus, "discovered"),
      rejected: statusCount(videoStatus, "rejected"),
    },
    byStage: byStage.map((row) => ({ stageId: row.stage_id, key: row.key, name: row.name, count: row.c })),
    byCategory: byCategory.map((row) => ({ categoryId: row.category_id, key: row.key, name: row.name, count: row.c })),
    readyForPerformance,
    performances: {
      events: performances.events,
      completedEvents: performances.completed_events,
      songAssignments: performances.song_assignments,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /reports/goals — annual/monthly progress, completed, remaining, overdue.
// ---------------------------------------------------------------------------
reportsRouter.get("/goals", requireAuth, requirePermission("reports.read"), (req, res) => {
  const scope = permittedGroupIds(req.auth!, "reports.read")
  requireGroupScope(scope)
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (scope !== "all") {
    clauses.push(`(g.group_id IS NULL OR g.group_id IN (${scope.map(() => "?").join(", ")}))`)
    params.push(...scope)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const rows = all<GoalRow>(
    `SELECT g.id, g.name, g.target_value, g.unit, g.deadline, g.status, g.period, g.group_id,
            COALESCE((SELECT SUM(gp.value) FROM goal_progress gp WHERE gp.goal_id = g.id), 0) AS current
       FROM goals g
       ${where}
      ORDER BY g.name COLLATE NOCASE`,
    ...params,
  )

  const todayDate = today()
  const aggregate = (period: string) => {
    const matching = rows.filter((row) => row.period === period)
    const target = matching.reduce((sum, row) => sum + row.target_value, 0)
    const current = matching.reduce((sum, row) => sum + row.current, 0)
    return { count: matching.length, target, current, percent: goalPercent(target, current) }
  }

  const active = rows.filter((row) => row.status === "active")
  res.json({
    total: rows.length,
    active: active.length,
    completed: rows.filter((row) => row.status === "completed").length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    remaining: active.length,
    overdue: active.filter((row) => row.deadline !== null && row.deadline < todayDate).length,
    annual: aggregate("annual"),
    monthly: aggregate("monthly"),
    custom: aggregate("custom"),
    progress: active.slice(0, 50).map((row) => ({
      id: row.id,
      name: row.name,
      target: row.target_value,
      unit: row.unit,
      current: row.current,
      percent: goalPercent(row.target_value, row.current),
      deadline: row.deadline,
      status: row.status,
      period: row.period,
      groupId: row.group_id,
    })),
  })
})

// ---------------------------------------------------------------------------
// GET /reports/events — events held, participants, training, performances.
// ---------------------------------------------------------------------------
reportsRouter.get("/events", requireAuth, requirePermission("reports.read"), (req, res) => {
  requireGroupScope(permittedGroupIds(req.auth!, "reports.read"))
  const from = queryString(req, "from")
  const to = queryString(req, "to")

  const dateFilter = (alias: string): { sql: string; params: (string | number)[] } => {
    const parts: string[] = []
    const params: (string | number)[] = []
    if (from) {
      parts.push(`${alias}.date >= ?`)
      params.push(from)
    }
    if (to) {
      parts.push(`${alias}.date <= ?`)
      params.push(to)
    }
    return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params }
  }

  const eventDate = dateFilter("e")
  const trainingDate = dateFilter("t")

  const eventsHeld = one<CountRow>(
    `SELECT COUNT(*) AS c FROM events e WHERE e.status = 'completed'${eventDate.sql}`,
    ...eventDate.params,
  )?.c ?? 0

  const participants = one<CountRow>(
    `SELECT COUNT(*) AS c
       FROM event_participants ep
       JOIN events e ON e.id = ep.event_id
      WHERE e.status = 'completed'${eventDate.sql}`,
    ...eventDate.params,
  )?.c ?? 0

  const trainingCompleted = one<CountRow>(
    `SELECT COUNT(*) AS c FROM training_sessions t WHERE t.status = 'completed'${trainingDate.sql}`,
    ...trainingDate.params,
  )?.c ?? 0

  const trainingParticipantsCompleted = one<CountRow>(
    `SELECT COUNT(*) AS c
       FROM training_participants tp
       JOIN training_sessions t ON t.id = tp.training_id
      WHERE tp.completed = 1${trainingDate.sql}`,
    ...trainingDate.params,
  )?.c ?? 0

  const performanceHistory = all<{
    id: string
    name: string
    event_type: string
    date: string
    participants: number
  }>(
    `SELECT e.id, e.name, e.event_type, e.date,
            (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) AS participants
       FROM events e
      WHERE e.status = 'completed'
        AND e.event_type IN ('concert', 'church_service', 'competition', 'community')${eventDate.sql}
      ORDER BY e.date DESC
      LIMIT 25`,
    ...eventDate.params,
  )

  res.json({
    range: { from: from ?? null, to: to ?? null },
    eventsHeld,
    participants,
    trainingCompleted,
    trainingParticipantsCompleted,
    performanceHistory: performanceHistory.map((row) => ({
      id: row.id,
      name: row.name,
      eventType: row.event_type,
      date: row.date,
      participants: row.participants,
    })),
  })
})

// ---------------------------------------------------------------------------
// GET /reports/me — the viewer's own attendance and progress (own records only).
// ---------------------------------------------------------------------------
reportsRouter.get("/me", requireAuth, (req, res) => {
  const user = req.auth!
  const policy = attendancePolicy()
  if (!user.memberId) {
    res.json({
      attendance: { sessions: 0, present: 0, late: 0, absent: 0, excused: 0, rate: null },
      songsLearning: 0,
      trainingsCompleted: 0,
      eventsAttended: 0,
    })
    return
  }

  const totals = one<AttendanceTotals>(
    `SELECT COALESCE(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
            COALESCE(SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
            COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
            COALESCE(SUM(CASE WHEN ar.status = 'excused' THEN 1 ELSE 0 END), 0) AS excused
       FROM attendance_records ar
      WHERE ar.member_id = ?`,
    user.memberId,
  ) ?? { present: 0, late: 0, absent: 0, excused: 0 }

  const sessions = one<CountRow>(
    "SELECT COUNT(DISTINCT ar.session_id) AS c FROM attendance_records ar WHERE ar.member_id = ?",
    user.memberId,
  )?.c ?? 0

  const songsLearning = user.groupId
    ? one<CountRow>(
        `SELECT COUNT(DISTINCT s.id) AS c
           FROM song_group_assignments sga
           JOIN songs s ON s.id = sga.song_id
           LEFT JOIN learning_stages ls ON ls.id = s.learning_stage_id
          WHERE sga.group_id = ? AND s.status = 'active'
            AND (ls.key IS NULL OR ls.key <> 'ready_for_performance')`,
        user.groupId,
      )?.c ?? 0
    : 0

  const trainingsCompleted = one<CountRow>(
    "SELECT COUNT(*) AS c FROM training_participants WHERE member_id = ? AND completed = 1",
    user.memberId,
  )?.c ?? 0

  const eventsAttended = one<CountRow>(
    "SELECT COUNT(*) AS c FROM event_participants WHERE member_id = ?",
    user.memberId,
  )?.c ?? 0

  res.json({
    attendance: { sessions, ...totals, rate: computeRate(totals, policy) },
    songsLearning,
    trainingsCompleted,
    eventsAttended,
  })
})
