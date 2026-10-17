import { Router } from "express"
import { can, type AuthUser } from "../auth/access.js"
import { all, one } from "../db/index.js"
import { today } from "../lib/time.js"
import { permittedGroupIds, requireAuth } from "../middleware/auth.js"
import { getGroupById, listGroups, type GroupRow } from "../services/groups.js"

export const dashboardRouter: Router = Router()

type DashboardRole = "chairman" | "junior_admin" | "members_admin" | "member"

interface StatItem {
  key: string
  label: string
  value: number | string
  hint: string
}

interface AttendanceTotals {
  present: number
  late: number
  absent: number
  excused: number
}

interface AttendanceWithSessions extends AttendanceTotals {
  sessions: number
}

interface AttendancePolicy {
  latePolicy: string
  excusedPolicy: string
}

interface GoalProgressItem {
  id: string
  name: string
  target: number
  unit: string
  current: number
  percent: number
  deadline: string | null
  status: string
}

interface EventItem {
  id: string
  name: string
  eventType: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
}

interface AnnouncementItem {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  publishedAt: string | null
}

interface SongItem {
  id: string
  title: string
  category: string | null
  stage: string | null
  updatedAt: string
}

interface AuditItem {
  id: string
  action: string
  entityType: string
  entityId: string | null
  summary: string
  actorName: string | null
  createdAt: string
}

interface MemberProgress {
  songsLearning?: number
  trainingsCompleted?: number
  eventsAttended?: number
}

/** One row of the per-group overview shown to administrators. */
interface GroupSummary {
  id: string
  key: string
  name: string
  members: number
  pendingApplications: number
  attendanceRate: number | null
}

/** A pending application waiting for a decision. */
interface ApplicationSummary {
  id: string
  fullName: string
  groupName: string | null
  groupKey: string | null
  status: string
  submittedAt: string
}

/** A message a member has sent to the Chairman. */
interface MessageSummary {
  id: string
  senderName: string
  subject: string
  createdAt: string
  readAt: string | null
}

interface DashboardPayload {
  role: DashboardRole
  viewer: { displayName: string; memberNo: string | null; groupKey: string | null; groupName: string | null }
  /** Human description of what this viewer oversees, e.g. "Junior group". */
  scopeLabel: string
  stats: StatItem[]
  attendance?: AttendanceWithSessions & { rate: number | null }
  goalProgress?: GoalProgressItem[]
  upcomingEvents?: EventItem[]
  recentAnnouncements?: AnnouncementItem[]
  recentSongs?: SongItem[]
  recentAudit?: AuditItem[]
  myAttendance?: { sessions: number; present: number; rate: number | null }
  myProgress?: MemberProgress
  disciplineAlerts?: number
  training?: { upcoming: number; completed: number }
  /** Per-group member + application counts (all groups for the Chairman, own group otherwise). */
  groups?: GroupSummary[]
  /** Pending applications the viewer can decide on. */
  applicationsToReview?: ApplicationSummary[]
  /** Chairman only: unread member messages. */
  unreadMessages?: number
  /** Chairman only: the most recent member messages. */
  recentMessages?: MessageSummary[]
}

function attendancePolicy(): AttendancePolicy {
  const latePolicy = one<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'attendance.late_policy'",
  )?.value ?? "counts_as_present"
  const excusedPolicy = one<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'attendance.excused_policy'",
  )?.value ?? "excluded_from_denominator"
  return { latePolicy, excusedPolicy }
}

