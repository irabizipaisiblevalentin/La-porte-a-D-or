import { useState, type FormEvent } from "react"
import { AlertCircle, Ban, CalendarClock, CheckCircle2, Pencil, Plus, Target } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  PageHeader,
  ProgressBar,
  Select,
  StatCard,
  StatusBadge,
  Textarea,
  humanize,
  useToast,
} from "../../components/ui"

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface GoalProgress {
  periodDate: string
  value: number
  notes: string | null
  recordedAt: string
}

interface Goal {
  id: string
  name: string
  description: string | null
  targetValue: number
  unit: string
  startDate: string
  deadline: string | null
  groupId: string | null
  groupKey: string | null
  groupName: string | null
  period: string
  status: string
  current: number
  percent: number
  overdue: boolean
  progress: GoalProgress[]
  createdAt: string
  updatedAt: string
}

interface Group {
  id: string
  key: string
  name: string
}

interface Meta {
  groups: Group[]
}

const GOAL_PERIODS = ["annual", "monthly", "custom"] as const
const GOAL_STATUSES = ["active", "completed", "cancelled"] as const

interface GoalFormState {
  name: string
  description: string
  targetValue: string
  unit: string
  startDate: string
  deadline: string
  groupId: string
  period: string
  status: string
}

function today(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function emptyGoalForm(): GoalFormState {
  return {
    name: "",
    description: "",
    targetValue: "",
    unit: "",
    startDate: today(),
    deadline: "",
    groupId: "",
    period: "annual",
    status: "active",
  }
}

function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">
      {message}
    </div>
  )
}

