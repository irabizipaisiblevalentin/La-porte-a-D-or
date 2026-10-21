import { AlertTriangle } from "lucide-react"
import { useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"

/** Shape of GET /api/health (see server/src/app.ts). */
interface HealthResponse {
  status: string
  warning?: string
  restoreAlert?: {
    reason: "restore_failed" | "replication_disabled" | "litestream_unavailable" | "pinned_restore"
    at: string | null
    detail: string | null
  }
}

/**
 * Shows a loud, unmissable notice when the server came up without its real
 * database (see server/src/index.ts → reportRestoreAlert, reported on
 * /api/health). Rendered for the people who act on records: group
 * administrators and the Chairman. A silent wipe must never look like a
 * healthy site again.
 *
 * A pinned recovery is included even though nothing failed: while
 * RESTORE_TIMESTAMP is set, every restart rolls the data back to the pinned
 * moment, so the site looks healthy while quietly discarding new records.
 */
export function RestoreAlertBanner() {
  const { can } = useAuth()
  const allowed = can("settings.read") || can("application.decide")
  const { data } = useQuery<HealthResponse>(allowed ? "/health" : null)

  const alert = data?.restoreAlert
  if (!alert) return null

  const pinned = alert.reason === "pinned_restore"
  const headline = pinned
    ? "A recovery pin is still set — every restart discards records entered since"
    : alert.reason === "replication_disabled"
      ? "This deployment has no durable storage — every restart erases all data"
      : alert.reason === "litestream_unavailable"
        ? "The database backup tool is missing — new records are not being backed up"
        : "The database could not be restored on the last restart — records may be missing"

  // Advice differs: a pin is cleared by removing one variable, after which what is
  // there now is kept. The other reasons mean storage is still broken.
  const advice = pinned
    ? "Remove RESTORE_TIMESTAMP in the Render environment and redeploy to stop the rollbacks — what is in the database now will then be kept."
    : "Do not re-enter records until storage access is fixed and the database restores"

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3"
      style={{
        borderColor: "color-mix(in srgb, #b4544a 45%, transparent)",
        background: "color-mix(in srgb, #b4544a 10%, transparent)",
      }}
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: "#b4544a" }} />
      <div className="text-sm">
        <p className="font-semibold" style={{ color: "#b4544a" }}>
          {headline}
        </p>
        <p className="muted mt-0.5 text-xs">
          {alert.detail ? `${alert.detail} ` : ""}
          {advice} — see <span className="font-medium">docs/DEPLOYMENT.md</span> (Troubleshooting).
        </p>
        {alert.at ? <p className="muted mt-0.5 text-[11px]">Detected at {alert.at}</p> : null}
      </div>
    </div>
  )
}
