import { CalendarDays, MapPin, Music2, Clock } from "lucide-react"
import { Card, EmptyState, Spinner } from "../../components/ui"
import { PublicPageHeader } from "../../components/layout/PublicPageHeader"
import { useQuery } from "../../api/hooks"

interface PublicEvent {
  id: string
  name: string
  eventType: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
  description: string | null
}

interface EventsData {
  upcomingEvents: PublicEvent[]
}

/** A friendly label for the stored event type key. */
function eventTypeLabel(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { dateStyle: "full" })
}

/**
 * The choir's public performances. Only events the choir has marked public are
 * listed — private rehearsals and internal meetings stay inside the platform.
 */
export function PublicEventsPage() {
  const { data, loading, error } = useQuery<EventsData>("/public/landing")
  const events = data?.upcomingEvents ?? []

  return (
    <div className="min-h-dvh bg-ivory dark:bg-charcoal-950">
      <PublicPageHeader
        title="Events & performances"
        description="Where you can hear Chorale La Porte d'Or next. These are the performances the choir has published to the public."
      />

      <section className="mx-auto max-w-7xl px-5 py-14">
        {loading && !data ? (
          <div className="flex items-center gap-2 py-10">
            <Spinner /> <span className="muted text-sm">Loading the events…</span>
          </div>
        ) : error ? (
          <EmptyState
            tone="danger"
            title="Could not load the events"
            description={error.message}
          />
        ) : events.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={22} />}
            title="No public events scheduled"
            description="Upcoming performances will appear here once the choir publishes them. In the meantime, our recorded performances are always available."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <Card key={event.id} className="flex flex-col p-5">
                <div className="flex items-center gap-2">
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ background: "color-mix(in srgb, var(--color-gold-400) 16%, transparent)", color: "var(--color-gold-700)" }}>
                    {eventTypeLabel(event.eventType)}
                  </span>
                </div>
                <h2 className="mt-3 font-display text-xl font-semibold">{event.name}</h2>
                <ul className="muted mt-3 flex flex-col gap-1.5 text-sm">
                  <li className="flex items-center gap-2">
                    <CalendarDays size={15} className="text-gold-600 dark:text-gold-300" />
                    {formatDate(event.date)}
                  </li>
                  {event.startTime ? (
                    <li className="flex items-center gap-2">
                      <Clock size={15} className="text-gold-600 dark:text-gold-300" />
                      {event.startTime}
                      {event.endTime ? ` – ${event.endTime}` : ""}
                    </li>
                  ) : null}
                  {event.location ? (
                    <li className="flex items-center gap-2">
                      <MapPin size={15} className="text-gold-600 dark:text-gold-300" />
                      {event.location}
                    </li>
                  ) : null}
                </ul>
                {event.description ? <p className="muted mt-3 text-sm">{event.description}</p> : null}
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-10 p-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Music2 size={20} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" />
              <div>
                <h2 className="font-display text-xl font-semibold">Can't wait for the next performance?</h2>
                <p className="muted mt-1 text-sm">Listen to the choir's recordings right here on the site.</p>
              </div>
            </div>
            <a href="/music" className="btn btn-gold shrink-0">
              Listen to our music
            </a>
          </div>
        </Card>
      </section>
    </div>
  )
}
