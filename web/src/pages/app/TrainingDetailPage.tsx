import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Pencil, Plus, Trash2, UserPlus } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  humanize,
  useToast,
  type Column,
} from "../../components/ui"

const TRAINING_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const
const ATTENDANCE_OPTIONS = ["pending", "present", "late", "absent", "excused"] as const

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

interface TrainingParticipantRow {
  member_id: string
  attendance: string
  completed: number
  notes: string | null
  full_name: string
  member_no: string
  group_id: string
  group_name: string
}

interface DetailResponse {
  training: TrainingRow
  participants: TrainingParticipantRow[]
}

interface RosterEntry {
  memberId: string
  fullName: string
  memberNo: string
  groupName: string
  attendance: string
  completed: boolean
  notes: string
}

interface RosterPayloadEntry {
  memberId: string
  attendance: string
  completed: boolean
  notes?: string | null
}

interface MemberRow {
  id: string
  member_no: string
  full_name: string
  status: string
  group_id: string
  group_name: string
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
  title?: string
  date?: string
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

function toRoster(participants: TrainingParticipantRow[]): RosterEntry[] {
  return participants.map((participant) => ({
    memberId: participant.member_id,
    fullName: participant.full_name,
    memberNo: participant.member_no,
    groupName: participant.group_name,
    attendance: participant.attendance,
    completed: participant.completed === 1,
    notes: participant.notes ?? "",
  }))
}

export function TrainingDetailPage() {
  const { id = "" } = useParams()
  const { can } = useAuth()
  const toast = useToast()
  const canWrite = can("training.write")
  const canReadMembers = can("member.read")

  const detail = useQuery<DetailResponse>(id ? `/training/${id}` : null)
  const meta = useQuery<{ groups: GroupRow[] }>("/members/meta")

  const [roster, setRoster] = useState<RosterEntry[]>([])

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<TrainingFormState | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [memberSearch, setMemberSearch] = useState("")
  const debouncedMemberSearch = useDebounced(memberSearch, 300)

  useEffect(() => {
    if (detail.data) setRoster(toRoster(detail.data.participants))
  }, [detail.data])

  const memberQuery = useQuery<Page<MemberRow>>(
    addOpen && canReadMembers ? `/members${toQuery({ search: debouncedMemberSearch, pageSize: 50 })}` : null,
  )

  const update = useMutation((body: TrainingPayload) => api.patch<{ training: TrainingRow }>(`/training/${id}`, body))
  const saveRoster = useMutation((participants: RosterPayloadEntry[]) =>
    api.put<{ training: TrainingRow; participants: TrainingParticipantRow[] }>(`/training/${id}/participants`, {
      participants,
    }),
  )

  const training = detail.data?.training
  const groups = meta.data?.groups ?? []

  function openEdit() {
    if (!training) return
    setEditForm({
      title: training.title,
      date: training.date,
      groupId: training.group_id ?? "",
      trainer: training.trainer ?? "",
      topics: training.topics ?? "",
      status: training.status,
      notes: training.notes ?? "",
    })
    update.reset()
    setEditOpen(true)
  }

  async function submitEdit(form: FormEvent) {
    form.preventDefault()
    if (!editForm) return
    const result = await update.run({
      title: editForm.title.trim(),
      date: editForm.date,
      groupId: editForm.groupId || null,
      trainer: editForm.trainer.trim() || null,
      topics: editForm.topics.trim() || null,
      status: editForm.status,
      notes: editForm.notes.trim() || null,
    })
    if (!result) return
    toast.success("Training session updated.")
    setEditOpen(false)
    detail.reload()
  }

  function updateEntry(memberId: string, patch: Partial<RosterEntry>) {
    setRoster((current) =>
      current.map((entry) => (entry.memberId === memberId ? { ...entry, ...patch } : entry)),
    )
  }

  function removeEntry(memberId: string) {
    setRoster((current) => current.filter((entry) => entry.memberId !== memberId))
  }

  function openAdd() {
    setSelectedMembers([])
    setMemberSearch("")
    setAddOpen(true)
  }

  function toggleMember(memberId: string) {
    setSelectedMembers((current) =>
      current.includes(memberId) ? current.filter((value) => value !== memberId) : [...current, memberId],
    )
  }

  function confirmAdd() {
    const existing = new Set(roster.map((entry) => entry.memberId))
    const items = memberQuery.data?.items ?? []
    const additions: RosterEntry[] = selectedMembers
      .filter((memberId) => !existing.has(memberId))
      .map((memberId) => {
        const member = items.find((item) => item.id === memberId)
        return {
          memberId,
          fullName: member?.full_name ?? "Member",
          memberNo: member?.member_no ?? "",
          groupName: member?.group_name ?? "",
          attendance: "pending",
          completed: false,
          notes: "",
        }
      })
    setRoster((current) => [...current, ...additions])
    setAddOpen(false)
  }

  async function submitRoster() {
    const result = await saveRoster.run(
      roster.map((entry) => ({
        memberId: entry.memberId,
        attendance: entry.attendance,
        completed: entry.completed,
        notes: entry.notes.trim() || null,
      })),
    )
    if (!result) return
    toast.success(`Roster saved (${result.participants.length} participant${result.participants.length === 1 ? "" : "s"}).`)
    detail.reload()
  }

  const columns: Column<RosterEntry>[] = [
    {
      key: "member",
      header: "Member",
      render: (entry) => (
        <div className="min-w-0">
          <p className="font-medium">{entry.fullName}</p>
          <p className="muted text-xs">
            {entry.memberNo}
            {entry.groupName ? ` · ${entry.groupName}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "attendance",
      header: "Attendance",
      render: (entry) =>
        canWrite ? (
          <Select
            aria-label={`Attendance for ${entry.fullName}`}
            value={entry.attendance}
            onChange={(event) => updateEntry(entry.memberId, { attendance: event.target.value })}
          >
            {ATTENDANCE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        ) : (
          <StatusBadge status={entry.attendance} />
        ),
    },
    {
      key: "completed",
      header: "Completed",
      align: "center",
      render: (entry) =>
        canWrite ? (
          <input
            type="checkbox"
            className="h-4 w-4"
            aria-label={`Completed for ${entry.fullName}`}
            checked={entry.completed}
            onChange={(event) => updateEntry(entry.memberId, { completed: event.target.checked })}
          />
        ) : entry.completed ? (
          "Yes"
        ) : (
          "No"
        ),
    },
    {
      key: "notes",
      header: "Notes",
      render: (entry) =>
        canWrite ? (
          <Input
            aria-label={`Notes for ${entry.fullName}`}
            value={entry.notes}
            placeholder="—"
            onChange={(event) => updateEntry(entry.memberId, { notes: event.target.value })}
          />
        ) : (
          entry.notes || <span className="muted">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (entry) =>
        canWrite ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={() => removeEntry(entry.memberId)}
            aria-label={`Remove ${entry.fullName}`}
          >
            Remove
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Link to="/app/training" className="link flex w-fit items-center gap-1.5 text-sm">
        <ArrowLeft size={15} /> All training
      </Link>

      {detail.loading ? (
        <LoadingBlock label="Loading training session…" rows={4} />
      ) : detail.error ? (
        <Card>
          <CardBody>
            <ErrorState title="Could not load this session" description={detail.error.message} />
          </CardBody>
        </Card>
      ) : !training ? (
        <Card>
          <CardBody>
            <EmptyState title="Session not found" description="This training session may have been removed." />
          </CardBody>
        </Card>
      ) : (
        <>
          <PageHeader
            title={training.title}
            description={`${formatDate(training.date)}${training.group_name ? ` · ${training.group_name}` : ""}`}
            actions={
              canWrite ? (
                <Button variant="outline" icon={<Pencil size={16} />} onClick={openEdit}>
                  Edit
                </Button>
              ) : null
            }
          />

          <Card>
            <CardHeader title="Details" description="Session schedule and content." />
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Status">
                <StatusBadge status={training.status} />
              </DetailRow>
              <DetailRow label="Date">{formatDate(training.date)}</DetailRow>
              <DetailRow label="Group">{training.group_name || "All members"}</DetailRow>
              <DetailRow label="Trainer">{training.trainer || "—"}</DetailRow>
              <DetailRow label="Participants">{training.participant_count}</DetailRow>
              <DetailRow label="Created">{formatDate(training.created_at)}</DetailRow>
              {training.topics ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <DetailRow label="Topics">
                    <span className="whitespace-pre-wrap">{training.topics}</span>
                  </DetailRow>
                </div>
              ) : null}
              {training.notes ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <DetailRow label="Notes">
                    <span className="whitespace-pre-wrap">{training.notes}</span>
                  </DetailRow>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Participants"
              description="Record attendance and completion for each member."
              actions={
                canWrite ? (
                  <>
                    <Button variant="outline" size="sm" icon={<UserPlus size={14} />} onClick={openAdd}>
                      Add members
                    </Button>
                    <Button
                      variant="gold"
                      size="sm"
                      loading={saveRoster.saving}
                      onClick={submitRoster}
                      disabled={roster.length === 0 && (detail.data?.participants.length ?? 0) === 0}
                    >
                      Save roster
                    </Button>
                  </>
                ) : null
              }
            />
            <div className="px-5 py-4">
              <DataTable
                columns={columns}
                rows={roster}
                rowKey={(entry) => entry.memberId}
                emptyTitle="No participants yet"
                emptyDescription={
                  canWrite
                    ? "Add members to build the training roster."
                    : "No members have been added to this session."
                }
                emptyAction={
                  canWrite ? (
                    <Button variant="gold" icon={<Plus size={16} />} onClick={openAdd}>
                      Add members
                    </Button>
                  ) : undefined
                }
              />
            </div>
          </Card>
        </>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit training session"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={update.saving}>
              Cancel
            </Button>
            <Button variant="gold" onClick={submitEdit} loading={update.saving}>
              Save changes
            </Button>
          </>
        }
      >
        {editForm ? (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitEdit}>
            <div className="sm:col-span-2">
              <Field label="Title" htmlFor="edit-title" required error={update.error?.fields?.title}>
                <Input
                  id="edit-title"
                  value={editForm.title}
                  onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Date" htmlFor="edit-date" required error={update.error?.fields?.date}>
              <Input
                id="edit-date"
                type="date"
                value={editForm.date}
                onChange={(event) => setEditForm({ ...editForm, date: event.target.value })}
                required
              />
            </Field>
            <Field label="Group" htmlFor="edit-group" error={update.error?.fields?.groupId}>
              <Select
                id="edit-group"
                value={editForm.groupId}
                onChange={(event) => setEditForm({ ...editForm, groupId: event.target.value })}
              >
                <option value="">All members</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Trainer" htmlFor="edit-trainer" error={update.error?.fields?.trainer}>
              <Input
                id="edit-trainer"
                value={editForm.trainer}
                onChange={(event) => setEditForm({ ...editForm, trainer: event.target.value })}
              />
            </Field>
            <Field label="Status" htmlFor="edit-status">
              <Select
                id="edit-status"
                value={editForm.status}
                onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
              >
                {TRAINING_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Topics" htmlFor="edit-topics" error={update.error?.fields?.topics}>
                <Textarea
                  id="edit-topics"
                  value={editForm.topics}
                  onChange={(event) => setEditForm({ ...editForm, topics: event.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Notes" htmlFor="edit-notes" error={update.error?.fields?.notes}>
                <Textarea
                  id="edit-notes"
                  value={editForm.notes}
                  onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                />
              </Field>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add members"
        description="Select members to add to this session's roster."
        size="lg"
        footer={
          <>
            <span className="muted mr-auto text-sm">{selectedMembers.length} selected</span>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="gold" onClick={confirmAdd} disabled={selectedMembers.length === 0}>
              Add selected
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Search members" htmlFor="member-search">
            <Input
              id="member-search"
              placeholder="Search by name or member number"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
          </Field>
          {!canReadMembers ? (
            <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
              You do not have permission to browse the member directory, so members cannot be added here.
            </div>
          ) : memberQuery.loading ? (
            <LoadingBlock label="Loading members…" rows={4} />
          ) : memberQuery.error ? (
            <ErrorState title="Could not load members" description={memberQuery.error.message} />
          ) : (memberQuery.data?.items ?? []).length === 0 ? (
            <EmptyState title="No members found" description="Try a different search term." />
          ) : (
            <ul className="max-h-80 overflow-y-auto rounded-xl border hairline">
              {(memberQuery.data?.items ?? []).map((member) => {
                const alreadyAdded = roster.some((entry) => entry.memberId === member.id)
                return (
                  <li key={member.id} className="border-b hairline last:border-0">
                    <label
                      className={`flex items-center gap-3 px-3 py-2 ${
                        alreadyAdded ? "opacity-60" : "cursor-pointer hover:bg-gold-400/10"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedMembers.includes(member.id) || alreadyAdded}
                        disabled={alreadyAdded}
                        onChange={() => toggleMember(member.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{member.full_name}</span>
                        <span className="muted block text-xs">
                          {member.member_no} · {member.group_name}
                          {alreadyAdded ? " · already on roster" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
