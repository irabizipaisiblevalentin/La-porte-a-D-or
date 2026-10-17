import { useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  Archive,
  CalendarDays,
  FileAudio,
  Link2,
  ListMusic,
  Music4,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Users,
  Youtube,
} from "lucide-react"
import { api, ApiError, toQuery } from "../../api/client"
import { useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  ProgressBar,
  Select,
  StatusBadge,
  Textarea,
  useToast,
  humanize,
} from "../../components/ui"

// ---------------------------------------------------------------------------
// Types (mirror server/src/routes/songs.ts and videos schema)
// ---------------------------------------------------------------------------

interface Song {
  id: string
  title: string
  composer: string | null
  arranger: string | null
  language: string | null
  genre: string | null
  musical_key: string | null
  bpm: number | null
  time_signature: string | null
  difficulty: string | null
  choir_section: string | null
  description: string | null
  category_id: string | null
  learning_stage_id: string | null
  youtube_channel_id: string | null
  status: string
  admin_notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  category_key?: string | null
  category_name?: string | null
  stage_key?: string | null
  stage_name?: string | null
}

interface Video {
  id: string
  youtube_video_id: string
  title: string
  url: string
  thumbnail_url: string | null
  published_at: string | null
  channel_id: string | null
  channel_title: string | null
  discovery_category: string | null
  status: string
  song_id: string | null
  is_primary: number
  notes: string | null
  created_at: string
  updated_at: string
}

interface Lyric {
  id: string
  song_id: string
  section_type: string
  section_order: number
  content: string
  language: string | null
  rights_note: string | null
  created_at: string
  updated_at: string
}

interface SongAudio {
  id: string
  song_id: string
  label: string
  track_type: string
  file_path: string
  mime_type: string | null
  file_size: number | null
  duration_seconds: number | null
  rights_note: string | null
  is_authorized: number
  created_at: string
  file_id?: string | null
}

interface ProgressEntry {
  id: string
  song_id: string
  group_id: string | null
  from_stage_id: string | null
  to_stage_id: string
  progress_percent: number | null
  notes: string | null
  recorded_by: string | null
  created_at: string
  from_stage_key?: string | null
  from_stage_name?: string | null
  to_stage_key?: string | null
  to_stage_name?: string | null
}

interface Assignment {
  group_id: string
  group_key: string
  group_name: string
  assigned_at: string
  assigned_by: string | null
}

interface SongEvent {
  id: string
  name: string
  event_type: string
  date: string
  status: string
  added_at: string
}

interface TaxonomyItem {
  id: string
  key: string
  name: string
  sort_order: number
}

interface GroupItem {
  id: string
  key: string
  name: string
  description: string
  is_minor_group: number
}

interface Taxonomy {
  categories: TaxonomyItem[]
  stages: TaxonomyItem[]
  groups: GroupItem[]
}

interface SongDetail {
  song: Song
  videos: Video[]
  lyrics: Lyric[]
  audio: SongAudio[]
  progress: ProgressEntry[]
  assignments: Assignment[]
  events: SongEvent[]
}

