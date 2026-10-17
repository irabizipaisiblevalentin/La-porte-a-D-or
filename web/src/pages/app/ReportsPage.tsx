import { useMemo, useState, type ReactNode } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toQuery } from "../../api/client"
import { useQuery } from "../../api/hooks"
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Field,
  LoadingBlock,
  PageHeader,
  Select,
  StatCard,
  Tabs,
  humanize,
  useTabState,
  type Column,
} from "../../components/ui"

// --- Response shapes (mirroring server/src/routes/reports.ts) ---------------

interface GroupMeta {
  id: string
  key: string
  name: string
  description: string
  is_minor_group: number
}

interface MetaResponse {
  groups: GroupMeta[]
  voiceSections: unknown[]
}

interface MembershipReport {
  byGroup: {
    groupId: string
    groupKey: string
    groupName: string
    total: number
    active: number
    inactive: number
    suspended: number
    withdrawn: number
  }[]
  byStatus: { status: string; count: number }[]
  admissionsByMonth: { month: string; count: number }[]
  total: number
}

interface AttendanceReport {
  range: { from: string | null; to: string | null }
  groupId: string | null
  policy: { latePolicy: string; excusedPolicy: string }
  sessions: number
  present: number
  late: number
  absent: number
  excused: number
  totalRecords: number
  rate: number | null
  byGroup: {
    groupId: string
    groupKey: string | null
    groupName: string | null
    sessions: number
    present: number
    late: number
    absent: number
    excused: number
    rate: number | null
  }[]
}

interface DisciplineReport {
  range: { from: string | null; to: string | null }
  groupId: string | null
  total: number
  negative: number
  positive: number
  byStatus: { status: string; count: number }[]
  byCategory: { categoryId: string; key: string; label: string; kind: string; count: number }[]
  byGroup: {
    groupId: string
    groupKey: string | null
    groupName: string | null
    negative: number
    positive: number
    total: number
  }[]
}

interface MusicReport {
  catalogue: { total: number; active: number; archived: number }
  videos: { total: number; approved: number; discovered: number; rejected: number }
  byStage: { stageId: string; key: string; name: string; count: number }[]
  byCategory: { categoryId: string; key: string; name: string; count: number }[]
  readyForPerformance: number
  performances: { events: number; completedEvents: number; songAssignments: number }
}

interface GoalAggregate {
  count: number
  target: number
  current: number
  percent: number
}

interface GoalsReport {
  total: number
  active: number
  completed: number
  cancelled: number
  remaining: number
  overdue: number
  annual: GoalAggregate
  monthly: GoalAggregate
  custom: GoalAggregate
  progress: {
    id: string
    name: string
    target: number
    unit: string
    current: number
    percent: number
    deadline: string | null
    status: string
    period: string
    groupId: string | null
  }[]
}

interface EventsReport {
  range: { from: string | null; to: string | null }
  eventsHeld: number
  participants: number
  trainingCompleted: number
  trainingParticipantsCompleted: number
  performanceHistory: { id: string; name: string; eventType: string; date: string; participants: number }[]
}

interface MeReport {
  attendance: { sessions: number; present: number; late: number; absent: number; excused: number; rate: number | null }
  songsLearning: number
  trainingsCompleted: number
  eventsAttended: number
}

const GOLD = "#d4af37"
const GOLD_DARK = "#b08d1e"
const GOLD_LIGHT = "#e3cb78"
const PALETTE = [GOLD, GOLD_DARK, GOLD_LIGHT, "#7d601c", "#c39b28", "#5c4718"]

const TABS = [
  { key: "membership", label: "Membership" },
  { key: "attendance", label: "Attendance" },
  { key: "discipline", label: "Discipline" },
  { key: "music", label: "Music" },
  { key: "goals", label: "Goals" },
  { key: "events", label: "Events" },
  { key: "me", label: "My Progress" },
]

function formatRate(rate: number | null): string {
  return rate === null || rate === undefined ? "—" : `${rate}%`
}

function ChartCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        <div className="h-72 w-full">{children}</div>
      </CardBody>
    </Card>
  )
}

function NoData({ message }: { message: string }) {
  return <p className="muted py-8 text-center text-sm">{message}</p>
}

