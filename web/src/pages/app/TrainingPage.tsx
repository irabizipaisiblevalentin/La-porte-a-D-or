import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { GraduationCap, Plus } from "lucide-react"
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

const TRAINING_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const

interface TrainingRow {
  id: string
  title: string
  date: string
  group_id: string | null
  trainer: string | null
  topics: string | null
  status: string
  notes: string | null
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

interface TrainingFormState {
  title: string
  date: string
  groupId: string
  trainer: string
  topics: string
  status: string
  notes: string
}

interface TrainingPayload {
  title: string
  date: string
  groupId?: string | null
  trainer?: string | null
  topics?: string | null
  status?: string
  notes?: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function emptyForm(): TrainingFormState {
  return { title: "", date: "", groupId: "", trainer: "", topics: "", status: "planned", notes: "" }
}

export function TrainingPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const canWrite = can("training.write")

  const [groupId, setGroupId] = useState("")
  const [status, setStatus] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<TrainingFormState>(emptyForm)

  const query = toQuery({ groupId, status, from, to, page })
  const list = useQuery<Page<TrainingRow>>(`/training${query}`)
  const meta = useQuery<{ groups: GroupRow[] }>("/members/meta")

  const create = useMutation((body: TrainingPayload) => api.post<{ training: TrainingRow }>("/training", body))

  const rows = list.data?.items ?? []
  const groups = meta.data?.groups ?? []

  function resetFilters() {
    setGroupId("")
    setStatus("")
    setFrom("")
    setTo("")
    setPage(1)
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    const result = await create.run({
      title: form.title.trim(),
      date: form.date,
      groupId: form.groupId || null,
      trainer: form.trainer.trim() || null,
      topics: form.topics.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    })
    if (!result) return
    toast.success(`Training session "${result.training.title}" was created.`)
    setCreateOpen(false)
    setForm(emptyForm())
    list.reload()
  }

  const columns: Column<TrainingRow>[] = [
    {
      key: "title",
      header: "Session",
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.title}</p>
          {row.trainer ? <p className="muted text-xs">{row.trainer}</p> : null}
        </div>
      ),
    },
    { key: "date", header: "Date", render: (row) => formatDate(row.date) },
    { key: "group", header: "Group", render: (row) => row.group_name || <span className="muted">All</span> },
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
        title="Training"
        description="Scheduled training sessions and the members taking part. Open a session to record attendance and completion."
        actions={
          canWrite ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              New training
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
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
          <div className="w-full sm:w-44">
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
                {TRAINING_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
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
            emptyTitle="No training sessions found"
            emptyDescription={
              groupId || status || from || to
                ? "No sessions match these filters. Try clearing them."
                : "No training sessions have been scheduled yet."
            }
            emptyAction={
              canWrite ? (
                <Button variant="gold" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                  New training
                </Button>
              ) : undefined
            }
            onRowClick={(row) => navigate(`/app/training/${row.id}`)}
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
        title="New training session"
        description="Schedule a training session and optionally target a group."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={create.saving}>
              Cancel
            </Button>
            <Button variant="gold" onClick={submitCreate} loading={create.saving} icon={<GraduationCap size={16} />}>
              Create session
            </Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitCreate}>
          <div className="sm:col-span-2">
            <Field label="Title" htmlFor="training-title" required error={create.error?.fields?.title}>
              <Input
                id="training-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Date" htmlFor="training-date" required error={create.error?.fields?.date}>
            <Input
              id="training-date"
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              required
            />
          </Field>
          <Field label="Group" htmlFor="training-group" hint="Leave blank for all members." error={create.error?.fields?.groupId}>
            <Select
              id="training-group"
              value={form.groupId}
              onChange={(event) => setForm({ ...form, groupId: event.target.value })}
            >
              <option value="">All members</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Trainer" htmlFor="training-trainer" error={create.error?.fields?.trainer}>
            <Input
              id="training-trainer"
              value={form.trainer}
              onChange={(event) => setForm({ ...form, trainer: event.target.value })}
            />
          </Field>
          <Field label="Status" htmlFor="training-status">
            <Select
              id="training-status"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              {TRAINING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Topics" htmlFor="training-topics" error={create.error?.fields?.topics}>
              <Textarea
                id="training-topics"
                value={form.topics}
                onChange={(event) => setForm({ ...form, topics: event.target.value })}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes" htmlFor="training-notes" error={create.error?.fields?.notes}>
              <Textarea
                id="training-notes"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
          </div>
        </form>
      </Modal>
    </div>
  )
}
