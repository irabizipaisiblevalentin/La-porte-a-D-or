import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Link2, Pencil, Plus, QrCode, Trash2, UserPlus } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
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
  type Column,
} from "../../components/ui"
import {
  EventContributionPanel,
  type CheckinRow,
  type ContributionRow,
  type ContributionSummary,
  type PassRow,
} from "./EventContributionPanel"
import { PassQr } from "./PassQr"
import { MyRsvp } from "./MyRsvp"
import { EventPhotoGallery, type EventPhoto } from "./EventPhotoGallery"
import { EventRollCall } from "./EventRollCall"

const EVENT_TYPES = [
  "rehearsal",
  "concert",
  "church_service",
  "retreat",
  "training",
  "meeting",
  "competition",
  "community",
  "other",
] as const

const EVENT_STATUSES = ["planned", "completed", "cancelled"] as const

interface EventRow {
  id: string
  name: string
  event_type: string
  date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  location_id: string | null
  description: string | null
  target_group_id: string | null
  status: string
  report: string | null
  is_public: number
  audience_public: number
  requires_contribution: number
  contribution_amount: number | null
  contribution_note: string | null
  contribution_due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  group_name: string | null
  participant_count: number
}

interface EventParticipantRow {
  member_id: string
  role: string | null
  added_at: string
  rsvp: string | null
  rsvp_at: string | null
  rsvp_note: string | null
  full_name: string
  member_no: string
  group_id: string
  group_name: string
}

interface EventSongRow {
  song_id: string
  added_at: string
  title: string
  composer: string | null
  status: string
}

interface AudienceGroup {
  id: string
  key: string
  name: string
}

interface DetailResponse {
  event: EventRow
  audience: AudienceGroup[]
  participants: EventParticipantRow[]
  songs: EventSongRow[]
  contribution: ContributionSummary
  contributions: ContributionRow[]
  passes: PassRow[]
  myPass: PassRow | null
  checkins: CheckinRow[]
  photos: EventPhoto[]
}

interface MemberRow {
  id: string
  member_no: string
  full_name: string
  status: string
  group_id: string
  group_name: string
}

