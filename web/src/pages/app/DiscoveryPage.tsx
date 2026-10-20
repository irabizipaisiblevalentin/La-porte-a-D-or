import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  BadgeCheck,
  Compass,
  Download,
  Play,
  RefreshCw,
  Search,
  Settings,
  Youtube,
} from "lucide-react"
import { api, ApiError, toQuery } from "../../api/client"
import { useQuery, useDebounced } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Textarea,
  VideoPlayerModal,
  VideoThumbnail,
  useToast,
  humanize,
  type Column,
} from "../../components/ui"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveryRun {
  id: string
  integration: string
  trigger: string
  status: string
  summary: string | null
  detail: string | null
  startedAt: string
  finishedAt: string | null
}

interface DiscoveryChannel {
  id: string
  title: string | null
  verifiedAt: string | null
}

interface DiscoveryStatus {
  apiConfigured: boolean
  channel: DiscoveryChannel | null
  lastRun: DiscoveryRun | null
}

interface ChannelCandidate {
  id: string
  title: string
  description: string
  customUrl: string | null
  thumbnail: string | null
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
  song_title?: string | null
}

interface Song {
  id: string
  title: string
  composer: string | null
  category_name?: string | null
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const DISCOVERY_CATEGORIES = [
  "official_performance",
  "full_choir",
  "live_performance",
  "rehearsal",
  "song_tutorial",
  "section_practice",
  "instrumental_backing",
  "other_choir_music",
] as const

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

function orDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : value
}

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DiscoveryPage() {
  const { can } = useAuth()
  const toast = useToast()

  const status = useQuery<DiscoveryStatus>("/discovery/status")
  const configured = status.data?.apiConfigured ?? false
  const channel = status.data?.channel ?? null

  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search, 300)
  const [queueStatus, setQueueStatus] = useState("")
  const [category, setCategory] = useState("")
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, queueStatus, category])

  const queuePath = `/discovery/queue${toQuery({ search: debouncedSearch, status: queueStatus, category, page })}`
  const queue = useQuery<Page<Video>>(queuePath)

  const [importOpen, setImportOpen] = useState(false)
  const [reviewVideo, setReviewVideo] = useState<Video | null>(null)
  const [rejectVideo, setRejectVideo] = useState<Video | null>(null)
  /** The queue video open in the preview player; null when nothing is playing. */
  const [watchingVideo, setWatchingVideo] = useState<Video | null>(null)
  const [rejecting, setRejecting] = useState(false)

  async function rejectVideoNow() {
    if (!rejectVideo) return
    setRejecting(true)
    try {
      await api.post(`/discovery/videos/${rejectVideo.id}/reject`)
      toast.success("Video rejected.")
      setRejectVideo(null)
      queue.reload()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not reject the video.")
    } finally {
      setRejecting(false)
    }
  }

  const canWrite = can("music.write")

  const columns: Column<Video>[] = [
    {
      key: "video",
      header: "Video",
      render: (row) => (
        <div className="flex min-w-[14rem] items-center gap-3">
          <button
            type="button"
            onClick={() => setWatchingVideo(row)}
            className="group w-20 shrink-0 overflow-hidden rounded-lg border hairline"
            aria-label={`Preview ${row.title}`}
          >
            <VideoThumbnail videoId={row.youtube_video_id} title={row.title} thumbnailUrl={row.thumbnail_url} />
          </button>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.title}</p>
            <p className="muted truncate text-xs">
              {orDash(row.channel_title)} · {formatDate(row.published_at)}
            </p>
            <button type="button" className="link text-xs" onClick={() => setWatchingVideo(row)}>
              Preview
            </button>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row) => (row.discovery_category ? <Badge tone="neutral">{humanize(row.discovery_category)}</Badge> : <span className="muted text-xs">Unclassified</span>),
    },
    {
      key: "song",
      header: "Linked song",
      render: (row) => (row.song_title ? <span className="text-sm">{row.song_title}</span> : <span className="muted text-xs">Not linked</span>),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.status} />
          {row.is_primary ? <Badge tone="gold">Primary</Badge> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <a href={row.url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm" aria-label="Open on YouTube">
            <Youtube size={15} />
          </a>
          <Button size="sm" variant="ghost" icon={<Play size={14} fill="currentColor" />} onClick={() => setWatchingVideo(row)}>
            Play
          </Button>
          {canWrite ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setReviewVideo(row)}>
                Review
              </Button>
              <Button size="sm" variant="danger" onClick={() => setRejectVideo(row)}>
                Reject
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Discovery"
        description="Find and review choir media from the official YouTube channel. Videos are always played through the official YouTube embed — never downloaded or re-hosted."
        breadcrumbs={[{ label: "Overview", to: "/app" }, { label: "Discovery" }]}
        actions={
          <Button variant="outline" icon={<RefreshCw size={16} />} onClick={() => status.reload()} loading={status.loading}>
            Refresh status
          </Button>
        }
      />

      {status.loading && !status.data ? (
        <LoadingBlock label="Checking YouTube integration…" rows={2} />
      ) : status.error ? (
        <Card>
          <CardBody>
            <EmptyState
              tone="danger"
              title="Could not load discovery status"
              description={status.error.message}
              action={
                <Button variant="outline" onClick={() => status.reload()}>
                  Try again
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {!configured ? <AwaitingSetupCard onImported={() => queue.reload()} /> : null}

          {configured ? (
            <ChannelTools
              channel={channel}
              onVerified={() => {
                status.reload()
                queue.reload()
              }}
              onRan={() => {
                status.reload()
                queue.reload()
              }}
            />
          ) : null}
        </>
      )}

      {/* Review queue */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Compass size={18} /> Review queue
            </span>
          }
          description="Discovered videos awaiting review. Nothing is approved automatically."
          actions={
            <Button variant="gold" size="sm" icon={<Download size={14} />} onClick={() => setImportOpen(true)}>
              Import by URL
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Search" htmlFor="queue-search">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
                <Input
                  id="queue-search"
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title or channel"
                />
              </div>
            </Field>
            <Field label="Status" htmlFor="queue-status">
              <Select id="queue-status" value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)}>
                <option value="">All statuses</option>
                <option value="discovered">Discovered</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </Select>
            </Field>
            <Field label="Category" htmlFor="queue-category">
              <Select id="queue-category" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {DISCOVERY_CATEGORIES.map((key) => (
                  <option key={key} value={key}>
                    {humanize(key)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {queue.error ? (
            <EmptyState
              tone="danger"
              title="Could not load the review queue"
              description={queue.error.message}
              action={
                <Button variant="outline" onClick={() => queue.reload()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={queue.data?.items ?? []}
                rowKey={(row) => row.id}
                loading={queue.loading}
                emptyTitle={configured ? "No videos in the queue" : "No videos yet"}
                emptyDescription={
                  configured
                    ? "Run discovery to pull recent uploads from the verified channel, or import a video by URL."
                    : "The YouTube API is not configured, so no videos have been discovered. Import a video by URL, or add the API key in Settings → Integrations."
                }
                emptyAction={
                  <Button variant="outline" icon={<Download size={14} />} onClick={() => setImportOpen(true)}>
                    Import by URL
                  </Button>
                }
                caption="Approve, classify and link discovered videos to songs."
              />
              <Pagination
                page={queue.data?.page ?? page}
                pageCount={queue.data?.pageCount ?? 1}
                total={queue.data?.total}
                onChange={setPage}
              />
            </>
          )}
        </CardBody>
      </Card>

      {importOpen ? (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={(title) => {
            setImportOpen(false)
            toast.success(`Imported “${title}”.`)
            queue.reload()
          }}
        />
      ) : null}

      {reviewVideo ? (
        <ReviewModal
          video={reviewVideo}
          onClose={() => setReviewVideo(null)}
          onSaved={() => {
            setReviewVideo(null)
            toast.success("Video updated.")
            queue.reload()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(rejectVideo)}
        title="Reject this video?"
        message={`“${rejectVideo?.title ?? ""}” will be marked as rejected and kept for the record.`}
        confirmLabel="Reject"
        tone="danger"
        loading={rejecting}
        onConfirm={() => void rejectVideoNow()}
        onCancel={() => setRejectVideo(null)}
      />

      {watchingVideo ? (
        <VideoPlayerModal
          open
          onClose={() => setWatchingVideo(null)}
          videoId={watchingVideo.youtube_video_id}
          title={watchingVideo.title}
          meta={[watchingVideo.channel_title, formatDate(watchingVideo.published_at)].filter(Boolean).join(" · ")}
          url={watchingVideo.url}
          footer={
            canWrite ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setReviewVideo(watchingVideo)
                  setWatchingVideo(null)
                }}
              >
                Review this video
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Awaiting setup
// ---------------------------------------------------------------------------

function AwaitingSetupCard({ onImported }: { onImported: () => void }) {
  const [importOpen, setImportOpen] = useState(false)
  return (
    <Card className="border-gold-400/40 bg-gold-400/5">
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-400/15 text-gold-600 dark:text-gold-300">
            <AlertTriangle size={22} />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">YouTube discovery is awaiting setup</h2>
            <p className="muted max-w-2xl text-sm">
              The official YouTube Data API key has not been configured, so channel and video discovery cannot run yet.
              Nothing is fabricated — the queue stays empty until setup is complete.
            </p>
          </div>
        </div>

        <ol className="muted flex flex-col gap-2 text-sm">
          <li className="flex items-start gap-2">
            <span className="font-semibold text-gold-600 dark:text-gold-300">1.</span>
            <span>
              An administrator adds the YouTube Data API key under{" "}
              <Link to="/app/settings" className="link">
                Settings → Integrations
              </Link>
              .
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-semibold text-gold-600 dark:text-gold-300">2.</span>
            <span>Return here to verify the official channel, then run discovery.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-semibold text-gold-600 dark:text-gold-300">3.</span>
            <span>Until then, you can still import individual videos by URL — that works without a key.</span>
          </li>
        </ol>

        <div className="flex flex-wrap gap-2">
          <Link to="/app/settings" className="btn btn-outline">
            <Settings size={16} /> Open Settings
          </Link>
          <Button variant="gold" icon={<Download size={16} />} onClick={() => setImportOpen(true)}>
            Import a video by URL
          </Button>
        </div>
      </CardBody>

      {importOpen ? (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false)
            onImported()
          }}
        />
      ) : null}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Channel tools (only rendered when the API key is configured)
// ---------------------------------------------------------------------------

function ChannelTools({ channel, onVerified, onRan }: { channel: DiscoveryChannel | null; onVerified: () => void; onRan: () => void }) {
  const { can } = useAuth()
  const toast = useToast()

  const [term, setTerm] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [maxResults, setMaxResults] = useState("25")
  const [includePlaylists, setIncludePlaylists] = useState(false)

  const channelsPath = submitted ? `/discovery/channels${toQuery({ q: submitted })}` : null
  const channels = useQuery<{ configured: boolean; candidates: ChannelCandidate[]; message?: string }>(channelsPath)

  async function verify(candidate: ChannelCandidate) {
    setVerifyingId(candidate.id)
    try {
      await api.post("/discovery/verify-channel", { channelId: candidate.id, title: candidate.title })
      toast.success(`Official channel set to “${candidate.title}”.`)
      onVerified()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not verify the channel.")
    } finally {
      setVerifyingId(null)
    }
  }

  async function run() {
    setRunning(true)
    try {
      const result = await api.post<{ fetched: number; inserted: number; updated: number }>("/discovery/run", {
        maxResults: Number(maxResults) || 25,
        includePlaylists,
      })
      toast.success(`Discovery finished: ${result.fetched} checked, ${result.inserted} new, ${result.updated} refreshed.`)
      onRan()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Discovery could not run.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Youtube size={18} /> Official channel & discovery
          </span>
        }
        description="Verify the choir's official YouTube channel, then pull recent uploads into the review queue."
      />
      <CardBody className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border hairline px-3 py-2">
          {channel ? (
            <>
              <BadgeCheck size={16} className="text-gold-600 dark:text-gold-300" />
              <span className="text-sm">
                Official channel: <span className="font-medium">{orDash(channel.title)}</span>
              </span>
              <span className="muted text-xs">
                {channel.id} · verified {formatDate(channel.verifiedAt)}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle size={16} className="text-gold-600 dark:text-gold-300" />
              <span className="text-sm">No official channel verified yet. Search below to find and verify it.</span>
            </>
          )}
        </div>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(term.trim())
          }}
        >
          <div className="w-full min-w-0 sm:w-auto sm:min-w-[16rem] sm:flex-1">
            <Field label="Search YouTube channels" htmlFor="channel-search">
              <Input
                id="channel-search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Chorale La Porte d'Or"
              />
            </Field>
          </div>
          <Button type="submit" variant="outline" icon={<Search size={16} />} disabled={!term.trim()}>
            Search
          </Button>
        </form>

        {submitted ? (
          channels.loading ? (
            <LoadingBlock label="Searching YouTube…" rows={2} />
          ) : channels.error ? (
            <EmptyState tone="danger" title="Channel search failed" description={channels.error.message} />
          ) : channels.data?.message ? (
            <p className="muted text-sm">{channels.data.message}</p>
          ) : (channels.data?.candidates ?? []).length === 0 ? (
            <EmptyState icon={<Youtube size={22} />} title="No channels found" description="No public channels matched that search. Try a different name." />
          ) : (
            <ul className="flex flex-col divide-y hairline">
              {(channels.data?.candidates ?? []).map((candidate) => (
                <li key={candidate.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {candidate.thumbnail ? (
                      <img src={candidate.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border hairline">
                        <Youtube size={16} className="opacity-50" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{candidate.title}</p>
                      <p className="muted truncate text-xs">
                        {candidate.customUrl ? `${candidate.customUrl} · ` : ""}
                        {candidate.id}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="gold" loading={verifyingId === candidate.id} onClick={() => void verify(candidate)}>
                    Verify
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        <div className="border-t hairline pt-4">
          <p className="muted mb-3 text-xs font-medium uppercase tracking-wide">Run discovery</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32">
              <Field label="Max results" htmlFor="run-max">
                <Input id="run-max" type="number" min={1} max={50} value={maxResults} onChange={(event) => setMaxResults(event.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={includePlaylists} onChange={(event) => setIncludePlaylists(event.target.checked)} />
              Include playlists
            </label>
            <Button
              variant="gold"
              icon={<Play size={16} />}
              loading={running}
              disabled={!channel || !can("music.discovery")}
              onClick={() => void run()}
            >
              Run discovery
            </Button>
          </div>
          <p className="muted mt-2 text-xs">
            {channel
              ? "Recent uploads are added as “discovered” for review. Existing videos keep their admin-set status, song link and category."
              : "Verify the official channel before running discovery."}
          </p>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Import modal (works without an API key)
// ---------------------------------------------------------------------------

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (title: string) => void }) {
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState("")
  const [song, setSong] = useState<Song | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    if (!youtubeUrl.trim()) {
      setFields({ youtubeUrl: "Enter a YouTube URL or an 11-character video ID." })
      return
    }
    setSaving(true)
    try {
      const result = await api.post<{ video: Video }>("/discovery/import", {
        youtubeUrl: youtubeUrl.trim(),
        title: toNullable(title),
        category: category ? category : null,
        songId: song ? song.id : null,
      })
      onImported(result.video.title)
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Could not import the video.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import a video by URL"
      description="Add a single public YouTube video to the review queue. Only metadata and the URL are stored."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" type="submit" form="import-form" loading={saving}>
            Import
          </Button>
        </>
      }
    >
      <form id="import-form" className="flex flex-col gap-4" onSubmit={submit}>
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}
        <Field label="YouTube URL or video ID" htmlFor="import-url" required error={fields.youtubeUrl}>
          <Input
            id="import-url"
            value={youtubeUrl}
            onChange={(event) => setYoutubeUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            invalid={Boolean(fields.youtubeUrl)}
            required
          />
        </Field>
        <Field label="Title" htmlFor="import-title" error={fields.title} hint="Required when the YouTube API key is not configured.">
          <Input id="import-title" value={title} onChange={(event) => setTitle(event.target.value)} invalid={Boolean(fields.title)} />
        </Field>
        <Field label="Category" htmlFor="import-category" hint="Leave blank to let the system suggest one.">
          <Select id="import-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Suggest automatically</option>
            {DISCOVERY_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {humanize(key)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Link to a song" htmlFor="import-song" hint="Optional. Linking a song approves the video for that song.">
          <SongPicker value={song} onChange={setSong} />
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Review modal
// ---------------------------------------------------------------------------

function ReviewModal({ video, onClose, onSaved }: { video: Video; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(video.status)
  const [category, setCategory] = useState(video.discovery_category ?? "")
  const [song, setSong] = useState<Song | null>(video.song_id ? { id: video.song_id, title: video.song_title ?? "Linked song", composer: null } : null)
  const [isPrimary, setIsPrimary] = useState(Boolean(video.is_primary))
  const [notes, setNotes] = useState(video.notes ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.patch(`/discovery/videos/${video.id}`, {
        status,
        category: category ? category : null,
        songId: song ? song.id : null,
        isPrimary,
        notes: toNullable(notes),
      })
      onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update the video.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Review video"
      description="Classify the video, link it to a song and decide whether it is approved for the choir."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" type="submit" form="review-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="review-form" className="flex flex-col gap-4" onSubmit={submit}>
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}

        <div className="flex items-center gap-3 rounded-xl border hairline p-3">
          {video.thumbnail_url ? (
            <img src={video.thumbnail_url} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg border hairline">
              <Youtube size={20} className="opacity-50" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{video.title}</p>
            <p className="muted truncate text-xs">
              {orDash(video.channel_title)} · {formatDate(video.published_at)}
            </p>
            <a href={video.url} target="_blank" rel="noreferrer noopener" className="link text-xs">
              Open on YouTube
            </a>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="review-status">
            <Select id="review-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="discovered">Discovered</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Category" htmlFor="review-category">
            <Select id="review-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Unclassified</option>
              {DISCOVERY_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {humanize(key)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Linked song" htmlFor="review-song" hint="Search the music library and pick a song to link.">
          <SongPicker value={song} onChange={setSong} />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
          Mark as the primary video for the linked song
        </label>

        <Field label="Notes" htmlFor="review-notes">
          <Textarea id="review-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Song picker
// ---------------------------------------------------------------------------

function SongPicker({ value, onChange }: { value: Song | null; onChange: (song: Song | null) => void }) {
  const [term, setTerm] = useState("")
  const debounced = useDebounced(term, 300)
  const path = debounced.trim().length >= 2 ? `/songs${toQuery({ search: debounced.trim(), pageSize: 8 })}` : null
  const results = useQuery<Page<Song>>(path)

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border hairline px-3 py-2">
        <span className="truncate text-sm">{value.title}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          Clear
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search songs by title…" />
      {debounced.trim().length >= 2 ? (
        results.loading ? (
          <p className="muted text-xs">Searching…</p>
        ) : (results.data?.items ?? []).length === 0 ? (
          <p className="muted text-xs">No matching songs.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto rounded-xl border hairline">
            {(results.data?.items ?? []).map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gold-400/10"
                  onClick={() => onChange(song)}
                >
                  {song.title}
                  {song.composer ? <span className="muted"> · {song.composer}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}
