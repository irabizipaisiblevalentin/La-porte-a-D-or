import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { ClipboardList, Plus, Search } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Button,
  Card,
  CardBody,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Textarea,
  useToast,
  type Column,
} from "../../components/ui"

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

interface MembersMeta {
  groups: Group[]
  voiceSections: VoiceSection[]
}

interface ApplicationListItem {
  id: string
  source: string
  submittedAt: string
  fullName: string
  email: string | null
  phone: string | null
  requestedGroupName: string | null
  requestedGroupKey: string | null
  assignedGroupName: string | null
  assignedGroupKey: string | null
  status: string
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "Under review" },
  { value: "more_info_required", label: "More info required" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

const EMPTY_FORM = { fullName: "", email: "", phone: "", groupId: "", answers: "" }

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** Turns "Question: Answer" lines into the answer map the API normalises. */
function parseAnswers(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf(":")
    if (separator === -1) {
      result[trimmed] = ""
    } else {
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim()
      if (key) result[key] = value
    }
  }
  return result
}

export function ApplicationsListPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()

  const [status, setStatus] = useState("")
  const [groupId, setGroupId] = useState("")
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const search = useDebounced(searchInput, 350)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [fields, setFields] = useState<Record<string, string>>({})

  const meta = useQuery<MembersMeta>("/members/meta")
  const path = `/applications${toQuery({ status, groupId, search, page })}`
  const { data, loading, error, reload } = useQuery<Page<ApplicationListItem>>(path)

  const create = useMutation(
    (body: { fullName: string; email?: string; phone?: string; groupId: string; answers?: Record<string, string> }) =>
      api.post("/applications", body),
  )

  useEffect(() => {
    if (!create.error) return
    setFields(create.error.fields ?? {})
    if (!create.error.fields) toast.error(create.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create.error])

  const groups = meta.data?.groups ?? []
  const canReview = can("application.review")

  function openModal() {
    setForm(EMPTY_FORM)
    setFields({})
    create.reset()
    setModalOpen(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFields({})
    const answers = parseAnswers(form.answers)
    const result = await create.run({
      fullName: form.fullName.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      groupId: form.groupId,
      ...(Object.keys(answers).length > 0 ? { answers } : {}),
    })
    if (!result) return
    toast.success("Application created.")
    setModalOpen(false)
    setForm(EMPTY_FORM)
    reload()
  }

  const columns: Column<ApplicationListItem>[] = [
    {
      key: "name",
      header: "Applicant",
      render: (row) => <span className="font-medium">{row.fullName}</span>,
    },
    {
      key: "email",
      header: "Email",
      render: (row) => (row.email ? <span>{row.email}</span> : <span className="muted">—</span>),
    },
    {
      key: "group",
      header: "Group",
      render: (row) => {
        const name = row.assignedGroupName ?? row.requestedGroupName
        if (!name) return <span className="muted">—</span>
        return (
          <span className="flex flex-col">
            <span>{name}</span>
            {row.assignedGroupName && row.requestedGroupName && row.assignedGroupName !== row.requestedGroupName ? (
              <span className="muted text-xs">Requested {row.requestedGroupName}</span>
            ) : null}
          </span>
        )
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "submitted",
      header: "Submitted",
      align: "right",
      render: (row) => <span className="muted text-sm">{formatDate(row.submittedAt)}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Applications"
        description="Review and process incoming applications for membership."
        breadcrumbs={[{ label: "Dashboard", to: "/app" }, { label: "Applications" }]}
        actions={
          canReview ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={openModal}>
              New application
            </Button>
          ) : null
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Search" htmlFor="applications-search">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" aria-hidden />
                <Input
                  id="applications-search"
                  type="search"
                  placeholder="Name, email or phone"
                  className="pl-9"
                  value={searchInput}
                  onChange={(event) => {
                    setSearchInput(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </Field>
            <Field label="Status" htmlFor="applications-status">
              <Select
                id="applications-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Group" htmlFor="applications-group">
              <Select
                id="applications-group"
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
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(row) => row.id}
            loading={loading}
            error={error ? error.message : null}
            emptyTitle="No applications found"
            emptyDescription="Try adjusting the filters, or add a new application manually."
            emptyAction={
              canReview ? (
                <Button variant="gold" icon={<Plus size={16} />} onClick={openModal}>
                  New application
                </Button>
              ) : undefined
            }
            onRowClick={(row) => navigate(`/app/applications/${row.id}`)}
          />
        </CardBody>
      </Card>

      {data ? (
        <Pagination page={data.page} pageCount={data.pageCount} total={data.total} onChange={setPage} />
      ) : null}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New application"
        description="Record an application received outside the official form."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={create.saving}>
              Cancel
            </Button>
            <Button variant="gold" type="submit" form="new-application-form" loading={create.saving} icon={<ClipboardList size={16} />}>
              Create application
            </Button>
          </>
        }
      >
        <form id="new-application-form" className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Full name" htmlFor="new-full-name" required error={fields.fullName}>
            <Input
              id="new-full-name"
              value={form.fullName}
              invalid={Boolean(fields.fullName)}
              onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor="new-email" error={fields.email} hint="Required before the application can be approved.">
              <Input
                id="new-email"
                type="email"
                value={form.email}
                invalid={Boolean(fields.email)}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </Field>
            <Field label="Phone" htmlFor="new-phone" error={fields.phone}>
              <Input
                id="new-phone"
                type="tel"
                value={form.phone}
                invalid={Boolean(fields.phone)}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="Group" htmlFor="new-group" required error={fields.groupId}>
            <Select
              id="new-group"
              value={form.groupId}
              invalid={Boolean(fields.groupId)}
              onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}
              required
            >
              <option value="">Select a group…</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Answers"
            htmlFor="new-answers"
            hint="Optional. One answer per line as “Question: Answer”."
          >
            <Textarea
              id="new-answers"
              value={form.answers}
              onChange={(event) => setForm((current) => ({ ...current, answers: event.target.value }))}
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