interface QueueVideo {
  id: string
  youtube_video_id: string
  title: string
  url: string
  thumbnail_url: string | null
  published_at: string | null
  channel_title: string | null
  discovery_category: string | null
  status: string
  song_id: string | null
  is_primary: number
  song_title?: string | null
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const LYRIC_SECTIONS = ["intro", "verse", "chorus", "bridge", "interlude", "ending"] as const
const TRACK_TYPES = ["full", "soprano", "alto", "tenor", "bass", "instrumental", "practice", "metronome", "other"] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function orDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value)
}

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function embedUrl(videoId: string): string {
  // Always the official YouTube embed player. We never download, rehost or proxy media.
  return `https://www.youtube.com/embed/${videoId}`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SongDetailPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const toast = useToast()

  const detail = useQuery<SongDetail>(`/songs/${id}`)
  const taxonomy = useQuery<Taxonomy>("/songs/taxonomy")

  const [editOpen, setEditOpen] = useState(false)
  const [lyricEditing, setLyricEditing] = useState<Lyric | null | undefined>(undefined)
  const [audioOpen, setAudioOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [lyricToDelete, setLyricToDelete] = useState<Lyric | null>(null)
  const [audioToDelete, setAudioToDelete] = useState<SongAudio | null>(null)
  const [deleting, setDeleting] = useState(false)

  const data = detail.data
  const song = data?.song

  async function archiveSong() {
    if (!song) return
    setArchiving(true)
    try {
      await api.del(`/songs/${song.id}`)
      toast.success(`“${song.title}” was archived.`)
      setArchiveOpen(false)
      detail.reload()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not archive the song.")
    } finally {
      setArchiving(false)
    }
  }

  async function deleteLyric() {
    if (!song || !lyricToDelete) return
    setDeleting(true)
    try {
      await api.del(`/songs/${song.id}/lyrics/${lyricToDelete.id}`)
      toast.success("Lyric section removed.")
      setLyricToDelete(null)
      detail.reload()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not remove the lyric section.")
    } finally {
      setDeleting(false)
    }
  }

  async function deleteAudio() {
    if (!song || !audioToDelete) return
    setDeleting(true)
    try {
      await api.del(`/songs/${song.id}/audio/${audioToDelete.id}`)
      toast.success("Practice track removed.")
      setAudioToDelete(null)
      detail.reload()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not remove the practice track.")
    } finally {
      setDeleting(false)
    }
  }

  if (detail.loading && !data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Song" breadcrumbs={[{ label: "Music Library", to: "/app/music" }, { label: "Loading…" }]} />
        <LoadingBlock label="Loading song…" rows={5} />
      </div>
    )
  }

  if (detail.error || !song) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Song" breadcrumbs={[{ label: "Music Library", to: "/app/music" }, { label: "Not available" }]} />
        <Card>
          <CardBody>
            <EmptyState
              tone={detail.error ? "danger" : "neutral"}
              title={detail.error ? "Could not load this song" : "Song not found"}
              description={detail.error?.message ?? "That song does not exist or may have been removed."}
              action={
                <Link to="/app/music" className="btn btn-outline">
                  Back to the music library
                </Link>
              }
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  const canWrite = can("music.write")
  const canLyrics = can("music.lyrics.write")
  const canAudio = can("music.audio.write")
  const canProgress = can("music.progress.write")
  const canDiscovery = can("music.discovery")

  const latestProgress = data.progress.find((entry) => entry.progress_percent !== null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={song.title}
        description={[song.composer ? `Composed by ${song.composer}` : null, song.arranger ? `Arranged by ${song.arranger}` : null]
          .filter(Boolean)
          .join(" · ") || "Song catalogue entry"}
        breadcrumbs={[{ label: "Music Library", to: "/app/music" }, { label: song.title }]}
        actions={
          <>
            {canWrite ? (
              <Button variant="outline" icon={<Pencil size={16} />} onClick={() => setEditOpen(true)}>
                Edit details
              </Button>
            ) : null}
            {canWrite ? (
              <Button variant="outline" icon={<Link2 size={16} />} onClick={() => setLinkOpen(true)}>
                Link a video
              </Button>
            ) : null}
            {canWrite && song.status !== "archived" ? (
              <Button variant="danger" icon={<Archive size={16} />} onClick={() => setArchiveOpen(true)}>
                Archive
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={song.status} />
        {song.category_name ? <Badge tone="gold">{song.category_name}</Badge> : null}
        {song.stage_name ? <Badge tone="neutral">{humanize(song.stage_name)}</Badge> : <Badge tone="neutral">No stage set</Badge>}
        {song.difficulty ? <Badge tone="neutral">{humanize(song.difficulty)}</Badge> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Song details" description="Metadata recorded for this song. Blank fields are unknown." />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Meta label="Composer" value={orDash(song.composer)} />
              <Meta label="Arranger" value={orDash(song.arranger)} />
              <Meta label="Language" value={orDash(song.language)} />
              <Meta label="Genre" value={orDash(song.genre)} />
              <Meta label="Musical key" value={orDash(song.musical_key)} />
              <Meta label="Tempo" value={song.bpm ? `${song.bpm} BPM` : "—"} />
              <Meta label="Time signature" value={orDash(song.time_signature)} />
              <Meta label="Choir section" value={orDash(song.choir_section)} />
              <Meta label="Category" value={orDash(song.category_name)} />
              <Meta label="Learning stage" value={orDash(song.stage_name)} />
              <Meta label="Added" value={formatDate(song.created_at)} />
              <Meta label="Last updated" value={formatDate(song.updated_at)} />
            </dl>
            {song.description ? (
              <div className="mt-4 border-t hairline pt-4">
                <p className="muted text-xs font-medium uppercase tracking-wide">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{song.description}</p>
              </div>
            ) : null}
            {song.admin_notes ? (
              <div className="mt-4 rounded-xl border hairline px-3 py-2">
                <p className="muted text-xs font-medium uppercase tracking-wide">Internal notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{song.admin_notes}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Progress"
              description="Recorded learning-stage history."
              actions={
                canProgress ? (
                  <Button size="sm" variant="gold" icon={<Plus size={14} />} onClick={() => setProgressOpen(true)}>
                    Record
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="flex flex-col gap-3">
              {latestProgress?.progress_percent !== null && latestProgress?.progress_percent !== undefined ? (
                <ProgressBar value={latestProgress.progress_percent} />
              ) : null}
              {data.progress.length === 0 ? (
                <p className="muted text-sm">No progress has been recorded for this song yet.</p>
              ) : (
                <ul className="flex flex-col divide-y hairline">
                  {data.progress.slice(0, 8).map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {entry.from_stage_name ? `${entry.from_stage_name} → ` : ""}
                          {entry.to_stage_name ?? humanize(entry.to_stage_key ?? "stage")}
                        </span>
                        {entry.progress_percent !== null ? <span className="muted text-xs">{entry.progress_percent}%</span> : null}
                      </div>
                      <span className="muted text-xs">
                        {formatDateTime(entry.created_at)}
                        {entry.notes ? ` · ${entry.notes}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Group assignments"
              description="Which choirs are learning this song."
              actions={
                canWrite ? (
                  <Button size="sm" variant="outline" icon={<Users size={14} />} onClick={() => setGroupsOpen(true)}>
                    Manage
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="flex flex-wrap gap-1.5">
              {data.assignments.length === 0 ? (
                <p className="muted text-sm">This song is not assigned to any group yet.</p>
              ) : (
                data.assignments.map((assignment) => (
                  <Badge key={assignment.group_id} tone="gold">
                    {assignment.group_name}
                  </Badge>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Videos */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Youtube size={18} /> Videos
            </span>
          }
          description="Played through the official YouTube embedded player. Choir media is never downloaded or re-hosted."
          actions={
            canWrite ? (
              <Button size="sm" variant="outline" icon={<Link2 size={14} />} onClick={() => setLinkOpen(true)}>
                Link a video
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {data.videos.length === 0 ? (
            <EmptyState
              icon={<Youtube size={22} />}
              title="No videos linked yet"
              description={
                canDiscovery
                  ? "Videos come from the official YouTube channel through Discovery, or from a manual URL import. Once a video is approved there, link it to this song."
                  : "Videos are added from the official YouTube channel by an administrator. None are linked to this song yet."
              }
              action={
                canDiscovery ? (
                  <Link to="/app/discovery" className="btn btn-outline">
                    Open Discovery
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {data.videos.map((video) => (
                <div key={video.id} className="flex flex-col gap-2">
                  <div className="overflow-hidden rounded-xl border hairline">
                    <iframe
                      src={embedUrl(video.youtube_video_id)}
                      title={video.title}
                      className="aspect-video w-full"
                      loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={video.status} />
                    {video.is_primary ? <Badge tone="gold">Primary</Badge> : null}
                    {video.discovery_category ? <Badge tone="neutral">{humanize(video.discovery_category)}</Badge> : null}
                  </div>
                  <p className="text-sm font-medium">{video.title}</p>
                  <p className="muted text-xs">
                    {orDash(video.channel_title)} · {formatDate(video.published_at)}
                  </p>
                  <a href={video.url} target="_blank" rel="noreferrer noopener" className="link text-xs">
                    Watch on YouTube
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Lyrics */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ListMusic size={18} /> Lyrics
            </span>
          }
          description="Lyrics appear here only when an administrator has lawfully entered them for the choir."
          actions={
            canLyrics ? (
              <Button size="sm" variant="gold" icon={<Plus size={14} />} onClick={() => setLyricEditing(null)}>
                Add lyrics
              </Button>
            ) : undefined
          }
        />
        <CardBody className="flex flex-col gap-4">
          {data.lyrics.length === 0 ? (
            <EmptyState
              icon={<ListMusic size={22} />}
              title="No lyrics recorded"
              description="No authorised lyrics have been entered for this song. We never scrape or guess lyrics — they are added only when provided by an administrator."
            />
          ) : (
            data.lyrics.map((lyric) => (
              <div key={lyric.id} className="rounded-xl border hairline p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="gold">{humanize(lyric.section_type)}</Badge>
                    {lyric.language ? <Badge tone="neutral">{lyric.language}</Badge> : null}
                    {lyric.rights_note ? <span className="muted text-xs">Rights: {lyric.rights_note}</span> : null}
                  </div>
                  {canLyrics ? (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setLyricEditing(lyric)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setLyricToDelete(lyric)}>
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{lyric.content}</p>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {/* Audio */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <FileAudio size={18} /> Practice tracks
            </span>
          }
          description="Private, authorised practice audio stored by the choir. Streamed to signed-in members only."
          actions={
            canAudio ? (
              <Button size="sm" variant="gold" icon={<Upload size={14} />} onClick={() => setAudioOpen(true)}>
                Upload track
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {data.audio.length === 0 ? (
            <EmptyState
              icon={<FileAudio size={22} />}
              title="No practice tracks"
              description="No authorised audio has been uploaded for this song. Only upload audio the choir has the rights to use."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.audio.map((track) => (
                <li key={track.id} className="flex flex-col gap-2 rounded-xl border hairline p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{track.label}</span>
                      <Badge tone="neutral">{humanize(track.track_type)}</Badge>
                      {track.is_authorized ? <Badge tone="positive">Authorised</Badge> : <Badge tone="warn">Rights unconfirmed</Badge>}
                    </div>
                    {canAudio ? (
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setAudioToDelete(track)}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                  <p className="muted text-xs">
                    {formatBytes(track.file_size)}
                    {track.rights_note ? ` · Rights: ${track.rights_note}` : ""}
                  </p>
                  {track.file_id ? (
                    <audio controls preload="none" src={`/api/files/${track.file_id}`} className="w-full">
                      Your browser does not support audio playback.
                    </audio>
                  ) : (
                    <p className="muted text-xs">This track&rsquo;s file is no longer available.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Events */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <CalendarDays size={18} /> Performance history
            </span>
          }
          description="Events where this song has been included."
        />
        <CardBody>
          {data.events.length === 0 ? (
            <p className="muted text-sm">This song has not been added to any event yet.</p>
          ) : (
            <ul className="flex flex-col divide-y hairline">
              {data.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-col">
                    <Link to={`/app/events/${event.id}`} className="link text-sm font-medium">
                      {event.name}
                    </Link>
                    <span className="muted text-xs">
                      {humanize(event.event_type)} · {formatDate(event.date)}
                    </span>
                  </div>
                  <StatusBadge status={event.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {editOpen ? (
        <EditSongModal
          song={song}
          taxonomy={taxonomy.data}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setEditOpen(false)
            toast.success(`“${updated.title}” was updated.`)
            detail.reload()
          }}
        />
      ) : null}

      {lyricEditing !== undefined ? (
        <LyricModal
          songId={song.id}
          lyric={lyricEditing}
          onClose={() => setLyricEditing(undefined)}
          onSaved={() => {
            setLyricEditing(undefined)
            toast.success(lyricEditing ? "Lyrics updated." : "Lyrics added.")
            detail.reload()
          }}
        />
      ) : null}

      {audioOpen ? (
        <AudioModal
          songId={song.id}
          onClose={() => setAudioOpen(false)}
          onUploaded={() => {
            setAudioOpen(false)
            toast.success("Practice track uploaded.")
            detail.reload()
          }}
        />
      ) : null}

      {progressOpen ? (
        <ProgressModal
          songId={song.id}
          taxonomy={taxonomy.data}
          onClose={() => setProgressOpen(false)}
          onSaved={() => {
            setProgressOpen(false)
            toast.success("Progress recorded.")
            detail.reload()
          }}
        />
      ) : null}

      {groupsOpen ? (
        <GroupsModal
          songId={song.id}
          taxonomy={taxonomy.data}
          selected={data.assignments.map((assignment) => assignment.group_id)}
          onClose={() => setGroupsOpen(false)}
          onSaved={() => {
            setGroupsOpen(false)
            toast.success("Group assignments updated.")
            detail.reload()
          }}
        />
      ) : null}

      {linkOpen ? (
        <LinkVideoModal
          songId={song.id}
          canDiscovery={canDiscovery}
          onClose={() => setLinkOpen(false)}
          onLinked={() => {
            setLinkOpen(false)
            toast.success("Video linked to this song.")
            detail.reload()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={archiveOpen}
        title="Archive this song?"
        message={`“${song.title}” will be archived and hidden from the active catalogue. Its videos, lyrics, audio and history are kept.`}
        confirmLabel="Archive"
        tone="danger"
        loading={archiving}
        onConfirm={() => void archiveSong()}
        onCancel={() => setArchiveOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(lyricToDelete)}
        title="Delete this lyric section?"
        message="This permanently removes the lyric section from the song."
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
        onConfirm={() => void deleteLyric()}
        onCancel={() => setLyricToDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(audioToDelete)}
        title="Delete this practice track?"
        message="The uploaded audio file is removed permanently."
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
        onConfirm={() => void deleteAudio()}
        onCancel={() => setAudioToDelete(null)}
      />

      {!canWrite ? (
        <p className="muted flex items-center gap-2 text-xs">
          <Music4 size={14} />
          You have read-only access to this song. Contact the Chairman to make changes.
        </p>
      ) : null}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="muted text-xs font-medium uppercase tracking-wide">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit song modal
// ---------------------------------------------------------------------------

interface EditFormState {
  title: string
  composer: string
  arranger: string
  language: string
  genre: string
  musicalKey: string
  bpm: string
  timeSignature: string
  difficulty: string
  choirSection: string
  categoryId: string
  stageId: string
  description: string
  adminNotes: string
  status: string
}

function EditSongModal({
  song,
  taxonomy,
  onClose,
  onSaved,
}: {
  song: Song
  taxonomy: Taxonomy | null
  onClose: () => void
  onSaved: (song: Song) => void
}) {
  const [form, setForm] = useState<EditFormState>({
    title: song.title,
    composer: song.composer ?? "",
    arranger: song.arranger ?? "",
    language: song.language ?? "",
    genre: song.genre ?? "",
    musicalKey: song.musical_key ?? "",
    bpm: song.bpm ? String(song.bpm) : "",
    timeSignature: song.time_signature ?? "",
    difficulty: song.difficulty ?? "",
    choirSection: song.choir_section ?? "",
    categoryId: song.category_id ?? "",
    stageId: song.learning_stage_id ?? "",
    description: song.description ?? "",
    adminNotes: song.admin_notes ?? "",
    status: song.status,
  })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [duplicate, setDuplicate] = useState(false)

  const update = (key: keyof EditFormState) => (value: string) => setForm((current) => ({ ...current, [key]: value }))

  async function save(force: boolean) {
    setError(null)
    setFields({})
    if (!form.title.trim()) {
      setFields({ title: "Enter the song title." })
      return
    }
    const bpm = form.bpm.trim() ? Number(form.bpm.trim()) : null
    setSaving(true)
    try {
      const result = await api.patch<{ song: Song }>(`/songs/${song.id}`, {
        title: form.title.trim(),
        composer: toNullable(form.composer),
        arranger: toNullable(form.arranger),
        language: toNullable(form.language),
        genre: toNullable(form.genre),
        musicalKey: toNullable(form.musicalKey),
        bpm: bpm !== null && Number.isFinite(bpm) ? Math.trunc(bpm) : null,
        timeSignature: toNullable(form.timeSignature),
        difficulty: form.difficulty ? form.difficulty : null,
        choirSection: toNullable(form.choirSection),
        categoryId: toNullable(form.categoryId),
        stageId: toNullable(form.stageId),
        description: toNullable(form.description),
        adminNotes: toNullable(form.adminNotes),
        status: form.status,
        ...(force ? { force: true } : {}),
      })
      onSaved(result.song)
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === "conflict") setDuplicate(true)
        else {
          setError(caught.message)
          setFields(caught.fields ?? {})
        }
      } else {
        setError("Could not save the song.")
      }
    } finally {
      setSaving(false)
    }
  }

  if (duplicate) {
    return (
      <Modal
        open
        onClose={() => setDuplicate(false)}
        title="A similar song already exists"
        description="Another active song has a similar title."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDuplicate(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="gold" loading={saving} onClick={() => void save(true)}>
              Save anyway
            </Button>
          </>
        }
      >
        <p className="text-sm">Titles are compared ignoring accents, case and punctuation. Save “{form.title.trim()}” anyway?</p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit song details"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" type="submit" form="edit-song-form" loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        id="edit-song-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save(false)
        }}
      >
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}

        <Field label="Title" htmlFor="edit-title" required error={fields.title}>
          <Input id="edit-title" value={form.title} onChange={(event) => update("title")(event.target.value)} invalid={Boolean(fields.title)} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Composer" htmlFor="edit-composer">
            <Input id="edit-composer" value={form.composer} onChange={(event) => update("composer")(event.target.value)} />
          </Field>
          <Field label="Arranger" htmlFor="edit-arranger">
            <Input id="edit-arranger" value={form.arranger} onChange={(event) => update("arranger")(event.target.value)} />
          </Field>
          <Field label="Category" htmlFor="edit-category">
            <Select id="edit-category" value={form.categoryId} onChange={(event) => update("categoryId")(event.target.value)}>
              <option value="">Not categorised</option>
              {(taxonomy?.categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Learning stage" htmlFor="edit-stage" hint="Use Record progress to move through stages with a history entry.">
            <Select id="edit-stage" value={form.stageId} onChange={(event) => update("stageId")(event.target.value)}>
              <option value="">Not set</option>
              {(taxonomy?.stages ?? []).map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language" htmlFor="edit-language">
            <Input id="edit-language" value={form.language} onChange={(event) => update("language")(event.target.value)} />
          </Field>
          <Field label="Genre" htmlFor="edit-genre">
            <Input id="edit-genre" value={form.genre} onChange={(event) => update("genre")(event.target.value)} />
          </Field>
          <Field label="Difficulty" htmlFor="edit-difficulty">
            <Select id="edit-difficulty" value={form.difficulty} onChange={(event) => update("difficulty")(event.target.value)}>
              <option value="">Not set</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Select>
          </Field>
          <Field label="Choir section" htmlFor="edit-section">
            <Input id="edit-section" value={form.choirSection} onChange={(event) => update("choirSection")(event.target.value)} />
          </Field>
          <Field label="Musical key" htmlFor="edit-key">
            <Input id="edit-key" value={form.musicalKey} onChange={(event) => update("musicalKey")(event.target.value)} />
          </Field>
          <Field label="Time signature" htmlFor="edit-time">
            <Input id="edit-time" value={form.timeSignature} onChange={(event) => update("timeSignature")(event.target.value)} />
          </Field>
          <Field label="Tempo (BPM)" htmlFor="edit-bpm" error={fields.bpm}>
            <Input id="edit-bpm" type="number" min={1} max={400} value={form.bpm} onChange={(event) => update("bpm")(event.target.value)} invalid={Boolean(fields.bpm)} />
          </Field>
          <Field label="Status" htmlFor="edit-status">
            <Select id="edit-status" value={form.status} onChange={(event) => update("status")(event.target.value)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
        </div>

        <Field label="Description" htmlFor="edit-description">
          <Textarea id="edit-description" value={form.description} onChange={(event) => update("description")(event.target.value)} />
        </Field>
        <Field label="Internal notes" htmlFor="edit-admin" hint="Only visible to administrators.">
          <Textarea id="edit-admin" value={form.adminNotes} onChange={(event) => update("adminNotes")(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Lyric modal (add or edit)
// ---------------------------------------------------------------------------

function LyricModal({
  songId,
  lyric,
  onClose,
  onSaved,
}: {
  songId: string
  lyric: Lyric | null
  onClose: () => void
  onSaved: () => void
}) {
  const [sectionType, setSectionType] = useState<string>(lyric?.section_type ?? "verse")
  const [sectionOrder, setSectionOrder] = useState<string>(lyric ? String(lyric.section_order) : "0")
  const [content, setContent] = useState(lyric?.content ?? "")
  const [language, setLanguage] = useState(lyric?.language ?? "")
  const [rightsNote, setRightsNote] = useState(lyric?.rights_note ?? "")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    if (!content.trim()) {
      setFields({ content: "Enter the lyrics." })
      return
    }
    setSaving(true)
    const payload = {
      sectionType,
      sectionOrder: Number(sectionOrder) || 0,
      content,
      language: toNullable(language),
      rightsNote: toNullable(rightsNote),
    }
    try {
      if (lyric) await api.patch(`/songs/${songId}/lyrics/${lyric.id}`, payload)
      else await api.post(`/songs/${songId}/lyrics`, payload)
      onSaved()
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Could not save the lyrics.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={lyric ? "Edit lyric section" : "Add lyrics"}
      description="Enter only lyrics the choir is lawfully able to use. A rights note is encouraged."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" type="submit" form="lyric-form" loading={saving}>
            {lyric ? "Save lyrics" : "Add lyrics"}
          </Button>
        </>
      }
    >
      <form id="lyric-form" className="flex flex-col gap-4" onSubmit={submit}>
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Section" htmlFor="lyric-section">
            <Select id="lyric-section" value={sectionType} onChange={(event) => setSectionType(event.target.value)}>
              {LYRIC_SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {humanize(section)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order" htmlFor="lyric-order" hint="Lower numbers appear first.">
            <Input id="lyric-order" type="number" min={0} value={sectionOrder} onChange={(event) => setSectionOrder(event.target.value)} />
          </Field>
        </div>
        <Field label="Lyrics" htmlFor="lyric-content" required error={fields.content}>
          <Textarea
            id="lyric-content"
            rows={8}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            invalid={Boolean(fields.content)}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Language" htmlFor="lyric-language">
            <Input id="lyric-language" value={language} onChange={(event) => setLanguage(event.target.value)} />
          </Field>
          <Field label="Rights note" htmlFor="lyric-rights" hint="For example: public domain, licensed, or permission granted.">
            <Input id="lyric-rights" value={rightsNote} onChange={(event) => setRightsNote(event.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Audio upload modal
// ---------------------------------------------------------------------------

function AudioModal({ songId, onClose, onUploaded }: { songId: string; onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState("")
  const [trackType, setTrackType] = useState<string>("full")
  const [rightsNote, setRightsNote] = useState("")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    if (!file) {
      setFields({ file: "Choose an audio file to upload." })
      return
    }
    if (!label.trim()) {
      setFields({ label: "Enter a label for this track." })
      return
    }
    setSaving(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("label", label.trim())
      form.append("trackType", trackType)
      if (rightsNote.trim()) form.append("rightsNote", rightsNote.trim())
      await api.upload(`/songs/${songId}/audio`, form)
      onUploaded()
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Could not upload the track.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload a practice track"
      description="Only upload audio the choir is authorised to use."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" type="submit" form="audio-form" loading={saving}>
            Upload
          </Button>
        </>
      }
    >
      <form id="audio-form" className="flex flex-col gap-4" onSubmit={submit}>
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}
        <Field label="Audio file" htmlFor="audio-file" required error={fields.file} hint="MP3, WAV or similar.">
          <input
            id="audio-file"
            type="file"
            accept="audio/*"
            className="field"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            aria-invalid={fields.file ? "true" : undefined}
          />
        </Field>
        <Field label="Label" htmlFor="audio-label" required error={fields.label}>
          <Input id="audio-label" value={label} onChange={(event) => setLabel(event.target.value)} invalid={Boolean(fields.label)} required />
        </Field>
        <Field label="Track type" htmlFor="audio-type">
          <Select id="audio-type" value={trackType} onChange={(event) => setTrackType(event.target.value)}>
            {TRACK_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rights note" htmlFor="audio-rights" hint="Explain the basis for using this recording.">
          <Input id="audio-rights" value={rightsNote} onChange={(event) => setRightsNote(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Progress modal
// ---------------------------------------------------------------------------

function ProgressModal({
  songId,
  taxonomy,
  onClose,
  onSaved,
}: {
  songId: string
  taxonomy: Taxonomy | null
  onClose: () => void
  onSaved: () => void
}) {
  const [stageId, setStageId] = useState("")
  const [groupId, setGroupId] = useState("")
  const [progressPercent, setProgressPercent] = useState("")
  const [notes, setNotes] = useState("")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    if (!stageId) {
      setFields({ stageId: "Choose a learning stage." })
      return
    }
    const percent = progressPercent.trim() ? Number(progressPercent.trim()) : null
    setSaving(true)
    try {
      await api.post(`/songs/${songId}/progress`, {
        stageId,
        groupId: toNullable(groupId),
        progressPercent: percent !== null && Number.isFinite(percent) ? Math.trunc(percent) : null,
        notes: toNullable(notes),
      })
      onSaved()
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Could not record progress.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record progress"
      description="Moves the song to a new learning stage and records a history entry."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" type="submit" form="progress-form" loading={saving}>
            Record
          </Button>
        </>
      }
    >
      <form id="progress-form" className="flex flex-col gap-4" onSubmit={submit}>
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}
        <Field label="New learning stage" htmlFor="progress-stage" required error={fields.stageId}>
          <Select id="progress-stage" value={stageId} onChange={(event) => setStageId(event.target.value)} invalid={Boolean(fields.stageId)} required>
            <option value="">Choose a stage</option>
            {(taxonomy?.stages ?? []).map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Group" htmlFor="progress-group" hint="Optional — for group-specific progress.">
            <Select id="progress-group" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="">All groups</option>
              {(taxonomy?.groups ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Progress" htmlFor="progress-percent" hint="Optional percentage, 0–100." error={fields.progressPercent}>
            <Input
              id="progress-percent"
              type="number"
              min={0}
              max={100}
              value={progressPercent}
              onChange={(event) => setProgressPercent(event.target.value)}
              invalid={Boolean(fields.progressPercent)}
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="progress-notes">
          <Textarea id="progress-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Groups modal
// ---------------------------------------------------------------------------

function GroupsModal({
  songId,
  taxonomy,
  selected,
  onClose,
  onSaved,
}: {
  songId: string
  taxonomy: Taxonomy | null
  selected: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [groupIds, setGroupIds] = useState<string[]>(selected)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function toggle(id: string) {
    setGroupIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      await api.post(`/songs/${songId}/groups`, { groupIds })
      onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update group assignments.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign groups"
      description="Choose which choirs are learning this song. This replaces the current assignments."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" loading={saving} onClick={() => void save()}>
            Save assignments
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}
        {(taxonomy?.groups ?? []).length === 0 ? (
          <p className="muted text-sm">No groups are available.</p>
        ) : (
          (taxonomy?.groups ?? []).map((group) => (
            <label key={group.id} className="flex cursor-pointer items-start gap-3 rounded-xl border hairline px-3 py-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={groupIds.includes(group.id)}
                onChange={() => toggle(group.id)}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{group.name}</span>
                <span className="muted text-xs">{group.description}</span>
              </span>
            </label>
          ))
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Link video modal
// ---------------------------------------------------------------------------

function LinkVideoModal({
  songId,
  canDiscovery,
  onClose,
  onLinked,
}: {
  songId: string
  canDiscovery: boolean
  onClose: () => void
  onLinked: () => void
}) {
  const queuePath = canDiscovery ? `/discovery/queue${toQuery({ status: "discovered", pageSize: 50 })}` : null
  const queue = useQuery<Page<QueueVideo>>(queuePath)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function link(videoId: string) {
    setError(null)
    setLinkingId(videoId)
    try {
      await api.post(`/songs/${songId}/videos/${videoId}/link`)
      onLinked()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not link the video.")
    } finally {
      setLinkingId(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Link a video"
      description="Approve a discovered video and attach it to this song. Playback always uses the official YouTube player."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}

        {!canDiscovery ? (
          <EmptyState
            icon={<Youtube size={22} />}
            title="Discovery access required"
            description="Videos are discovered and imported from the Discovery page. Ask an administrator with YouTube discovery access to import the video, then link it here."
          />
        ) : queue.loading ? (
          <LoadingBlock label="Loading discovered videos…" rows={3} />
        ) : queue.error ? (
          <EmptyState tone="danger" title="Could not load discovered videos" description={queue.error.message} />
        ) : (queue.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={<Youtube size={22} />}
            title="No discovered videos waiting"
            description="There are no unlinked videos in the discovery queue. Run discovery or import a video URL from the Discovery page first."
          />
        ) : (
          <ul className="flex max-h-[26rem] flex-col divide-y hairline overflow-y-auto">
            {(queue.data?.items ?? []).map((video) => (
              <li key={video.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {video.thumbnail_url ? (
                    <img src={video.thumbnail_url} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg border hairline">
                      <Youtube size={18} className="opacity-50" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{video.title}</p>
                    <p className="muted truncate text-xs">
                      {orDash(video.channel_title)} · {formatDate(video.published_at)}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="gold" loading={linkingId === video.id} onClick={() => void link(video.id)}>
                  Link
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
