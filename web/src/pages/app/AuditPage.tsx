import { useState } from "react"
import { toQuery } from "../../api/client"
import { useQuery } from "../../api/hooks"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  type Column,
} from "../../components/ui"

// --- Response shapes (mirroring server/src/routes/audit.ts) -----------------

interface AuditEntry {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  summary: string
  detail: unknown
  ipAddress: string | null
  createdAt: string
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

/**
 * Removes any field whose name looks like a credential before display. Audit
 * entries should never contain secrets, but this is a defensive last line.
 */
function sanitizeDetail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDetail)
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>
    const clean: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(source)) {
      if (/pass|secret|token|credential|hash|api_?key/i.test(key)) continue
      clean[key] = sanitizeDetail(nested)
    }
    return clean
  }
  return value
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function AuditPage() {
  const [entityType, setEntityType] = useState("")
  const [action, setAction] = useState("")
  const [actorId, setActorId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AuditEntry | null>(null)

  const query = toQuery({ entityType, action, actorId, from, to, page })
  const list = useQuery<Page<AuditEntry>>(`/audit${query}`)

  const historyPath =
    selected && selected.entityId
      ? `/audit/entity/${encodeURIComponent(selected.entityType)}/${encodeURIComponent(selected.entityId)}`
      : null
  const history = useQuery<Page<AuditEntry>>(historyPath)

  function updateFilter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value)
      setPage(1)
    }
  }

  const columns: Column<AuditEntry>[] = [
    { key: "time", header: "Time", render: (row) => <span className="whitespace-nowrap">{formatTimestamp(row.createdAt)}</span> },
    { key: "actor", header: "Actor", render: (row) => row.actorName ?? row.actorId ?? "System" },
    { key: "action", header: "Action", render: (row) => <Badge tone="gold">{row.action}</Badge> },
    {
      key: "entity",
      header: "Entity",
      render: (row) => (
        <span className="muted text-xs">
          {row.entityType}
          {row.entityId ? ` · ${row.entityId}` : ""}
        </span>
      ),
    },
    { key: "summary", header: "Summary", render: (row) => row.summary },
  ]

  const historyColumns: Column<AuditEntry>[] = [
    { key: "time", header: "Time", render: (row) => <span className="whitespace-nowrap">{formatTimestamp(row.createdAt)}</span> },
    { key: "actor", header: "Actor", render: (row) => row.actorName ?? row.actorId ?? "System" },
    { key: "action", header: "Action", render: (row) => <Badge tone="gold">{row.action}</Badge> },
    { key: "summary", header: "Summary", render: (row) => row.summary },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="An append-only history of administrative changes. Entries cannot be edited or removed, and sensitive values are never shown."
      />

      <Card>
        <CardHeader title="Filters" description="Narrow the history by entity, action or actor." />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Entity type" htmlFor="audit-entity">
            <Input
              id="audit-entity"
              value={entityType}
              placeholder="e.g. user, member"
              onChange={(event) => updateFilter(setEntityType)(event.target.value)}
            />
          </Field>
          <Field label="Action" htmlFor="audit-action">
            <Input
              id="audit-action"
              value={action}
              placeholder="e.g. user.invite"
              onChange={(event) => updateFilter(setAction)(event.target.value)}
            />
          </Field>
          <Field label="Actor ID" htmlFor="audit-actor">
            <Input id="audit-actor" value={actorId} onChange={(event) => updateFilter(setActorId)(event.target.value)} />
          </Field>
          <Field label="From" htmlFor="audit-from">
            <Input id="audit-from" type="date" value={from} onChange={(event) => updateFilter(setFrom)(event.target.value)} />
          </Field>
          <Field label="To" htmlFor="audit-to">
            <Input id="audit-to" type="date" value={to} onChange={(event) => updateFilter(setTo)(event.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="History" description={`${list.data?.total ?? 0} recorded entr${(list.data?.total ?? 0) === 1 ? "y" : "ies"}.`} />
        <CardBody className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={list.loading && !list.data}
            error={list.error?.message ?? null}
            emptyTitle="No audit entries match"
            emptyDescription="Try widening the date range or clearing a filter."
            onRowClick={setSelected}
            caption="Select a row to view the full entry and that entity's history."
          />
          {list.data ? (
            <Pagination page={list.data.page} pageCount={list.data.pageCount} total={list.data.total} onChange={setPage} />
          ) : null}
        </CardBody>
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Audit entry"
        description={selected ? formatTimestamp(selected.createdAt) : undefined}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected ? (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Actor" value={selected.actorName ?? selected.actorId ?? "System"} />
              <Detail label="Action" value={selected.action} />
              <Detail label="Entity type" value={selected.entityType} />
              <Detail label="Entity ID" value={selected.entityId ?? "—"} />
              <Detail label="IP address" value={selected.ipAddress ?? "—"} />
              <Detail label="Entry ID" value={selected.id} />
            </dl>

            <div>
              <p className="muted mb-1 text-xs font-medium uppercase tracking-wide">Summary</p>
              <p className="text-sm">{selected.summary}</p>
            </div>

            <div>
              <p className="muted mb-1 text-xs font-medium uppercase tracking-wide">Change detail</p>
              {selected.detail === null || selected.detail === undefined ? (
                <p className="muted text-sm">No structured change detail was recorded for this entry.</p>
              ) : (
                <pre className="field max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(sanitizeDetail(selected.detail), null, 2)}
                </pre>
              )}
            </div>

            {selected.entityId ? (
              <div className="border-t hairline pt-4">
                <p className="mb-2 text-sm font-medium">
                  History for {selected.entityType} · {selected.entityId}
                </p>
                {history.loading && !history.data ? (
                  <LoadingBlock label="Loading entity history…" rows={2} />
                ) : history.error ? (
                  <p className="muted text-sm">Could not load the entity history: {history.error.message}</p>
                ) : (
                  <>
                    <p className="muted mb-2 text-xs">
                      {history.data?.total ?? 0} recorded change{(history.data?.total ?? 0) === 1 ? "" : "s"} for this entity.
                    </p>
                    <DataTable
                      columns={historyColumns}
                      rows={history.data?.items ?? []}
                      rowKey={(row) => row.id}
                      emptyTitle="No history for this entity"
                    />
                  </>
                )}
              </div>
            ) : (
              <p className="muted border-t hairline pt-4 text-sm">
                This entry is not attached to a specific entity, so there is no entity history to show.
              </p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="muted text-xs font-medium uppercase tracking-wide">{label}</dt>
      <dd className="break-words text-sm">{value}</dd>
    </div>
  )
}