export function GoalsPage() {
  const toast = useToast()
  const { can } = useAuth()
  const canWrite = can("goals.write")

  const [groupId, setGroupId] = useState("")
  const [status, setStatus] = useState("")
  const [period, setPeriod] = useState("")
  const [page, setPage] = useState(1)

  const meta = useQuery<Meta>("/members/meta")
  const list = useQuery<Page<Goal>>(
    `/goals${toQuery({ groupId, status, period, page })}`,
    [groupId, status, period, page],
  )
  // A separate, unfiltered-by-status read powers the headline counters honestly.
  const stats = useQuery<Page<Goal>>(
    `/goals${toQuery({ groupId, period, pageSize: 100 })}`,
    [groupId, period],
  )

  const statItems = stats.data?.items ?? []
  const activeCount = statItems.filter((goal) => goal.status === "active").length
  const completedCount = statItems.filter((goal) => goal.status === "completed").length
  const overdueCount = statItems.filter((goal) => goal.overdue).length
  const statsCapped = (stats.data?.total ?? 0) > statItems.length

  // --- New / edit goal ---
  const [showGoal, setShowGoal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<GoalFormState>(emptyGoalForm())

  const createGoal = useMutation((body: Record<string, unknown>) => api.post<{ goal: Goal }>("/goals", body))
  const updateGoal = useMutation((payload: { id: string; body: Record<string, unknown> }) =>
    api.patch<{ goal: Goal }>(`/goals/${payload.id}`, payload.body),
  )

  const activeMutation = editingId ? updateGoal : createGoal

  function openNew() {
    createGoal.reset()
    updateGoal.reset()
    setEditingId(null)
    setForm(emptyGoalForm())
    setShowGoal(true)
  }

  function openEdit(goal: Goal) {
    createGoal.reset()
    updateGoal.reset()
    setEditingId(goal.id)
    setForm({
      name: goal.name,
      description: goal.description ?? "",
      targetValue: String(goal.targetValue),
      unit: goal.unit,
      startDate: goal.startDate,
      deadline: goal.deadline ?? "",
      groupId: goal.groupId ?? "",
      period: goal.period,
      status: goal.status,
    })
    setShowGoal(true)
  }

  function goalBody() {
    return {
      name: form.name.trim(),
      description: form.description.trim() || null,
      targetValue: Number(form.targetValue),
      unit: form.unit.trim(),
      startDate: form.startDate,
      deadline: form.deadline || null,
      groupId: form.groupId || null,
      period: form.period,
      status: form.status,
    }
  }

  async function submitGoal(event: FormEvent) {
    event.preventDefault()
    const result = editingId
      ? await updateGoal.run({ id: editingId, body: goalBody() })
      : await createGoal.run(goalBody())
    if (result) {
      toast.success(editingId ? "Goal updated." : "Goal created.")
      setShowGoal(false)
      list.reload()
      stats.reload()
    }
  }

  // --- Add progress ---
  const [progressGoal, setProgressGoal] = useState<Goal | null>(null)
  const [progressForm, setProgressForm] = useState({ periodDate: today(), value: "", notes: "" })

  const addProgress = useMutation((payload: { id: string; body: Record<string, unknown> }) =>
    api.post<{ goal: Goal }>(`/goals/${payload.id}/progress`, payload.body),
  )

  function openProgress(goal: Goal) {
    addProgress.reset()
    setProgressGoal(goal)
    setProgressForm({ periodDate: today(), value: String(goal.current), notes: "" })
  }

  async function submitProgress(event: FormEvent) {
    event.preventDefault()
    if (!progressGoal) return
    const result = await addProgress.run({
      id: progressGoal.id,
      body: {
        periodDate: progressForm.periodDate,
        value: Number(progressForm.value),
        notes: progressForm.notes.trim() || null,
      },
    })
    if (result) {
      toast.success("Progress recorded.")
      setProgressGoal(null)
      list.reload()
      stats.reload()
    }
  }

  // --- Cancel goal ---
  const [cancelTarget, setCancelTarget] = useState<Goal | null>(null)
  const cancelGoal = useMutation((id: string) => api.patch<{ goal: Goal }>(`/goals/${id}`, { status: "cancelled" }))

  async function doCancel() {
    if (!cancelTarget) return
    const result = await cancelGoal.run(cancelTarget.id)
    if (result) {
      toast.success("Goal cancelled.")
      setCancelTarget(null)
      list.reload()
      stats.reload()
    }
  }

  const goals = list.data?.items ?? []
  const groups = meta.data?.groups ?? []

  const progressValue = Number(progressForm.value)
  const progressValid = progressForm.value.trim() !== "" && Number.isFinite(progressValue)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Goals"
        description="Set measurable targets for the choir and track progress over time."
        actions={
          canWrite ? (
            <Button variant="gold" icon={<Plus size={16} />} onClick={openNew}>
              New goal
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active goals"
          value={stats.loading ? "…" : activeCount}
          icon={<Target size={18} />}
          hint={statsCapped ? `Based on the first ${statItems.length} goals` : undefined}
        />
        <StatCard
          label="Completed"
          value={stats.loading ? "…" : completedCount}
          icon={<CheckCircle2 size={18} />}
          tone="neutral"
          hint={statsCapped ? `Based on the first ${statItems.length} goals` : undefined}
        />
        <StatCard
          label="Overdue"
          value={stats.loading ? "…" : overdueCount}
          icon={<CalendarClock size={18} />}
          tone="neutral"
          hint={stats.error ? "Could not load counters" : statsCapped ? `Based on the first ${statItems.length} goals` : undefined}
        />
      </div>

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Group" htmlFor="g-group" hint={meta.error ? "Groups could not be loaded." : undefined}>
            <Select
              id="g-group"
              value={groupId}
              onChange={(event) => {
                setGroupId(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All groups</option>
              <option value="none">Organisation-wide</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="g-status">
            <Select
              id="g-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All statuses</option>
              {GOAL_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period" htmlFor="g-period">
            <Select
              id="g-period"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All periods</option>
              {GOAL_PERIODS.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {list.loading ? (
        <LoadingBlock label="Loading goals…" rows={3} />
      ) : list.error ? (
        <EmptyState
          tone="danger"
          icon={<AlertCircle size={22} />}
          title="Could not load goals"
          description={list.error.message}
        />
      ) : goals.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Target size={22} />}
              title="No goals found"
              description="Adjust the filters, or create a goal to get started."
              action={
                canWrite ? (
                  <Button variant="gold" icon={<Plus size={16} />} onClick={openNew}>
                    New goal
                  </Button>
                ) : null
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((goal) => (
            <Card key={goal.id} className="flex flex-col">
              <CardHeader
                title={goal.name}
                description={goal.groupName ?? "Whole organisation"}
                actions={
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={goal.status} />
                    {goal.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                  </div>
                }
              />
              <CardBody className="flex flex-1 flex-col gap-3">
                {goal.description ? <p className="muted text-sm">{goal.description}</p> : null}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {goal.current} / {goal.targetValue} {goal.unit}
                    </span>
                    <span className="font-medium">{goal.percent}%</span>
                  </div>
                  <ProgressBar
                    value={goal.percent}
                    tone={goal.overdue ? "danger" : goal.percent >= 100 ? "positive" : "gold"}
                  />
                </div>
                <div className="muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>Period: {humanize(goal.period)}</span>
                  {goal.deadline ? <span>Deadline: {goal.deadline}</span> : <span>No deadline</span>}
                </div>
                {goal.progress.length > 0 ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer">Progress history ({goal.progress.length})</summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {goal.progress
                        .slice()
                        .reverse()
                        .map((point, index) => (
                          <li key={`${point.periodDate}-${index}`} className="flex items-start justify-between gap-2">
                            <span className="muted">{point.periodDate}</span>
                            <span className="text-right">
                              {point.value} {goal.unit}
                              {point.notes ? <span className="muted"> · {point.notes}</span> : null}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </details>
                ) : (
                  <p className="muted text-xs">No progress recorded yet.</p>
                )}
              </CardBody>
              {canWrite ? (
                <CardFooter className="gap-2">
                  {goal.status === "active" ? (
                    <Button size="sm" variant="gold" icon={<Plus size={14} />} onClick={() => openProgress(goal)}>
                      Add progress
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" icon={<Pencil size={14} />} onClick={() => openEdit(goal)}>
                    Edit
                  </Button>
                  {goal.status !== "cancelled" ? (
                    <Button size="sm" variant="ghost" icon={<Ban size={14} />} onClick={() => setCancelTarget(goal)}>
                      Cancel
                    </Button>
                  ) : null}
                </CardFooter>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {list.data ? (
        <Pagination
          page={list.data.page}
          pageCount={list.data.pageCount}
          total={list.data.total}
          onChange={setPage}
        />
      ) : null}

      {/* New / edit goal */}
      <Modal
        open={showGoal}
        onClose={() => setShowGoal(false)}
        title={editingId ? "Edit goal" : "New goal"}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowGoal(false)} disabled={activeMutation.saving}>
              Cancel
            </Button>
            <Button variant="gold" type="submit" form="goal-form" loading={activeMutation.saving}>
              {editingId ? "Save changes" : "Create goal"}
            </Button>
          </>
        }
      >
        <form id="goal-form" className="flex flex-col gap-4" onSubmit={submitGoal}>
          <FormError message={activeMutation.error?.message} />
          <Field label="Name" required error={activeMutation.error?.fields?.name} htmlFor="goal-name">
            <Input
              id="goal-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. Learn 20 new songs this year"
              required
            />
          </Field>
          <Field label="Description" error={activeMutation.error?.fields?.description} htmlFor="goal-description">
            <Textarea
              id="goal-description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target value" required error={activeMutation.error?.fields?.targetValue} htmlFor="goal-target">
              <Input
                id="goal-target"
                type="number"
                min={0}
                step="any"
                value={form.targetValue}
                onChange={(event) => setForm({ ...form, targetValue: event.target.value })}
                required
              />
            </Field>
            <Field label="Unit" required error={activeMutation.error?.fields?.unit} htmlFor="goal-unit">
              <Input
                id="goal-unit"
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
                placeholder="songs, sessions, members…"
                required
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" required error={activeMutation.error?.fields?.startDate} htmlFor="goal-start">
              <Input
                id="goal-start"
                type="date"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                required
              />
            </Field>
            <Field label="Deadline" error={activeMutation.error?.fields?.deadline} htmlFor="goal-deadline">
              <Input
                id="goal-deadline"
                type="date"
                value={form.deadline}
                onChange={(event) => setForm({ ...form, deadline: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Group" error={activeMutation.error?.fields?.groupId} htmlFor="goal-group">
              <Select
                id="goal-group"
                value={form.groupId}
                onChange={(event) => setForm({ ...form, groupId: event.target.value })}
              >
                <option value="">Whole organisation</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Period" error={activeMutation.error?.fields?.period} htmlFor="goal-period">
              <Select
                id="goal-period"
                value={form.period}
                onChange={(event) => setForm({ ...form, period: event.target.value })}
              >
                {GOAL_PERIODS.map((option) => (
                  <option key={option} value={option}>
                    {humanize(option)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" error={activeMutation.error?.fields?.status} htmlFor="goal-status">
              <Select
                id="goal-status"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              >
                {GOAL_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {humanize(option)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </form>
      </Modal>

      {/* Add progress */}
      <Modal
        open={Boolean(progressGoal)}
        onClose={() => setProgressGoal(null)}
        title="Add progress"
        description={progressGoal ? progressGoal.name : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProgressGoal(null)} disabled={addProgress.saving}>
              Cancel
            </Button>
            <Button
              variant="gold"
              type="submit"
              form="progress-form"
              loading={addProgress.saving}
              disabled={!progressValid}
            >
              Save progress
            </Button>
          </>
        }
      >
        {progressGoal ? (
          <form id="progress-form" className="flex flex-col gap-4" onSubmit={submitProgress}>
            <FormError message={addProgress.error?.message} />
            <p className="muted text-xs">
              Progress is stored as a running total. Currently {progressGoal.current} of {progressGoal.targetValue}{" "}
              {progressGoal.unit}.
            </p>
            <Field label="Period date" required error={addProgress.error?.fields?.periodDate} htmlFor="p-date">
              <Input
                id="p-date"
                type="date"
                value={progressForm.periodDate}
                onChange={(event) => setProgressForm({ ...progressForm, periodDate: event.target.value })}
                required
              />
            </Field>
            <Field
              label={`Total value (${progressGoal.unit})`}
              required
              hint="Enter the cumulative total achieved so far."
              error={addProgress.error?.fields?.value}
              htmlFor="p-value"
            >
              <Input
                id="p-value"
                type="number"
                step="any"
                value={progressForm.value}
                onChange={(event) => setProgressForm({ ...progressForm, value: event.target.value })}
                required
              />
            </Field>
            <Field label="Notes" error={addProgress.error?.fields?.notes} htmlFor="p-notes">
              <Textarea
                id="p-notes"
                rows={2}
                value={progressForm.notes}
                onChange={(event) => setProgressForm({ ...progressForm, notes: event.target.value })}
              />
            </Field>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel this goal?"
        message={cancelTarget ? `“${cancelTarget.name}” will be marked as cancelled. Its recorded progress is kept.` : ""}
        confirmLabel="Cancel goal"
        cancelLabel="Keep goal"
        tone="danger"
        loading={cancelGoal.saving}
        onConfirm={doCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
