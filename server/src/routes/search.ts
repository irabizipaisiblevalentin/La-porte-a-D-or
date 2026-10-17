import { Router } from "express"
import { can, type AuthUser } from "../auth/access.js"
import { all } from "../db/index.js"
import { queryString } from "../lib/http.js"
import { permittedGroupIds, requireAuth, requirePermission } from "../middleware/auth.js"

export const searchRouter: Router = Router()

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string
  link: string
}

const MAX_RESULTS = 40
const PER_TYPE = 10

function memberResults(user: AuthUser, like: string): SearchResult[] {
  const scope = permittedGroupIds(user, "member.read")
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (scope !== "all") {
    const parts: string[] = []
    if (scope.length > 0) {
      parts.push(`m.group_id IN (${scope.map(() => "?").join(", ")})`)
      params.push(...scope)
    }
    // A singer may only ever find their own record, never the directory.
    if (can(user, "member.read", "own") && user.memberId) {
      parts.push("m.id = ?")
      params.push(user.memberId)
    }
    if (parts.length === 0) return []
    clauses.push(`(${parts.join(" OR ")})`)
  }
  clauses.push("(m.full_name LIKE ? OR m.member_no LIKE ?)")
  params.push(like, like)

  const rows = all<{ id: string; full_name: string; member_no: string; group_name: string }>(
    `SELECT m.id, m.full_name, m.member_no, g.name AS group_name
       FROM members m
       JOIN groups g ON g.id = m.group_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY m.full_name COLLATE NOCASE
      LIMIT ?`,
    ...params, PER_TYPE,
  )
  return rows.map((row) => ({
    type: "member",
    id: row.id,
    title: row.full_name,
    subtitle: `${row.member_no} · ${row.group_name}`,
    link: `/members/${row.id}`,
  }))
}

function songResults(like: string): SearchResult[] {
  const rows = all<{ id: string; title: string; composer: string | null; category_name: string | null }>(
    `SELECT s.id, s.title, s.composer, sc.name AS category_name
       FROM songs s
       LEFT JOIN song_categories sc ON sc.id = s.category_id
      WHERE s.status = 'active' AND s.title LIKE ?
      ORDER BY s.title COLLATE NOCASE
      LIMIT ?`,
    like, PER_TYPE,
  )
  return rows.map((row) => ({
    type: "song",
    id: row.id,
    title: row.title,
    subtitle: [row.composer, row.category_name].filter((part): part is string => Boolean(part)).join(" · ") || "Song",
    link: `/songs/${row.id}`,
  }))
}

function eventResults(like: string): SearchResult[] {
  const rows = all<{ id: string; name: string; event_type: string; date: string }>(
    `SELECT id, name, event_type, date
       FROM events
      WHERE name LIKE ? AND status <> 'cancelled'
      ORDER BY date DESC
      LIMIT ?`,
    like, PER_TYPE,
  )
  return rows.map((row) => ({
    type: "event",
    id: row.id,
    title: row.name,
    subtitle: `${row.date} · ${row.event_type}`,
    link: `/events/${row.id}`,
  }))
}

function trainingResults(like: string): SearchResult[] {
  const rows = all<{ id: string; title: string; date: string }>(
    `SELECT id, title, date
       FROM training_sessions
      WHERE title LIKE ?
      ORDER BY date DESC
      LIMIT ?`,
    like, PER_TYPE,
  )
  return rows.map((row) => ({
    type: "training",
    id: row.id,
    title: row.title,
    subtitle: row.date,
    link: `/training/${row.id}`,
  }))
}

function applicationResults(user: AuthUser, like: string): SearchResult[] {
  const scope = permittedGroupIds(user, "application.read")
  const clauses: string[] = ["(a.full_name LIKE ? OR a.email LIKE ?)"]
  const params: (string | number)[] = [like, like]
  if (scope !== "all") {
    if (scope.length === 0) return []
    clauses.push(`COALESCE(a.assigned_group_id, a.requested_group_id) IN (${scope.map(() => "?").join(", ")})`)
    params.push(...scope)
  }
  const rows = all<{ id: string; full_name: string; email: string | null; status: string }>(
    `SELECT a.id, a.full_name, a.email, a.status
       FROM applications a
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.submitted_at DESC
      LIMIT ?`,
    ...params, PER_TYPE,
  )
  return rows.map((row) => ({
    type: "application",
    id: row.id,
    title: row.full_name,
    subtitle: [row.email, row.status].filter((part): part is string => Boolean(part)).join(" · "),
    link: `/applications/${row.id}`,
  }))
}

function groupResults(like: string): SearchResult[] {
  const rows = all<{ id: string; name: string }>(
    "SELECT id, name FROM groups WHERE name LIKE ? ORDER BY name LIMIT 5",
    like,
  )
  return rows.map((row) => ({
    type: "group",
    id: row.id,
    title: row.name,
    subtitle: "Group",
    link: `/members?groupId=${row.id}`,
  }))
}

function voiceSectionResults(like: string): SearchResult[] {
  const rows = all<{ id: string; name: string }>(
    "SELECT id, name FROM voice_sections WHERE name LIKE ? ORDER BY sort_order LIMIT 5",
    like,
  )
  return rows.map((row) => ({
    type: "voice",
    id: row.id,
    title: row.name,
    subtitle: "Voice section",
    link: `/members?voiceSectionId=${row.id}`,
  }))
}

searchRouter.get("/", requireAuth, requirePermission("search.global"), (req, res) => {
  const q = queryString(req, "q")
  if (!q || q.length < 2) {
    res.json({ results: [] })
    return
  }
  const user = req.auth!
  const like = `%${q}%`
  const results: SearchResult[] = []

  if (can(user, "member.read")) results.push(...memberResults(user, like))
  if (can(user, "music.read")) results.push(...songResults(like))
  if (can(user, "events.read")) results.push(...eventResults(like))
  if (can(user, "training.read")) results.push(...trainingResults(like))
  if (can(user, "application.read")) results.push(...applicationResults(user, like))
  results.push(...groupResults(like))
  results.push(...voiceSectionResults(like))

  res.json({ results: results.slice(0, MAX_RESULTS) })
})
