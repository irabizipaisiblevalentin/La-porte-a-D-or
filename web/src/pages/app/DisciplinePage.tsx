import { useMemo, useState, type FormEvent } from "react"
import { AlertCircle, Award, Plus, ShieldAlert } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
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
  Modal,
  Pagination,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
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

interface Category {
  id: string
  label: string
  kind: string
}

interface Group {
  id: string
  key: string
  name: string
}

interface Meta {
  groups: Group[]
}

interface DisciplineRecord {
  id: string
  memberId: string
  fullName: string
  memberNo: string
  groupKey: string
  categoryId: string
  categoryKey: string
  categoryLabel: string
  kind: string
  date: string
  description: string
  actionTaken: string | null
  status: string
  followUpNotes: string | null
  recordedBy: string | null
  createdAt: string
  updatedAt: string
}

interface MemberOption {
  id: string
  full_name: string
  member_no: string
  group_name: string | null
}

interface MemberHistory {
  member: { id: string; fullName: string; memberNo: string; groupId: string }
  records: DisciplineRecord[]
}

const RECORD_STATUSES = ["open", "in_progress", "resolved", "closed"] as const

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

function MemberPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: MemberOption | null
  onChange: (member: MemberOption | null) => void
  disabled?: boolean
}) {
  const [term, setTerm] = useState("")
  const debounced = useDebounced(term, 250)
  const search = debounced.trim()
  const results = useQuery<Page<MemberOption>>(
    !selected && search.length >= 2 ? `/members${toQuery({ search, pageSize: 20 })}` : null,
    [search, selected?.id],
  )

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border hairline px-3 py-2">
        <span className="truncate text-sm">
          {selected.full_name} <span className="muted">· {selected.member_no}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange(null)
            setTerm("")
          }}
        >
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={term}
        disabled={disabled}
        placeholder="Search members by name or member number"
        onChange={(event) => setTerm(event.target.value)}
        aria-label="Search members"
      />
      {search.length < 2 ? (
        <p className="muted text-xs">Type at least two characters to search.</p>
      ) : results.loading ? (
        <p className="muted text-xs">Searching…</p>
      ) : results.error ? (
        <p className="muted text-xs">Member search unavailable: {results.error.message}</p>
      ) : (results.data?.items.length ?? 0) === 0 ? (
        <p className="muted text-xs">No members found.</p>
      ) : (
        <ul className="max-h-44 overflow-y-auto rounded-xl border hairline">
          {results.data!.items.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gold-400/10"
                onClick={() => onChange(member)}
              >
                <span className="truncate">{member.full_name}</span>
                <span className="muted shrink-0 text-xs">
                  {member.member_no}
                  {member.group_name ? ` · ${member.group_name}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DisciplinePage() {
  const toast = useToast()
  const { can } = useAuth()
  const canDiscipline = can("discipline.write")
  const canRecognition = can("recognition.write")

  const [kind, setKind] = useState("negative")
  const [groupId, setGroupId] = useState("")
  const [status, setStatus] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [memberFilter, setMemberFilter] = useState<MemberOption | null>(null)

  const categories = useQuery<{ categories: Category[] }>("/discipline/categories")
  const meta = useQuery<Meta>("/members/meta")
  const records = useQuery<Page<DisciplineRecord>>(
    `/discipline${toQuery({ kind, groupId, status, from, to, page, memberId: memberFilter?.id })}`,
    [kind, groupId, status, from, to, page, memberFilter?.id],
  )

  const [history, setHistory] = useState<{ id: string; name: string } | null>(null)
  const historyQuery = useQuery<MemberHistory>(
    history ? `/discipline/member/${history.id}` : null,
    [history?.id],
  )

  const activeKindCanWrite = kind === "positive" ? canRecognition : canDiscipline
  const kindCategories = useMemo(
    () => (categories.data?.categories ?? []).filter((category) => category.kind === kind),
    [categories.data, kind],
  )

  // --- Record creation ---
  const [showRecord, setShowRecord] = useState(false)
  const [recordForm, setRecordForm] = useState<{
    categoryId: string
    member: MemberOption | null
    date: string
    description: string
    actionTaken: string
    status: string
    followUpNotes: string
  }>({ categoryId: "", member: null, date: today(), description: "", actionTaken: "", status: "open", followUpNotes: "" })

  const createRecord = useMutation((body: Record<string, unknown>) =>
    api.post<{ record: DisciplineRecord }>("/discipline", body),
  )

  function openRecord() {
    createRecord.reset()
    setRecordForm({
      categoryId: kindCategories[0]?.id ?? "",
      member: memberFilter,
      date: today(),
      description: "",
      actionTaken: "",
      status: "open",
      followUpNotes: "",
    })
    setShowRecord(true)
  }

  async function submitRecord(event: FormEvent) {
    event.preventDefault()
    if (!recordForm.member) return
    const result = await createRecord.run({
      memberId: recordForm.member.id,
      date: recordForm.date,
      categoryId: recordForm.categoryId,
      description: recordForm.description.trim(),
      actionTaken: recordForm.actionTaken.trim() || null,
      status: recordForm.status,
      followUpNotes: recordForm.followUpNotes.trim() || null,
    })
    if (result) {
      toast.success(kind === "positive" ? "Recognition recorded." : "Discipline record created.")
      setShowRecord(false)
      records.reload()
    }
  }

  // --- Record detail / edit ---
  const [detail, setDetail] = useState<DisciplineRecord | null>(null)
  const [detailForm, setDetailForm] = useState({ status: "open", actionTaken: "", followUpNotes: "" })

  const updateRecord = useMutation((payload: { id: string; body: Record<string, unknown> }) =>
    api.patch<{ record: DisciplineRecord }>(`/discipline/${payload.id}`, payload.body),
  )

  function openDetail(record: DisciplineRecord) {
    updateRecord.reset()
    setDetail(record)
    setDetailForm({
      status: record.status,
      actionTaken: record.actionTaken ?? "",
      followUpNotes: record.followUpNotes ?? "",
    })
  }

  const detailCanWrite = detail ? (detail.kind === "positive" ? canRecognition : canDiscipline) : false

  async function submitDetail(event: FormEvent) {
    event.preventDefault()
    if (!detail) return
    const result = await updateRecord.run({
      id: detail.id,
      body: {
        status: detailForm.status,
        actionTaken: detailForm.actionTaken.trim() || null,
        followUpNotes: detailForm.followUpNotes.trim() || null,
      },
    })
    if (result) {
      toast.success("Record updated.")
      setDetail(null)
      records.reload()
      if (history) historyQuery.reload()
    }
  }

  const columns: Column<DisciplineRecord>[] = [
    { key: "date", header: "Date", render: (row) => row.date },
    {
      key: "member",
      header: "Member",
      render: (row) => (
        <button
          type="button"
          className="link text-left"
          onClick={(event) => {
            event.stopPropagation()
            setHistory({ id: row.memberId, name: row.fullName })
          }}
        >
          {row.fullName}
          <span className="muted block text-xs">
            {row.memberNo} · {humanize(row.groupKey)}
          </span>
        </button>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row) => (
        <Badge tone={row.kind === "positive" ? "positive" : "danger"}>{row.categoryLabel}</Badge>
      ),
    },
    {
      key: "description",
      header: "Details",
      render: (row) => <span className="block max-w-md truncate">{row.description}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
  ]

  const historyColumns: Column<DisciplineRecord>[] = [
    { key: "date", header: "Date", render: (row) => row.date },
    {
      key: "category",
      header: "Category",
      render: (row) => <Badge tone={row.kind === "positive" ? "positive" : "danger"}>{row.categoryLabel}</Badge>,
    },
    {
      key: "description",
      header: "Details",
      render: (row) => <span className="block max-w-md truncate">{row.description}</span>,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Discipline & recognition"
        description="Log behaviour concerns and celebrate members' achievements, all from one place."
        actions={
          activeKindCanWrite ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={openRecord}>
              {kind === "positive" ? "Record recognition" : "Record discipline"}
            </Button>
          ) : null
        }
      />

      <Tabs
        tabs={[
          { key: "negative", label: <span className="flex items-center gap-1.5"><ShieldAlert size={15} /> Discipline</span> },
          { key: "positive", label: <span className="flex items-center gap-1.5"><Award size={15} /> Recognition</span> },
        ]}
        active={kind}
        onChange={(key) => {
          setKind(key)
          setPage(1)
        }}
      />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Group" htmlFor="d-group" hint={meta.error ? "Groups could not be loaded." : undefined}>
            <Select
              id="d-group"
              value={groupId}
              onChange={(event) => {
                setGroupId(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All groups</option>
              {(meta.data?.groups ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="d-status">
            <Select
              id="d-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All statuses</option>
              {RECORD_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="d-from">
            <Input
              id="d-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => {
                setFrom(event.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="To" htmlFor="d-to">
            <Input
              id="d-to"
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
        <CardBody className="border-t hairline pt-4">
          <Field label="Member" hint="Filter to a single member, or pick one to open their full history.">
            <MemberPicker
              selected={memberFilter}
              onChange={(member) => {
                setMemberFilter(member)
                setPage(1)
              }}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={kind === "positive" ? "Recognition records" : "Discipline records"}
          description="Select a row to update its status, action taken or follow-up notes."
          actions={
            activeKindCanWrite ? (
              <Button variant="outline" size="sm" icon={<Plus size={15} />} onClick={openRecord}>
                {kind === "positive" ? "Record recognition" : "Record discipline"}
              </Button>
            ) : null
          }
        />
        <CardBody className="pt-0">
          <DataTable
            columns={columns}
            rows={records.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={records.loading}
            error={records.error?.message ?? null}
            emptyTitle={kind === "positive" ? "No recognition records" : "No discipline records"}
            emptyDescription="Adjust the filters, or record a new entry."
            emptyAction={
              activeKindCanWrite ? (
                <Button variant="gold" icon={<Plus size={16} />} onClick={openRecord}>
                  {kind === "positive" ? "Record recognition" : "Record discipline"}
                </Button>
              ) : null
            }
            onRowClick={openDetail}
          />
          {records.data ? (
            <Pagination
              page={records.data.page}
              pageCount={records.data.pageCount}
              total={records.data.total}
              onChange={setPage}
            />
          ) : null}
        </CardBody>
      </Card>

      {/* Create record */}
      <Modal
        open={showRecord}
        onClose={() => setShowRecord(false)}
        title={kind === "positive" ? "Record recognition" : "Record discipline"}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowRecord(false)} disabled={createRecord.saving}>
              Cancel
            </Button>
            <Button
              variant="gold"
              type="submit"
              form="record-form"
              loading={createRecord.saving}
              disabled={!recordForm.member || !recordForm.categoryId}
            >
              Save record
            </Button>
          </>
        }
      >
        <form id="record-form" className="flex flex-col gap-4" onSubmit={submitRecord}>
          <FormError message={createRecord.error?.message} />
          <Field label="Member" required error={createRecord.error?.fields?.memberId}>
            <MemberPicker
              selected={recordForm.member}
              onChange={(member) => setRecordForm({ ...recordForm, member })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required error={createRecord.error?.fields?.categoryId} htmlFor="r-category">
              <Select
                id="r-category"
                value={recordForm.categoryId}
                onChange={(event) => setRecordForm({ ...recordForm, categoryId: event.target.value })}
                required
              >
                <option value="">Choose a category</option>
                {kindCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required error={createRecord.error?.fields?.date} htmlFor="r-date">
              <Input
                id="r-date"
                type="date"
                value={recordForm.date}
                onChange={(event) => setRecordForm({ ...recordForm, date: event.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Description" required error={createRecord.error?.fields?.description} htmlFor="r-description">
            <Textarea
              id="r-description"
              rows={3}
              value={recordForm.description}
              onChange={(event) => setRecordForm({ ...recordForm, description: event.target.value })}
              placeholder="Describe what happened or what was achieved."
              required
            />
          </Field>
          <Field label="Action taken" error={createRecord.error?.fields?.actionTaken} htmlFor="r-action">
            <Textarea
              id="r-action"
              rows={2}
              value={recordForm.actionTaken}
              onChange={(event) => setRecordForm({ ...recordForm, actionTaken: event.target.value })}
              placeholder="Optional follow-up action."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="r-status">
              <Select
                id="r-status"
                value={recordForm.status}
                onChange={(event) => setRecordForm({ ...recordForm, status: event.target.value })}
              >
                {RECORD_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {humanize(option)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Follow-up notes" error={createRecord.error?.fields?.followUpNotes} htmlFor="r-notes">
            <Textarea
              id="r-notes"
              rows={2}
              value={recordForm.followUpNotes}
              onChange={(event) => setRecordForm({ ...recordForm, followUpNotes: event.target.value })}
            />
          </Field>
        </form>
      </Modal>

      {/* Record detail */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? detail.categoryLabel : "Record"}
        description={detail ? `${detail.fullName} · ${detail.date}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)} disabled={updateRecord.saving}>
              Close
            </Button>
            {detailCanWrite ? (
              <Button variant="gold" type="submit" form="detail-form" loading={updateRecord.saving}>
                Save changes
              </Button>
            ) : null}
          </>
        }
      >
        {detail ? (
          <form id="detail-form" className="flex flex-col gap-4" onSubmit={submitDetail}>
            <FormError message={updateRecord.error?.message} />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={detail.kind === "positive" ? "positive" : "danger"}>{detail.categoryLabel}</Badge>
              <StatusBadge status={detail.status} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="muted text-xs font-medium uppercase tracking-wide">Description</span>
              <p className="text-sm">{detail.description}</p>
            </div>
            <Field label="Status" htmlFor="d-edit-status">
              <Select
                id="d-edit-status"
                value={detailForm.status}
                disabled={!detailCanWrite}
                onChange={(event) => setDetailForm({ ...detailForm, status: event.target.value })}
              >
                {RECORD_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {humanize(option)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Action taken" htmlFor="d-edit-action">
              <Textarea
                id="d-edit-action"
                rows={2}
                disabled={!detailCanWrite}
                value={detailForm.actionTaken}
                onChange={(event) => setDetailForm({ ...detailForm, actionTaken: event.target.value })}
              />
            </Field>
            <Field label="Follow-up notes" htmlFor="d-edit-notes">
              <Textarea
                id="d-edit-notes"
                rows={2}
                disabled={!detailCanWrite}
                value={detailForm.followUpNotes}
                onChange={(event) => setDetailForm({ ...detailForm, followUpNotes: event.target.value })}
              />
            </Field>
          </form>
        ) : null}
      </Modal>

      {/* Member history */}
      <Modal
        open={Boolean(history)}
        onClose={() => setHistory(null)}
        title="Member history"
        description={history ? history.name : undefined}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setHistory(null)}>
            Close
          </Button>
        }
      >
        {historyQuery.loading ? (
          <p className="muted py-6 text-center text-sm">Loading history…</p>
        ) : historyQuery.error ? (
          <EmptyState
            tone="danger"
            icon={<AlertCircle size={22} />}
            title="Could not load this member's history"
            description={historyQuery.error.message}
          />
        ) : historyQuery.data ? (
          <>
            <p className="muted mb-3 text-xs">
              {historyQuery.data.member.fullName} · {historyQuery.data.member.memberNo} ·{" "}
              {historyQuery.data.records.length} record{historyQuery.data.records.length === 1 ? "" : "s"}
            </p>
            <DataTable
              columns={historyColumns}
              rows={historyQuery.data.records}
              rowKey={(row) => row.id}
              emptyTitle="No records for this member"
              emptyDescription="This member has no discipline or recognition history yet."
            />
          </>
        ) : null}
      </Modal>
    </div>
  )
}