function computeRate(totals: AttendanceTotals, policy: AttendancePolicy): number | null {
  const numerator = totals.present + (policy.latePolicy === "counts_as_present" ? totals.late : 0)
  let denominator = totals.present + totals.late + totals.absent + totals.excused
  if (policy.excusedPolicy === "excluded_from_denominator") denominator -= totals.excused
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function scopeHint(scope: string[] | "all"): string {
  if (scope === "all") return "All groups"
  const names = scope
    .map((id) => getGroupById(id)?.name)
    .filter((name): name is string => Boolean(name))
  return names.length > 0 ? names.join(", ") : "No groups"
}

function attendanceTotals(scope: string[] | "all"): AttendanceWithSessions {
  if (scope !== "all" && scope.length === 0) {
    return { sessions: 0, present: 0, late: 0, absent: 0, excused: 0 }
  }
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (scope !== "all") {
    clauses.push(`m.group_id IN (${scope.map(() => "?").join(", ")})`)
    params.push(...scope)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const totals = one<AttendanceTotals>(
    `SELECT COALESCE(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
            COALESCE(SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
            COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
            COALESCE(SUM(CASE WHEN ar.status = 'excused' THEN 1 ELSE 0 END), 0) AS excused
       FROM attendance_records ar
       JOIN attendance_sessions s ON s.id = ar.session_id
       JOIN members m ON m.id = ar.member_id
       ${where}`,
    ...params,
  ) ?? { present: 0, late: 0, absent: 0, excused: 0 }
  const sessions = one<{ c: number }>(
    `SELECT COUNT(DISTINCT s.id) AS c
       FROM attendance_records ar
       JOIN attendance_sessions s ON s.id = ar.session_id
       JOIN members m ON m.id = ar.member_id
       ${where}`,
    ...params,
  )?.c ?? 0
  return { sessions, ...totals }
}

function attendanceForMember(memberId: string): AttendanceWithSessions {
  const totals = one<AttendanceTotals>(
    `SELECT COALESCE(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
            COALESCE(SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
            COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
            COALESCE(SUM(CASE WHEN ar.status = 'excused' THEN 1 ELSE 0 END), 0) AS excused
       FROM attendance_records ar
      WHERE ar.member_id = ?`,
    memberId,
  ) ?? { present: 0, late: 0, absent: 0, excused: 0 }
  const sessions = one<{ c: number }>(
    "SELECT COUNT(DISTINCT ar.session_id) AS c FROM attendance_records ar WHERE ar.member_id = ?",
    memberId,
  )?.c ?? 0
  return { sessions, ...totals }
}

function countActiveMembers(scope: string[] | "all"): number {
  if (scope !== "all" && scope.length === 0) return 0
  const clauses = ["m.status = 'active'"]
  const params: (string | number)[] = []
  if (scope !== "all") {
    clauses.push(`m.group_id IN (${scope.map(() => "?").join(", ")})`)
    params.push(...scope)
  }
  return one<{ c: number }>(`SELECT COUNT(*) AS c FROM members m WHERE ${clauses.join(" AND ")}`, ...params)?.c ?? 0
}

function countPendingApplications(scope: string[] | "all"): number {
  if (scope !== "all" && scope.length === 0) return 0
  const clauses = ["a.status IN ('pending', 'under_review', 'more_info_required')"]
  const params: (string | number)[] = []
  if (scope !== "all") {
    clauses.push(`COALESCE(a.assigned_group_id, a.requested_group_id) IN (${scope.map(() => "?").join(", ")})`)
    params.push(...scope)
  }
  return one<{ c: number }>(`SELECT COUNT(*) AS c FROM applications a WHERE ${clauses.join(" AND ")}`, ...params)?.c ?? 0
}

function countUpcomingEvents(): number {
  return one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM events WHERE date >= ? AND status <> 'cancelled'",
    today(),
  )?.c ?? 0
}

function countActiveGoals(): number {
  return one<{ c: number }>("SELECT COUNT(*) AS c FROM goals WHERE status = 'active'")?.c ?? 0
}

function disciplineAlerts(scope: string[] | "all", memberId: string | null): number {
  const clauses = ["d.status IN ('open', 'in_progress')", "c.kind = 'negative'"]
  const params: (string | number)[] = []
  if (memberId) {
    clauses.push("d.member_id = ?")
    params.push(memberId)
  } else if (scope !== "all") {
    if (scope.length === 0) return 0
    clauses.push(`m.group_id IN (${scope.map(() => "?").join(", ")})`)
    params.push(...scope)
  }
  return one<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM discipline_records d
       JOIN discipline_categories c ON c.id = d.category_id
       JOIN members m ON m.id = d.member_id
      WHERE ${clauses.join(" AND ")}`,
    ...params,
  )?.c ?? 0
}

function countSongsLearning(groupId: string | null): number {
  if (!groupId) return 0
  return one<{ c: number }>(
    `SELECT COUNT(DISTINCT s.id) AS c
       FROM song_group_assignments sga
       JOIN songs s ON s.id = sga.song_id
       LEFT JOIN learning_stages ls ON ls.id = s.learning_stage_id
      WHERE sga.group_id = ? AND s.status = 'active'
        AND (ls.key IS NULL OR ls.key <> 'ready_for_performance')`,
    groupId,
  )?.c ?? 0
}

function countTrainingsCompleted(memberId: string): number {
  return one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM training_participants WHERE member_id = ? AND completed = 1",
    memberId,
  )?.c ?? 0
}

function countEventsAttended(memberId: string): number {
  return one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM event_participants WHERE member_id = ?",
    memberId,
  )?.c ?? 0
}

/** Admin-facing statistics; each entry is only added when the viewer holds the permission. */
function adminStats(user: AuthUser, policy: AttendancePolicy): StatItem[] {
  const stats: StatItem[] = []
  if (can(user, "member.read")) {
    const scope = permittedGroupIds(user, "member.read")
    stats.push({ key: "members", label: "Active members", value: countActiveMembers(scope), hint: scopeHint(scope) })
  }
  if (can(user, "application.read")) {
    const scope = permittedGroupIds(user, "application.read")
    stats.push({ key: "applications", label: "Applications awaiting review", value: countPendingApplications(scope), hint: scopeHint(scope) })
  }
  if (can(user, "attendance.read") || can(user, "reports.read")) {
    const scope = permittedGroupIds(user, "attendance.read")
    const rate = computeRate(attendanceTotals(scope), policy)
    stats.push({ key: "attendance", label: "Attendance rate", value: rate === null ? "—" : `${rate}%`, hint: scopeHint(scope) })
  }
  if (can(user, "events.read")) {
    stats.push({ key: "events", label: "Upcoming events", value: countUpcomingEvents(), hint: "From today onward" })
  }
  if (can(user, "discipline.read")) {
    const scope = permittedGroupIds(user, "discipline.read")
    stats.push({ key: "discipline", label: "Open discipline records", value: disciplineAlerts(scope, null), hint: scopeHint(scope) })
  }
  if (can(user, "goals.read")) {
    stats.push({ key: "goals", label: "Active goals", value: countActiveGoals(), hint: "Organisation-wide and group goals" })
  }
  return stats
}

/** Personal statistics for a singer or support member — never the member directory. */
function memberStats(user: AuthUser, policy: AttendancePolicy): StatItem[] {
  const stats: StatItem[] = []
  if (user.memberId && can(user, "attendance.read")) {
    const own = attendanceForMember(user.memberId)
    const rate = computeRate(own, policy)
    stats.push({
      key: "attendance",
      label: "My attendance rate",
      value: rate === null ? "—" : `${rate}%`,
      hint: `${own.present} present across ${own.sessions} sessions`,
    })
  }
  if (user.memberId && can(user, "music.read")) {
    stats.push({ key: "songs", label: "Songs learning", value: countSongsLearning(user.groupId), hint: "Assigned to your group" })
  }
  if (user.memberId && can(user, "training.read")) {
    stats.push({ key: "trainings", label: "Trainings completed", value: countTrainingsCompleted(user.memberId), hint: "Marked complete" })
  }
  if (user.memberId && can(user, "events.read")) {
    stats.push({ key: "events", label: "Events attended", value: countEventsAttended(user.memberId), hint: "Recorded as a participant" })
  }
  return stats
}

function memberProgress(user: AuthUser): MemberProgress {
  const progress: MemberProgress = {}
  if (!user.memberId) return progress
  if (can(user, "music.read")) progress.songsLearning = countSongsLearning(user.groupId)
  if (can(user, "training.read")) progress.trainingsCompleted = countTrainingsCompleted(user.memberId)
  if (can(user, "events.read")) progress.eventsAttended = countEventsAttended(user.memberId)
  return progress
}

function activeGoalProgress(): GoalProgressItem[] {
  const rows = all<{
    id: string
    name: string
    target_value: number
    unit: string
    deadline: string | null
    status: string
    current: number
  }>(
    `SELECT g.id, g.name, g.target_value, g.unit, g.deadline, g.status,
            COALESCE((SELECT SUM(gp.value) FROM goal_progress gp WHERE gp.goal_id = g.id), 0) AS current
       FROM goals g
      WHERE g.status = 'active'
      ORDER BY (g.deadline IS NULL), g.deadline ASC
      LIMIT 5`,
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    target: row.target_value,
    unit: row.unit,
    current: row.current,
    percent: row.target_value > 0 ? Math.min(100, Math.round((row.current / row.target_value) * 100)) : 0,
    deadline: row.deadline,
    status: row.status,
  }))
}

function upcomingEvents(): EventItem[] {
  const rows = all<{
    id: string
    name: string
    event_type: string
    date: string
    start_time: string | null
    end_time: string | null
    location: string | null
  }>(
    `SELECT id, name, event_type, date, start_time, end_time, location
       FROM events
      WHERE date >= ? AND status <> 'cancelled'
      ORDER BY date ASC, start_time ASC
      LIMIT 5`,
    today(),
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    eventType: row.event_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
  }))
}

interface AnnouncementRow {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  published_at: string | null
}

function recentAnnouncements(user: AuthUser, limit: number): AnnouncementItem[] {
  const columns = "a.id, a.title, a.message, a.audience, a.priority, a.published_at"
  let rows: AnnouncementRow[]
  if (can(user, "announcements.write")) {
    rows = all<AnnouncementRow>(
      `SELECT ${columns} FROM announcements a
        WHERE a.status = 'published'
        ORDER BY a.published_at DESC
        LIMIT ?`,
      limit,
    )
  } else {
    const groupKey = user.groupId ? getGroupById(user.groupId)?.key ?? "" : ""
    rows = all<AnnouncementRow>(
      `SELECT ${columns} FROM announcements a
        WHERE a.status = 'published'
          AND (a.audience = 'all'
               OR a.audience = ?
               OR EXISTS (SELECT 1 FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.user_id = ?))
        ORDER BY a.published_at DESC
        LIMIT ?`,
      groupKey, user.id, limit,
    )
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    audience: row.audience,
    priority: row.priority,
    publishedAt: row.published_at,
  }))
}

function recentSongs(): SongItem[] {
  const rows = all<{ id: string; title: string; category: string | null; stage: string | null; updated_at: string }>(
    `SELECT s.id, s.title, sc.name AS category, ls.name AS stage, s.updated_at
       FROM songs s
       LEFT JOIN song_categories sc ON sc.id = s.category_id
       LEFT JOIN learning_stages ls ON ls.id = s.learning_stage_id
      WHERE s.status = 'active'
      ORDER BY s.updated_at DESC
      LIMIT 5`,
  )
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    stage: row.stage,
    updatedAt: row.updated_at,
  }))
}

function recentAudit(): AuditItem[] {
  const rows = all<{
    id: string
    action: string
    entity_type: string
    entity_id: string | null
    summary: string
    actor_name: string | null
    created_at: string
  }>(
    `SELECT id, action, entity_type, entity_id, summary, actor_name, created_at
       FROM audit_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 5`,
  )
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }))
}

function trainingCounts(): { upcoming: number; completed: number } {
  const upcoming = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM training_sessions WHERE date >= ? AND status IN ('planned', 'in_progress')",
    today(),
  )?.c ?? 0
  const completed = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM training_sessions WHERE status = 'completed'",
  )?.c ?? 0
  return { upcoming, completed }
}

/** Member + pending-application counts per group, plus that group's attendance rate. */
function groupSummaries(scope: string[] | "all", policy: AttendancePolicy): GroupSummary[] {
  const groups = scope === "all"
    ? listGroups()
    : scope.map((id) => getGroupById(id)).filter((group): group is GroupRow => Boolean(group))
  return groups.map((group) => ({
    id: group.id,
    key: group.key,
    name: group.name,
    members: countActiveMembers([group.id]),
    pendingApplications: countPendingApplications([group.id]),
    attendanceRate: computeRate(attendanceTotals([group.id]), policy),
  }))
}

/** The most recent pending applications within the viewer's scope. */
function applicationsToReview(scope: string[] | "all", limit = 6): ApplicationSummary[] {
  if (scope !== "all" && scope.length === 0) return []
  const clauses = ["a.status IN ('pending', 'under_review', 'more_info_required')"]
  const params: (string | number)[] = []
  if (scope !== "all") {
    clauses.push(`COALESCE(a.assigned_group_id, a.requested_group_id) IN (${scope.map(() => "?").join(",")})`)
    params.push(...scope)
  }
  const rows = all<{
    id: string
    full_name: string
    status: string
    submitted_at: string
    group_name: string | null
    group_key: string | null
  }>(
    `SELECT a.id, a.full_name, a.status, a.submitted_at,
            COALESCE(ag.name, rg.name) AS group_name, COALESCE(ag.key, rg.key) AS group_key
       FROM applications a
       LEFT JOIN groups ag ON ag.id = a.assigned_group_id
       LEFT JOIN groups rg ON rg.id = a.requested_group_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.submitted_at DESC, a.created_at DESC
      LIMIT ?`,
    ...params, limit,
  )
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    groupName: row.group_name,
    groupKey: row.group_key,
    status: row.status,
    submittedAt: row.submitted_at,
  }))
}

/** Recent messages addressed to the viewer (used by the Chairman to see who wrote). */
function recentMessagesFor(recipientId: string, limit = 5): MessageSummary[] {
  const rows = all<{ id: string; sender_name: string; subject: string; created_at: string; read_at: string | null }>(
    `SELECT id, sender_name, subject, created_at, read_at
       FROM messages
      WHERE recipient_user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    recipientId, limit,
  )
  return rows.map((row) => ({
    id: row.id,
    senderName: row.sender_name,
    subject: row.subject,
    createdAt: row.created_at,
    readAt: row.read_at,
  }))
}

