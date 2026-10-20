import { useMemo, useState } from "react"
import { CalendarDays, Clock, MapPin, Music2, Search, Ticket, Users } from "lucide-react"
import { Card, EmptyState, Input, Spinner, Tabs } from "../../components/ui"
import { PublicPageHeader } from "../../components/layout/PublicPageHeader"
import { useQuery } from "../../api/hooks"

/**
 * The choir's public calendar.
 *
 * Only events the choir has published appear here, and a visitor can do three
 * things with them: see what is coming, look back at what has happened, and
 * search by name. A contribution is shown as information — the choir collects it
 * as it always has, and nothing is paid on this site.
 */

interface PublicEvent {
  id: string
  name: string
  eventType: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
  description: string | null
  audience: string[]
  photos: { id: string; url: string; name: string }[]
  contribution: { amount: number; note: string | null } | null
}

interface EventsData {
  events: PublicEvent[]
}

/** A friendly label for the stored event type key. */
function eventTypeLabel(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDate(value: string): string {
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { dateStyle: "full" })
}

/** A short weekday and day, as they read on a calendar chip. */
function dateParts(value: string): { weekday: string; day: string; month: string } {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return { weekday: "", day: value, month: "" }
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
    day: String(date.getDate()),
    month: date.toLocaleDateString(undefined, { month: "short" }),
  }
}

function formatAmount(value: number): string {
  return `${value.toLocaleString("en-US").replace(/,/g, " ")} FRW`
}

/** `YYYY-MM-DD` for today, in the visitor's own timezone. */
function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function PublicEventsPage() {
  const [scope, setScope] = useState<"upcoming" | "past" | "all">("upcoming")
  const [search, setSearch] = useState("")

  // The site's own clock decides "today", so an event happening right now is not
  // shown as past just because the server sits in another timezone.
  const query = useQuery<EventsData>(`/public/events?scope=${scope}`)
  const events = query.data?.events ?? []

  const today = todayIso()
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return events
    return events.filter(
      (event) =>
        event.name.toLowerCase().includes(needle) ||
        (event.location ?? "").toLowerCase().includes(needle) ||
        eventTypeLabel(event.eventType).toLowerCase().includes(needle),
    )
  }, [events, search])

  // On the "upcoming" tab, what is on today is worth separating out: it is the
  // thing a visitor is most likely to be looking for.
  const todays = scope === "upcoming" ? filtered.filter((event) => event.date === today) : []
  const rest = scope === "upcoming" ? filtered.filter((event) => event.date !== today) : filtered

  return (
    <div className="min-h-dvh bg-ivory dark:bg-charcoal-950">
      <PublicPageHeader
        title="Events & performances"
        description="Where you can hear Chorale La Porte d'Or next, and what the choir has already done. These are the events the choir has published to the public."
      />

      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Tabs
            tabs={[
              { key: "upcoming", label: "Upcoming" },
              { key: "past", label: "Past" },
              { key: "all", label: "All" },
            ]}
            active={scope}
            onChange={(key) => setScope(key as "upcoming" | "past" | "all")}
          />
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search events</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
            <Input
              className="pl-9"
              placeholder="Search by name, place or type"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-8">
          {query.loading && !query.data ? (
            <div className="flex items-center gap-2 py-10">
              <Spinner /> <span className="muted text-sm">Loading the events…</span>
            </div>
          ) : query.error ? (
            <EmptyState tone="danger" title="Could not load the events" description={query.error.message} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={22} />}
              title={search ? "No events match that search" : scope === "past" ? "Nothing here yet" : "No public events scheduled"}
              description={
                search
                  ? "Try a shorter search, or look at all the events."
                  : scope === "past"
                    ? "Once the choir has performed, past events will be listed here."
                    : "Upcoming performances will appear here once the choir publishes them. In the meantime, our recorded performances are always available."
              }
            />
          ) : (
            <div className="flex flex-col gap-10">
              {todays.length > 0 ? (
                <div>
                  <h2 className="font-display text-lg font-semibold">Today</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {todays.map((event) => (
                      <EventCard key={event.id} event={event} today={today} />
                    ))}
                  </div>
                </div>
              ) : null}

              {rest.length > 0 ? (
                <div>
                  {todays.length > 0 ? (
                    <h2 className="font-display text-lg font-semibold">
                      {scope === "past" ? "Earlier" : "Coming up"}
                    </h2>
                  ) : null}
                  <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 ${todays.length > 0 ? "mt-4" : ""}`}>
                    {rest.map((event) => (
                      <EventCard key={event.id} event={event} today={today} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <Card className="mt-12 p-6">
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

function EventCard({ event, today }: { event: PublicEvent; today: string }) {
  const parts = dateParts(event.date)
  const isToday = event.date === today

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        {/* A calendar chip rather than a plain date line: the day is what a
            visitor scans for, and a chip makes it findable at a glance. */}
        <div
          className="flex w-14 shrink-0 flex-col items-center rounded-xl px-2 py-1.5 text-center"
          style={{ background: "color-mix(in srgb, var(--color-gold-400) 16%, transparent)" }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{parts.weekday}</span>
          <span className="font-display text-xl font-semibold leading-tight tabular-nums">{parts.day}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{parts.month}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ background: "color-mix(in srgb, var(--color-gold-400) 16%, transparent)", color: "var(--color-gold-700)" }}
            >
              {eventTypeLabel(event.eventType)}
            </span>
            {isToday ? (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ background: "color-mix(in srgb, var(--color-green-500, #22c55e) 18%, transparent)" }}>
                Today
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 font-display text-xl font-semibold">{event.name}</h3>
        </div>
      </div>

      <ul className="muted mt-4 flex flex-col gap-1.5 text-sm">
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
        {event.audience.length > 0 ? (
          <li className="flex items-center gap-2">
            <Users size={15} className="text-gold-600 dark:text-gold-300" />
            {event.audience.join(", ")}
          </li>
        ) : null}
      </ul>

      {event.description ? <p className="muted mt-3 text-sm">{event.description}</p> : null}

      {/* A performance is better seen than described: a couple of pictures from
          the day say more than another paragraph. Only a handful are shown, since
          this is a card in a list, not the album itself. */}
      {event.photos.length > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {event.photos.slice(0, 3).map((photo) => (
            <a
              key={photo.id}
              href={photo.url}
              target="_blank"
              rel="noreferrer"
              className="overflow-hidden rounded-lg border hairline"
            >
              <img
                src={photo.url}
                alt={photo.name}
                loading="lazy"
                className="aspect-square w-full object-cover transition-transform duration-300 hover:scale-[1.04]"
              />
            </a>
          ))}
        </div>
      ) : null}

      {event.contribution ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-xl px-3 py-2 text-sm"
          style={{ background: "color-mix(in srgb, var(--color-gold-400) 12%, transparent)" }}
        >
          <Ticket size={16} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" />
          <p>
            <span className="font-medium">Contribution {formatAmount(event.contribution.amount)}</span>
            {event.contribution.note ? <span className="muted"> · {event.contribution.note}</span> : null}
            <span className="muted block text-xs">
              Collected by the choir at the door. Nothing is paid on this site.
            </span>
          </p>
        </div>
      ) : null}
    </Card>
  )
}
