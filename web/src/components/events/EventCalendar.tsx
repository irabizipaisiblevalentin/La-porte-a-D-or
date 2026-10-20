import { useMemo } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button, humanize } from "../../components/ui"

/**
 * A month grid of events, with dots marking each day that has one.
 *
 * A choir plans in weeks — a rehearsal every Wednesday, a service on Sunday, a
 * concert a month out — which a descending table hides and a calendar shows. The
 * grid is deliberately not a full scheduling tool: it answers "what is on, and
 * when", and a click opens the event itself.
 */

export interface CalendarEvent {
  id: string
  name: string
  date: string
  start_time: string | null
  event_type: string
  status: string
  location: string | null
  requires_contribution: number
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** `YYYY-MM-DD` for a date, without going through UTC and drifting a day. */
function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

/**
 * The weeks that make up a month view, starting on Monday.
 *
 * The leading days belong to the previous month and the trailing ones to the
 * next, so the grid is always a whole number of weeks and a month's edges are
 * visible in context rather than cut off.
 */
function buildWeeks(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1)
  // getDay() is 0 for Sunday; the grid starts on Monday.
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - offset)

  const weeks: Date[][] = []
  const cursor = new Date(start)
  for (let week = 0; week < 6; week += 1) {
    const days: Date[] = []
    for (let day = 0; day < 7; day += 1) {
      days.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(days)
    // Stop once the following month has begun and a full week has been shown
    // after it, so February does not always render six rows.
    if (cursor.getMonth() !== month && cursor.getDate() > 7) break
  }
  return weeks
}

export function EventCalendar({
  year,
  month,
  events,
  onMonthChange,
  onSelect,
}: {
  year: number
  month: number
  events: CalendarEvent[]
  onMonthChange: (year: number, month: number) => void
  onSelect: (eventId: string) => void
}) {
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }
    for (const list of map.values()) {
      list.sort((left, right) => (left.start_time ?? "").localeCompare(right.start_time ?? ""))
    }
    return map
  }, [events])

  const weeks = buildWeeks(year, month)
  const today = isoDate(new Date())

  function shift(delta: number) {
    const next = new Date(year, month + delta, 1)
    onMonthChange(next.getFullYear(), next.getMonth())
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft size={16} />
        </Button>
        <p className="min-w-40 text-center font-semibold">{monthLabel(year, month)}</p>
        <Button variant="ghost" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight size={16} />
        </Button>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            const now = new Date()
            onMonthChange(now.getFullYear(), now.getMonth())
          }}
        >
          Today
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border hairline">
        <div className="grid grid-cols-7 border-b hairline bg-black/[0.02] dark:bg-white/[0.03]">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide opacity-60">
              {day}
            </div>
          ))}
        </div>

        {weeks.map((week, index) => (
          <div key={index} className="grid grid-cols-7 border-b hairline last:border-b-0">
            {week.map((day) => {
              const key = isoDate(day)
              const inMonth = day.getMonth() === month
              const dayEvents = byDate.get(key) ?? []
              return (
                <div
                  key={key}
                  className="min-h-24 border-r hairline p-1.5 last:border-r-0"
                  style={{
                    background: key === today ? "color-mix(in srgb, var(--color-gold-400) 12%, transparent)" : undefined,
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <p className="mb-1 text-xs font-semibold tabular-nums">{day.getDate()}</p>
                  <div className="flex flex-col gap-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        onClick={() => onSelect(event.id)}
                        className="w-full truncate rounded px-1.5 py-1 text-left text-[11px] leading-tight transition-colors hover:brightness-95"
                        style={{
                          background:
                            event.status === "cancelled"
                              ? "color-mix(in srgb, currentColor 8%, transparent)"
                              : "color-mix(in srgb, var(--color-gold-400) 26%, transparent)",
                          textDecoration: event.status === "cancelled" ? "line-through" : undefined,
                        }}
                        title={`${event.name} — ${humanize(event.event_type)}`}
                      >
                        {event.start_time ? <span className="tabular-nums opacity-70">{event.start_time} </span> : null}
                        {event.name}
                      </button>
                    ))}
                    {dayEvents.length > 3 ? (
                      <p className="px-1.5 text-[10px] opacity-60">+{dayEvents.length - 3} more</p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
