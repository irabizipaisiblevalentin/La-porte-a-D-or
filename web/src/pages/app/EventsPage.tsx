import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarDays, ListFilter, MapPin, Plus, Search, Users } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Button,
  Card,
  DataTable,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  humanize,
  useTabState,
  useToast,
  type Column,
} from "../../components/ui"
import { EventCalendar, type CalendarEvent } from "../../components/events/EventCalendar"

interface EventRow {
  id: string
  name: string
  event_type: string
  date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  location_id: string | null
  description: string | null
  target_group_id: string | null
  status: string
  report: string | null
  is_public: number
  audience_public: number
  requires_contribution: number
  contribution_amount: number | null
  contribution_note: string | null
  contribution_due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  group_name: string | null
  participant_count: number
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface GroupRow {
  id: string
  key: string
  name: string
}

export const EVENT_TYPES = [
  "rehearsal",
  "concert",
  "church_service",
  "retreat",
  "training",
  "meeting",
  "competition",
  "community",
  "other",
] as const

export const EVENT_STATUSES = ["planned", "completed", "cancelled"] as const

/** The official groups, in the order the choir names them. */
export const AUDIENCE_GROUPS = [
  { id: "grp_senior", name: "Senior" },
  { id: "grp_junior", name: "Junior" },
  { id: "grp_members", name: "Members / Support" },
] as const

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** Whole Rwandan francs, with thin spaces so a figure is readable at a glance. */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return `${value.toLocaleString("en-US").replace(/,/g, " ")} FRW`
}

interface EventFormState {
  name: string
  eventType: string
  date: string
  startTime: string
  endTime: string
  location: string
  status: string
  description: string
  report: string
  isPublic: boolean
  audienceGroupIds: string[]
  requiresContribution: boolean
  contributionAmount: string
  contributionNote: string
  contributionDueDate: string
}

interface EventPayload {
  name: string
  eventType: string
  date: string
  startTime?: string | null
  endTime?: string | null
  location?: string | null
  status?: string
  description?: string | null
  report?: string | null
  isPublic?: boolean
  audienceGroupIds?: string[]
  audiencePublic?: boolean
  requiresContribution?: boolean
  contributionAmount?: number | null
  contributionNote?: string | null
  contributionDueDate?: string | null
}

function emptyForm(): EventFormState {
  return {
    name: "",
    eventType: "rehearsal",
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    status: "planned",
    description: "",
    report: "",
    isPublic: false,
    audienceGroupIds: [],
    requiresContribution: false,
    contributionAmount: "",
    contributionNote: "",
    contributionDueDate: "",
  }
}

/** A short summary of who an event is for, shown on the row. */
function audienceLabel(event: EventRow): string {
  if (event.target_group_id && !event.audience_public) return event.group_name ?? "—"
  return "Whole choir"
}

