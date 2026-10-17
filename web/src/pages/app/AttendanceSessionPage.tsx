import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  MapPin,
  Pencil,
  Save,
  Trash2,
} from "lucide-react"
import { api } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Textarea,
  humanize,
  useToast,
  type Column,
} from "../../components/ui"

interface Group {
  id: string
  key: string
  name: string
}

interface Meta {
  groups: Group[]
}

interface AttendanceSession {
  id: string
  title: string
  activityType: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
  targetGroupId: string | null
  targetGroupKey: string | null
  targetGroupName: string | null
  markedCount: number | null
  notes: string | null
}

interface Participant {
  memberId: string
  fullName: string
  memberNo: string
  groupKey: string
  status: string
  notes: string | null
}

interface SessionDetail {
  session: AttendanceSession
  participants: Participant[]
}

interface Mark {
  status: string
  notes: string
}

interface MarkInput {
  memberId: string
  status: string
  notes: string | null
}

interface EditFormState {
  title: string
  activityType: string
  date: string
  startTime: string
  endTime: string
  location: string
  targetGroupId: string
  notes: string
}

const STATUS_OPTIONS = ["unmarked", "present", "late", "absent", "excused"] as const

const STATUS_LABELS: Record<string, string> = {
  unmarked: "Not marked",
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
}

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