interface SongRow {
  id: string
  title: string
  composer: string | null
  status: string
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface GroupRow {
  id: string
  key: string
  name: string
}

interface EventFormState {
  name: string
  eventType: string
  date: string
  startTime: string
  endTime: string
  location: string
  targetGroupId: string
  status: string
  description: string
  report: string
  isPublic: boolean
}

interface EventPayload {
  name?: string
  eventType?: string
  date?: string
  startTime?: string | null
  endTime?: string | null
  location?: string | null
  targetGroupId?: string | null
  status?: string
  description?: string | null
  report?: string | null
  isPublic?: boolean
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—"
  if (start && end) return `${start} – ${end}`
  return start ?? end ?? "—"
}

/** Whole Rwandan francs, with thin spaces so a figure is readable at a glance. */
function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return `${value.toLocaleString("en-US").replace(/,/g, " ")} FRW`
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

export function EventDetailPage() {
  const { id = "" } = useParams()
  const { can, hasRole, user } = useAuth()
  const toast = useToast()
  const canWrite = can("events.write")
  const canReadMembers = can("member.read")
  const canReadMusic = can("music.read")
  // Who an event is for, and what it costs, is the Events Coordinator's call —
  // the Chairman oversees everything. A group administrator runs their own events
  // but does not re-aim them.
  const canManage = can("events.manage")
  const canApprove = can("events.payment.approve")
  const canCheckin = can("events.checkin")
  const isMember = hasRole("member")
  const myMemberId = user?.memberId ?? null

  const detail = useQuery<DetailResponse>(id ? `/events/${id}` : null)
  const meta = useQuery<{ groups: GroupRow[] }>("/members/meta")

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<EventFormState | null>(null)

  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [memberSearch, setMemberSearch] = useState("")
  const debouncedMemberSearch = useDebounced(memberSearch, 300)

  const [songsOpen, setSongsOpen] = useState(false)
  const [selectedSongs, setSelectedSongs] = useState<string[]>([])
  const [songSearch, setSongSearch] = useState("")
  const debouncedSongSearch = useDebounced(songSearch, 300)

  const [removeTarget, setRemoveTarget] = useState<EventSongRow | null>(null)

  const memberQuery = useQuery<Page<MemberRow>>(
    participantsOpen && canReadMembers
      ? `/members${toQuery({ search: debouncedMemberSearch, pageSize: 50 })}`
      : null,
  )
  const songQuery = useQuery<Page<SongRow>>(
    songsOpen && canReadMusic ? `/songs${toQuery({ search: debouncedSongSearch, pageSize: 50 })}` : null,
  )

  const update = useMutation((body: EventPayload) => api.patch<{ event: EventRow }>(`/events/${id}`, body))
  const saveParticipants = useMutation((memberIds: string[]) =>
    api.put<{ event: EventRow; participants: EventParticipantRow[] }>(`/events/${id}/participants`, { memberIds }),
  )
  const addSongs = useMutation((songIds: string[]) => api.post<{ event: EventRow; songs: EventSongRow[] }>(`/events/${id}/songs`, { songIds }))
  const removeSong = useMutation((songId: string) => api.del<{ ok: boolean }>(`/events/${id}/songs/${songId}`))

  const event = detail.data?.event
  const participants = detail.data?.participants ?? []
  const songs = detail.data?.songs ?? []
  const groups = meta.data?.groups ?? []
  const audience = detail.data?.audience ?? []
  const contribution = detail.data?.contribution ?? {
    required: false,
    amount: null,
    dueDate: null,
    counts: { due: 0, paid: 0, waived: 0, total: 0 },
    collected: 0,
    outstanding: 0,
  }
  const contributions = detail.data?.contributions ?? []
  const passes = detail.data?.passes ?? []
  const myPass = detail.data?.myPass ?? null
  const checkins = detail.data?.checkins ?? []
  const photos = detail.data?.photos ?? []

  // A past event is closed for answering, and its contribution list is history.
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const isPast = Boolean(event && event.date < todayIso)

  /** Who the event is for, as a short label. */
  const audienceLabel =
    audience.length > 0
      ? audience.map((group) => group.name).join(", ")
      : event?.target_group_id
        ? event.group_name ?? "One group"
        : "Whole choir"

  const linkedSongIds = useMemo(() => new Set(songs.map((song) => song.song_id)), [songs])

  function openEdit() {
    if (!event) return
    setEditForm({
      name: event.name,
      eventType: event.event_type,
      date: event.date,
      startTime: event.start_time ?? "",
      endTime: event.end_time ?? "",
      location: event.location ?? "",
      targetGroupId: event.target_group_id ?? "",
      status: event.status,
      description: event.description ?? "",
      report: event.report ?? "",
      isPublic: event.is_public === 1,
    })
    update.reset()
    setEditOpen(true)
  }

  async function submitEdit(form: FormEvent) {
    form.preventDefault()
    if (!editForm) return
    const result = await update.run({
      name: editForm.name.trim(),
      eventType: editForm.eventType,
      date: editForm.date,
      startTime: editForm.startTime || null,
      endTime: editForm.endTime || null,
      location: editForm.location.trim() || null,
      targetGroupId: editForm.targetGroupId || null,
      status: editForm.status,
      description: editForm.description.trim() || null,
      report: editForm.report.trim() || null,
      isPublic: editForm.isPublic,
    })
    if (!result) return
    toast.success("Event updated.")
    setEditOpen(false)
    detail.reload()
  }

  function openParticipants() {
    setSelectedMembers(participants.map((participant) => participant.member_id))
    setMemberSearch("")
    saveParticipants.reset()
    setParticipantsOpen(true)
  }

  function toggleMember(memberId: string) {
    setSelectedMembers((current) =>
      current.includes(memberId) ? current.filter((value) => value !== memberId) : [...current, memberId],
    )
  }

  async function submitParticipants() {
    const result = await saveParticipants.run(selectedMembers)
    if (!result) return
    toast.success(`Participants saved (${result.participants.length}).`)
    setParticipantsOpen(false)
    detail.reload()
  }

  function openSongs() {
    setSelectedSongs([])
    setSongSearch("")
    addSongs.reset()
    setSongsOpen(true)
  }

  function toggleSong(songId: string) {
    setSelectedSongs((current) =>
      current.includes(songId) ? current.filter((value) => value !== songId) : [...current, songId],
    )
  }

  async function submitSongs() {
    if (selectedSongs.length === 0) return
    const result = await addSongs.run(selectedSongs)
    if (!result) return
    toast.success(`Linked ${selectedSongs.length} song${selectedSongs.length === 1 ? "" : "s"} to this event.`)
    setSongsOpen(false)
    detail.reload()
  }

  async function confirmRemoveSong() {
    if (!removeTarget) return
    const result = await removeSong.run(removeTarget.song_id)
    if (!result) return
    toast.success(`Removed "${removeTarget.title}" from this event.`)
    setRemoveTarget(null)
    detail.reload()
  }

  const participantColumns: Column<EventParticipantRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.full_name}</p>
          <p className="muted text-xs">{row.member_no}</p>
        </div>
      ),
    },
    { key: "group", header: "Group", render: (row) => row.group_name },
    { key: "role", header: "Role", render: (row) => (row.role ? humanize(row.role) : <span className="muted">—</span>) },
    {
      key: "rsvp",
      header: "Answer",
      render: (row) =>
        row.rsvp ? (
          <span
            title={row.rsvp_note ?? undefined}
            className="rounded-full px-2 py-0.5 text-xs font-medium capitalize"
            style={{
              background:
                row.rsvp === "yes"
                  ? "color-mix(in srgb, var(--color-green-500, #22c55e) 18%, transparent)"
                  : row.rsvp === "no"
                    ? "color-mix(in srgb, currentColor 8%, transparent)"
                    : "color-mix(in srgb, var(--color-gold-400) 20%, transparent)",
            }}
          >
            {row.rsvp}
          </span>
        ) : (
          // Someone on the list who has not answered is worth seeing, since the
          // coordinator chases them before the day rather than after.
          <span className="muted text-xs">No answer</span>
        ),
    },
  ]

  /** How many have answered, and how — the number that decides whether to chase. */
  const rsvpCounts = participants.reduce(
    (totals, participant) => {
      if (participant.rsvp === "yes") totals.yes += 1
      else if (participant.rsvp === "no") totals.no += 1
      else if (participant.rsvp === "maybe") totals.maybe += 1
      else totals.none += 1
      return totals
    },
    { yes: 0, no: 0, maybe: 0, none: 0 },
  )

  const songColumns: Column<EventSongRow>[] = [
    { key: "title", header: "Song", render: (row) => row.title },
    { key: "composer", header: "Composer", render: (row) => row.composer || <span className="muted">—</span> },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        canWrite ? (
          <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => setRemoveTarget(row)}>
            Remove
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Link to="/app/events" className="link flex w-fit items-center gap-1.5 text-sm">
        <ArrowLeft size={15} /> All events
      </Link>

      {detail.loading ? (
        <LoadingBlock label="Loading event…" rows={4} />
      ) : detail.error ? (
        <Card>
          <CardBody>
            <ErrorState title="Could not load this event" description={detail.error.message} />
          </CardBody>
        </Card>
      ) : !event ? (
        <Card>
          <CardBody>
            <EmptyState title="Event not found" description="This event may have been removed." />
          </CardBody>
        </Card>
      ) : (
        <>
          <PageHeader
            title={event.name}
            description={`${humanize(event.event_type)} · ${formatDate(event.date)}`}
            actions={
              canWrite ? (
                <>
                  <Button variant="outline" icon={<Pencil size={16} />} onClick={openEdit}>
                    Edit
                  </Button>
                  <Button variant="outline" icon={<UserPlus size={16} />} onClick={openParticipants}>
                    Participants
                  </Button>
                  <Button variant="gold" icon={<Link2 size={16} />} onClick={openSongs}>
                    Link songs
                  </Button>
                </>
              ) : null
            }
          />

          <Card>
            <CardHeader title="Details" description="The schedule and location for this event." />
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Status">
                <StatusBadge status={event.status} />
              </DetailRow>
              <DetailRow label="Type">{humanize(event.event_type)}</DetailRow>
              <DetailRow label="Date">{formatDate(event.date)}</DetailRow>
              <DetailRow label="Time">{formatTimeRange(event.start_time, event.end_time)}</DetailRow>
              <DetailRow label="Location">{event.location || "—"}</DetailRow>
              <DetailRow label="For">{audienceLabel}</DetailRow>
              <DetailRow label="Participants">{event.participant_count}</DetailRow>
              <DetailRow label="Contribution">
                {event.requires_contribution === 1 ? (
                  <span className="tabular-nums">
                    {formatAmount(event.contribution_amount)}
                    {event.contribution_due_date ? (
                      <span className="muted"> · by {formatDate(event.contribution_due_date)}</span>
                    ) : null}
                  </span>
                ) : (
                  "Free"
                )}
              </DetailRow>
              <DetailRow label="Public">{event.is_public === 1 ? "Yes" : "No"}</DetailRow>
              <DetailRow label="Created">{formatDate(event.created_at)}</DetailRow>
              {event.description ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <DetailRow label="Description">
                    <span className="whitespace-pre-wrap">{event.description}</span>
                  </DetailRow>
                </div>
              ) : null}
              {event.report ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <DetailRow label="Report">
                    <span className="whitespace-pre-wrap">{event.report}</span>
                  </DetailRow>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* A member's own answer, contribution and pass. An administrator has no
              member record, so this never appears for them. */}
          {isMember && !canApprove ? (
            <MyRsvp
              eventId={event.id}
              isPast={isPast}
              contribution={contribution}
              mine={contributions}
              myAnswer={participants.find((participant) => participant.member_id === myMemberId) ?? null}
              myPass={myPass}
              onChanged={() => detail.reload()}
            />
          ) : null}

          {/* The ledger and the door, for whoever runs the event. */}
          {canApprove && (contribution.required || contributions.length > 0 || passes.length > 0) ? (
            <EventContributionPanel
              eventId={event.id}
              eventName={event.name}
              eventDate={event.date}
              eventTime={event.start_time}
              eventLocation={event.location}
              summary={contribution}
              contributions={contributions}
              passes={passes}
              checkins={checkins}
              canApprove={canApprove}
              canCheckin={canCheckin}
              onChanged={() => detail.reload()}
            />
          ) : null}

          <Card>
            <CardHeader
              title="Participants"
              description={`${participants.length} member${participants.length === 1 ? "" : "s"} linked to this event · ${rsvpCounts.yes} coming, ${rsvpCounts.maybe} maybe, ${rsvpCounts.no} not coming, ${rsvpCounts.none} silent.`}
              actions={
                canWrite ? (
                  <Button variant="outline" size="sm" icon={<UserPlus size={14} />} onClick={openParticipants}>
                    Manage
                  </Button>
                ) : null
              }
            />
            <div className="px-5 py-4">
              <DataTable
                columns={participantColumns}
                rows={participants}
                rowKey={(row) => row.member_id}
                emptyTitle="No participants yet"
                emptyDescription="Add members to record who is taking part in this event."
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Songs"
              description={`${songs.length} song${songs.length === 1 ? "" : "s"} linked to this event.`}
              actions={
                canWrite ? (
                  <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={openSongs}>
                    Link songs
                  </Button>
                ) : null
              }
            />
            <div className="px-5 py-4">
              <DataTable
                columns={songColumns}
                rows={songs}
                rowKey={(row) => row.song_id}
                emptyTitle="No songs linked"
                emptyDescription="Link songs from the music library to plan this event's repertoire."
              />
            </div>
          </Card>

          <EventPhotoGallery
            eventId={event.id}
            photos={photos}
            canWrite={canWrite}
            isPublic={event.is_public === 1}
            onChanged={() => detail.reload()}
          />

          {/* The roll-call is the written door, so it belongs to whoever works
              the door — and to past events especially, where it is the record. */}
          {canCheckin ? <EventRollCall eventId={event.id} /> : null}
        </>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit event"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={update.saving}>
              Cancel
            </Button>
            <Button variant="gold" onClick={submitEdit} loading={update.saving}>
              Save changes
            </Button>
          </>
        }
      >
        {editForm ? (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitEdit}>
            <div className="sm:col-span-2">
              <Field label="Event name" htmlFor="edit-name" required error={update.error?.fields?.name}>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Type" htmlFor="edit-type" required error={update.error?.fields?.eventType}>
              <Select
                id="edit-type"
                value={editForm.eventType}
                onChange={(event) => setEditForm({ ...editForm, eventType: event.target.value })}
              >
                {EVENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="edit-date" required error={update.error?.fields?.date}>
              <Input
                id="edit-date"
                type="date"
                value={editForm.date}
                onChange={(event) => setEditForm({ ...editForm, date: event.target.value })}
                required
              />
            </Field>
            <Field label="Start time" htmlFor="edit-start" hint="24-hour, e.g. 18:30" error={update.error?.fields?.startTime}>
              <Input
                id="edit-start"
                type="time"
                value={editForm.startTime}
                onChange={(event) => setEditForm({ ...editForm, startTime: event.target.value })}
              />
            </Field>
            <Field label="End time" htmlFor="edit-end" hint="24-hour, e.g. 20:00" error={update.error?.fields?.endTime}>
              <Input
                id="edit-end"
                type="time"
                value={editForm.endTime}
                onChange={(event) => setEditForm({ ...editForm, endTime: event.target.value })}
              />
            </Field>
            <Field label="Location" htmlFor="edit-location" error={update.error?.fields?.location}>
              <Input
                id="edit-location"
                value={editForm.location}
                onChange={(event) => setEditForm({ ...editForm, location: event.target.value })}
              />
            </Field>
            <Field label="Target group" htmlFor="edit-group" error={update.error?.fields?.targetGroupId}>
              <Select
                id="edit-group"
                value={editForm.targetGroupId}
                onChange={(event) => setEditForm({ ...editForm, targetGroupId: event.target.value })}
              >
                <option value="">Whole choir</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="edit-status">
              <Select
                id="edit-status"
                value={editForm.status}
                onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
              >
                {EVENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="edit-description" error={update.error?.fields?.description}>
                <Textarea
                  id="edit-description"
                  value={editForm.description}
                  onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Report" htmlFor="edit-report" hint="A short summary recorded after the event." error={update.error?.fields?.report}>
                <Textarea
                  id="edit-report"
                  value={editForm.report}
                  onChange={(event) => setEditForm({ ...editForm, report: event.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                id="edit-public"
                type="checkbox"
                className="h-4 w-4"
                checked={editForm.isPublic}
                onChange={(event) => setEditForm({ ...editForm, isPublic: event.target.checked })}
              />
              <label htmlFor="edit-public" className="text-sm">
                Show on the public events list
              </label>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
        title="Event participants"
        description="Choose who is taking part. This replaces the current participant list."
        size="lg"
        footer={
          <>
            <span className="muted mr-auto text-sm">{selectedMembers.length} selected</span>
            <Button variant="ghost" onClick={() => setParticipantsOpen(false)} disabled={saveParticipants.saving}>
              Cancel
            </Button>
            <Button variant="gold" onClick={submitParticipants} loading={saveParticipants.saving}>
              Save participants
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Search members" htmlFor="participant-search">
            <Input
              id="participant-search"
              placeholder="Search by name or member number"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
          </Field>
          {!canReadMembers ? (
            <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
              You do not have permission to browse the member directory, so participants cannot be selected here.
            </div>
          ) : memberQuery.loading ? (
            <LoadingBlock label="Loading members…" rows={4} />
          ) : memberQuery.error ? (
            <ErrorState title="Could not load members" description={memberQuery.error.message} />
          ) : (memberQuery.data?.items ?? []).length === 0 ? (
            <EmptyState title="No members found" description="Try a different search term." />
          ) : (
            <ul className="max-h-80 overflow-y-auto rounded-xl border hairline">
              {(memberQuery.data?.items ?? []).map((member) => (
                <li key={member.id} className="border-b hairline last:border-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gold-400/10">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedMembers.includes(member.id)}
                      onChange={() => toggleMember(member.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{member.full_name}</span>
                      <span className="muted block text-xs">
                        {member.member_no} · {member.group_name}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal
        open={songsOpen}
        onClose={() => setSongsOpen(false)}
        title="Link songs"
        description="Attach songs from the music library to this event's repertoire."
        size="lg"
        footer={
          <>
            <span className="muted mr-auto text-sm">{selectedSongs.length} selected</span>
            <Button variant="ghost" onClick={() => setSongsOpen(false)} disabled={addSongs.saving}>
              Cancel
            </Button>
            <Button
              variant="gold"
              onClick={submitSongs}
              loading={addSongs.saving}
              disabled={selectedSongs.length === 0}
            >
              Link songs
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Search songs" htmlFor="song-search">
            <Input
              id="song-search"
              placeholder="Search by title or composer"
              value={songSearch}
              onChange={(event) => setSongSearch(event.target.value)}
            />
          </Field>
          {!canReadMusic ? (
            <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
              You do not have permission to browse the music library, so songs cannot be selected here.
            </div>
          ) : songQuery.loading ? (
            <LoadingBlock label="Loading songs…" rows={4} />
          ) : songQuery.error ? (
            <ErrorState title="Could not load songs" description={songQuery.error.message} />
          ) : (songQuery.data?.items ?? []).length === 0 ? (
            <EmptyState title="No songs found" description="Try a different search term." />
          ) : (
            <ul className="max-h-80 overflow-y-auto rounded-xl border hairline">
              {(songQuery.data?.items ?? []).map((song) => {
                const alreadyLinked = linkedSongIds.has(song.id)
                return (
                  <li key={song.id} className="border-b hairline last:border-0">
                    <label
                      className={`flex items-center gap-3 px-3 py-2 ${
                        alreadyLinked ? "opacity-60" : "cursor-pointer hover:bg-gold-400/10"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedSongs.includes(song.id)}
                        disabled={alreadyLinked}
                        onChange={() => toggleSong(song.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{song.title}</span>
                        <span className="muted block text-xs">
                          {song.composer || "Unknown composer"}
                          {alreadyLinked ? " · already linked" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove song"
        message={`Remove "${removeTarget?.title ?? "this song"}" from this event? The song stays in the music library.`}
        confirmLabel="Remove"
        tone="danger"
        loading={removeSong.saving}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={confirmRemoveSong}
      />
    </div>
  )
}