function unreadMessagesFor(recipientId: string): number {
  return one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM messages WHERE recipient_user_id = ? AND read_at IS NULL",
    recipientId,
  )?.c ?? 0
}

dashboardRouter.get("/", requireAuth, (req, res) => {
  const user = req.auth!
  const role: DashboardRole = user.roles.includes("chairman")
    ? "chairman"
    : user.roles.includes("junior_admin")
      ? "junior_admin"
      : user.roles.includes("members_admin")
        ? "members_admin"
        : "member"
  const group = user.groupId ? getGroupById(user.groupId) : undefined
  const viewer = { displayName: user.displayName, memberNo: user.memberNo, groupKey: group?.key ?? null, groupName: group?.name ?? null }
  const policy = attendancePolicy()
  const payload: DashboardPayload = { role, viewer, scopeLabel: "your own records", stats: [] }

  if (role !== "member") {
    const memberScope = permittedGroupIds(user, "member.read")
    const applicationScope = permittedGroupIds(user, "application.read")

    payload.scopeLabel = role === "chairman" ? "All three groups" : scopeHint(memberScope)
    payload.stats = adminStats(user, policy)
    if (role === "chairman") {
      payload.groups = groupSummaries("all", policy)
    } else {
      payload.groups = groupSummaries(memberScope, policy)
    }
    payload.applicationsToReview = applicationsToReview(applicationScope, role === "chairman" ? 6 : 5)
    if (can(user, "attendance.read") || can(user, "reports.read")) {
      const totals = attendanceTotals(permittedGroupIds(user, "attendance.read"))
      payload.attendance = { ...totals, rate: computeRate(totals, policy) }
    }
    if (can(user, "discipline.read")) {
      payload.disciplineAlerts = disciplineAlerts(permittedGroupIds(user, "discipline.read"), null)
    }
    if (can(user, "training.read")) payload.training = trainingCounts()
    if (role === "chairman") {
      payload.unreadMessages = unreadMessagesFor(user.id)
      payload.recentMessages = recentMessagesFor(user.id, 5)
    }
  } else {
    payload.stats = memberStats(user, policy)
    if (user.memberId && can(user, "attendance.read")) {
      const own = attendanceForMember(user.memberId)
      payload.myAttendance = { sessions: own.sessions, present: own.present, rate: computeRate(own, policy) }
    }
    if (user.memberId) {
      const progress = memberProgress(user)
      if (Object.keys(progress).length > 0) payload.myProgress = progress
    }
    if (user.memberId && can(user, "discipline.read")) {
      payload.disciplineAlerts = disciplineAlerts([], user.memberId)
    }
  }

  if (can(user, "goals.read")) payload.goalProgress = activeGoalProgress()
  if (can(user, "events.read")) payload.upcomingEvents = upcomingEvents()
  if (can(user, "announcements.read")) payload.recentAnnouncements = recentAnnouncements(user, 5)
  if (can(user, "music.read")) payload.recentSongs = recentSongs()
  if (can(user, "audit.read")) payload.recentAudit = recentAudit()

  res.json(payload)
})
