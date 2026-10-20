import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Music2, Play, Search, Youtube } from "lucide-react"
import { useQuery, useDebounced } from "../../api/hooks"
import { APPLICATION_FORM_URL } from "../../components/layout/PublicLayout"
import { Badge, Card, EmptyState, Spinner, VideoPlayerModal, VideoThumbnail } from "../../components/ui"

/** One catalogue entry as `GET /public/music` returns it. */
interface PublicSong {
  id: string
  title: string
  composer: string | null
  arranger: string | null
  language: string | null
  description: string | null
  categoryKey: string | null
  categoryName: string | null
  stageName: string | null
  youtubeVideoId: string | null
  videoTitle: string | null
  publishedAt: string | null
  thumbnailUrl: string | null
  videoCount: number
}

interface PublicMusic {
  songs: PublicSong[]
  categories: { key: string; name: string; count: number }[]
  totals: { songs: number; videos: number }
}

/**
 * The choir's music, on one page, for anyone.
 *
 * Every performance the choir has published is here and a click plays it in the
 * official YouTube player — no sign-in, no need to leave the site or open the
 * YouTube app. Nothing loads from YouTube until somebody asks to watch.
 */
export function PublicMusicPage() {
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search, 300)
  const [category, setCategory] = useState("")
  /** The song whose video is playing; null when nothing is playing. */
  const [watching, setWatching] = useState<PublicSong | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim())
    if (category) params.set("category", category)
    const qs = params.toString()
    return `/public/music${qs ? `?${qs}` : ""}`
  }, [debouncedSearch, category])

  const { data, loading, error } = useQuery<PublicMusic>(query)
  const songs = data?.songs ?? []
  const filtering = Boolean(debouncedSearch.trim() || category)

  return (
    <div className="min-h-dvh bg-ivory pb-20 pt-16 dark:bg-charcoal-950">
      {/* Masthead */}
      <section className="border-b border-black/10 bg-white px-5 py-12 dark:border-gold-400/15 dark:bg-charcoal-900">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600 dark:text-gold-300">
            Chorale La Porte d'Or
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Our music</h1>
          <p className="muted mt-4 max-w-3xl text-base">
            Every performance our choir has published, on one page. Press play on any of them to watch and listen
            right here — the recordings play through YouTube's official player, and we never download or re-host
            anybody's media.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <Music2 size={16} className="text-gold-600 dark:text-gold-300" />
              <span className="muted">
                {data ? `${data.totals.songs} song${data.totals.songs === 1 ? "" : "s"}` : "Loading the catalogue…"}
              </span>
            </span>
            {data && data.totals.videos > data.totals.songs ? (
              <span className="flex items-center gap-2">
                <Youtube size={16} className="text-gold-600 dark:text-gold-300" />
                <span className="muted">{data.totals.videos} recordings</span>
              </span>
            ) : null}
            <a
              href="https://www.youtube.com/@laportedor"
              target="_blank"
              rel="noopener noreferrer"
              className="link flex items-center gap-1.5"
            >
              <Youtube size={15} /> Visit our YouTube channel
            </a>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="px-5 pt-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, composer or arranger…"
              className="input w-full pl-9"
              aria-label="Search the music catalogue"
            />
          </label>
          {data && data.categories.length > 0 ? (
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="input sm:w-64"
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {data.categories.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.name} ({entry.count})
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </section>

      {/* The catalogue */}
      <section className="px-5 pt-8">
        <div className="mx-auto max-w-7xl">
          {loading && !data ? (
            <div className="flex items-center gap-2 py-16">
              <Spinner /> <span className="muted text-sm">Loading the music…</span>
            </div>
          ) : error ? (
            <EmptyState
              tone="danger"
              title="Could not load the music"
              description={error.message}
              action={
                <Link to="/" className="btn btn-outline">
                  Back to the home page
                </Link>
              }
            />
          ) : songs.length === 0 ? (
            <EmptyState
              icon={<Music2 size={22} />}
              title={filtering ? "Nothing matches that" : "No performances published yet"}
              description={
                filtering
                  ? "Try a different search term, or clear the filters to see the whole catalogue."
                  : "The choir's recordings will appear here as soon as they are published."
              }
              action={
                filtering ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setSearch("")
                      setCategory("")
                    }}
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {songs.map((song) => (
                  <Card key={song.id} className="group flex flex-col overflow-hidden">
                    {/* The cover is the control: clicking it is what starts playback. */}
                    {song.youtubeVideoId ? (
                      <button
                        type="button"
                        onClick={() => setWatching(song)}
                        className="block w-full text-left"
                        aria-label={`Watch ${song.title}`}
                      >
                        <VideoThumbnail
                          videoId={song.youtubeVideoId}
                          title={song.title}
                          thumbnailUrl={song.thumbnailUrl}
                        />
                      </button>
                    ) : (
                      <VideoThumbnail videoId={null} title={song.title} thumbnailUrl={song.thumbnailUrl} playable={false} />
                    )}

                    <div className="flex flex-1 flex-col gap-2 px-4 py-3">
                      <div className="flex-1">
                        <p className="font-display text-lg font-semibold">{song.title}</p>
                        <p className="muted mt-0.5 text-xs">
                          {[
                            song.composer ? `Composed by ${song.composer}` : null,
                            !song.composer && song.arranger ? `Arranged by ${song.arranger}` : null,
                            song.language,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "La Porte d'Or performance"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {song.categoryName ? <Badge tone="gold">{song.categoryName}</Badge> : null}
                        {song.videoCount > 1 ? <Badge tone="neutral">{song.videoCount} recordings</Badge> : null}
                      </div>

                      {song.youtubeVideoId ? (
                        <button
                          type="button"
                          onClick={() => setWatching(song)}
                          className="btn btn-outline btn-sm mt-1 w-full justify-center"
                        >
                          <Play size={14} fill="currentColor" />
                          {song.videoCount > 1 ? "Watch" : "Watch this song"}
                        </button>
                      ) : null}
                    </div>
                  </Card>
                ))}
              </div>

              <p className="muted mt-10 text-center text-xs">
                Performances play through the official YouTube embedded player. Choir media is never downloaded or
                re-hosted.
              </p>
            </>
          )}
        </div>
      </section>

      {/* Closing invitation */}
      <section className="px-5 pt-16">
        <div className="mx-auto max-w-7xl">
          <Card>
            <div className="flex flex-col items-start gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-2xl font-semibold">Sing with us</h2>
                <p className="muted mt-1 max-w-2xl text-sm">
                  Membership is received through the official application form. Ministers and members of the
                  community are all welcome to apply.
                </p>
              </div>
              <a
                href={APPLICATION_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-gold shrink-0"
              >
                Apply for Membership
              </a>
            </div>
          </Card>
        </div>
      </section>

      {watching?.youtubeVideoId ? (
        <VideoPlayerModal
          open
          onClose={() => setWatching(null)}
          videoId={watching.youtubeVideoId}
          title={watching.title}
          description={watching.description ?? undefined}
          meta={[
            watching.videoCount > 1 ? `${watching.videoCount} recordings — this is the primary one` : null,
            watching.publishedAt ? `Published ${watching.publishedAt.slice(0, 10)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          footer={
            <Link to="/" className="btn btn-ghost">
              Home
            </Link>
          }
        />
      ) : null}
    </div>
  )
}
