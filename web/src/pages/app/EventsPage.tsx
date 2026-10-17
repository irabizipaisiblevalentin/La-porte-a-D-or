import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarDays, Plus } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Button,
  Card,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Textarea,
  humanize,
  useToast,
  type Column,
} from "../../components/ui"

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

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

interface EventFormState {
  name: string
  eventType: string
  date: string
  startTime: string
  endTime: string
  location: string
  targetGroupId: string
  status: string
  description: string
  report: string
  isPublic: boolean
}

interface EventPayload {
  name: string
  eventType: string
  date: string
  startTime?: string | null
  endTime?: string | null
  location?: string | null
  targetGroupId?: string | null
  status?: string
  description?: string | null
  report?: string | null
  isPublic?: boolean
}

function emptyForm(): EventFormState {
  return {
    name: "",
    eventType: "rehearsal",
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    targetGroupId: "",
    status: "planned",
    description: "",
    report: "",
    isPublic: false,
  }
}

export function EventsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const canWrite = can("events.write")

  const [type, setType] = useState("")
  const [groupId, setGroupId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<EventFormState>(emptyForm)

  const query = toQuery({ type, groupId, from, to, status, page })
  const list = useQuery<Page<EventRow>>(`/events${query}`)
  const meta = useQuery<{ groups: GroupRow[] }>("/members/meta")

  const create = useMutation((body: EventPayload) => api.post<{ event: EventRow }>("/events", body))

  const rows = list.data?.items ?? []
  const groups = meta.data?.groups ?? []

  function resetFilters() {
    setType("")
    setGroupId("")
    setFrom("")
    setTo("")
    setStatus("")
    setPage(1)
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    const result = await create.run({
      name: form.name.trim(),
      eventType: form.eventType,
      date: form.date,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      location: form.location.trim() || null,
      targetGroupId: form.targetGroupId || null,
      status: form.status,
      description: form.description.trim() || null,
      report: form.report.trim() || null,
      isPublic: form.isPublic,
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
          {row.group_name ? <p className="muted text-xs">{row.group_name}</p> : null}
        </div>
      ),
    },
    { key: "date", header: "Date", render: (row) => formatDate(row.date) },
    { key: "type", header: "Type", render: (row) => humanize(row.event_type) },
    { key: "location", header: "Location", render: (row) => row.location || <span className="muted">—</span> },
    {
      key: "participants",
      header: "Participants",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.participant_count}</span>,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Events"
        description="Rehearsals, services, concerts and other gatherings. Open an event to manage its participants and songs."
        actions={
          canWrite ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              New event
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="w-full sm:w-44">
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
          <div className="w-full sm:w-44">
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
          <div className="w-full sm:w-40">
            <Field label="From" htmlFor="filter-from">
              <Input
                id="filter-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setPage(1)
                }}
              />
            </Field>
          </div>
          <div className="w-full sm:w-40">
            <Field label="To" htmlFor="filter-to">
              <Input
                id="filter-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  setPage(1)
                }}
              />
            </Field>
          </div>
          <div className="w-full sm:w-40">
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
          <Button variant="ghost" onClick={resetFilters}>
            Clear
          </Button>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={list.loading}
            error={list.error?.message ?? null}
            emptyTitle="No events found"
            emptyDescription={
              type || groupId || from || to || status
                ? "No events match these filters. Try clearing them."
                : "No events have been scheduled yet."
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

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          create.reset()
        }}
        title="New event"
        description="Schedule a new rehearsal, service or gathering."
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
          <Field label="Target group" htmlFor="event-group" hint="Leave blank for the whole choir." error={create.error?.fields?.targetGroupId}>
            <Select
              id="event-group"
              value={form.targetGroupId}
              onChange={(event) => setForm({ ...form, targetGroupId: event.target.value })}
            >
              <option value="">Whole choir</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
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
