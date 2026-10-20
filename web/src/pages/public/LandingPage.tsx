import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "../../api/hooks"
import { APPLICATION_FORM_URL, YOUTUBE_CHANNEL_URL } from "../../components/layout/PublicLayout"
import { Card, EmptyState, Spinner, VideoPlayerModal, VideoThumbnail } from "../../components/ui"
import { CHOIR_PHOTOS } from "./gallery/photos.generated"
import { ArrowRight, CalendarDays, Images, Mail, Music2, Phone, PlayCircle, Users } from "lucide-react"

interface LandingSong {
  id: string
  title: string
  categoryName: string | null
  youtubeVideoId: string | null
  thumbnailUrl: string | null
}

interface LandingEvent {
  id: string
  name: string
  date: string
  location: string | null
  eventType: string
}

interface LandingData {
  about: string
  contact: { email: string; phone: string }
  applicationFormUrl: string
  logoUrl: string | null
  heroImageUrl: string | null
  galleryUrls: string[]
  upcomingEvents: LandingEvent[]
  featuredSongs: LandingSong[]
  counts: { senior: number; junior: number; members: number; total: number }
}

/** A short strip of the choir's own photographs for the landing page. */
const HERO_PHOTOS = CHOIR_PHOTOS.slice(0, 8)

export function LandingPage() {
  const { data, loading } = useQuery<LandingData>("/public/landing")
  /** The featured video a visitor asked to watch; null when nothing is playing. */
  const [watching, setWatching] = useState<LandingSong | null>(null)
  // Any photographs the Chairman has uploaded take priority; otherwise the
  // choir's own bundled photos are used. The stock placeholders are gone.
  const gallery = data && data.galleryUrls.length > 0 ? data.galleryUrls : HERO_PHOTOS.map((photo) => photo.thumb)
  const heroImage = data?.heroImageUrl ?? CHOIR_PHOTOS[0]?.full ?? "/logo.png"
  const formUrl = data?.applicationFormUrl || APPLICATION_FORM_URL

  return (
    <div>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-charcoal-950 pb-20 pt-28">
        <div className="absolute inset-0 -z-10">
          <img src={heroImage} alt="" className="h-full w-full object-cover opacity-25" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,11,15,0.72), rgba(10,11,15,0.94))" }} />
        </div>
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold-300">Chorale · Digital Platform</p>
            <h1 className="mt-3 font-display text-5xl font-semibold leading-[1.05] text-ivory sm:text-6xl">
              Chorale La Porte d'Or
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ivory/80">
              One home for our singers, our music library, rehearsals, performances and administration — built for the
              three official groups: Senior, Junior and Support Members.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={formUrl} target="_blank" rel="noopener noreferrer" className="btn btn-gold">
                Apply for Membership
              </a>
              <Link to="/music" className="btn btn-outline text-ivory">
                <PlayCircle size={16} /> Listen to our music
              </Link>
            </div>
            <p className="mt-3 text-xs text-ivory/50">
              All applications go through the official Google Form. There is no public self-registration.
            </p>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <div className="card flex items-center justify-center border-gold-400/25 bg-charcoal-900/70 p-10 backdrop-blur">
              <img src={data?.logoUrl ?? "/logo.png"} alt="Chorale La Porte d'Or logo" className="h-40 w-40 object-contain" />
            </div>
          </div>
        </div>

        {data && (
          <div className="mx-auto mt-14 grid max-w-7xl grid-cols-2 gap-4 px-5 sm:grid-cols-4">
            {[
              { label: "Senior singers", value: data.counts.senior },
              { label: "Junior singers", value: data.counts.junior },
              { label: "Support members", value: data.counts.members },
              { label: "Total members", value: data.counts.total },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-gold-400/20 bg-charcoal-900/60 px-4 py-3">
                <p className="font-display text-3xl font-semibold text-gold-200">{stat.value}</p>
                <p className="text-xs uppercase tracking-wide text-ivory/60">{stat.label}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* About */}
      <section id="about" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionTitle eyebrow="Who we are" title="A choir built on three groups" />
            <p className="muted mt-4 text-base">
              {data?.about?.trim()
                ? data.about
                : "Chorale La Porte d'Or brings together Senior singers who are out of school, Junior singers who are still in school, and Support Members who serve the choir through technology, media, sound, finance, transport and events."}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { title: "Senior", text: "Grown singers, voice sections, performance and development." },
                { title: "Junior", text: "Young singers in school, with protected guardian records." },
                { title: "Support", text: "Media, sound, IT, finance, logistics and administration." },
              ].map((item) => (
                <Card key={item.title} className="p-4">
                  <p className="font-display text-lg font-semibold text-gold-600 dark:text-gold-300">{item.title}</p>
                  <p className="muted mt-1 text-sm">{item.text}</p>
                </Card>
              ))}
            </div>
            <Link to="/about" className="btn btn-outline mt-6">
              More about the choir <ArrowRight size={15} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {HERO_PHOTOS.slice(0, 3).map((photo, index) => (
              <img
                key={photo.key}
                src={photo.thumb}
                alt={photo.alt}
                loading={index === 0 ? "eager" : "lazy"}
                className={
                  index === 0
                    ? "col-span-2 h-56 w-full rounded-2xl object-cover"
                    : "h-40 w-full rounded-2xl object-cover"
                }
              />
            ))}
          </div>
        </div>
      </section>

      {/* Music */}
      <section id="music" className="scroll-mt-24 border-y border-black/5 bg-white py-16 dark:border-gold-400/10 dark:bg-charcoal-900">
        <div className="mx-auto max-w-7xl px-5">
          <SectionTitle eyebrow="Music library" title="Performances from our official channel" />
          <p className="muted mt-3 max-w-2xl text-sm">
            Videos play through YouTube's official embedded player. We catalogue public metadata and link to the
            original videos — we never download or rehost performances.
          </p>
          <div className="mt-6">
            {loading ? (
              <div className="flex items-center gap-2 py-10">
                <Spinner /> <span className="muted text-sm">Loading music…</span>
              </div>
            ) : data && data.featuredSongs.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.featuredSongs.map((song) => (
                  <Card key={song.id} className="overflow-hidden">
                    {song.youtubeVideoId ? (
                      // A visitor's click is what starts playback, so nothing loads
                      // from YouTube until they ask for it.
                      <button
                        type="button"
                        className="group block w-full"
                        onClick={() => setWatching(song)}
                        aria-label={`Watch ${song.title}`}
                      >
                        <VideoThumbnail
                          videoId={song.youtubeVideoId}
                          title={song.title}
                          thumbnailUrl={song.thumbnailUrl}
                        />
                      </button>
                    ) : (
                      <VideoThumbnail
                        videoId={null}
                        title={song.title}
                        thumbnailUrl={song.thumbnailUrl}
                        playable={false}
                      />
                    )}
                    <div className="px-4 py-3">
                      <p className="font-medium">{song.title}</p>
                      <p className="muted text-xs">{song.categoryName ?? "Choir music"}</p>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Music catalogue is being prepared"
                description="No songs have been published to the public highlights yet. Choir administrators add songs from the official YouTube channel in the Music Library."
                icon={<Music2 size={22} />}
              />
            )}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/music" className="btn btn-gold">
              <PlayCircle size={16} /> See all our music
            </Link>
            <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
              Visit our YouTube channel
            </a>
          </div>
        </div>
      </section>

      {/* Gallery preview */}
      <section id="gallery" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionTitle eyebrow="Gallery" title="Moments from the choir" />
          <Link to="/gallery" className="btn btn-outline">
            <Images size={16} /> Open the full gallery
          </Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {gallery.slice(0, 8).map((url, index) => (
            <Link key={`${url}-${index}`} to="/gallery" className="group block overflow-hidden rounded-2xl">
              <img
                src={url}
                alt="Chorale La Porte d'Or"
                loading="lazy"
                className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </Link>
          ))}
        </div>
      </section>

      {/* Events */}
      <section id="events" className="scroll-mt-24 border-y border-black/5 bg-white py-16 dark:border-gold-400/10 dark:bg-charcoal-900">
        <div className="mx-auto max-w-7xl px-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionTitle eyebrow="What's next" title="Upcoming public events" />
            <Link to="/events" className="btn btn-outline">
              <CalendarDays size={16} /> All events
            </Link>
          </div>
          <div className="mt-6">
            {data && data.upcomingEvents.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {data.upcomingEvents.slice(0, 3).map((event) => (
                  <Card key={event.id} className="flex items-start gap-3 p-4">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--color-gold-400) 14%, transparent)" }}>
                      <CalendarDays size={18} className="text-gold-600 dark:text-gold-300" />
                    </div>
                    <div>
                      <p className="font-medium">{event.name}</p>
                      <p className="muted text-xs">
                        {new Date(event.date).toLocaleDateString(undefined, { dateStyle: "long" })}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No public events scheduled"
                description="Upcoming performances will appear here once the choir publishes them."
                icon={<CalendarDays size={22} />}
              />
            )}
          </div>
        </div>
      </section>

      {/* Contact / Apply */}
      <section id="contact" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <SectionTitle eyebrow="Join us" title="Apply for membership" />
            <p className="muted mt-3 text-sm">
              Membership is reviewed by the correct group administrator. Submitting the form does not create an account
              automatically; approved applicants receive secure account setup instructions.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href={formUrl} target="_blank" rel="noopener noreferrer" className="btn btn-gold">
                Open the official application form
              </a>
              <Link to="/contact" className="btn btn-outline">
                Contact the choir
              </Link>
            </div>
          </Card>
          <Card className="p-6">
            <SectionTitle eyebrow="Contact" title="Reach the choir" />
            {data?.contact.email || data?.contact.phone ? (
              <ul className="mt-4 flex flex-col gap-2 text-sm">
                {data.contact.email ? (
                  <li className="flex items-center gap-2">
                    <Mail size={16} className="text-gold-600 dark:text-gold-300" /> {data.contact.email}
                  </li>
                ) : null}
                {data.contact.phone ? (
                  <li className="flex items-center gap-2">
                    <Phone size={16} className="text-gold-600 dark:text-gold-300" /> {data.contact.phone}
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="muted mt-3 text-sm">
                Public contact details have not been added yet. The Chairman can set them in Settings.
              </p>
            )}
            <div className="mt-5 flex items-center gap-3 text-sm">
              <Users size={16} className="text-gold-600 dark:text-gold-300" />
              <span className="muted">
                {data ? `${data.counts.total} active member${data.counts.total === 1 ? "" : "s"}` : "Membership platform"}
              </span>
              <PlayCircle size={16} className="text-gold-600 dark:text-gold-300" />
              <span className="muted">Official performances</span>
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
          meta={watching.categoryName ?? "Choir music"}
        />
      ) : null}
    </div>
  )
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600 dark:text-gold-300">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">{title}</h2>
    </div>
  )
}