export function EventsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const canWrite = can("events.write")
  const canManage = can("events.manage")

  const viewTabs = useTabState("upcoming")
  const view = viewTabs.active
  const setView = viewTabs.setActive
  const [type, setType] = useState("")
  const [groupId, setGroupId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [status, setStatus] = useState("")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search)
  const [page, setPage] = useState(1)

  const today = new Date()
  const [calendarYear, setCalendarYear] = useState(today.getFullYear())
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth())

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<EventFormState>(emptyForm)

  // The list is filtered by the tab: upcoming means today onwards, past means
  // strictly before today. The server does the filtering so paging and counts
  // stay correct rather than being applied to one page of results.
  const todayIso = (() => {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    return `${now.getFullYear()}-${month}-${day}`
  })()

  const tabFrom = view === "upcoming" ? todayIso : from
  const tabTo = view === "past" ? from || addDays(todayIso, -1) : to

  const query = toQuery({
    type,
    groupId,
    from: view === "past" ? from : tabFrom,
    to: view === "past" ? tabTo : to,
    status,
    search: debouncedSearch,
    page,
  })
  const list = useQuery<Page<EventRow>>(`/events${query}`)
  const meta = useQuery<{ groups: GroupRow[] }>("/members/meta")

  // The calendar needs a whole month regardless of the tab or the paging, so it
  // asks for its own range rather than reusing the list.
  const monthStart = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-01`
  const monthEnd = (() => {
    const last = new Date(calendarYear, calendarMonth + 1, 0)
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`
  })()
  const calendarList = useQuery<Page<EventRow>>(
    view === "calendar" ? `/events${toQuery({ from: monthStart, to: monthEnd, pageSize: 200 })}` : null,
    [monthStart, monthEnd],
  )

  const create = useMutation((body: EventPayload) => api.post<{ event: EventRow }>("/events", body))

  const rows = list.data?.items ?? []
  const groups = meta.data?.groups ?? []

  function resetFilters() {
    setType("")
    setGroupId("")
    setFrom("")
    setTo("")
    setStatus("")
    setSearch("")
    setPage(1)
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    const amount = form.contributionAmount.trim()
    const result = await create.run({
      name: form.name.trim(),
      eventType: form.eventType,
      date: form.date,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      location: form.location.trim() || null,
      status: form.status,
      description: form.description.trim() || null,
      report: form.report.trim() || null,
      isPublic: form.isPublic,
      // Only the coordinator may aim an event or price it; the form does not show
      // those fields to anyone else, and the server refuses them regardless.
      ...(canManage
        ? {
            audienceGroupIds: form.audienceGroupIds,
            requiresContribution: form.requiresContribution,
            contributionAmount: form.requiresContribution && amount ? Number(amount) : null,
            contributionNote: form.requiresContribution ? form.contributionNote.trim() || null : null,
            contributionDueDate: form.requiresContribution ? form.contributionDueDate || null : null,
          }
        : {}),
    })
    if (!result) return
    toast.success(`Event "${result.event.name}" was created.`)
    setCreateOpen(false)
    setForm(emptyForm())
    list.reload()
  }

  const columns: Column<EventRow>[] = [
    {
      key: "name",
      header: "Event",
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.name}</p>
          <p className="muted text-xs">
            {audienceLabel(row)}
            {row.location ? ` · ${row.location}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (row) => (
        <div>
          <p>{formatDate(row.date)}</p>
          {row.start_time ? <p className="muted text-xs tabular-nums">{row.start_time}</p> : null}
        </div>
      ),
    },
    { key: "type", header: "Type", render: (row) => humanize(row.event_type) },
    {
      key: "contribution",
      header: "Contribution",
      render: (row) =>
        row.requires_contribution === 1 ? (
          <span className="tabular-nums">{formatAmount(row.contribution_amount)}</span>
        ) : (
          <span className="muted">Free</span>
        ),
    },
    {
      key: "participants",
      header: "Participants",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.participant_count}</span>,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ]

  const calendarEvents: CalendarEvent[] = (calendarList.data?.items ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    date: row.date,
    start_time: row.start_time,
    event_type: row.event_type,
    status: row.status,
    location: row.location,
    requires_contribution: row.requires_contribution,
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Events"
        description="Rehearsals, services, concerts and other gatherings. Open an event to manage its participants, its songs and — for a paid event — who has contributed and who is coming in."
        actions={
          canWrite ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              New event
            </Button>
          ) : null
        }
      />

      <Tabs
        tabs={[
          { key: "upcoming", label: "Upcoming" },
          { key: "past", label: "Past" },
          { key: "calendar", label: "Calendar" },
          { key: "all", label: "All" },
        ]}
        active={view}
        onChange={(key) => {
          setView(key)
          setPage(1)
        }}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="w-full sm:w-64">
            <Field label="Search" htmlFor="filter-search">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
                <Input
                  id="filter-search"
                  className="pl-9"
                  placeholder="Event name"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </Field>
          </div>
          <div className="w-full sm:w-40">
            <Field label="Type" htmlFor="filter-type">
              <Select
                id="filter-type"
                value={type}
                onChange={(event) => {
                  setType(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All types</option>
                {EVENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-full sm:w-40">
            <Field label="Group" htmlFor="filter-group">
              <Select
                id="filter-group"
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All groups</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-full sm:w-36">
            <Field
              label={view === "past" ? "Before" : "From"}
              htmlFor="filter-from"
              hint={view === "upcoming" ? "Starts from today." : undefined}
            >
              <Input
                id="filter-from"
                type="date"
                value={from}
                disabled={view === "upcoming"}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setPage(1)
                }}
              />
            </Field>
          </div>
          <div className="w-full sm:w-36">
            <Field label="To" htmlFor="filter-to" hint={view === "past" ? "Includes today." : undefined}>
              <Input
                id="filter-to"
                type="date"
                value={to}
                disabled={view === "past"}
                onChange={(event) => {
                  setTo(event.target.value)
                  setPage(1)
                }}
              />
            </Field>
          </div>
          <div className="w-full sm:w-36">
            <Field label="Status" htmlFor="filter-status">
              <Select
                id="filter-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">Any status</option>
                {EVENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="ghost" onClick={resetFilters} icon={<ListFilter size={15} />}>
            Clear
          </Button>
        </div>
      </Card>

      {view === "calendar" ? (
        <Card>
          <div className="px-5 py-4">
            {calendarList.loading ? (
              <LoadingBlock />
            ) : (
              <EventCalendar
                year={calendarYear}
                month={calendarMonth}
                events={calendarEvents}
                onMonthChange={(year, month) => {
                  setCalendarYear(year)
                  setCalendarMonth(month)
                }}
                onSelect={(id) => navigate(`/app/events/${id}`)}
              />
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="px-5 py-4">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              loading={list.loading}
              error={list.error?.message ?? null}
              emptyTitle={view === "upcoming" ? "Nothing coming up" : "No events found"}
              emptyDescription={
                view === "upcoming"
                  ? "No events are scheduled from today onwards."
                  : "No events match these filters. Try clearing them."
              }
              emptyAction={
                canWrite ? (
                  <Button variant="gold" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                    New event
                  </Button>
                ) : undefined
              }
              onRowClick={(row) => navigate(`/app/events/${row.id}`)}
            />
            {list.data ? (
              <Pagination
                page={list.data.page}
                pageCount={list.data.pageCount}
                total={list.data.total}
                onChange={setPage}
              />
            ) : null}
          </div>
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          create.reset()
        }}
        title="New event"
        description={
          canManage
            ? "Schedule an event, choose which groups it is for, and say whether it asks for a contribution."
            : "Schedule a rehearsal, service or gathering for your group."
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={create.saving}>
              Cancel
            </Button>
            <Button variant="gold" onClick={submitCreate} loading={create.saving} icon={<CalendarDays size={16} />}>
              Create event
            </Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitCreate}>
          <div className="sm:col-span-2">
            <Field label="Event name" htmlFor="event-name" required error={create.error?.fields?.name}>
              <Input
                id="event-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Type" htmlFor="event-type" required error={create.error?.fields?.eventType}>
            <Select
              id="event-type"
              value={form.eventType}
              onChange={(event) => setForm({ ...form, eventType: event.target.value })}
            >
              {EVENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="event-date" required error={create.error?.fields?.date}>
            <Input
              id="event-date"
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              required
            />
          </Field>
          <Field label="Start time" htmlFor="event-start" hint="24-hour, e.g. 18:30" error={create.error?.fields?.startTime}>
            <Input
              id="event-start"
              type="time"
              value={form.startTime}
              onChange={(event) => setForm({ ...form, startTime: event.target.value })}
            />
          </Field>
          <Field label="End time" htmlFor="event-end" hint="24-hour, e.g. 20:00" error={create.error?.fields?.endTime}>
            <Input
              id="event-end"
              type="time"
              value={form.endTime}
              onChange={(event) => setForm({ ...form, endTime: event.target.value })}
            />
          </Field>
          <Field label="Location" htmlFor="event-location" error={create.error?.fields?.location}>
            <Input
              id="event-location"
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
            />
          </Field>
          <Field label="Status" htmlFor="event-status">
            <Select
              id="event-status"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              {EVENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="event-description" error={create.error?.fields?.description}>
              <Textarea
                id="event-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>
          </div>

          {canManage ? (
            <div className="sm:col-span-2 flex flex-col gap-4 rounded-xl border hairline p-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Users size={15} /> Who is this event for?
                </p>
                <p className="muted mt-0.5 text-xs">
                  Choose the groups that should see it. Leave all unticked for the whole choir.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {AUDIENCE_GROUPS.map((group) => {
                    const checked = form.audienceGroupIds.includes(group.id)
                    return (
                      <label key={group.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={(event) => {
                            setForm({
                              ...form,
                              audienceGroupIds: event.target.checked
                                ? [...form.audienceGroupIds, group.id]
                                : form.audienceGroupIds.filter((id) => id !== group.id),
                            })
                          }}
                        />
                        {group.name}
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="border-t hairline pt-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <MapPin size={15} /> Contribution
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.requiresContribution}
                    onChange={(event) => setForm({ ...form, requiresContribution: event.target.checked })}
                  />
                  This event asks for a contribution to attend
                </label>
                <p className="muted mt-1 text-xs">
                  The choir collects the money as it always has; this only records who has paid. No payment is taken
                  on the site.
                </p>

                {form.requiresContribution ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field label="Amount (FRW)" htmlFor="event-amount" required error={create.error?.fields?.contributionAmount}>
                      <Input
                        id="event-amount"
                        type="number"
                        min={0}
                        step={100}
                        value={form.contributionAmount}
                        onChange={(event) => setForm({ ...form, contributionAmount: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Pay by" htmlFor="event-due" hint="Optional">
                      <Input
                        id="event-due"
                        type="date"
                        value={form.contributionDueDate}
                        onChange={(event) => setForm({ ...form, contributionDueDate: event.target.value })}
                      />
                    </Field>
                    <Field label="Note" htmlFor="event-note" hint="Optional">
                      <Input
                        id="event-note"
                        value={form.contributionNote}
                        onChange={(event) => setForm({ ...form, contributionNote: event.target.value })}
                        placeholder="e.g. transport and venue"
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="sm:col-span-2 flex items-center gap-2">
            <input
              id="event-public"
              type="checkbox"
              className="h-4 w-4"
              checked={form.isPublic}
              onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            />
            <label htmlFor="event-public" className="text-sm">
              Show on the public events list
            </label>
          </div>
        </form>
      </Modal>
    </div>
  )
}

/** `YYYY-MM-DD`, `days` away from `value`; used only to default the Past tab. */
function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}
