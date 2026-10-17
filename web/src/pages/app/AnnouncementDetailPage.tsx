import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Megaphone, Pencil, Send } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
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
} from "../../components/ui"

const AUDIENCES = ["all", "senior", "junior", "members", "selected"] as const
const PRIORITIES = ["normal", "important", "urgent"] as const

interface AnnouncementRow {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  status: string
  scheduled_at: string | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  created_by_name: string | null
  recipient_count: number
}

interface RecipientRow {
  user_id: string
  display_name: string
  email: string
}

interface DetailResponse {
  announcement: AnnouncementRow
  recipients: RecipientRow[]
}

interface UserDto {
  id: string
  email: string
  displayName: string
  status: string
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface EditPayload {
  title?: string
  message?: string
  audience?: string
  priority?: string
  scheduledAt?: string | null
  recipientIds?: string[]
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function priorityTone(priority: string): "neutral" | "warn" | "danger" {
  if (priority === "urgent") return "danger"
  if (priority === "important") return "warn"
  return "neutral"
}

/** Converts a stored ISO timestamp into the value a datetime-local input expects. */
function toLocalInput(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}

interface EditFormState {
  title: string
  message: string
  audience: string
  priority: string
  scheduledAt: string
}

export function AnnouncementDetailPage() {
  const { id = "" } = useParams()
  const { can } = useAuth()
  const toast = useToast()
  const canWrite = can("announcements.write")
  const canPickUsers = can("users.manage")

  const detail = useQuery<DetailResponse>(id ? `/announcements/${id}` : null)
  const readMarked = useRef<Set<string>>(new Set())

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState("")
  const debouncedUserSearch = useDebounced(userSearch, 300)

  const [publishOpen, setPublishOpen] = useState(false)

  const usersQuery = useQuery<Page<UserDto>>(
    editOpen && editForm?.audience === "selected" && canPickUsers
      ? `/users${toQuery({ search: debouncedUserSearch, pageSize: 50 })}`
      : null,
  )

  const update = useMutation((body: EditPayload) =>
    api.patch<{ announcement: AnnouncementRow }>(`/announcements/${id}`, body),
  )
  const publish = useMutation(() => api.post<{ announcement: AnnouncementRow }>(`/announcements/${id}/publish`))

  const announcement = detail.data?.announcement
  const recipients = detail.data?.recipients ?? []

  // Record that the signed-in reader has opened a published announcement (best effort only).
  useEffect(() => {
    if (!announcement || canWrite || announcement.status !== "published") return
    if (readMarked.current.has(announcement.id)) return
    readMarked.current.add(announcement.id)
    api.post(`/announcements/${announcement.id}/read`).catch(() => undefined)
  }, [announcement, canWrite])

  function openEdit() {
    if (!announcement) return
    setEditForm({
      title: announcement.title,
      message: announcement.message,
      audience: announcement.audience,
      priority: announcement.priority,
      scheduledAt: toLocalInput(announcement.scheduled_at),
    })
    setRecipientIds(recipients.map((recipient) => recipient.user_id))
    setUserSearch("")
    update.reset()
    setEditOpen(true)
  }

  function toggleRecipient(userId: string) {
    setRecipientIds((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    )
  }

  async function submitEdit(form: FormEvent) {
    form.preventDefault()
    if (!editForm) return
    const audienceChanged = editForm.audience !== announcement?.audience
    const needsRecipients =
      editForm.audience === "selected" && (audienceChanged || recipientIds.length > 0)
    if (editForm.audience === "selected" && recipientIds.length === 0) return
    const result = await update.run({
      title: editForm.title.trim(),
      message: editForm.message.trim(),
      audience: editForm.audience,
      priority: editForm.priority,
      scheduledAt: editForm.scheduledAt || null,
      recipientIds: needsRecipients ? recipientIds : undefined,
    })
    if (!result) return
    toast.success("Announcement updated.")
    setEditOpen(false)
    detail.reload()
  }

  async function confirmPublish() {
    const result = await publish.run()
    if (!result) return
    toast.success("Announcement published. In-app notifications have been delivered.")
    setPublishOpen(false)
    detail.reload()
  }

  const canSchedule = announcement ? announcement.status === "draft" || announcement.status === "scheduled" : false

  return (
    <div className="flex flex-col gap-6">
      <Link to="/app/announcements" className="link flex w-fit items-center gap-1.5 text-sm">
        <ArrowLeft size={15} /> All announcements
      </Link>

      {detail.loading ? (
        <LoadingBlock label="Loading announcement…" rows={4} />
      ) : detail.error ? (
        <Card>
          <CardBody>
            <ErrorState title="Could not load this announcement" description={detail.error.message} />
          </CardBody>
        </Card>
      ) : !announcement ? (
        <Card>
          <CardBody>
            <EmptyState title="Announcement not found" description="This announcement may have been removed." />
          </CardBody>
        </Card>
      ) : (
        <>
          <PageHeader
            title={announcement.title}
            description={`From ${announcement.created_by_name ?? "the choir team"} · ${formatDateTime(
              announcement.created_at,
            )}`}
            actions={
              canWrite ? (
                <>
                  <Button variant="outline" icon={<Pencil size={16} />} onClick={openEdit}>
                    Edit
                  </Button>
                  {announcement.status !== "published" && announcement.status !== "archived" ? (
                    <Button variant="gold" icon={<Send size={16} />} onClick={() => setPublishOpen(true)}>
                      Publish
                    </Button>
                  ) : null}
                </>
              ) : null
            }
          />

          <Card>
            <CardHeader
              title={<StatusBadge status={announcement.status} />}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={priorityTone(announcement.priority)}>{humanize(announcement.priority)}</Badge>
                  <span className="muted text-xs">Audience: {humanize(announcement.audience)}</span>
                </span>
              }
            />
            <CardBody className="flex flex-col gap-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{announcement.message}</p>
              <div className="grid gap-3 border-t hairline pt-4 sm:grid-cols-2 lg:grid-cols-3">
                <DetailRow label="Status">
                  <StatusBadge status={announcement.status} />
                </DetailRow>
                <DetailRow label="Audience">{humanize(announcement.audience)}</DetailRow>
                <DetailRow label="Priority">{humanize(announcement.priority)}</DetailRow>
                <DetailRow label="Author">{announcement.created_by_name ?? "—"}</DetailRow>
                <DetailRow label="Scheduled for">
                  {announcement.scheduled_at ? formatDateTime(announcement.scheduled_at) : "Not scheduled"}
                </DetailRow>
                <DetailRow label="Published">
                  {announcement.published_at ? formatDateTime(announcement.published_at) : "Not published yet"}
                </DetailRow>
              </div>
            </CardBody>
          </Card>

          {canWrite ? (
            <Card>
              <CardHeader
                title="Recipients"
                description={
                  announcement.audience === "selected"
                    ? `${recipients.length} specifically selected account${recipients.length === 1 ? "" : "s"}.`
                    : "Everyone in the selected audience receives this announcement."
                }
              />
              <CardBody>
                {announcement.audience === "selected" ? (
                  recipients.length > 0 ? (
                    <ul className="flex flex-col divide-y hairline">
                      {recipients.map((recipient) => (
                        <li key={recipient.user_id} className="flex items-center justify-between gap-3 py-2">
                          <span className="text-sm font-medium">{recipient.display_name}</span>
                          <span className="muted text-xs">{recipient.email}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted text-sm">No specific recipients have been added.</p>
                  )
                ) : (
                  <p className="muted text-sm">
                    This announcement targets the {humanize(announcement.audience).toLowerCase()} audience.
                  </p>
                )}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Delivery" description="How this announcement reaches members." />
            <CardBody className="flex flex-col gap-3 text-sm">
              <p>
                <strong>In-app:</strong>{" "}
                {announcement.status === "published"
                  ? "delivered as notifications when published."
                  : "will be delivered as in-app notifications on publish."}
              </p>
              <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2">
                External email and SMS delivery is not configured on this deployment yet. Members will only receive
                this announcement inside the platform until those integrations are set up.
              </div>
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit announcement"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={update.saving}>
              Cancel
            </Button>
            <Button
              variant="gold"
              onClick={submitEdit}
              loading={update.saving}
              disabled={editForm?.audience === "selected" && recipientIds.length === 0}
            >
              Save changes
            </Button>
          </>
        }
      >
        {editForm ? (
          <form className="flex flex-col gap-4" onSubmit={submitEdit}>
            <Field label="Title" htmlFor="edit-title" required error={update.error?.fields?.title}>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                required
              />
            </Field>
            <Field label="Message" htmlFor="edit-message" required error={update.error?.fields?.message}>
              <Textarea
                id="edit-message"
                rows={6}
                value={editForm.message}
                onChange={(event) => setEditForm({ ...editForm, message: event.target.value })}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Audience" htmlFor="edit-audience" required error={update.error?.fields?.audience}>
                <Select
                  id="edit-audience"
                  value={editForm.audience}
                  onChange={(event) => setEditForm({ ...editForm, audience: event.target.value })}
                >
                  {AUDIENCES.map((value) => (
                    <option key={value} value={value}>
                      {humanize(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="edit-priority">
                <Select
                  id="edit-priority"
                  value={editForm.priority}
                  onChange={(event) => setEditForm({ ...editForm, priority: event.target.value })}
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {humanize(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {editForm.audience === "selected" ? (
              <div className="flex flex-col gap-3">
                <Field
                  label="Recipients"
                  hint="Choose the accounts that should receive this announcement."
                  error={update.error?.fields?.recipientIds}
                >
                  <Input
                    placeholder="Search accounts by name or email"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    disabled={!canPickUsers}
                  />
                </Field>
                {!canPickUsers ? (
                  <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
                    You need the account-management permission to pick specific recipients.
                  </div>
                ) : usersQuery.loading ? (
                  <LoadingBlock label="Loading accounts…" rows={3} />
                ) : usersQuery.error ? (
                  <ErrorState title="Could not load accounts" description={usersQuery.error.message} />
                ) : (usersQuery.data?.items ?? []).length === 0 ? (
                  <EmptyState title="No accounts found" description="Try a different search term." />
                ) : (
                  <ul className="max-h-56 overflow-y-auto rounded-xl border hairline">
                    {(usersQuery.data?.items ?? []).map((user) => (
                      <li key={user.id} className="border-b hairline last:border-0">
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gold-400/10">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={recipientIds.includes(user.id)}
                            onChange={() => toggleRecipient(user.id)}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{user.displayName}</span>
                            <span className="muted block text-xs">{user.email}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {canSchedule ? (
              <Field
                label="Schedule for later"
                htmlFor="edit-schedule"
                hint="Clear this to move the announcement back to a draft."
                error={update.error?.fields?.scheduledAt}
              >
                <Input
                  id="edit-schedule"
                  type="datetime-local"
                  value={editForm.scheduledAt}
                  onChange={(event) => setEditForm({ ...editForm, scheduledAt: event.target.value })}
                />
              </Field>
            ) : (
              <p className="muted text-xs">This announcement has already been published, so its schedule cannot change.</p>
            )}
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={publishOpen}
        title="Publish announcement"
        message={
          <>
            Publish "{announcement?.title}" now? In-app notifications are delivered immediately. External email and
            SMS delivery is not configured on this deployment yet, so members will only see it in the platform.
          </>
        }
        confirmLabel="Publish now"
        loading={publish.saving}
        onCancel={() => setPublishOpen(false)}
        onConfirm={confirmPublish}
      />

      {announcement && !canWrite && announcement.status === "published" ? (
        <p className="muted flex items-center gap-1.5 text-xs">
          <Megaphone size={13} /> This announcement was delivered to you in the platform.
        </p>
      ) : null}
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