export function AttendanceSessionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const canWrite = can("attendance.write")

  const detail = useQuery<SessionDetail>(id ? `/attendance/sessions/${id}` : null, [id])
  const activityTypes = useQuery<{ activityTypes: string[] }>("/attendance/activity-types")
  const meta = useQuery<Meta>("/members/meta")

  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editForm, setEditForm] = useState<EditFormState>({
    title: "",
    activityType: "rehearsal",
    date: today(),
    startTime: "",
    endTime: "",
    location: "",
    targetGroupId: "",
    notes: "",
  })

  useEffect(() => {
    if (!detail.data) return
    const next: Record<string, Mark> = {}
    for (const participant of detail.data.participants) {
      next[participant.memberId] = { status: participant.status, notes: participant.notes ?? "" }
    }
    setMarks(next)
  }, [detail.data])

  const save = useMutation((records: MarkInput[]) =>
    api.put<{ ok: boolean; changed: number; total: number }>(`/attendance/sessions/${id}/records`, { records }),
  )
  const update = useMutation((body: Record<string, unknown>) =>
    api.patch<{ session: AttendanceSession }>(`/attendance/sessions/${id}`, body),
  )
  const remove = useMutation(() => api.del<{ ok: boolean }>(`/attendance/sessions/${id}`))

  const session = detail.data?.session
  const participants = detail.data?.participants ?? []

  const counts = useMemo(() => {
    const result: Record<string, number> = { unmarked: 0, present: 0, late: 0, absent: 0, excused: 0 }
    for (const participant of participants) {
      const status = marks[participant.memberId]?.status ?? participant.status
      result[status] = (result[status] ?? 0) + 1
    }
    return result
  }, [participants, marks])

  function setStatus(memberId: string, status: string) {
    setMarks((previous) => ({
      ...previous,
      [memberId]: { status, notes: previous[memberId]?.notes ?? "" },
    }))
  }

  function setNotes(memberId: string, notes: string) {
    setMarks((previous) => ({
      ...previous,
      [memberId]: { status: previous[memberId]?.status ?? "unmarked", notes },
    }))
  }

  function markAllPresent() {
    setMarks((previous) => {
      const next: Record<string, Mark> = { ...previous }
      for (const participant of participants) {
        next[participant.memberId] = { status: "present", notes: previous[participant.memberId]?.notes ?? "" }
      }
      return next
    })
  }

  async function saveAll() {
    const records: MarkInput[] = []
    for (const participant of participants) {
      const mark = marks[participant.memberId]
      const status = mark?.status ?? participant.status
      if (!STATUS_OPTIONS.includes(status as (typeof STATUS_OPTIONS)[number])) continue
      if (status === "unmarked") continue
      records.push({ memberId: participant.memberId, status, notes: (mark?.notes ?? "").trim() || null })
    }
    if (records.length === 0) {
      toast.info("Mark at least one member before saving.")
      return
    }
    const result = await save.run(records)
    if (result) {
      toast.success(`Attendance saved — ${result.changed} of ${result.total} record(s) changed.`)
      detail.reload()
    }
  }

  function openEdit() {
    if (!session) return
    update.reset()
    setEditForm({
      title: session.title,
      activityType: session.activityType,
      date: session.date,
      startTime: session.startTime ?? "",
      endTime: session.endTime ?? "",
      location: session.location ?? "",
      targetGroupId: session.targetGroupId ?? "",
      notes: session.notes ?? "",
    })
    setEditing(true)
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault()
    const result = await update.run({
      title: editForm.title.trim(),
      activityType: editForm.activityType,
      date: editForm.date,
      startTime: editForm.startTime || null,
      endTime: editForm.endTime || null,
      location: editForm.location.trim() || null,
      targetGroupId: editForm.targetGroupId || null,
      notes: editForm.notes.trim() || null,
    })
    if (result) {
      toast.success("Session updated.")
      setEditing(false)
      detail.reload()
    }
  }

  async function doDelete() {
    const result = await remove.run()
    if (result !== undefined) {
      toast.success("Session deleted.")
      navigate("/app/attendance")
    }
  }

  const columns: Column<Participant>[] = [
    {
      key: "member",
      header: "Member",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.fullName}</span>
          <span className="muted text-xs">
            {row.memberNo} · {humanize(row.groupKey)}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = marks[row.memberId]?.status ?? row.status
        return (
          <Select
            aria-label={`Attendance status for ${row.fullName}`}
            value={value}
            disabled={!canWrite}
            onChange={(event) => setStatus(row.memberId, event.target.value)}
            className="max-w-[10rem]"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        )
      },
    },
    {
      key: "notes",
      header: "Notes",
      render: (row) => (
        <Input
          aria-label={`Notes for ${row.fullName}`}
          placeholder="Optional note"
          value={marks[row.memberId]?.notes ?? ""}
          disabled={!canWrite}
          onChange={(event) => setNotes(row.memberId, event.target.value)}
        />
      ),
    },
  ]

  if (detail.loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Attendance session"
          breadcrumbs={[{ label: "Attendance", to: "/app/attendance" }, { label: "Session" }]}
        />
        <LoadingBlock label="Loading session…" rows={4} />
      </div>
    )
  }

  if (detail.error || !session) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Attendance session"
          breadcrumbs={[{ label: "Attendance", to: "/app/attendance" }, { label: "Session" }]}
        />
        <EmptyState
          tone="danger"
          icon={<AlertCircle size={22} />}
          title="Could not load this session"
          description={detail.error?.message ?? "That attendance session could not be found."}
          action={
            <Link to="/app/attendance" className="btn btn-outline">
              <ArrowLeft size={16} /> Back to attendance
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={session.title}
        description={`${humanize(session.activityType)} · ${session.date}${session.targetGroupName ? ` · ${session.targetGroupName}` : " · Whole choir"}`}
        breadcrumbs={[{ label: "Attendance", to: "/app/attendance" }, { label: session.title }]}
        actions={
          <>
            <Link to="/app/attendance" className="btn btn-ghost btn-sm">
              <ArrowLeft size={15} /> Back
            </Link>
            {canWrite ? (
              <>
                <Button variant="outline" size="sm" icon={<Pencil size={15} />} onClick={openEdit}>
                  Edit
                </Button>
                <Button variant="danger" size="sm" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem icon={<CalendarClock size={15} />} label="Date" value={session.date} />
          <InfoItem label="Activity" value={humanize(session.activityType)} />
          <InfoItem label="Group" value={session.targetGroupName ?? "Whole choir"} />
          <InfoItem icon={<MapPin size={15} />} label="Location" value={session.location ?? "Not specified"} />
        </CardBody>
        {session.notes ? (
          <CardBody className="border-t hairline pt-3">
            <p className="muted text-sm">{session.notes}</p>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Roster"
          description={`${participants.length} member${participants.length === 1 ? "" : "s"} in this session`}
          actions={
            canWrite ? (
              <>
                <Button variant="ghost" size="sm" icon={<CheckCheck size={15} />} onClick={markAllPresent}>
                  Mark all present
                </Button>
                <Button variant="gold" size="sm" icon={<Save size={15} />} loading={save.saving} onClick={saveAll}>
                  Save attendance
                </Button>
              </>
            ) : null
          }
        />
        <CardBody className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="positive">Present {counts.present ?? 0}</Badge>
            <Badge tone="warn">Late {counts.late ?? 0}</Badge>
            <Badge tone="danger">Absent {counts.absent ?? 0}</Badge>
            <Badge tone="neutral">Excused {counts.excused ?? 0}</Badge>
            <Badge tone="neutral">Not marked {counts.unmarked ?? 0}</Badge>
          </div>
          <FormError message={save.error?.message} />
          <DataTable
            columns={columns}
            rows={participants}
            rowKey={(row) => row.memberId}
            emptyTitle="No members to mark"
            emptyDescription="This session has no active members in its group, or its roster is empty."
          />
        </CardBody>
      </Card>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit session"
        description="Update the session details. Attendance records are saved separately."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={update.saving}>
              Cancel
            </Button>
            <Button variant="gold" type="submit" form="edit-session-form" loading={update.saving}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-session-form" className="flex flex-col gap-4" onSubmit={submitEdit}>
          <FormError message={update.error?.message} />
          <Field label="Title" required error={update.error?.fields?.title} htmlFor="edit-title">
            <Input
              id="edit-title"
              value={editForm.title}
              onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Activity type" required error={update.error?.fields?.activityType} htmlFor="edit-activity">
              <Select
                id="edit-activity"
                value={editForm.activityType}
                onChange={(event) => setEditForm({ ...editForm, activityType: event.target.value })}
              >
                {(activityTypes.data?.activityTypes ?? [editForm.activityType]).map((type) => (
                  <option key={type} value={type}>
                    {humanize(type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required error={update.error?.fields?.date} htmlFor="edit-date">
              <Input
                id="edit-date"
                type="date"
                value={editForm.date}
                onChange={(event) => setEditForm({ ...editForm, date: event.target.value })}
                required
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time" htmlFor="edit-start">
              <Input
                id="edit-start"
                type="time"
                value={editForm.startTime}
                onChange={(event) => setEditForm({ ...editForm, startTime: event.target.value })}
              />
            </Field>
            <Field label="End time" htmlFor="edit-end">
              <Input
                id="edit-end"
                type="time"
                value={editForm.endTime}
                onChange={(event) => setEditForm({ ...editForm, endTime: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Location" htmlFor="edit-location">
            <Input
              id="edit-location"
              value={editForm.location}
              onChange={(event) => setEditForm({ ...editForm, location: event.target.value })}
            />
          </Field>
          <Field
            label="Group"
            hint="Leave as whole choir for an organisation-wide session."
            error={update.error?.fields?.targetGroupId}
            htmlFor="edit-group"
          >
            <Select
              id="edit-group"
              value={editForm.targetGroupId}
              onChange={(event) => setEditForm({ ...editForm, targetGroupId: event.target.value })}
            >
              <option value="">Whole choir</option>
              {(meta.data?.groups ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="edit-notes">
            <Textarea
              id="edit-notes"
              rows={3}
              value={editForm.notes}
              onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this session?"
        message={`“${session.title}” and all of its attendance records will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete session"
        tone="danger"
        loading={remove.saving}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}

function InfoItem({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="muted flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
        {icon}
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
