import { useEffect, useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Plus, Search, Trash2, UserPlus } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import { canActOnGroup, permittedGroups } from "../../auth/groups"
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

interface MemberListItem {
  id: string
  member_no: string
  full_name: string
  status: string
  joined_at: string
  photo_path: string | null
  group_id: string
  group_key: string
  group_name: string
  voice_section_name: string | null
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
  { value: "withdrawn", label: "Withdrawn" },
]

const EMPTY_FORM = {
  groupId: "",
  fullName: "",
  gender: "",
  dateOfBirth: "",
  joinedAt: "",
  status: "active",
  voiceSectionId: "",
  notes: "",
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function MembersListPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  // The dashboard and group tiles link here with ?groupId=… to pre-filter the list.
  const [searchParams] = useSearchParams()

  const [groupId, setGroupId] = useState(() => searchParams.get("groupId") ?? "")
  const [status, setStatus] = useState("")
  const [voiceSectionId, setVoiceSectionId] = useState("")
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const search = useDebounced(searchInput, 350)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [fields, setFields] = useState<Record<string, string>>({})

  const meta = useQuery<MembersMeta>("/members/meta")
  const path = `/members${toQuery({ groupId, status, voiceSectionId, search, page })}`
  const { data, loading, error, reload } = useQuery<Page<MemberListItem>>(path)

  const create = useMutation(
    (body: {
      groupId: string
      fullName: string
      gender?: string | null
      dateOfBirth?: string | null
      joinedAt?: string | null
      status?: string
      voiceSectionId?: string | null
      notes?: string | null
    }) => api.post("/members", body),
  )

  // Deleting straight from the directory, so an administrator does not have to
  // open each record. The server re-checks the group and the confirmation flag.
  const [pendingDelete, setPendingDelete] = useState<MemberListItem | null>(null)
  const [typedName, setTypedName] = useState("")
  const remove = useMutation((target: MemberListItem) =>
    api.del<{ ok: boolean; memberNo: string; fullName: string }>(`/members/${target.id}`, {
      confirmActive: target.status !== "withdrawn",
    }),
  )

  async function confirmDelete() {
    if (!pendingDelete) return
    const result = await remove.run(pendingDelete)
    if (!result) return
    toast.success(`${result.memberNo} (${result.fullName}) was deleted for good.`)
    setPendingDelete(null)
    reload()
  }

  useEffect(() => {
    if (!create.error) return
    setFields(create.error.fields ?? {})
    if (!create.error.fields) toast.error(create.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create.error])

  useEffect(() => {
    if (remove.error) toast.error(remove.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remove.error])

  const groups = meta.data?.groups ?? []
  const readableGroups = permittedGroups(groups, can, "member.read")
  const writableGroups = permittedGroups(groups, can, "member.write")
  const voiceSections = meta.data?.voiceSections ?? []
  const canWrite = can("member.write")

  function openModal() {
    setForm({ ...EMPTY_FORM, groupId: writableGroups.length === 1 ? writableGroups[0].id : "" })
    setFields({})
    create.reset()
    setModalOpen(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFields({})
    const result = await create.run({
      groupId: form.groupId,
      fullName: form.fullName.trim(),
      gender: form.gender.trim() || null,
      dateOfBirth: form.dateOfBirth.trim() || null,
      joinedAt: form.joinedAt.trim() || null,
      status: form.status,
      voiceSectionId: form.voiceSectionId || null,
      notes: form.notes.trim() || null,
    })
    if (!result) return
    toast.success("Member created.")
    setModalOpen(false)
    setForm(EMPTY_FORM)
    reload()
  }

  const columns: Column<MemberListItem>[] = [
    {
      key: "member_no",
      header: "Member no.",
      render: (row) => <span className="font-mono text-sm">{row.member_no}</span>,
    },
    {
      key: "name",
      header: "Name",
      render: (row) => <span className="font-medium">{row.full_name}</span>,
    },
    {
      key: "group",
      header: "Group",
      render: (row) => <span>{row.group_name}</span>,
    },
    {
      key: "voice",
      header: "Voice section",
      render: (row) => (row.voice_section_name ? <span>{row.voice_section_name}</span> : <span className="muted">—</span>),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      render: (row) => <span className="muted text-sm">{formatDate(row.joined_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        canActOnGroup(can, "member.delete", row.group_key) ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={15} />}
            aria-label={`Delete ${row.full_name} permanently`}
            onClick={(event) => {
              event.stopPropagation()
              setTypedName("")
              setPendingDelete(row)
            }}
          >
            Delete
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description="The choir directory across the Senior, Junior and Support Member groups."
        breadcrumbs={[{ label: "Dashboard", to: "/app" }, { label: "Members" }]}
        actions={
          canWrite ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={openModal}>
              New member
            </Button>
          ) : null
        }
      />

      <Card>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Search" htmlFor="members-search">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" aria-hidden />
                <Input
                  id="members-search"
                  type="search"
                  placeholder="Name or member number"
                  className="pl-9"
                  value={searchInput}
                  onChange={(event) => {
                    setSearchInput(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </Field>
            <Field label="Group" htmlFor="members-group">
              <Select
                id="members-group"
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All groups</option>
                {readableGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Voice section" htmlFor="members-voice">
              <Select
                id="members-voice"
                value={voiceSectionId}
                onChange={(event) => {
                  setVoiceSectionId(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">All sections</option>
                {voiceSections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="members-status">
              <Select
                id="members-status"
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
            emptyTitle="No members found"
            emptyDescription="Try adjusting the filters, or add a new member."
            emptyAction={
              canWrite ? (
                <Button variant="gold" icon={<Plus size={16} />} onClick={openModal}>
                  New member
                </Button>
              ) : undefined
            }
            onRowClick={(row) => navigate(`/app/members/${row.id}`)}
          />
        </CardBody>
      </Card>

      {data ? (
        <Pagination page={data.page} pageCount={data.pageCount} total={data.total} onChange={setPage} />
      ) : null}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New member"
        description="Create a member record directly in a group."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={create.saving}>
              Cancel
            </Button>
            <Button variant="gold" type="submit" form="new-member-form" loading={create.saving} icon={<UserPlus size={16} />}>
              Create member
            </Button>
          </>
        }
      >
        <form id="new-member-form" className="flex flex-col gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="new-member-name" required error={fields.fullName}>
              <Input
                id="new-member-name"
                value={form.fullName}
                invalid={Boolean(fields.fullName)}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                required
              />
            </Field>
            <Field label="Group" htmlFor="new-member-group" required error={fields.groupId}>
              <Select
                id="new-member-group"
                value={form.groupId}
                invalid={Boolean(fields.groupId)}
                onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}
                required
              >
                <option value="">Select a group…</option>
                {writableGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Gender" htmlFor="new-member-gender" error={fields.gender}>
              <Input
                id="new-member-gender"
                value={form.gender}
                invalid={Boolean(fields.gender)}
                onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}
              />
            </Field>
            <Field label="Date of birth" htmlFor="new-member-dob" error={fields.dateOfBirth}>
              <Input
                id="new-member-dob"
                type="date"
                value={form.dateOfBirth}
                invalid={Boolean(fields.dateOfBirth)}
                onChange={(event) => setForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Joined date" htmlFor="new-member-joined" error={fields.joinedAt} hint="Defaults to today.">
              <Input
                id="new-member-joined"
                type="date"
                value={form.joinedAt}
                invalid={Boolean(fields.joinedAt)}
                onChange={(event) => setForm((current) => ({ ...current, joinedAt: event.target.value }))}
              />
            </Field>
            <Field label="Status" htmlFor="new-member-status">
              <Select
                id="new-member-status"
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Voice section" htmlFor="new-member-voice" error={fields.voiceSectionId}>
            <Select
              id="new-member-voice"
              value={form.voiceSectionId}
              onChange={(event) => setForm((current) => ({ ...current, voiceSectionId: event.target.value }))}
            >
              <option value="">Not assigned</option>
              {voiceSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="new-member-notes" error={fields.notes}>
            <Textarea
              id="new-member-notes"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete ? `Delete ${pendingDelete.full_name} permanently?` : "Delete member"}
        description={
          pendingDelete
            ? `${pendingDelete.member_no} will be erased, together with the sign-in details created at approval and the photograph. This cannot be undone.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={remove.saving}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={15} />}
              loading={remove.saving}
              disabled={
                !pendingDelete ||
                typedName.trim().toLowerCase() !== pendingDelete.full_name.trim().toLowerCase()
              }
              onClick={confirmDelete}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="flex flex-col gap-3">
            {pendingDelete.status !== "withdrawn" ? (
              <p className="text-sm">
                <strong>
                  {pendingDelete.full_name} is still {pendingDelete.status}.
                </strong>{" "}
                This removes a chorister who is on the register right now. If they are only away, withdraw them
                instead — that keeps the record and history, and can be undone.
              </p>
            ) : null}
            <p className="text-sm">
              Deleting is recorded in the audit trail, and the application {pendingDelete.full_name} came from is
              kept. Lost for good: the member record, the sign-in account and the photograph.
            </p>
            <Field label={`Type ${pendingDelete.full_name} to confirm`} htmlFor="confirm-member-delete">
              <Input
                id="confirm-member-delete"
                value={typedName}
                autoComplete="off"
                onChange={(event) => setTypedName(event.target.value)}
                placeholder={pendingDelete.full_name}
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
