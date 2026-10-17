import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertCircle,
  CalendarCheck,
  CalendarPlus,
  ClipboardCheck,
  Clock3,
  ListChecks,
  Plus,
  UserCheck,
  UserX,
} from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  PageHeader,
  Select,
  StatCard,
  Textarea,
  humanize,
  useToast,
  type Column,
} from "../../components/ui"

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface Group {
  id: string
  key: string
  name: string
  description: string
  is_minor_group: number
}

interface VoiceSection {
  id: string
  key: string
  name: string
  sort_order: number
}

interface Meta {
  groups: Group[]
  voiceSections: VoiceSection[]
}

interface AttendanceSession {
  id: string
  title: string
  activityType: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
  locationId: string | null
  targetGroupId: string | null
  targetGroupKey: string | null
  targetGroupName: string | null
  markedCount: number | null
  recorderId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface AttendanceSummary {
  sessions: number
  present: number
  late: number
  absent: number
  excused: number
  marked: number
  denominator: number
  rate: number | null
  policy: { late: string; excused: string }
  note?: string | null
}

interface SessionBody {
  title: string
  activityType: string
  date: string
  startTime?: string | null
  endTime?: string | null
  location?: string | null
  targetGroupId?: string | null
  notes?: string | null
}

interface SessionFormState {
  title: string
  activityType: string
  date: string
  startTime: string
  endTime: string
  location: string
  targetGroupId: string
  notes: string
}

/** Local YYYY-MM-DD for the date input default. */
function today(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">
      {message}
    </div>
  )
}

