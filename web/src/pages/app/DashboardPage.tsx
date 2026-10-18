import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  MessageSquare,
  Music,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react"
import { useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  StatCard,
  StatusBadge,
  humanize,
} from "../../components/ui"

/* ------------------------------------------------------------------ *
 * Response shapes mirror server/src/routes/dashboard.ts exactly.
 * Only the sections the viewer's permissions allow are present.
 * ------------------------------------------------------------------ */

type DashboardRole = "chairman" | "senior_leader" | "junior_admin" | "members_admin" | "member"

interface StatItem {
  key: string
  label: string
  value: number | string
  hint: string
}

interface AttendanceTotals {
  sessions: number
  present: number
  late: number
  absent: number
  excused: number
}

interface GoalProgressItem {
  id: string
  name: string
  target: number
  unit: string
  current: number
  percent: number
  deadline: string | null
  status: string
}

interface EventItem {
  id: string
  name: string
  eventType: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
}

interface AnnouncementItem {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  publishedAt: string | null
}

interface SongItem {
  id: string
  title: string
  category: string | null
  stage: string | null
  updatedAt: string
}

interface AuditItem {
  id: string
  action: string
  entityType: string
  entityId: string | null
  summary: string
  actorName: string | null
  createdAt: string
}

interface MemberProgress {
  songsLearning?: number
  trainingsCompleted?: number
  eventsAttended?: number
}

interface GroupSummary {
  id: string
  key: string
  name: string
  members: number
  pendingApplications: number
  attendanceRate: number | null
}

interface ApplicationSummary {
  id: string
  fullName: string
  groupName: string | null
  groupKey: string | null
  status: string
  submittedAt: string
}

interface MessageSummary {
  id: string
  senderName: string
  subject: string
  createdAt: string
  readAt: string | null
}

interface FounderItem {
  name: string
  role: string | null
  photo: string | null
}

interface DashboardPayload {
  role: DashboardRole
  viewer: { displayName: string; memberNo: string | null; groupKey: string | null; groupName: string | null }
  scopeLabel: string
  stats: StatItem[]
  attendance?: AttendanceTotals & { rate: number | null }
  goalProgress?: GoalProgressItem[]
  upcomingEvents?: EventItem[]
  recentAnnouncements?: AnnouncementItem[]
  recentSongs?: SongItem[]
  recentAudit?: AuditItem[]
  myAttendance?: { sessions: number; present: number; rate: number | null }
  myProgress?: MemberProgress
  disciplineAlerts?: number
  training?: { upcoming: number; completed: number }
  groups?: GroupSummary[]
  applicationsToReview?: ApplicationSummary[]
  unreadMessages?: number
  recentMessages?: MessageSummary[]
  founders?: FounderItem[]
}

const STAT_ICONS: Record<string, ReactNode> = {
  members: <Users size={18} />,
  applications: <FileText size={18} />,
  attendance: <ClipboardCheck size={18} />,
  events: <CalendarDays size={18} />,
  discipline: <ShieldAlert size={18} />,
  goals: <Target size={18} />,
  songs: <Music size={18} />,
  trainings: <GraduationCap size={18} />,
}

