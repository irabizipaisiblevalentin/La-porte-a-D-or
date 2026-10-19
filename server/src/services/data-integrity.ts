import type { RestoreAlert } from "../config.js"
import { all, one } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { notifyMany } from "./notifications.js"

/**
 * "Your data may be gone" reporting.
 *
 * On hosts with an ephemeral disk the database is wiped on every restart and
 * brought back by Litestream (see deploy/render-start.sh). When that restore
 * fails the app used to boot on a brand-new, perfectly healthy-looking empty
 * database — which is how real member records disappeared unnoticed.
 *
 * The start script now leaves a marker (config.ts → restoreAlert); this module
 * turns it into something a human cannot miss: a loud log line, one immutable
 * audit entry, and a notification in the Chairman's bell. The same alert is
 * exposed on GET /api/health and shown as a banner in the web app.
 */

/** One-line summary of what went wrong, shown in the log, the audit entry and the bell. */
export function restoreAlertHeadline(alert: RestoreAlert): string {
  if (alert.reason === "replication_disabled") return "Durable storage is not configured — every restart erases all data"
  if (alert.reason === "litestream_unavailable") return "Database backup tool is missing — this data is not being backed up"
  return "Database could not be restored — recent records may be missing"
}

export function reportRestoreAlert(alert: RestoreAlert | null): void {
  if (!alert) return

  const headline = restoreAlertHeadline(alert)

  console.error(
    [
      "",
      "##########################################################################",
      `# DATA INTEGRITY WARNING: ${headline}`,
      `# reason: ${alert.reason}${alert.at ? ` (at ${alert.at})` : ""}`,
      `# ${alert.detail ?? "see docs/DEPLOYMENT.md"}`,
      "# The app is running, but it is NOT on the real database.",
      "# Do not re-enter records until storage access is fixed and it restores.",
      "##########################################################################",
      "",
    ].join("\n"),
  )

  try {
    // One report per database: a restart of the same instance must not ring the
    // Chairman's bell again, and the audit log is append-only.
    if (one<{ id: string }>("SELECT id FROM audit_logs WHERE action = 'system.database_restore_failed' LIMIT 1")) return

    recordAudit({
      action: "system.database_restore_failed",
      entityType: "system",
      summary: headline,
      detail: { reason: alert.reason, at: alert.at, detail: alert.detail },
    })

    const chairmen = all<{ id: string }>(
      `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_id = 'role_chairman' AND u.status = 'active'`,
    )
    notifyMany(
      chairmen.map((chairman) => ({
        userId: chairman.id,
        type: "system",
        title: headline,
        body: `${alert.detail ?? "The database was not restored on the last restart."} Do not re-enter records until storage access is restored.`,
        link: "/app/account",
      })),
    )
  } catch (error) {
    console.error("[setup] could not report the restore warning:", error)
  }
}
