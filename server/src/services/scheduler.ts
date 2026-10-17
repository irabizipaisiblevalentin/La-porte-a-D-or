import { all, one, run } from "../db/index.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { audienceUserIds, notifyMany } from "./notifications.js"

/**
 * Publishes scheduled announcements whose time has arrived.
 * Runs on a real interval in the server process; nothing is delivered before it is published.
 */
export function publishDueAnnouncements(): number {
  const due = all<{ id: string; title: string; message: string; audience: string; priority: string; created_by: string | null }>(
    `SELECT id, title, message, audience, priority, created_by
       FROM announcements
      WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`,
    nowIso(),
  )
  if (due.length === 0) return 0
  const timestamp = nowIso()
  for (const announcement of due) {
    run("UPDATE announcements SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?",
      timestamp, timestamp, announcement.id)
    const recipients = announcement.audience === "selected"
      ? all<{ user_id: string }>("SELECT user_id FROM announcement_recipients WHERE announcement_id = ?", announcement.id).map((r) => r.user_id)
      : audienceUserIds(announcement.audience)
    notifyMany(recipients.map((userId) => ({
      userId,
      type: "announcement",
      title: announcement.title,
      body: announcement.message.slice(0, 240),
      link: `/announcements/${announcement.id}`,
    })))
  }
  return due.length
}

/** Clears expired lockouts so a temporary lock does not persist after its window. */
export function clearExpiredLockouts(): void {
  run("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE locked_until IS NOT NULL AND locked_until <= ?", nowIso())
}

export function createNotificationId(): string {
  return id()
}

export function pendingPasswordResets(): { count: number } {
  const row = one<{ c: number }>("SELECT COUNT(*) AS c FROM password_resets WHERE used_at IS NULL AND expires_at > ?", nowIso())
  return { count: row?.c ?? 0 }
}