export function ReportsPage() {
  const { active, setActive } = useTabState("membership")
  const [groupId, setGroupId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const meta = useQuery<MetaResponse>("/members/meta")
  const dateQuery = toQuery({ groupId, from, to })

  const membership = useQuery<MembershipReport>(active === "membership" ? "/reports/membership" : null)
  const attendance = useQuery<AttendanceReport>(active === "attendance" ? `/reports/attendance${dateQuery}` : null)
  const discipline = useQuery<DisciplineReport>(active === "discipline" ? `/reports/discipline${dateQuery}` : null)
  const music = useQuery<MusicReport>(active === "music" ? "/reports/music" : null)
  const goals = useQuery<GoalsReport>(active === "goals" ? "/reports/goals" : null)
  const events = useQuery<EventsReport>(active === "events" ? `/reports/events${dateQuery}` : null)
  const me = useQuery<MeReport>(active === "me" ? "/reports/me" : null)

  const showFilters = active === "attendance" || active === "discipline" || active === "events"
  const showGroupFilter = active === "attendance" || active === "discipline"

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Operational reports built entirely from recorded data. Empty reports mean there is nothing to show yet."
      />

      <Tabs tabs={TABS} active={active} onChange={setActive} />

      {showFilters ? (
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            {showGroupFilter ? (
              <Field label="Group" htmlFor="report-group">
                <Select id="report-group" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  <option value="">All permitted groups</option>
                  {(meta.data?.groups ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="From" htmlFor="report-from">
              <input
                id="report-from"
                type="date"
                className="field"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field label="To" htmlFor="report-to">
              <input
                id="report-to"
                type="date"
                className="field"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
          </CardBody>
        </Card>
      ) : null}

      {active === "membership" ? <MembershipTab report={membership} /> : null}
      {active === "attendance" ? <AttendanceTab report={attendance} /> : null}
      {active === "discipline" ? <DisciplineTab report={discipline} /> : null}
      {active === "music" ? <MusicTab report={music} /> : null}
      {active === "goals" ? <GoalsTab report={goals} /> : null}
      {active === "events" ? <EventsTab report={events} /> : null}
      {active === "me" ? <MeTab report={me} /> : null}
    </div>
  )
}

function ReportState({
  loading,
  error,
  hasData,
  children,
}: {
  loading: boolean
  error: { message: string } | null
  hasData: boolean
  children: ReactNode
}) {
  if (loading && !hasData) return <LoadingBlock label="Loading report…" rows={4} />
  if (error) {
    return (
      <Card>
        <CardBody>
          <NoData message={error.message} />
        </CardBody>
      </Card>
    )
  }
  return <>{children}</>
}

// --- Membership -------------------------------------------------------------

function MembershipTab({ report }: { report: ReturnType<typeof useQuery<MembershipReport>> }) {
  const { data, loading, error } = report

  const groupColumns: Column<MembershipReport["byGroup"][number]>[] = [
    { key: "group", header: "Group", render: (row) => row.groupName },
    { key: "total", header: "Total", align: "right", render: (row) => row.total },
    { key: "active", header: "Active", align: "right", render: (row) => row.active },
    { key: "inactive", header: "Inactive", align: "right", render: (row) => row.inactive },
    { key: "suspended", header: "Suspended", align: "right", render: (row) => row.suspended },
    { key: "withdrawn", header: "Withdrawn", align: "right", render: (row) => row.withdrawn },
  ]

  const statusColumns: Column<MembershipReport["byStatus"][number]>[] = [
    { key: "status", header: "Status", render: (row) => <Badge tone="neutral">{humanize(row.status)}</Badge> },
    { key: "count", header: "Members", align: "right", render: (row) => row.count },
  ]

  const activeTotal = useMemo(
    () => (data?.byGroup ?? []).reduce((sum, row) => sum + row.active, 0),
    [data],
  )

  return (
    <ReportState loading={loading} error={error} hasData={Boolean(data)}>
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total members" value={data.total} />
            <StatCard label="Active" value={activeTotal} />
            <StatCard label="Groups" value={data.byGroup.length} />
            <StatCard label="Status categories" value={data.byStatus.length} />
          </div>

          <ChartCard title="New admissions by month" description="Members who joined over the last 12 months.">
            {data.admissionsByMonth.length === 0 ? (
              <NoData message="No admissions recorded in this period." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.admissionsByMonth}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" name="Admissions" stroke={GOLD} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Members by group and status" description="Counts come directly from member records.">
            {data.byGroup.length === 0 ? (
              <NoData message="No groups are in scope for your account." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byGroup}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                  <XAxis dataKey="groupName" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="active" name="Active" stackId="a" fill={GOLD} />
                  <Bar dataKey="inactive" name="Inactive" stackId="a" fill={GOLD_DARK} />
                  <Bar dataKey="suspended" name="Suspended" stackId="a" fill="#7d601c" />
                  <Bar dataKey="withdrawn" name="Withdrawn" stackId="a" fill="#545c6e" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <Card>
            <CardHeader title="By group" />
            <CardBody>
              <DataTable columns={groupColumns} rows={data.byGroup} rowKey={(row) => row.groupId} emptyTitle="No group counts" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="By status" />
            <CardBody>
              <DataTable columns={statusColumns} rows={data.byStatus} rowKey={(row) => row.status} emptyTitle="No members recorded" />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </ReportState>
  )
}

// --- Attendance -------------------------------------------------------------

function AttendanceTab({ report }: { report: ReturnType<typeof useQuery<AttendanceReport>> }) {
  const { data, loading, error } = report

  const columns: Column<AttendanceReport["byGroup"][number]>[] = [
    { key: "group", header: "Group", render: (row) => row.groupName ?? row.groupId },
    { key: "sessions", header: "Sessions", align: "right", render: (row) => row.sessions },
    { key: "present", header: "Present", align: "right", render: (row) => row.present },
    { key: "late", header: "Late", align: "right", render: (row) => row.late },
    { key: "absent", header: "Absent", align: "right", render: (row) => row.absent },
    { key: "excused", header: "Excused", align: "right", render: (row) => row.excused },
    { key: "rate", header: "Rate", align: "right", render: (row) => formatRate(row.rate) },
  ]

  return (
    <ReportState loading={loading} error={error} hasData={Boolean(data)}>
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Attendance rate" value={formatRate(data.rate)} hint="Uses the configured policy." />
            <StatCard label="Sessions" value={data.sessions} />
            <StatCard label="Present" value={data.present} />
            <StatCard label="Late" value={data.late} />
            <StatCard label="Absent" value={data.absent} />
            <StatCard label="Excused" value={data.excused} />
            <StatCard label="Records" value={data.totalRecords} />
            <StatCard
              label="Policy"
              value={<span className="text-base">{humanize(data.policy.latePolicy)}</span>}
              hint={`Excused: ${humanize(data.policy.excusedPolicy)}`}
            />
          </div>

          <ChartCard title="Attendance by group" description="Present, late, absent and excused records.">
            {data.byGroup.length === 0 ? (
              <NoData message="No attendance records were found for this selection." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byGroup}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                  <XAxis dataKey="groupName" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="present" name="Present" stackId="a" fill={GOLD} />
                  <Bar dataKey="late" name="Late" stackId="a" fill={GOLD_DARK} />
                  <Bar dataKey="excused" name="Excused" stackId="a" fill={GOLD_LIGHT} />
                  <Bar dataKey="absent" name="Absent" stackId="a" fill="#545c6e" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <Card>
            <CardHeader title="By group" description="Rate is null when there are no records to divide by." />
            <CardBody>
              <DataTable columns={columns} rows={data.byGroup} rowKey={(row) => row.groupId} emptyTitle="No attendance records" />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </ReportState>
  )
}

// --- Discipline -------------------------------------------------------------

function DisciplineTab({ report }: { report: ReturnType<typeof useQuery<DisciplineReport>> }) {
  const { data, loading, error } = report

  const categoryColumns: Column<DisciplineReport["byCategory"][number]>[] = [
    { key: "label", header: "Category", render: (row) => row.label },
    { key: "kind", header: "Kind", render: (row) => <Badge tone={row.kind === "negative" ? "danger" : "positive"}>{humanize(row.kind)}</Badge> },
    { key: "count", header: "Records", align: "right", render: (row) => row.count },
  ]

  const groupColumns: Column<DisciplineReport["byGroup"][number]>[] = [
    { key: "group", header: "Group", render: (row) => row.groupName ?? row.groupId },
    { key: "positive", header: "Positive", align: "right", render: (row) => row.positive },
    { key: "negative", header: "Negative", align: "right", render: (row) => row.negative },
    { key: "total", header: "Total", align: "right", render: (row) => row.total },
  ]

  const statusColumns: Column<DisciplineReport["byStatus"][number]>[] = [
    { key: "status", header: "Status", render: (row) => <Badge tone="neutral">{humanize(row.status)}</Badge> },
    { key: "count", header: "Records", align: "right", render: (row) => row.count },
  ]

  return (
    <ReportState loading={loading} error={error} hasData={Boolean(data)}>
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total records" value={data.total} />
            <StatCard label="Positive" value={data.positive} tone="gold" />
            <StatCard label="Negative" value={data.negative} tone="neutral" />
          </div>

          <ChartCard title="Records by category" description="Positive recognition and negative records combined.">
            {data.byCategory.length === 0 ? (
              <NoData message="No discipline or recognition records were found." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byCategory}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                  <XAxis dataKey="label" fontSize={12} interval={0} angle={-20} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                    {data.byCategory.map((row, index) => (
                      <Cell key={row.categoryId} fill={row.kind === "negative" ? "#b4544a" : PALETTE[index % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <Card>
            <CardHeader title="By category" />
            <CardBody>
              <DataTable columns={categoryColumns} rows={data.byCategory} rowKey={(row) => row.categoryId} emptyTitle="No records" />
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="By status" />
              <CardBody>
                <DataTable columns={statusColumns} rows={data.byStatus} rowKey={(row) => row.status} emptyTitle="No records" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="By group" />
              <CardBody>
                <DataTable columns={groupColumns} rows={data.byGroup} rowKey={(row) => row.groupId} emptyTitle="No records" />
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}
    </ReportState>
  )
}

// --- Music ------------------------------------------------------------------

function MusicTab({ report }: { report: ReturnType<typeof useQuery<MusicReport>> }) {
  const { data, loading, error } = report

  const stageColumns: Column<MusicReport["byStage"][number]>[] = [
    { key: "name", header: "Learning stage", render: (row) => row.name },
    { key: "count", header: "Songs", align: "right", render: (row) => row.count },
  ]

  const categoryColumns: Column<MusicReport["byCategory"][number]>[] = [
    { key: "name", header: "Category", render: (row) => row.name },
    { key: "count", header: "Songs", align: "right", render: (row) => row.count },
  ]

  return (
    <ReportState loading={loading} error={error} hasData={Boolean(data)}>
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Songs in catalogue" value={data.catalogue.total} hint={`${data.catalogue.active} active · ${data.catalogue.archived} archived`} />
            <StatCard label="Ready for performance" value={data.readyForPerformance} />
            <StatCard label="Videos catalogued" value={data.videos.total} hint={`${data.videos.approved} approved`} />
            <StatCard label="Song assignments to events" value={data.performances.songAssignments} hint={`${data.performances.completedEvents} completed events`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Active songs by learning stage">
              {data.byStage.length === 0 ? (
                <NoData message="No songs have a learning stage recorded yet." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byStage}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                    <XAxis dataKey="name" fontSize={12} interval={0} angle={-20} textAnchor="end" height={70} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" name="Songs" fill={GOLD} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Active songs by category">
              {data.byCategory.length === 0 ? (
                <NoData message="No songs have a category recorded yet." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byCategory}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                    <XAxis dataKey="name" fontSize={12} interval={0} angle={-20} textAnchor="end" height={70} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" name="Songs" fill={GOLD_DARK} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="By learning stage" />
              <CardBody>
                <DataTable columns={stageColumns} rows={data.byStage} rowKey={(row) => row.stageId} emptyTitle="No stages recorded" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="By category" />
              <CardBody>
                <DataTable columns={categoryColumns} rows={data.byCategory} rowKey={(row) => row.categoryId} emptyTitle="No categories recorded" />
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}
    </ReportState>
  )
}

// --- Goals ------------------------------------------------------------------

function GoalsTab({ report }: { report: ReturnType<typeof useQuery<GoalsReport>> }) {
  const { data, loading, error } = report

  const columns: Column<GoalsReport["progress"][number]>[] = [
    { key: "name", header: "Goal", render: (row) => row.name },
    { key: "period", header: "Period", render: (row) => humanize(row.period) },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "completed" ? "positive" : "neutral"}>{humanize(row.status)}</Badge> },
    { key: "progress", header: "Progress", align: "right", render: (row) => `${row.current} / ${row.target} ${row.unit} (${row.percent}%)` },
    { key: "deadline", header: "Deadline", render: (row) => row.deadline ?? "—" },
  ]

  const aggregates: { label: string; aggregate: GoalAggregate }[] = data
    ? [
        { label: "Annual", aggregate: data.annual },
        { label: "Monthly", aggregate: data.monthly },
        { label: "Custom", aggregate: data.custom },
      ]
    : []

  return (
    <ReportState loading={loading} error={error} hasData={Boolean(data)}>
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total goals" value={data.total} />
            <StatCard label="Active" value={data.active} />
            <StatCard label="Completed" value={data.completed} />
            <StatCard label="Overdue" value={data.overdue} hint={`${data.remaining} active remaining`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {aggregates.map(({ label, aggregate }) => (
              <StatCard
                key={label}
                label={`${label} goals`}
                value={aggregate.percent + "%"}
                hint={`${aggregate.count} goals · ${aggregate.current} / ${aggregate.target}`}
              />
            ))}
          </div>

          <ChartCard title="Active goal progress" description="Percentage complete for up to 50 active goals.">
            {data.progress.length === 0 ? (
              <NoData message="There are no active goals to chart." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.progress}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                  <XAxis dataKey="name" fontSize={12} interval={0} angle={-20} textAnchor="end" height={80} />
                  <YAxis domain={[0, 100]} fontSize={12} unit="%" />
                  <Tooltip />
                  <Bar dataKey="percent" name="Complete" fill={GOLD} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <Card>
            <CardHeader title="Goal progress" description="Progress is summed from recorded goal progress entries." />
            <CardBody>
              <DataTable columns={columns} rows={data.progress} rowKey={(row) => row.id} emptyTitle="No active goals" />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </ReportState>
  )
}

// --- Events -----------------------------------------------------------------

function EventsTab({ report }: { report: ReturnType<typeof useQuery<EventsReport>> }) {
  const { data, loading, error } = report

  const columns: Column<EventsReport["performanceHistory"][number]>[] = [
    { key: "date", header: "Date", render: (row) => row.date },
    { key: "name", header: "Event", render: (row) => row.name },
    { key: "type", header: "Type", render: (row) => <Badge tone="neutral">{humanize(row.eventType)}</Badge> },
    { key: "participants", header: "Participants", align: "right", render: (row) => row.participants },
  ]

  return (
    <ReportState loading={loading} error={error} hasData={Boolean(data)}>
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Events held" value={data.eventsHeld} hint="Completed events only." />
            <StatCard label="Event participations" value={data.participants} />
            <StatCard label="Training sessions completed" value={data.trainingCompleted} />
            <StatCard label="Training completions" value={data.trainingParticipantsCompleted} hint="Participant records marked complete." />
          </div>

          <Card>
            <CardHeader title="Performance history" description="Completed concerts, church services, competitions and community events." />
            <CardBody>
              <DataTable columns={columns} rows={data.performanceHistory} rowKey={(row) => row.id} emptyTitle="No completed performances recorded" />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </ReportState>
  )
}

// --- Me ---------------------------------------------------------------------

function MeTab({ report }: { report: ReturnType<typeof useQuery<MeReport>> }) {
  const { data, loading, error } = report

  return (
    <ReportState loading={loading} error={error} hasData={Boolean(data)}>
      {data ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Attendance rate" value={formatRate(data.attendance.rate)} hint="Recorded against your own member record." />
            <StatCard label="Sessions attended" value={data.attendance.sessions} />
            <StatCard label="Present" value={data.attendance.present} />
            <StatCard label="Songs learning" value={data.songsLearning} />
            <StatCard label="Trainings completed" value={data.trainingsCompleted} />
            <StatCard label="Events attended" value={data.eventsAttended} />
            <StatCard label="Late" value={data.attendance.late} />
            <StatCard label="Excused / absent" value={`${data.attendance.excused} / ${data.attendance.absent}`} />
          </div>

          <ChartCard title="Your attendance breakdown">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { status: "Present", count: data.attendance.present },
                  { status: "Late", count: data.attendance.late },
                  { status: "Excused", count: data.attendance.excused },
                  { status: "Absent", count: data.attendance.absent },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                <XAxis dataKey="status" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" name="Records" fill={GOLD} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      ) : null}
    </ReportState>
  )
}
