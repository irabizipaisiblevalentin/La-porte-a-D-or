import { useMemo, useState } from "react"
import {
  BadgeCheck,
  Ban,
  Download,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Undo2,
} from "lucide-react"
import { api } from "../../api/client"
import { useMutation } from "../../api/hooks"
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  Modal,
  ProgressBar,
  StatCard,
  useToast,
  type Column,
} from "../../components/ui"
import { PassQr } from "./PassQr"
import { downloadPassSheet } from "./download-pass-sheet"

/**
 * The coordinator's contribution ledger and the door.
 *
 * One panel rather than two screens, because the three things here are one
 * decision each and they depend on each other: who owes what, who has paid, and
 * who therefore holds a pass. Confirming a payment issues the pass in the same
 * request, so the list never shows someone paid with no way in.
 */

export interface ContributionRow {
  event_id: string
  member_id: string
  amount: number
  status: "due" | "paid" | "waived"
  reference: string | null
  note: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  full_name?: string
  member_no?: string
  group_name?: string
  confirmed_by_name?: string | null
}

export interface PassRow {
  id: string
  event_id: string
  member_id: string
  token: string
  passcode: string
  status: "issued" | "checked_in" | "revoked"
  issued_at: string
  checked_in_at: string | null
  full_name?: string
  member_no?: string
  group_name?: string
}

export interface ContributionSummary {
  required: boolean
  amount: number | null
  dueDate: string | null
  counts: { due: number; paid: number; waived: number; total: number }
  collected: number
  outstanding: number
}

export interface CheckinRow {
  id: string
  member_id: string | null
  outcome: "admitted" | "repeat" | "refused" | "unknown"
  detail: string | null
  actor_name: string | null
  created_at: string
  full_name: string | null
}

function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return `${value.toLocaleString("en-US").replace(/,/g, " ")} FRW`
}

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

const STATUS_TONE: Record<ContributionRow["status"], string> = {
  paid: "positive",
  waived: "info",
  due: "warning",
}

