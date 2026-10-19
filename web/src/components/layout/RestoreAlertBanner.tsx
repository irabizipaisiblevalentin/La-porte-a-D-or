import { AlertTriangle } from "lucide-react"
import { useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"

/** Shape of GET /api/health (see server/src/app.ts). */
interface HealthResponse {
  status: string
  warning?: string
  restoreAlert?: {
    reason: "restore_failed" | "replication_disabled" | "litestream_unavailable"
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
 */
export function RestoreAlertBanner() {
  const { can } = useAuth()
  const allowed = can("settings.read") || can("application.decide")
  const { data } = useQuery<HealthResponse>(allowed ? "/health" : null)

  const alert = data?.restoreAlert
  if (!alert) return null

  const headline =
    alert.reason === "replication_disabled"
      ? "This deployment has no durable storage — every restart erases all data"
      : alert.reason === "litestream_unavailable"
        ? "The database backup tool is missing — new records are not being backed up"
        : "The database could not be restored on the last restart — records may be missing"

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
          {alert.detail ? `${alert.detail}. ` : ""}
          Do not re-enter records until storage access is fixed and the database restores — see{" "}
          <span className="font-medium">docs/DEPLOYMENT.md</span> (Troubleshooting).
        </p>
        {alert.at ? <p className="muted mt-0.5 text-[11px]">Detected at {alert.at}</p> : null}
      </div>
    </div>
  )
}
