import { useMemo } from "react"
import { encodeQr, qrSvgPath } from "../../lib/qr"

/**
 * An entrance pass rendered as a QR code, with the holder's name and the typed
 * fallback underneath.
 *
 * The symbol is generated in the browser from the pass token — the token is never
 * sent anywhere to be turned into a picture, and nothing is fetched from a third
 * party. Rendering is a single SVG path, so a large symbol is one DOM element
 * rather than a thousand.
 */
export function PassQr({
  token,
  name,
  memberNo,
  group,
  passcode,
  status,
  size = 240,
}: {
  token: string
  name: string
  memberNo?: string
  group?: string
  passcode: string
  status?: "issued" | "checked_in" | "revoked"
  size?: number
}) {
  const code = useMemo(() => {
    try {
      const encoded = encodeQr(token)
      return { path: qrSvgPath(encoded), size: encoded.size, error: null as string | null }
    } catch (error) {
      return { path: "", size: 0, error: error instanceof Error ? error.message : "Could not build the code." }
    }
  }, [token])

  if (code.error) {
    return (
      <div className="rounded-xl border hairline p-4 text-sm" data-tone="danger">
        This pass could not be turned into a QR code: {code.error}
      </div>
    )
  }

  // Four modules of quiet zone: a code printed right up to its edge is one of the
  // most common reasons a scanner will not read it.
  const margin = 4
  const extent = code.size + margin * 2

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="rounded-xl border hairline bg-white p-3"
        style={{ opacity: status === "revoked" ? 0.4 : 1 }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${extent} ${extent}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`Entrance pass for ${name || "this member"}`}
        >
          <rect width={extent} height={extent} fill="#ffffff" />
          <path d={code.path} fill="#000000" transform={`translate(${margin} ${margin})`} />
        </svg>
      </div>

      <div className="text-center">
        <p className="font-semibold">{name || "Member"}</p>
        {memberNo || group ? (
          <p className="muted text-xs">
            {memberNo}
            {memberNo && group ? " · " : ""}
            {group}
          </p>
        ) : null}
        <p className="mt-2 font-mono text-lg tracking-widest">{passcode}</p>
        <p className="muted text-xs">Type this if the code will not scan.</p>
        {status === "revoked" ? (
          <p className="mt-2 text-sm font-medium" data-tone="danger">
            This pass has been cancelled and will not admit anyone.
          </p>
        ) : null}
        {status === "checked_in" ? (
          <p className="mt-2 text-sm font-medium">Already admitted.</p>
        ) : null}
      </div>
    </div>
  )
}