export function EventContributionPanel({
  eventId,
  eventName,
  eventDate,
  eventTime,
  eventLocation,
  summary,
  contributions,
  passes,
  checkins,
  canApprove,
  canCheckin,
  onChanged,
}: {
  eventId: string
  eventName: string
  eventDate: string
  eventTime: string | null
  eventLocation: string | null
  summary: ContributionSummary
  contributions: ContributionRow[]
  passes: PassRow[]
  checkins: CheckinRow[]
  canApprove: boolean
  canCheckin: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [syncOpen, setSyncOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<ContributionRow | null>(null)
  const [undoTarget, setUndoTarget] = useState<ContributionRow | null>(null)
  const [amountTarget, setAmountTarget] = useState<ContributionRow | null>(null)
  const [amountDraft, setAmountDraft] = useState("")
  const [passTarget, setPassTarget] = useState<PassRow | null>(null)

  const sync = useMutation((body: void) =>
    api.post<{ added: number }>(`/events/${eventId}/contributions/sync`, {}),
  )
  const confirm = useMutation((body: { memberId: string; status: "paid" | "waived"; reference?: string | null }) =>
    api.post<{ pass: PassRow | null }>(`/events/${eventId}/contributions/confirm`, body),
  )
  const undo = useMutation((body: { memberId: string }) =>
    api.post<{ ok: boolean }>(`/events/${eventId}/contributions/undo`, body),
  )
  const setAmount = useMutation((body: { memberId: string; amount: number }) =>
    api.patch<{ ok: boolean }>(`/events/${eventId}/contributions`, body),
  )
  const issueAll = useMutation((body: void) =>
    api.post<{ passes: PassRow[] }>(`/events/${eventId}/passes/issue`, {}),
  )

  const passByMember = useMemo(() => {
    const map = new Map<string, PassRow>()
    for (const pass of passes) map.set(pass.member_id, pass)
    return map
  }, [passes])

  const settled = summary.counts.paid + summary.counts.waived

  const columns: Column<ContributionRow>[] = [
    {
      key: "name",
      header: "Member",
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.full_name ?? "—"}</p>
          <p className="muted text-xs">
            {row.member_no ?? ""}
            {row.group_name ? ` · ${row.group_name}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => (
        <button
          className="tabular-nums underline decoration-dotted underline-offset-4"
          disabled={!canApprove || row.status === "paid"}
          onClick={() => {
            setAmountTarget(row)
            setAmountDraft(String(row.amount))
          }}
        >
          {formatAmount(row.amount)}
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium capitalize"
          style={{
            background:
              row.status === "paid"
                ? "color-mix(in srgb, var(--color-green-500, #22c55e) 18%, transparent)"
                : row.status === "waived"
                  ? "color-mix(in srgb, var(--color-gold-400) 20%, transparent)"
                  : "color-mix(in srgb, currentColor 10%, transparent)",
          }}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "pass",
      header: "Pass",
      render: (row) => {
        const pass = passByMember.get(row.member_id)
        if (!pass) return <span className="muted text-xs">—</span>
        return (
          <Button variant="ghost" size="sm" icon={<QrCode size={14} />} onClick={() => setPassTarget(pass)}>
            {pass.status === "checked_in" ? "Admitted" : "Show"}
          </Button>
        )
      },
    },
    {
      key: "confirmed",
      header: "Confirmed",
      render: (row) =>
        row.confirmed_at ? (
          <div>
            <p className="text-xs">{formatDateTime(row.confirmed_at)}</p>
            <p className="muted text-xs">{row.confirmed_by_name ?? ""}</p>
          </div>
        ) : (
          <span className="muted text-xs">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        canApprove ? (
          row.status === "due" ? (
            <Button variant="gold" size="sm" icon={<BadgeCheck size={14} />} onClick={() => setConfirmTarget(row)}>
              Mark paid
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon={<Undo2 size={14} />} onClick={() => setUndoTarget(row)}>
              Undo
            </Button>
          )
        ) : null,
    },
  ]

  const passColumns: Column<PassRow>[] = [
    {
      key: "name",
      header: "Member",
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.full_name ?? "—"}</p>
          <p className="muted text-xs">{row.member_no ?? ""}</p>
        </div>
      ),
    },
    { key: "group", header: "Group", render: (row) => row.group_name ?? <span className="muted">—</span> },
    {
      key: "passcode",
      header: "Passcode",
      render: (row) => <span className="font-mono text-xs tracking-wider">{row.passcode}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) =>
        row.status === "checked_in" ? (
          <span className="text-xs">Admitted {formatDateTime(row.checked_in_at)}</span>
        ) : (
          <span className="text-xs">Issued</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Button variant="ghost" size="sm" icon={<QrCode size={14} />} onClick={() => setPassTarget(row)}>
          Show
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Amount due" value={formatAmount(summary.amount)} hint="Per person" />
        <StatCard
          label="Confirmed paid"
          value={`${summary.counts.paid} of ${summary.counts.total}`}
          hint={summary.counts.waived > 0 ? `${summary.counts.waived} waived` : undefined}
        />
        <StatCard label="Collected" value={formatAmount(summary.collected)} />
        <StatCard label="Outstanding" value={formatAmount(summary.outstanding)} />
      </div>

      <div className="flex flex-col gap-1">
        <ProgressBar value={settled} max={summary.counts.total || 1} />
        <p className="muted text-xs">
          {settled} of {summary.counts.total} settled
        </p>
      </div>

      <Card>
        <CardHeader
          title="Contributions"
          description={
            summary.dueDate
              ? `Amounts are per person. Pay by ${new Date(`${summary.dueDate}T00:00:00`).toLocaleDateString()}.`
              : "Amounts are per person. Nothing is charged on this site — confirming a payment records it and issues the person's entrance pass."
          }
          actions={
            canApprove ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  onClick={() => setSyncOpen(true)}
                >
                  Add missing people
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<ShieldCheck size={14} />}
                  loading={issueAll.saving}
                  onClick={async () => {
                    const result = await issueAll.run()
                    if (!result) return
                    toast.success(`Entrance passes ready (${result.passes.length}).`)
                    onChanged()
                  }}
                >
                  Issue passes
                </Button>
                <Button
                  variant="gold"
                  size="sm"
                  icon={<Download size={14} />}
                  disabled={passes.length === 0}
                  onClick={() =>
                    downloadPassSheet({ eventName, eventDate, eventTime, eventLocation, passes })
                  }
                >
                  Download QR sheet
                </Button>
              </div>
            ) : null
          }
        />
        <div className="px-5 py-4">
          <DataTable
            columns={columns}
            rows={contributions}
            rowKey={(row) => row.member_id}
            emptyTitle="Nobody on the contribution list yet"
            emptyDescription="Add the people taking part, then press “Add missing people” to put them all on the list at the amount above."
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Entrance passes"
          description={`${passes.length} pass${passes.length === 1 ? "" : "es"} issued. A pass exists only for someone whose contribution is confirmed paid or waived.`}
        />
        <div className="px-5 py-4">
          <DataTable
            columns={passColumns}
            rows={passes}
            rowKey={(row) => row.id}
            emptyTitle="No passes yet"
            emptyDescription="Confirm a person's contribution and their pass is issued automatically."
          />
        </div>
      </Card>

      {checkins.length > 0 ? (
        <Card>
          <CardHeader title="Door log" description="Every scan and every typed code at this event's door." />
          <CardBody className="flex flex-col gap-2">
            {checkins.slice(0, 25).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{row.full_name ?? "Unknown code"}</span>
                  {row.actor_name ? <span className="muted"> · by {row.actor_name}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="muted text-xs capitalize">{row.detail ?? row.outcome}</span>
                  <span className="muted text-xs">{formatDateTime(row.created_at)}</span>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <ConfirmDialog
        open={syncOpen}
        onCancel={() => setSyncOpen(false)}
        title="Add missing people"
        message="Every participant who is not already on the list is added at the amount above. Anyone already recorded keeps their amount and their status."
        confirmLabel="Add them"
        loading={sync.saving}
        onConfirm={async () => {
          const result = await sync.run()
          if (!result) return
          toast.success(
            result.added === 0
              ? "Everyone taking part is already on the list."
              : `Added ${result.added} ${result.added === 1 ? "person" : "people"}.`,
          )
          setSyncOpen(false)
          onChanged()
        }}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onCancel={() => setConfirmTarget(null)}
        title="Confirm this contribution?"
        message={
          confirmTarget
            ? `${confirmTarget.full_name} · ${formatAmount(confirmTarget.amount)}. This issues their entrance pass straight away.`
            : ""
        }
        confirmLabel="Confirm paid"
        loading={confirm.saving}
        onConfirm={async () => {
          if (!confirmTarget) return
          const result = await confirm.run({ memberId: confirmTarget.member_id, status: "paid" })
          if (!result) return
          toast.success(`${confirmTarget.full_name} is confirmed. Their entrance pass is ready.`)
          setConfirmTarget(null)
          onChanged()
        }}
      />

      <ConfirmDialog
        open={undoTarget !== null}
        onCancel={() => setUndoTarget(null)}
        title="Return this to unpaid?"
        message={
          undoTarget
            ? `${undoTarget.full_name} will show as owing again, and their entrance pass is cancelled. A pass already used at the door stays used.`
            : ""
        }
        confirmLabel="Return to unpaid"
        tone="danger"
        loading={undo.saving}
        onConfirm={async () => {
          if (!undoTarget) return
          const result = await undo.run({ memberId: undoTarget.member_id })
          if (!result) return
          toast.success(`${undoTarget.full_name} is back on the unpaid list.`)
          setUndoTarget(null)
          onChanged()
        }}
      />

      <Modal
        open={amountTarget !== null}
        onClose={() => setAmountTarget(null)}
        title="Change the amount"
        description={
          amountTarget ? `What ${amountTarget.full_name} owes for this event, in whole francs.` : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setAmountTarget(null)} disabled={setAmount.saving}>
              Cancel
            </Button>
            <Button
              variant="gold"
              loading={setAmount.saving}
              onClick={async () => {
                if (!amountTarget) return
                const amount = Number(amountDraft)
                if (!Number.isFinite(amount) || amount < 0) {
                  toast.error("Enter an amount in whole francs.")
                  return
                }
                const result = await setAmount.run({ memberId: amountTarget.member_id, amount })
                if (!result) return
                toast.success("Amount updated.")
                setAmountTarget(null)
                onChanged()
              }}
            >
              Save amount
            </Button>
          </>
        }
      >
        <Field label="Amount (FRW)" htmlFor="contribution-amount">
          <Input
            id="contribution-amount"
            type="number"
            min={0}
            step={100}
            value={amountDraft}
            onChange={(event) => setAmountDraft(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={passTarget !== null}
        onClose={() => setPassTarget(null)}
        title={passTarget ? `${passTarget.full_name} — entrance pass` : "Entrance pass"}
        description="Scan this at the door, or type the passcode if the camera will not read it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPassTarget(null)}>
              Close
            </Button>
            {passTarget ? (
              <Button
                variant="outline"
                icon={<Ban size={15} />}
                onClick={async () => {
                  await api.post(`/events/${eventId}/passes/revoke`, { memberId: passTarget.member_id })
                  toast.success("Pass cancelled.")
                  setPassTarget(null)
                  onChanged()
                }}
              >
                Cancel this pass
              </Button>
            ) : null}
          </>
        }
      >
        {passTarget ? (
          <PassQr
            token={passTarget.token}
            name={passTarget.full_name ?? ""}
            memberNo={passTarget.member_no ?? ""}
            group={passTarget.group_name ?? ""}
            passcode={passTarget.passcode}
            status={passTarget.status}
          />
        ) : null}
      </Modal>

      {canCheckin ? null : (
        <p className="muted text-xs">
          You can record contributions. Working the door — checking people in — belongs to the person running the
          event.
        </p>
      )}
    </div>
  )
}
