import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Library, Play, Plus, Search, Youtube } from "lucide-react"
import { api, ApiError, toQuery } from "../../api/client"
import { useQuery, useDebounced } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Textarea,
  VideoPlayerModal,
  VideoThumbnail,
  useToast,
  type Column,
} from "../../components/ui"

// ---------------------------------------------------------------------------
// Types (mirror the server DTOs exactly — see server/src/routes/songs.ts)
// ---------------------------------------------------------------------------

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
  /** Playable video for this song, when one is linked and approved. */
  primary_video_id?: string | null
  thumbnail_url?: string | null
  video_count?: number
  // Only present if the server ever inlines assignments on the list payload.
  groups?: { id: string; key: string; name: string }[]
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function MusicLibraryPage() {
  const navigate = useNavigate()
  const { can, user } = useAuth()
  const toast = useToast()

  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search, 300)
  const [categoryId, setCategoryId] = useState("")
  const [stageId, setStageId] = useState("")
  const [groupId, setGroupId] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  /** The song whose video is playing in the dialog; null when nothing is playing. */
  const [watching, setWatching] = useState<Song | null>(null)
  /** The one-time channel import, and whether it is running or awaiting a confirm. */
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, categoryId, stageId, groupId, status])

  const taxonomy = useQuery<Taxonomy>("/songs/taxonomy")
  const listPath = `/songs${toQuery({ search: debouncedSearch, categoryId, stageId, groupId, status, page })}`
  const songs = useQuery<Page<Song>>(listPath)

  const columns: Column<Song>[] = [
    {
      key: "title",
      header: "Title",
      render: (row) => (
        <div className="flex min-w-[14rem] items-center gap-3">
          <VideoThumbnail
            videoId={row.primary_video_id ?? null}
            title={row.title}
            thumbnailUrl={row.thumbnail_url ?? null}
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.title}</p>
            <p className="muted truncate text-xs">
              {row.composer ? `Composer: ${row.composer}` : row.arranger ? `Arranger: ${row.arranger}` : "Composer not recorded"}
            </p>
            {row.primary_video_id ? (
              <p className="muted truncate text-xs">
                {row.video_count && row.video_count > 1
                  ? `${row.video_count} videos · press play to watch`
                  : "Press play to watch"}
              </p>
            ) : (
              <p className="muted truncate text-xs">No video linked yet</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row) => (row.category_name ? <span>{row.category_name}</span> : <span className="muted text-xs">Not categorised</span>),
    },
    {
      key: "stage",
      header: "Learning stage",
      render: (row) => (row.stage_name ? <Badge tone="neutral">{row.stage_name}</Badge> : <span className="muted text-xs">Not set</span>),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "watch",
      header: "",
      align: "right",
      render: (row) =>
        row.primary_video_id ? (
          <Button
            size="sm"
            variant="outline"
            icon={<Play size={14} fill="currentColor" />}
            onClick={(event) => {
              event.stopPropagation()
              setWatching(row)
            }}
          >
            Watch
          </Button>
        ) : (
          <span className="muted text-xs">—</span>
        ),
    },
    {
      key: "groups",
      header: "Groups",
      render: (row) =>
        row.groups && row.groups.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {row.groups.map((group) => (
              <Badge key={group.id} tone="gold">
                {group.name}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="muted text-xs" title="Group assignments are shown on the song page.">
            —
          </span>
        ),
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      render: (row) => <span className="muted text-xs">{formatDate(row.created_at)}</span>,
    },
  ]

  const canWrite = can("music.write")
  const isChairman = Boolean(user?.roles.includes("chairman"))

  /** Runs the one-time import of the choir's own YouTube channel. */
  async function runChannelImport() {
    setImporting(true)
    try {
      const report = await api.post<{
        songsCreated: number
        videosLinked: number
        groupsAssigned: number
        message: string
      }>("/songs/import-channel", {})
      toast.success(report.message)
      setImportOpen(false)
      songs.reload()
      taxonomy.reload()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The channel import could not be completed.")
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Music Library"
        description="The choir catalogue of songs, categories, learning stages and group assignments."
        breadcrumbs={[{ label: "Overview", to: "/app" }, { label: "Music Library" }]}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              {isChairman ? (
                <Button variant="outline" icon={<Youtube size={16} />} onClick={() => setImportOpen(true)}>
                  Import from YouTube
                </Button>
              ) : null}
              <Button variant="gold" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                New song
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Search" htmlFor="song-search">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
                <Input
                  id="song-search"
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title, composer or arranger"
                />
              </div>
            </Field>
            <Field label="Category" htmlFor="song-category">
              <Select id="song-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">All categories</option>
                {(taxonomy.data?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Learning stage" htmlFor="song-stage">
              <Select id="song-stage" value={stageId} onChange={(event) => setStageId(event.target.value)}>
                <option value="">All stages</option>
                {(taxonomy.data?.stages ?? []).map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Group" htmlFor="song-group">
              <Select id="song-group" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                <option value="">All groups</option>
                {(taxonomy.data?.groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="song-status">
              <Select id="song-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Active and archived</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
          </div>

          {(categoryId || stageId || groupId || status || debouncedSearch) && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("")
                  setCategoryId("")
                  setStageId("")
                  setGroupId("")
                  setStatus("")
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {songs.error ? (
        <Card>
          <CardBody>
            <EmptyState
              tone="danger"
              title="Could not load the library"
              description={songs.error.message}
              action={
                <Button variant="outline" onClick={() => songs.reload()}>
                  Try again
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <DataTable
              columns={columns}
              rows={songs.data?.items ?? []}
              rowKey={(row) => row.id}
              loading={songs.loading}
              onRowClick={(row) => navigate(`/app/music/${row.id}`)}
              emptyTitle="No songs match your filters"
              emptyDescription={
                canWrite
                  ? "Add a song to start building the choir catalogue, or adjust the filters above."
                  : "Nothing has been added to the catalogue yet, or your filters are too narrow."
              }
              emptyAction={
                canWrite ? (
                  <Button variant="gold" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                    New song
                  </Button>
                ) : undefined
              }
              caption="Select a row to open the song, or press play to watch its video here."
            />
            <Pagination
              page={songs.data?.page ?? page}
              pageCount={songs.data?.pageCount ?? 1}
              total={songs.data?.total}
              onChange={setPage}
            />
          </CardBody>
        </Card>
      )}

      {watching?.primary_video_id ? (
        <VideoPlayerModal
          open
          onClose={() => setWatching(null)}
          videoId={watching.primary_video_id}
          title={watching.title}
          meta={[
            watching.composer ? `Composer: ${watching.composer}` : watching.arranger ? `Arranger: ${watching.arranger}` : null,
            watching.category_name,
            watching.video_count && watching.video_count > 1 ? `${watching.video_count} videos — open the song for the rest` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          footer={
            <Button variant="ghost" onClick={() => navigate(`/app/music/${watching.id}`)}>
              Open song
            </Button>
          }
        />
      ) : null}

      {creating ? (
        <NewSongModal
          taxonomy={taxonomy.data}
          onClose={() => setCreating(false)}
          onCreated={(song) => {
            setCreating(false)
            toast.success(`“${song.title}” was added to the library.`)
            songs.reload()
          }}
        />
      ) : null}

      <Modal
        open={importOpen}
        onClose={() => (importing ? undefined : setImportOpen(false))}
        title="Import from the choir's YouTube channel"
        description="Adds the choir's own songs from @laportedor to the catalogue."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button variant="gold" onClick={() => void runChannelImport()} loading={importing}>
              Import songs
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-2 text-sm">
          <li>Every individual song from the channel is added to the catalogue.</li>
          <li>Live streams and concert recordings are skipped — they are not songs.</li>
          <li>Each song is assigned to Senior, Junior and Support members alike.</li>
          <li>Songs already in the catalogue are never duplicated.</li>
        </ul>
        <p className="muted mt-3 text-xs">
          This runs once. Pressing it again is harmless: if everything is already imported, nothing changes.
        </p>
      </Modal>

      {canWrite ? null : (
        <p className="muted flex items-center gap-2 text-xs">
          <Library size={14} />
          You have read-only access to the music library.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// New song modal
// ---------------------------------------------------------------------------

interface SongFormState {
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
}

const EMPTY_FORM: SongFormState = {
  title: "",
  composer: "",
  arranger: "",
  language: "",
  genre: "",
  musicalKey: "",
  bpm: "",
  timeSignature: "",
  difficulty: "",
  choirSection: "",
  categoryId: "",
  stageId: "",
  description: "",
}

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function buildSongPayload(form: SongFormState, force: boolean) {
  const bpm = form.bpm.trim() ? Number(form.bpm.trim()) : null
  return {
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
    ...(force ? { force: true } : {}),
  }
}

function NewSongModal({
  taxonomy,
  onClose,
  onCreated,
}: {
  taxonomy: Taxonomy | null
  onClose: () => void
  onCreated: (song: Song) => void
}) {
  const [form, setForm] = useState<SongFormState>(EMPTY_FORM)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [duplicate, setDuplicate] = useState(false)

  const update = (key: keyof SongFormState) => (value: string) => setForm((current) => ({ ...current, [key]: value }))

  async function save(force: boolean) {
    setError(null)
    setFields({})
    if (!form.title.trim()) {
      setFields({ title: "Enter the song title." })
      return
    }
    setSaving(true)
    try {
      const result = await api.post<{ song: Song }>("/songs", buildSongPayload(form, force))
      onCreated(result.song)
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === "conflict") {
          setDuplicate(true)
        } else {
          setError(caught.message)
          setFields(caught.fields ?? {})
        }
      } else {
        setError("Could not add the song. Please try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void save(false)
  }

  if (duplicate) {
    return (
      <Modal
        open
        onClose={() => setDuplicate(false)}
        title="A similar song already exists"
        description="A song with a similar title is already in the library."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDuplicate(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="gold" loading={saving} onClick={() => void save(true)}>
              Add anyway
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Titles are compared ignoring accents, case and punctuation. Add “{form.title.trim()}” anyway?
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New song"
      description="Create a catalogue entry. Only record what is known — leave fields blank rather than guessing."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gold" type="submit" form="new-song-form" loading={saving}>
            Add song
          </Button>
        </>
      }
    >
      <form id="new-song-form" className="flex flex-col gap-4" onSubmit={(event) => submit(event)}>
        {error ? (
          <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
        ) : null}

        <Field label="Title" htmlFor="new-title" required error={fields.title}>
          <Input
            id="new-title"
            value={form.title}
            onChange={(event) => update("title")(event.target.value)}
            invalid={Boolean(fields.title)}
            autoFocus
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Composer" htmlFor="new-composer" error={fields.composer}>
            <Input id="new-composer" value={form.composer} onChange={(event) => update("composer")(event.target.value)} />
          </Field>
          <Field label="Arranger" htmlFor="new-arranger" error={fields.arranger}>
            <Input id="new-arranger" value={form.arranger} onChange={(event) => update("arranger")(event.target.value)} />
          </Field>
          <Field label="Category" htmlFor="new-category" hint="Where this song sits in the library.">
            <Select id="new-category" value={form.categoryId} onChange={(event) => update("categoryId")(event.target.value)}>
              <option value="">Not categorised</option>
              {(taxonomy?.categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Learning stage" htmlFor="new-stage">
            <Select id="new-stage" value={form.stageId} onChange={(event) => update("stageId")(event.target.value)}>
              <option value="">Not set</option>
              {(taxonomy?.stages ?? []).map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language" htmlFor="new-language">
            <Input id="new-language" value={form.language} onChange={(event) => update("language")(event.target.value)} />
          </Field>
          <Field label="Genre" htmlFor="new-genre">
            <Input id="new-genre" value={form.genre} onChange={(event) => update("genre")(event.target.value)} />
          </Field>
          <Field label="Difficulty" htmlFor="new-difficulty">
            <Select id="new-difficulty" value={form.difficulty} onChange={(event) => update("difficulty")(event.target.value)}>
              <option value="">Not set</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Select>
          </Field>
          <Field label="Choir section" htmlFor="new-section" hint="For example: full choir, soprano only.">
            <Input id="new-section" value={form.choirSection} onChange={(event) => update("choirSection")(event.target.value)} />
          </Field>
          <Field label="Musical key" htmlFor="new-key">
            <Input id="new-key" value={form.musicalKey} onChange={(event) => update("musicalKey")(event.target.value)} />
          </Field>
          <Field label="Time signature" htmlFor="new-time">
            <Input id="new-time" value={form.timeSignature} onChange={(event) => update("timeSignature")(event.target.value)} />
          </Field>
          <Field label="Tempo (BPM)" htmlFor="new-bpm" error={fields.bpm}>
            <Input
              id="new-bpm"
              type="number"
              min={1}
              max={400}
              value={form.bpm}
              onChange={(event) => update("bpm")(event.target.value)}
              invalid={Boolean(fields.bpm)}
            />
          </Field>
        </div>

        <Field label="Description" htmlFor="new-description">
          <Textarea id="new-description" value={form.description} onChange={(event) => update("description")(event.target.value)} />
        </Field>

        <p className="muted text-xs">
          Lyrics, videos and practice tracks are added on the song page, only when they are lawfully available.
        </p>
      </form>
    </Modal>
  )
}
