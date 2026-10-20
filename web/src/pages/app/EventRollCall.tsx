import { useMemo, useState } from "react"
import { CheckCheck, Clock3, MinusCircle, ShieldQuestion, UserCheck } from "lucide-react"
import { api } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { Button, Card, CardBody, CardHeader, LoadingBlock, Select, useToast } from "../../components/ui"

/**
 * The roll-call.
 *
 * Answering an event is a promise; this is the record of who kept it. It is the
 * written form of the door, so it sits exactly where the door does — with whoever
 * works it — and it writes into the choir's ordinary attendance book, so a
 * performance's attendance is counted beside every rehearsal's.
 *
 * Marks are saved a click at a time rather than through a "Save" button: a
 * coordinator standing at the front with a list does not want to lose a mark
 * because they were interrupted, and a single changed row is a tiny request.
 */

type Mark = "present" | "late" | "absent" | "excused"

interface RollCallEntry {
  member_id: string
  full_name: string
  member_no: string
  group_name: string
  status: Mark | "unmarked"
  notes: string | null
}

interface RollCall {
  sessionId: string | null
  counts: Record<Mark | "unmarked" | "total", number>
  entries: RollCallEntry[]
}

const MARKS: { key: Mark; label: string; short: string; icon: typeof CheckCheck }[] = [
  { key: "present", label: "Present", short: "P", icon: CheckCheck },
  { key: "late", label: "Late", short: "L", icon: Clock3 },
  { key: "absent", label: "Absent", short: "A", icon: MinusCircle },
  { key: "excused", label: "Excused", short: "E", icon: ShieldQuestion },
]

/** The colour a mark is drawn in, kept in one place so the list reads consistently. */
function markColour(status: Mark | "unmarked"): string {
  switch (status) {
    case "present":
      return "color-mix(in srgb, var(--color-green-500, #22c55e) 20%, transparent)"
    case "late":
      return "color-mix(in srgb, var(--color-gold-400) 26%, transparent)"
    case "absent":
      return "color-mix(in srgb, #a0433a 16%, transparent)"
    case "excused":
      return "color-mix(in srgb, currentColor 9%, transparent)"
    default:
      return "transparent"
  }
}

export function EventRollCall({ eventId }: { eventId: string }) {
  const toast = useToast()
  const query = useQuery<{ rollCall: RollCall }>(`/events/${eventId}/roll-call`)
  const [filter, setFilter] = useState<"all" | "unmarked" | Mark>("all")

  // Marks are held locally as they are clicked, so the list updates at once and a
  // slow save never makes the button look stuck.
  const [pending, setPending] = useState<Record<string, Mark | "unmarked">>({})

  const save = useMutation((records: { memberId: string; status: Mark }[]) =>
    api.put<{ rollCall: RollCall }>(`/events/${eventId}/roll-call`, { records }),
  )

  const rollCall = query.data?.rollCall
  const entries = useMemo(() => {
    const rows = rollCall?.entries ?? []
    if (filter === "all") return rows
    return rows.filter((row) => (pending[row.member_id] ?? row.status) === filter)
  }, [rollCall, filter, pending])

  async function applyMark(entry: RollCallEntry, status: Mark) {
    setPending((current) => ({ ...current, [entry.member_id]: status }))
    const result = await save.run([{ memberId: entry.member_id, status }])
    if (!result) {
      // Put the row back if the save failed, so the screen never lies about what
      // was recorded.
      setPending((current) => {
        const next = { ...current }
        delete next[entry.member_id]
        return next
      })
      toast.error(save.error?.message ?? "That mark could not be saved. Check the connection and try again.")
      return
    }
    query.reload()
  }

  function markAllPresent() {
    const rows = (rollCall?.entries ?? []).filter((row) => (pending[row.member_id] ?? row.status) === "unmarked")
    if (rows.length === 0) return
    void save
      .run(rows.map((row) => ({ memberId: row.member_id, status: "present" as Mark })))
      .then((result) => {
        if (!result) {
          toast.error(save.error?.message ?? "The roll-call could not be saved.")
          return
        }
        toast.success(`${rows.length} marked present.`)
        query.reload()
      })
  }

  const counts = rollCall?.counts

  return (
    <Card>
      <CardHeader
        title="Roll-call"
        description={
          counts
            ? `${counts.present} present · ${counts.late} late · ${counts.absent} absent · ${counts.excused} excused · ${counts.unmarked} not yet marked.`
            : "Who actually came."
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            icon={<UserCheck size={14} />}
            loading={save.saving}
            disabled={!counts || counts.unmarked === 0}
            onClick={markAllPresent}
          >
            Mark the rest present
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {query.loading && !query.data ? (
          <LoadingBlock label="Loading the roll-call…" rows={5} />
        ) : query.error ? (
          <p className="text-sm" data-tone="danger">
            {query.error.message}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <span className="muted">Show</span>
                <Select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as typeof filter)}
                  aria-label="Filter the roll-call"
                >
                  <option value="all">Everyone</option>
                  <option value="unmarked">Not yet marked</option>
                  {MARKS.map((mark) => (
                    <option key={mark.key} value={mark.key}>
                      {mark.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            {entries.length === 0 ? (
              <p className="muted text-sm">
                {filter === "all"
                  ? "Nobody is in this event's audience yet."
                  : "Nobody matches that filter."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-current/10">
                {entries.map((entry) => {
                  const status = pending[entry.member_id] ?? entry.status
                  return (
                    <li key={entry.member_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium">{entry.full_name}</p>
                        <p className="muted text-xs">
                          {entry.member_no} · {entry.group_name}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {MARKS.map((mark) => {
                          const Icon = mark.icon
                          const chosen = status === mark.key
                          return (
                            <Button
                              key={mark.key}
                              variant={chosen ? "gold" : "ghost"}
                              size="sm"
                              icon={<Icon size={14} />}
                              style={chosen ? undefined : { background: markColour(status) }}
                              aria-pressed={chosen}
                              aria-label={`Mark ${entry.full_name} ${mark.label.toLowerCase()}`}
                              onClick={() => applyMark(entry, mark.key)}
                            >
                              <span className="hidden sm:inline">{mark.label}</span>
                              <span className="sm:hidden">{mark.short}</span>
                            </Button>
                          )
                        })}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
