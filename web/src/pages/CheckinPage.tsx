/**
 * The door.
 *
 * A steward points a phone camera at an entrance pass. The QR encodes a URL that
 * opens this page, so no scanner app is needed — the camera app's own "open link"
 * is the scanner. The page has two jobs and one rule:
 *
 *   - It shows **whose** pass it is, so the steward can see the name against the
 *     person standing in front of them.
 *   - It lets a signed-in steward **admit** them, once.
 *
 * The rule is that opening the page admits nobody. A pass can be photographed and
 * forwarded, so a scan on its own proves only that someone has a picture of a pass
 * — it is the steward pressing the button that lets a person in. A signed-in
 * steward sees the button; a visitor who merely followed the link sees the name
 * and a prompt to hand the phone to the door.
 */
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { BadgeCheck, DoorOpen, ScanLine, TriangleAlert } from "lucide-react"
import { api, ApiError } from "../api/client"
import { useAuth } from "../auth/AuthProvider"
import { Button, Card, CardBody, Spinner } from "../components/ui"

interface PassPreview {
  valid: boolean
  alreadyIn: boolean
  status: "issued" | "checked_in" | "revoked"
  holder: { name: string; memberNo: string }
  event: {
    id: string
    name: string
    date: string
    start_time: string | null
    location: string | null
  }
}

interface CheckinResult {
  outcome: "admitted" | "repeat" | "refused" | "unknown"
  message: string
  pass: { full_name?: string; member_no?: string } | null
}

function formatEventDate(value: string, time: string | null): string {
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  const day = Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
  return time ? `${day} at ${time}` : day
}

export function CheckinPage() {
  const { token = "" } = useParams()
  const { user, can } = useAuth()

  const [preview, setPreview] = useState<PassPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckinResult | null>(null)
  const [admitting, setAdmitting] = useState(false)

  const canCheckin = can("events.checkin")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<PassPreview>(`/public/pass/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        setError(
          failure instanceof ApiError
            ? failure.message
            : "This entrance pass could not be checked. Check the connection and scan again.",
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function admit() {
    if (!preview) return
    setAdmitting(true)
    try {
      const outcome = await api.post<CheckinResult>(`/events/${preview.event.id}/checkin`, {
        credential: token,
      })
      setResult(outcome)
      // The page is now spent: a second scan of the same pass must not look like
      // a fresh, valid pass, so the preview is refreshed to show the new state.
      const refreshed = await api.get<PassPreview>(`/public/pass/${encodeURIComponent(token)}`)
      setPreview(refreshed)
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Could not reach the server. The person is not admitted — try again.",
      )
    } finally {
      setAdmitting(false)
    }
  }

  const outcomeTone: Record<CheckinResult["outcome"], { background: string; icon: typeof BadgeCheck }> = {
    admitted: { background: "color-mix(in srgb, var(--color-green-500, #22c55e) 14%, transparent)", icon: BadgeCheck },
    repeat: { background: "color-mix(in srgb, var(--color-gold-400) 22%, transparent)", icon: TriangleAlert },
    refused: { background: "color-mix(in srgb, #a0433a 14%, transparent)", icon: TriangleAlert },
    unknown: { background: "color-mix(in srgb, #a0433a 14%, transparent)", icon: TriangleAlert },
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-4 py-10">
      <a href="/" className="mx-auto flex items-center gap-2.5">
        <img src="/logo.png" alt="" className="h-9 w-9" />
        <span className="font-semibold">Chorale La Porte d'Or</span>
      </a>

      {loading ? (
        <Card>
          <CardBody className="flex items-center justify-center gap-3 py-10">
            <Spinner /> <span className="text-sm">Reading the pass…</span>
          </CardBody>
        </Card>
      ) : error && !preview ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
            <TriangleAlert size={28} />
            <p className="font-semibold">Not a valid entrance pass</p>
            <p className="muted text-sm">{error}</p>
          </CardBody>
        </Card>
      ) : preview ? (
        <>
          {result ? (
            <div
              className="flex flex-col items-center gap-2 rounded-xl border hairline p-6 text-center"
              style={{ background: outcomeTone[result.outcome].background }}
            >
              {(() => {
                const Icon = outcomeTone[result.outcome].icon
                return <Icon size={32} />
              })()}
              <p className="text-lg font-semibold">
                {result.outcome === "admitted"
                  ? "Admitted"
                  : result.outcome === "repeat"
                    ? "Already admitted"
                    : "Refused"}
              </p>
              <p className="text-sm">{result.message}</p>
            </div>
          ) : null}

          <Card>
            <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
              <ScanLine size={26} />
              <div>
                <p className="muted text-xs font-medium uppercase tracking-wide">Entrance pass for</p>
                <p className="text-2xl font-semibold">{preview.holder.name}</p>
                {preview.holder.memberNo ? <p className="muted text-sm">{preview.holder.memberNo}</p> : null}
              </div>

              <div className="w-full rounded-xl border hairline p-4 text-left">
                <p className="font-semibold">{preview.event.name}</p>
                <p className="muted text-sm">{formatEventDate(preview.event.date, preview.event.start_time)}</p>
                {preview.event.location ? <p className="muted text-sm">{preview.event.location}</p> : null}
              </div>

              {!preview.valid ? (
                <p className="font-medium" data-tone="danger">
                  This pass has been cancelled. Do not admit them.
                </p>
              ) : preview.alreadyIn ? (
                <p className="font-medium">This pass has already been used at the door.</p>
              ) : (
                <p className="muted text-sm">Not yet admitted.</p>
              )}
            </CardBody>
          </Card>

          {canCheckin ? (
            <Button
              variant="gold"
              icon={<DoorOpen size={18} />}
              loading={admitting}
              disabled={!preview.valid}
              onClick={admit}
            >
              {preview.alreadyIn ? "Admit again and log it" : "Admit this person"}
            </Button>
          ) : (
            <Card>
              <CardBody className="text-center">
                <p className="text-sm font-medium">Hand this phone to the steward at the door.</p>
                <p className="muted mt-1 text-sm">
                  {user
                    ? "You are signed in, but working the door belongs to the person running the event."
                    : "Sign in with your choir account to admit people, or show this screen to whoever is on the door."}
                </p>
                {!user ? (
                  <a href={`/login?next=${encodeURIComponent(`/checkin/${token}`)}`} className="link mt-3 inline-block text-sm">
                    Sign in
                  </a>
                ) : null}
              </CardBody>
            </Card>
          )}
        </>
      ) : null}

      <p className="muted text-center text-xs">
        Opening this page does not admit anyone — only a steward can let a person in.
      </p>
    </div>
  )
}
