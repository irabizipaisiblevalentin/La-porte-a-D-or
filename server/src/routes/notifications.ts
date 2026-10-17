import { Router } from "express"
import { all, one, run } from "../db/index.js"
import { notFound } from "../lib/errors.js"
import { makePage, pagination, queryBool } from "../lib/http.js"
import { requireAuth } from "../middleware/auth.js"
import { nowIso } from "../lib/time.js"
import { unreadCount } from "../services/notifications.js"

export const notificationsRouter: Router = Router()

interface NotificationRow {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

notificationsRouter.get("/", requireAuth, (req, res) => {
  const p = pagination(req)
  const unreadOnly = queryBool(req, "unread") === true
  const where = unreadOnly ? "WHERE user_id = ? AND read_at IS NULL" : "WHERE user_id = ?"

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM notifications ${where}`, req.auth!.id)?.c ?? 0
  const items = all<NotificationRow>(
    `SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    req.auth!.id, p.limit, p.offset,
  )
  res.json(makePage(items, total, p))
})

notificationsRouter.get("/unread-count", requireAuth, (req, res) => {
  res.json({ count: unreadCount(req.auth!.id) })
})

notificationsRouter.post("/read-all", requireAuth, (req, res) => {
  const result = run(
    "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
    nowIso(), req.auth!.id,
  )
  res.json({ ok: true, updated: result.changes })
})

notificationsRouter.post("/:id/read", requireAuth, (req, res) => {
  const notification = one<{ id: string; read_at: string | null }>(
    "SELECT id, read_at FROM notifications WHERE id = ? AND user_id = ?",
    String(req.params.id), req.auth!.id,
  )
  if (!notification) throw notFound("That notification does not exist.")
  if (!notification.read_at) {
    run("UPDATE notifications SET read_at = ? WHERE id = ?", nowIso(), notification.id)
  }
  res.json({ ok: true })
})