export function AttendancePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const canWrite = can("attendance.write")

  const [activityType, setActivityType] = useState("")
  const [groupId, setGroupId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)

  const meta = useQuery<Meta>("/members/meta")
  const activityTypes = useQuery<{ activityTypes: string[] }>("/attendance/activity-types")

  const sessions = useQuery<Page<AttendanceSession>>(
    `/attendance/sessions${toQuery({ activityType, groupId, from, to, page })}`,
    [activityType, groupId, from, to, page],
  )

  const summary = useQuery<AttendanceSummary>(
    `/attendance/summary${toQuery({ groupId, from, to })}`,
    [groupId, from, to],
  )

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState<SessionFormState>({
    title: "",
    activityType: "rehearsal",
    date: today(),
    startTime: "",
    endTime: "",
    location: "",
    targetGroupId: "",
    notes: "",
  })

  const create = useMutation((body: SessionBody) =>
    api.post<{ session: AttendanceSession }>("/attendance/sessions", body),
  )

  function openNew() {
    create.reset()
    setForm({
      title: "",
      activityType: activityTypes.data?.activityTypes?.[0] ?? "rehearsal",
      date: today(),
      startTime: "",
      endTime: "",
      location: "",
      targetGroupId: groupId,
      notes: "",
    })
    setShowNew(true)
  }

  async function submitNew(event: FormEvent) {
    event.preventDefault()
    const result = await create.run({
      title: form.title.trim(),
      activityType: form.activityType,
      date: form.date,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      location: form.location.trim() || null,
      targetGroupId: form.targetGroupId || null,
      notes: form.notes.trim() || null,
    })
    if (result) {
      toast.success("Attendance session created.")
      setShowNew(false)
      sessions.reload()
      summary.reload()
    }
  }

  const rows = sessions.data?.items ?? []
  const groups = meta.data?.groups ?? []
  const types = activityTypes.data?.activityTypes ?? []

  const columns: Column<AttendanceSession>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.date}</span>
          {row.startTime ? <span className="muted text-xs">{row.startTime}{row.endTime ? `–${row.endTime}` : ""}</span> : null}
        </div>
      ),
    },
    {
      key: "title",
      header: "Session",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.title}</span>
          {row.location ? <span className="muted text-xs">{row.location}</span> : null}
        </div>
      ),
    },
    {
      key: "activity",
      header: "Activity",
      render: (row) => <Badge tone="gold">{humanize(row.activityType)}</Badge>,
    },
    {
      key: "group",
      header: "Group",
      render: (row) =>
        row.targetGroupName ? (
          <span>{row.targetGroupName}</span>
        ) : (
          <span className="muted">Whole choir</span>
        ),
    },
    {
      key: "marked",
      header: "Marked",
      align: "right",
      render: (row) => <span>{row.markedCount ?? 0}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description="Track rehearsal, service and performance attendance for the choir."
        actions={
          <>
            <a href="#summary" className="btn btn-outline btn-sm">
              <ListChecks size={15} /> Summary
            </a>
            {canWrite ? (
              <Button variant="gold" icon={<Plus size={16} />} onClick={openNew}>
                New session
              </Button>
            ) : null}
          </>
        }
      />

      <section id="summary" className="flex flex-col gap-4 scroll-mt-20">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Attendance summary</h2>
          <p className="muted text-xs">
            {groupId ? "Filtered by group" : "All groups"}
            {from || to ? ` · ${from || "start"} to ${to || "today"}` : ""}
          </p>
        </div>
        {summary.loading ? (
          <LoadingBlock label="Loading summary…" rows={0} />
        ) : summary.error ? (
          <EmptyState
            tone="danger"
            icon={<AlertCircle size={22} />}
            title="Could not load the attendance summary"
            description={summary.error.message}
          />
        ) : summary.data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Sessions" value={summary.data.sessions} icon={<CalendarCheck size={18} />} />
              <StatCard
                label="Attendance rate"
                value={summary.data.rate === null ? "—" : `${summary.data.rate}%`}
                hint={summary.data.rate === null ? "Not enough data" : "Under the current policy"}
                icon={<ClipboardCheck size={18} />}
              />
              <StatCard label="Present" value={summary.data.present} icon={<UserCheck size={18} />} />
              <StatCard label="Late" value={summary.data.late} icon={<Clock3 size={18} />} />
              <StatCard label="Absent" value={summary.data.absent} icon={<UserX size={18} />} />
              <StatCard label="Excused" value={summary.data.excused} tone="neutral" />
              <StatCard label="Records marked" value={summary.data.marked} tone="neutral" />
            </div>
            {summary.data.rate === null && summary.data.note ? (
              <p className="muted text-sm">{summary.data.note}</p>
            ) : null}
            <p className="muted text-xs">
              Policy · late {humanize(summary.data.policy.late)} · excused {humanize(summary.data.policy.excused)} ·{" "}
              {summary.data.denominator} counted in the denominator
            </p>
          </>
        ) : null}
      </section>

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Activity type" htmlFor="filter-activity">
            <Select
              id="filter-activity"
              value={activityType}
              onChange={(event) => {
                setActivityType(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All activities</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {humanize(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Group" htmlFor="filter-group" hint={meta.error ? "Groups could not be loaded." : undefined}>
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
          <Field label="From" htmlFor="filter-from">
            <Input
              id="filter-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => {
                setFrom(event.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="To" htmlFor="filter-to">
            <Input
              id="filter-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value)
                setPage(1)
              }}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sessions"
          description="Select a session to open its roster and mark attendance."
          actions={
            canWrite ? (
              <Button variant="outline" size="sm" icon={<CalendarPlus size={15} />} onClick={openNew}>
                New session
              </Button>
            ) : null
          }
        />
        <CardBody className="pt-0">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={sessions.loading}
            error={sessions.error?.message ?? null}
            emptyTitle="No attendance sessions found"
            emptyDescription="Adjust the filters or create a session to get started."
            emptyAction={
              canWrite ? (
                <Button variant="gold" icon={<Plus size={16} />} onClick={openNew}>
                  New session
                </Button>
              ) : null
            }
            onRowClick={(row) => navigate(`/app/attendance/${row.id}`)}
          />
          {sessions.data ? (
            <Pagination
              page={sessions.data.page}
              pageCount={sessions.data.pageCount}
              total={sessions.data.total}
              onChange={setPage}
            />
          ) : null}
        </CardBody>
      </Card>

      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="New attendance session"
        description="Create a session, then open it to mark who attended."
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowNew(false)} disabled={create.saving}>
              Cancel
            </Button>
            <Button variant="gold" type="submit" form="new-session-form" loading={create.saving}>
              Create session
            </Button>
          </>
        }
      >
        <form id="new-session-form" className="flex flex-col gap-4" onSubmit={submitNew}>
          <FormError message={create.error?.message} />
          <Field label="Title" required error={create.error?.fields?.title} htmlFor="new-title">
            <Input
              id="new-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="e.g. Thursday rehearsal"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Activity type" required error={create.error?.fields?.activityType} htmlFor="new-activity">
              <Select
                id="new-activity"
                value={form.activityType}
                onChange={(event) => setForm({ ...form, activityType: event.target.value })}
              >
                {(types.length > 0 ? types : ["rehearsal"]).map((type) => (
                  <option key={type} value={type}>
                    {humanize(type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required error={create.error?.fields?.date} htmlFor="new-date">
              <Input
                id="new-date"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
                required
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time" error={create.error?.fields?.startTime} htmlFor="new-start">
              <Input
                id="new-start"
                type="time"
                value={form.startTime}
                onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              />
            </Field>
            <Field label="End time" error={create.error?.fields?.endTime} htmlFor="new-end">
              <Input
                id="new-end"
                type="time"
                value={form.endTime}
                onChange={(event) => setForm({ ...form, endTime: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Location" error={create.error?.fields?.location} htmlFor="new-location">
            <Input
              id="new-location"
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
              placeholder="Rehearsal hall, church…"
            />
          </Field>
          <Field
            label="Group"
            hint="Leave as whole choir for an organisation-wide session."
            error={create.error?.fields?.targetGroupId}
            htmlFor="new-group"
          >
            <Select
              id="new-group"
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
          <Field label="Notes" error={create.error?.fields?.notes} htmlFor="new-notes">
            <Textarea
              id="new-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Optional context for this session"
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
