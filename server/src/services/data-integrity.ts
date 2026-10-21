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
  if (alert.reason === "pinned_restore") return "A recovery pin is still set — every restart discards records entered since"
  return "Database could not be restored — recent records may be missing"
}

/**
 * True for reasons where the app is knowingly running on the wrong (or an old)
 * database, so the "do not re-enter records" advice applies as written.
 * A pinned restore is different: the data is real and current once the pin is
 * removed, so that advice would be misleading.
 */
function isRecoveryIncomplete(alert: RestoreAlert): boolean {
  return alert.reason !== "pinned_restore"
}

export function reportRestoreAlert(alert: RestoreAlert | null): void {
  if (!alert) return

  const headline = restoreAlertHeadline(alert)
  const incomplete = isRecoveryIncomplete(alert)

  console.error(
    [
      "",
      "##########################################################################",
      `# DATA INTEGRITY WARNING: ${headline}`,
      `# reason: ${alert.reason}${alert.at ? ` (at ${alert.at})` : ""}`,
      `# ${alert.detail ?? "see docs/DEPLOYMENT.md"}`,
      incomplete
        ? "# The app is running, but it is NOT on the real database."
        : "# The app is on a real database, but an OLD one — the recovery pin is still set.",
      incomplete
        ? "# Do not re-enter records until storage access is fixed and it restores."
        : "# Remove RESTORE_TIMESTAMP to stop the rollbacks; what is there now will then be kept.",
      "##########################################################################",
      "",
    ].join("\n"),
  )

  try {
    // One report per kind of problem, per database: a restart of the same instance
    // must not ring the Chairman's bell again, and the audit log is append-only. The
    // action name distinguishes a rolled-back pin from a failed restore, so one can
    // never suppress the record of the other.
    const action = incomplete ? "system.database_restore_failed" : "system.database_restore_pinned"
    if (one<{ id: string }>("SELECT id FROM audit_logs WHERE action = ? LIMIT 1", action)) return

    recordAudit({
      action,
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
        body: incomplete
          ? `${alert.detail ?? "The database was not restored on the last restart."} Do not re-enter records until storage access is restored.`
          : `${alert.detail ?? "The database was restored to a pinned moment."} Remove RESTORE_TIMESTAMP so new records stop being discarded.`,
        link: "/app/account",
      })),
    )
  } catch (error) {
    console.error("[setup] could not report the restore warning:", error)
  }
}

/**
 * Startup integrity probe.
 *
 * A replica can restore "successfully" and still be unusable: a torn write in
 * the bucket leaves a database whose control structures look fine but whose
 * table pages are damaged. The app then boots looking healthy, and the damage
 * surfaces much later as a 500 on whichever page happens to read the broken
 * table — exactly what a malformed `songs` page did to the public music page and
 * the landing page.
 *
 * `PRAGMA integrity_check` alone is not enough: it can report "ok" for damage
 * that only appears when rows are actually scanned. So each critical table is
 * probed by reading a row through the same path a page would use, and any
 * failure is reported as loudly as a failed restore.
 */
const PROBE_TABLES = [
  "songs",
  "videos",
  "song_group_assignments",
  "members",
  "users",
  "applications",
  "events",
] as const

export interface IntegrityProblem {
  table: string
  message: string
}

/**
 * What the startup probe found, kept here so `GET /api/health` can report it
 * without re-scanning the tables on every request.
 */
const integrityProblems: IntegrityProblem[] = []

/** The problems found at boot; empty on a healthy database. */
export function reportedIntegrityProblems(): readonly IntegrityProblem[] {
  return integrityProblems
}

/**
 * Maps the "Tree N" numbers in an integrity report back to table names.
 *
 * SQLite's report says `Tree 75 page 75 cell 0: 2nd reference to page 251` — it
 * identifies the broken tree by its root page, not by name. A number alone is
 * useless to whoever has to fix it, so the root page of each probe table is read
 * from `sqlite_master` and used to translate. Trees that do not correspond to a
 * table we know are left as-is.
 */
function treeRootPages(): Map<number, string> {
  const map = new Map<number, string>()
  try {
    const rows = all<{ name: string; rootpage: number }>(
      "SELECT name, rootpage FROM sqlite_master WHERE type = 'table' AND rootpage > 0",
    )
    for (const row of rows) map.set(row.rootpage, row.name)
  } catch {
    // The catalog itself is unreadable; the raw report still gets reported.
  }
  return map
}

/** Replaces `Tree 75` with `Tree 75 (songs)` so the report names the table. */
function nameTrees(report: string, roots: Map<number, string>): string {
  return report.replace(/Tree (\d+)/g, (whole, number: string) => {
    const table = roots.get(Number(number))
    return table ? `${whole} (${table})` : whole
  })
}

/**
 * Reads every critical table end to end and runs SQLite's own integrity check;
 * returns what broke, if anything.
 *
 * Two independent signals, because they catch different damage:
 *
 *  1. `PRAGMA integrity_check` inspects the file's structures and is what
 *     actually named the live corruption (`2nd reference to page 251`). Its
 *     report is translated so it says which table each broken tree belongs to.
 *  2. A **full scan** of each critical table. `LIMIT 1` was not enough: the
 *     damage that took out the public music page sat deep in the `songs` tree,
 *     so reading the first row returned a healthy page and reported the table as
 *     fine while every real query failed. Scanning visits every page, which is
 *     what the failing queries do.
 */
export function checkDatabaseIntegrity(): IntegrityProblem[] {
  const problems: IntegrityProblem[] = []
  const roots = treeRootPages()

  try {
    const result = one<{ integrity_check: string }>("PRAGMA integrity_check")
    const verdict = result?.integrity_check ?? ""
    if (verdict && verdict !== "ok") {
      problems.push({ table: "(whole database)", message: nameTrees(verdict, roots) })
    }
  } catch (error) {
    problems.push({ table: "(whole database)", message: error instanceof Error ? error.message : String(error) })
  }

  for (const table of PROBE_TABLES) {
    try {
      // Walk the whole table, not just its first row — see the note above.
      all(`SELECT * FROM ${table}`)
    } catch (error) {
      problems.push({ table, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return problems
}

/** Logs, audits and rings the bell about a database that restored but is damaged. */
export function reportIntegrityProblems(problems: IntegrityProblem[]): void {
  if (problems.length === 0) return
  integrityProblems.length = 0
  integrityProblems.push(...problems)

  const headline = "The database restored but is damaged — some pages cannot be read"
  const summary = problems.map((problem) => `${problem.table}: ${problem.message}`).join(" | ")

  console.error(
    [
      "",
      "##########################################################################",
      `# DATA INTEGRITY WARNING: ${headline}`,
      ...problems.map((problem) => `#   ${problem.table}: ${problem.message}`),
      "# The app is running, but the database is NOT safe to write to.",
      "# Restore a clean point from the bucket (see docs/DEPLOYMENT.md) before",
      "# changing anything: writing over damaged pages makes recovery harder.",
      "##########################################################################",
      "",
    ].join("\n"),
  )

  try {
    // One report per database, so a restart of the same damaged file does not
    // ring the bell repeatedly.
    if (one<{ id: string }>("SELECT id FROM audit_logs WHERE action = 'system.database_damaged' LIMIT 1")) return

    recordAudit({
      action: "system.database_damaged",
      entityType: "system",
      summary: headline,
      detail: { problems },
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
        body: `${summary} Restore a clean point before changing anything.`,
        link: "/app/account",
      })),
    )
  } catch (error) {
    // The database is damaged; auditing it may itself fail. Never let that stop the boot.
    console.error("[integrity] could not record the damage report:", error)
  }
}