const ROLE_LABELS: Record<DashboardRole, string> = {
  chairman: "Chairman",
  senior_leader: "Senior Leader",
  junior_admin: "Junior Administrator",
  members_admin: "Members Administrator",
  member: "Member",
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatRate(rate: number | null | undefined): string {
  return typeof rate === "number" ? `${rate}%` : "—"
}

export function DashboardPage() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useQuery<DashboardPayload>("/dashboard")

  const displayName = user?.displayName ?? data?.viewer.displayName ?? "there"

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome back, ${displayName}`}
        description={
          data
            ? `${ROLE_LABELS[data.role]} · ${data.scopeLabel}${
                data.viewer.memberNo ? ` · ${data.viewer.memberNo}` : ""
              }`
            : "Your role-appropriate overview."
        }
      />

      {loading ? <LoadingBlock label="Loading your dashboard…" rows={4} /> : null}

      {!loading && error ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4">
            <ErrorState
              title="Could not load your dashboard"
              description={error.message || "The dashboard could not be loaded. Please try again."}
            />
            <Button variant="gold" onClick={reload}>
              Try again
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {!loading && !error && data ? <DashboardContent payload={data} /> : null}
    </div>
  )
}

function DashboardContent({ payload }: { payload: DashboardPayload }) {
  const isAdmin = payload.role !== "member"

  return (
    <>
      {payload.stats.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {payload.stats.map((stat) => (
            <StatCard
              key={stat.key}
              label={stat.label}
              value={stat.value}
              hint={stat.hint}
              icon={STAT_ICONS[stat.key]}
            />
          ))}
        </div>
      ) : null}

      {isAdmin && payload.groups && payload.groups.length > 0 ? (
        <GroupOverview groups={payload.groups} isChairman={payload.role === "chairman"} />
      ) : null}

      {payload.role === "chairman" && payload.founders ? (
        <Card>
          <CardHeader
            title="Founders of the Choir"
            description="The members who formed Chorale La Porte d'Or."
            actions={
              <Link to="/app/settings" className="link text-sm">
                Manage in Settings
              </Link>
            }
          />
          <CardBody>
            {payload.founders.length === 0 ? (
              <p className="muted text-sm">
                No founders have been listed yet. Add them under Application settings → Founders of the
                choir, one entry per founder with a name, an optional role and an optional photo link.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {payload.founders.map((founder, index) => (
                  <li
                    key={`${founder.name}-${index}`}
                    className="flex items-center gap-3 rounded-lg border hairline border-[color:var(--color-hairline)] p-3"
                  >
                    {founder.photo ? (
                      <img
                        src={founder.photo}
                        alt={founder.name}
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-gold)]/15 font-display text-lg font-semibold text-[color:var(--color-gold)]"
                      >
                        {founder.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{founder.name}</p>
                      <p className="muted truncate text-xs">{founder.role ?? "Founder"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {isAdmin && payload.applicationsToReview ? (
          <SectionCard
            title="Applications to review"
            description={
              payload.role === "chairman"
                ? "Pending membership applications across all groups."
                : `Pending applications in ${payload.scopeLabel}.`
            }
            to="/app/applications"
          >
            {payload.applicationsToReview.length === 0 ? (
              <p className="muted text-sm">No applications are waiting for a decision.</p>
            ) : (
              <ul className="flex flex-col divide-y hairline">
                {payload.applicationsToReview.map((application) => (
                  <li
                    key={application.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link to={`/app/applications/${application.id}`} className="link text-sm font-medium">
                        {application.fullName}
                      </Link>
                      <p className="muted text-xs">
                        {application.groupName ?? "No group selected"} · {formatDate(application.submittedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={application.status} />
                      <Link
                        to={`/app/applications/${application.id}`}
                        className="btn btn-outline btn-sm"
                      >
                        Review
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}

        {payload.recentMessages ? (
          <SectionCard
            title="Message the Chairman"
            description="Private messages members have sent you."
            to="/app/messages"
          >
            <div className="flex flex-wrap items-center gap-3">
              {typeof payload.unreadMessages === "number" && payload.unreadMessages > 0 ? (
                <Badge tone="gold">{payload.unreadMessages} unread</Badge>
              ) : (
                <Badge tone="positive">All read</Badge>
              )}
              <p className="muted text-sm">
                {typeof payload.unreadMessages === "number" && payload.unreadMessages > 0
                  ? `${payload.unreadMessages} member message${
                      payload.unreadMessages === 1 ? "" : "s"
                    } waiting for your reply.`
                  : "No unread messages from members."}
              </p>
            </div>
            {payload.recentMessages.length === 0 ? (
              <p className="muted mt-3 text-sm">No messages have been sent yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y hairline">
                {payload.recentMessages.map((message) => (
                  <li key={message.id} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{message.senderName}</span>
                      {!message.readAt ? <Badge tone="gold">Unread</Badge> : null}
                    </div>
                    <p className="muted line-clamp-1 text-xs">{message.subject}</p>
                    <p className="muted text-[11px]">{formatDateTime(message.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}

        {isAdmin && payload.attendance ? (
          <SectionCard
            title="Attendance overview"
            description={`${payload.attendance.sessions} session${
              payload.attendance.sessions === 1 ? "" : "s"
            } recorded in your scope.`}
            to="/app/attendance"
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="muted text-xs font-medium uppercase tracking-wide">Overall rate</p>
                <p className="font-display text-3xl font-semibold leading-none">
                  {formatRate(payload.attendance.rate)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Present" value={payload.attendance.present} />
                <MiniStat label="Late" value={payload.attendance.late} />
                <MiniStat label="Absent" value={payload.attendance.absent} />
                <MiniStat label="Excused" value={payload.attendance.excused} />
              </div>
            </div>
          </SectionCard>
        ) : null}

        {!isAdmin && payload.myAttendance ? (
          <SectionCard
            title="My attendance"
            description="How often you have been present at recorded sessions."
            to="/app/attendance"
          >
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <p className="muted text-xs font-medium uppercase tracking-wide">Attendance rate</p>
                <p className="font-display text-3xl font-semibold leading-none">
                  {formatRate(payload.myAttendance.rate)}
                </p>
              </div>
              <MiniStat label="Present" value={payload.myAttendance.present} />
              <MiniStat label="Sessions" value={payload.myAttendance.sessions} />
            </div>
          </SectionCard>
        ) : null}

        {!isAdmin && payload.myProgress ? (
          <SectionCard title="My progress" description="Your learning and participation so far." to="/app/music">
            <div className="flex flex-wrap gap-6">
              {typeof payload.myProgress.songsLearning === "number" ? (
                <MiniStat label="Songs learning" value={payload.myProgress.songsLearning} />
              ) : null}
              {typeof payload.myProgress.trainingsCompleted === "number" ? (
                <MiniStat label="Trainings completed" value={payload.myProgress.trainingsCompleted} />
              ) : null}
              {typeof payload.myProgress.eventsAttended === "number" ? (
                <MiniStat label="Events attended" value={payload.myProgress.eventsAttended} />
              ) : null}
            </div>
          </SectionCard>
        ) : null}

        {typeof payload.disciplineAlerts === "number" ? (
          <SectionCard
            title="Discipline"
            description="Open negative records you are able to see."
            to="/app/discipline"
          >
            <div className="flex flex-wrap items-center gap-3">
              {payload.disciplineAlerts > 0 ? (
                <Badge tone="danger">
                  {payload.disciplineAlerts} open
                </Badge>
              ) : (
                <Badge tone="positive">No open records</Badge>
              )}
              <p className="muted text-sm">
                {payload.disciplineAlerts > 0
                  ? `${payload.disciplineAlerts} open discipline record${
                      payload.disciplineAlerts === 1 ? "" : "s"
                    } currently require attention.`
                  : "There are no open negative discipline records in your scope."}
              </p>
            </div>
          </SectionCard>
        ) : null}

        {payload.training ? (
          <SectionCard title="Training" description="Sessions planned and completed." to="/app/training">
            <div className="flex flex-wrap gap-6">
              <MiniStat label="Upcoming" value={payload.training.upcoming} />
              <MiniStat label="Completed" value={payload.training.completed} />
            </div>
          </SectionCard>
        ) : null}

        {payload.goalProgress ? (
          <SectionCard
            title="Goal progress"
            description="Active organisation and group goals."
            to="/app/goals"
          >
            {payload.goalProgress.length === 0 ? (
              <p className="muted text-sm">No active goals are being tracked.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {payload.goalProgress.map((goal) => (
                  <li key={goal.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{goal.name}</span>
                      <StatusBadge status={goal.status} />
                    </div>
                    <ProgressBar value={goal.percent} />
                    <div className="muted flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>
                        {goal.current} / {goal.target} {goal.unit} · {goal.percent}%
                      </span>
                      <span>{goal.deadline ? `Due ${formatDate(goal.deadline)}` : "No deadline"}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}

        {payload.upcomingEvents ? (
          <SectionCard
            title="Upcoming events"
            description="From today onward."
            to="/app/events"
          >
            {payload.upcomingEvents.length === 0 ? (
              <p className="muted text-sm">No upcoming events are scheduled.</p>
            ) : (
              <ul className="flex flex-col divide-y hairline">
                {payload.upcomingEvents.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link to="/app/events" className="link text-sm font-medium">
                        {event.name}
                      </Link>
                      <p className="muted text-xs">
                        {humanize(event.eventType)} · {formatDate(event.date)}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                    {event.startTime ? (
                      <span className="muted shrink-0 text-xs">
                        {event.startTime}
                        {event.endTime ? `–${event.endTime}` : ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}

        {payload.recentAnnouncements ? (
          <SectionCard
            title="Announcements"
            description="The most recent published announcements."
            to="/app/announcements"
          >
            {payload.recentAnnouncements.length === 0 ? (
              <p className="muted text-sm">There are no announcements to show.</p>
            ) : (
              <ul className="flex flex-col divide-y hairline">
                {payload.recentAnnouncements.map((announcement) => (
                  <li key={announcement.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link to="/app/announcements" className="link text-sm font-medium">
                        {announcement.title}
                      </Link>
                      <Badge tone={announcement.priority === "high" || announcement.priority === "urgent" ? "gold" : "neutral"}>
                        {humanize(announcement.priority)}
                      </Badge>
                    </div>
                    <p className="muted line-clamp-2 text-xs">{announcement.message}</p>
                    <p className="muted text-[11px]">
                      {announcement.publishedAt ? formatDateTime(announcement.publishedAt) : "Not published"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}

        {payload.recentSongs ? (
          <SectionCard
            title="Recently updated songs"
            description="From the music library."
            to="/app/music"
          >
            {payload.recentSongs.length === 0 ? (
              <p className="muted text-sm">The library has no songs yet.</p>
            ) : (
              <ul className="flex flex-col divide-y hairline">
                {payload.recentSongs.map((song) => (
                  <li
                    key={song.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <Link to="/app/music" className="link text-sm font-medium">
                      {song.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {song.category ? <Badge tone="neutral">{song.category}</Badge> : null}
                      {song.stage ? <StatusBadge status={song.stage} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}

        {payload.recentAudit ? (
          <SectionCard title="Recent activity" description="Latest entries from the audit log." to="/app/audit">
            {payload.recentAudit.length === 0 ? (
              <p className="muted text-sm">No activity has been recorded yet.</p>
            ) : (
              <ul className="flex flex-col divide-y hairline">
                {payload.recentAudit.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">{entry.summary}</span>
                      <Badge tone="neutral">{humanize(entry.entityType)}</Badge>
                    </div>
                    <p className="muted text-[11px]">
                      {entry.actorName ?? "System"} · {humanize(entry.action)} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}
      </div>

      {payload.stats.length === 0 &&
      !payload.attendance &&
      !payload.myAttendance &&
      !payload.myProgress &&
      payload.disciplineAlerts === undefined &&
      !payload.training &&
      !payload.goalProgress &&
      !payload.upcomingEvents &&
      !payload.recentAnnouncements &&
      !payload.recentSongs &&
      !payload.recentAudit &&
      !(payload.groups && payload.groups.length > 0) &&
      !payload.applicationsToReview &&
      !payload.recentMessages &&
      payload.founders === undefined ? (
        <Card>
          <CardBody>
            <p className="muted text-sm">
              There is nothing to show on your dashboard yet. Sections appear here as your roles grant
              access to members, music, events and other modules.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}

function SectionCard({
  title,
  description,
  to,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  to?: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          to ? (
            <Link to={to} className="link text-sm">
              View all
            </Link>
          ) : undefined
        }
      />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="muted text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="font-display text-2xl font-semibold leading-none">{value}</p>
    </div>
  )
}

/**
 * Per-group overview tiles. The Chairman sees all three groups side by side; a
 * scoped administrator sees only their own group, which makes their dashboard
 * visibly about their group rather than a generic org view.
 */
function GroupOverview({ groups, isChairman }: { groups: GroupSummary[]; isChairman: boolean }) {
  return (
    <Card>
      <CardHeader
        title={isChairman ? "Choir at a glance" : "Your group"}
        description={
          isChairman
            ? "Live counts for the Senior, Junior and Members/Support Member groups."
            : "Live counts for the group you oversee."
        }
        actions={
          <Link to="/app/members" className="link text-sm">
            View members
          </Link>
        }
      />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div key={group.id} className="rounded-xl border hairline p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-base font-semibold">{group.name}</span>
                <Badge tone="neutral">{group.key}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="muted text-[11px] uppercase tracking-wide">Members</dt>
                  <dd className="font-display text-xl font-semibold">{group.members}</dd>
                </div>
                <div>
                  <dt className="muted text-[11px] uppercase tracking-wide">Pending</dt>
                  <dd className="font-display text-xl font-semibold">{group.pendingApplications}</dd>
                </div>
                <div>
                  <dt className="muted text-[11px] uppercase tracking-wide">Attend.</dt>
                  <dd className="font-display text-xl font-semibold">{formatRate(group.attendanceRate)}</dd>
                </div>
              </dl>
              <Link to={`/app/members?groupId=${group.id}`} className="link mt-3 inline-block text-xs">
                Open {group.name} members →
              </Link>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
