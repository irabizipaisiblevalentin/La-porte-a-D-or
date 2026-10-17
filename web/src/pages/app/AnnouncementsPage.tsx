import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Megaphone, Plus } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
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

const AUDIENCES = ["all", "senior", "junior", "members", "selected"] as const
const PRIORITIES = ["normal", "important", "urgent"] as const
const STATUSES = ["draft", "scheduled", "published", "archived"] as const

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
  read: boolean
}

interface Template {
  key: string
  title: string
  message: string
}

interface UserDto {
  id: string
  email: string
  displayName: string
  status: string
  member: { fullName: string | null } | null
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface AnnouncementPayload {
  title: string
  message: string
  audience: string
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

function priorityTone(priority: string): "neutral" | "warn" | "danger" | "gold" {
  if (priority === "urgent") return "danger"
  if (priority === "important") return "warn"
  return "neutral"
}

interface FormState {
  title: string
  message: string
  audience: string
  priority: string
  scheduledAt: string
}

function emptyForm(): FormState {
  return { title: "", message: "", audience: "all", priority: "normal", scheduledAt: "" }
}

export function AnnouncementsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const canWrite = can("announcements.write")
  const canPickUsers = can("users.manage")

  const [audience, setAudience] = useState("")
  const [priority, setPriority] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState("")
  const debouncedUserSearch = useDebounced(userSearch, 300)

  const query = toQuery({ audience, priority, status, page })
  const list = useQuery<Page<AnnouncementRow>>(`/announcements${query}`)
  const templatesQuery = useQuery<{ templates: Template[] }>("/announcements/templates")

  const usersQuery = useQuery<Page<UserDto>>(
    createOpen && form.audience === "selected" && canPickUsers
      ? `/users${toQuery({ search: debouncedUserSearch, pageSize: 50 })}`
      : null,
  )

  const create = useMutation((body: AnnouncementPayload) =>
    api.post<{ announcement: AnnouncementRow }>("/announcements", body),
  )

  const rows = list.data?.items ?? []
  const templates = templatesQuery.data?.templates ?? []

  function resetFilters() {
    setAudience("")
    setPriority("")
    setStatus("")
    setPage(1)
  }

  function openCreate() {
    setForm(emptyForm())
    setRecipientIds([])
    setUserSearch("")
    create.reset()
    setCreateOpen(true)
  }

  function applyTemplate(template: Template) {
    setForm((current) => ({ ...current, title: template.title, message: template.message }))
  }

  function toggleRecipient(userId: string) {
    setRecipientIds((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    )
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    if (form.audience === "selected" && recipientIds.length === 0) return
    const result = await create.run({
      title: form.title.trim(),
      message: form.message.trim(),
      audience: form.audience,
      priority: form.priority,
      scheduledAt: form.scheduledAt || null,
      recipientIds: form.audience === "selected" ? recipientIds : undefined,
    })
    if (!result) return
    toast.success(
      result.announcement.status === "scheduled"
        ? `"${result.announcement.title}" was scheduled.`
        : `"${result.announcement.title}" was saved as a draft.`,
    )
    setCreateOpen(false)
    list.reload()
  }

  const columns: Column<AnnouncementRow>[] = [
    {
      key: "title",
      header: "Announcement",
      render: (row) => (
        <div className="flex items-start gap-2.5">
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{
              background: row.read ? "transparent" : "var(--color-gold-400)",
              border: row.read ? "1px solid color-mix(in srgb, currentColor 30%, transparent)" : "none",
            }}
            aria-label={row.read ? "Read" : "Unread"}
          />
          <div className="min-w-0">
            <p className={row.read ? "font-medium" : "font-semibold"}>{row.title}</p>
            <p className="muted line-clamp-1 text-xs">{row.message}</p>
          </div>
        </div>
      ),
    },
    { key: "audience", header: "Audience", render: (row) => humanize(row.audience) },
    {
      key: "priority",
      header: "Priority",
      render: (row) => <Badge tone={priorityTone(row.priority)}>{humanize(row.priority)}</Badge>,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "when",
      header: "Published / scheduled",
      render: (row) =>
        row.published_at ? (
          formatDateTime(row.published_at)
        ) : row.scheduled_at ? (
          <span className="muted">Scheduled {formatDateTime(row.scheduled_at)}</span>
        ) : (
          <span className="muted">Draft · {formatDateTime(row.created_at)}</span>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Announcements"
        description="Messages to the choir. Publishing delivers in-app notifications immediately."
        actions={
          canWrite ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={openCreate}>
              New announcement
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="w-full sm:w-44">
            <Field label="Audience" htmlFor="filter-audience">
              <Select
                id="filter-audience"
                value={audience}
                onChange={(event) => {
                  setAudience(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All audiences</option>
                {AUDIENCES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-full sm:w-44">
            <Field label="Priority" htmlFor="filter-priority">
              <Select
                id="filter-priority"
                value={priority}
                onChange={(event) => {
                  setPriority(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">Any priority</option>
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
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
                {STATUSES.map((value) => (
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
            caption={!canWrite ? "Only published announcements addressed to you are shown." : undefined}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={list.loading}
            error={list.error?.message ?? null}
            emptyTitle="No announcements"
            emptyDescription={
              audience || priority || status
                ? "No announcements match these filters. Try clearing them."
                : canWrite
                  ? "No announcements have been created yet."
                  : "There are no announcements for you right now."
            }
            emptyAction={
              canWrite ? (
                <Button variant="gold" icon={<Plus size={16} />} onClick={openCreate}>
                  New announcement
                </Button>
              ) : undefined
            }
            onRowClick={(row) => navigate(`/app/announcements/${row.id}`)}
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
        onClose={() => setCreateOpen(false)}
        title="New announcement"
        description="Write a message and choose who should receive it."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={create.saving}>
              Cancel
            </Button>
            <Button
              variant="gold"
              onClick={submitCreate}
              loading={create.saving}
              disabled={form.audience === "selected" && recipientIds.length === 0}
              icon={<Megaphone size={16} />}
            >
              Save announcement
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={submitCreate}>
          {templates.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Start from a template</span>
              <div className="flex flex-wrap gap-2">
                {templates.map((template) => (
                  <Button
                    key={template.key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyTemplate(template)}
                  >
                    {template.title}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <Field label="Title" htmlFor="announcement-title" required error={create.error?.fields?.title}>
            <Input
              id="announcement-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
            />
          </Field>

          <Field label="Message" htmlFor="announcement-message" required error={create.error?.fields?.message}>
            <Textarea
              id="announcement-message"
              rows={6}
              value={form.message}
              onChange={(event) => setForm({ ...form, message: event.target.value })}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Audience" htmlFor="announcement-audience" required error={create.error?.fields?.audience}>
              <Select
                id="announcement-audience"
                value={form.audience}
                onChange={(event) => setForm({ ...form, audience: event.target.value })}
              >
                {AUDIENCES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="announcement-priority">
              <Select
                id="announcement-priority"
                value={form.priority}
                onChange={(event) => setForm({ ...form, priority: event.target.value })}
              >
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Schedule for later"
            htmlFor="announcement-schedule"
            hint="Leave blank to save as a draft you can publish now."
            error={create.error?.fields?.scheduledAt}
          >
            <Input
              id="announcement-schedule"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}
            />
          </Field>

          {form.audience === "selected" ? (
            <div className="flex flex-col gap-3">
              <Field label="Recipients" hint="Choose the accounts that should receive this announcement." error={create.error?.fields?.recipientIds}>
                <Input
                  placeholder="Search accounts by name or email"
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  disabled={!canPickUsers}
                />
              </Field>
              {!canPickUsers ? (
                <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
                  You need the account-management permission to pick specific recipients. Choose a group audience
                  instead, or ask an administrator to grant access.
                </div>
              ) : usersQuery.loading ? (
                <LoadingBlock label="Loading accounts…" rows={3} />
              ) : usersQuery.error ? (
                <ErrorState title="Could not load accounts" description={usersQuery.error.message} />
              ) : (usersQuery.data?.items ?? []).length === 0 ? (
                <EmptyState title="No accounts found" description="Try a different search term." />
              ) : (
                <ul className="max-h-60 overflow-y-auto rounded-xl border hairline">
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

          <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
            <span className="muted">
              In-app notifications are delivered as soon as this is published. External email and SMS delivery is
              not configured on this deployment yet, so members will only see it inside the platform.
            </span>
          </div>
        </form>
      </Modal>
    </div>
  )
}
