import { Link } from "react-router-dom"
import { Card, Spinner } from "../../components/ui"
import { PublicPageHeader } from "../../components/layout/PublicPageHeader"
import { useQuery } from "../../api/hooks"
import { CHOIR_PHOTOS, CHOIR_HERO_PHOTO } from "./gallery/photos.generated"

interface AboutData {
  about: string
  heroImageUrl: string | null
  counts: { senior: number; junior: number; members: number; total: number }
}

const GROUP_CARDS = [
  {
    title: "Senior singers",
    text: "Grown singers who are no longer in school. They carry the choir's repertoire, lead voice sections and represent La Porte d'Or at official performances.",
  },
  {
    title: "Junior singers",
    text: "Young singers who are still in school. Their records are protected, guardians are on file, and rehearsals are arranged around their studies.",
  },
  {
    title: "Support members",
    text: "The people who serve the choir through technology, media, sound, finance, transport and events — everything that lets the singing happen.",
  },
]

/**
 * The choir, in its own words: who the three groups are, how it is run, and what
 * it does. Reads the same public settings the landing page does, so the
 * Chairman's "About" text appears here too.
 */
export function PublicAboutPage() {
  const { data, loading } = useQuery<AboutData>("/public/landing")
  const hero = data?.heroImageUrl ?? CHOIR_HERO_PHOTO
  const strip = CHOIR_PHOTOS.slice(1, 7)

  return (
    <div className="min-h-dvh bg-ivory dark:bg-charcoal-950">
      <PublicPageHeader
        title="About the choir"
        description={
          data?.about?.trim()
            ? data.about
            : "Chorale La Porte d'Or is a choir of three groups — Senior singers, Junior singers and Support Members — who sing together and serve one another."
        }
      >
        {loading ? (
          <div className="flex items-center gap-2">
            <Spinner /> <span className="muted text-sm">Loading…</span>
          </div>
        ) : data ? (
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span>
              <strong className="font-display text-2xl text-gold-600 dark:text-gold-300">{data.counts.total}</strong>{" "}
              <span className="muted">active members</span>
            </span>
            <span>
              <strong className="font-display text-2xl text-gold-600 dark:text-gold-300">{data.counts.senior}</strong>{" "}
              <span className="muted">senior</span>
            </span>
            <span>
              <strong className="font-display text-2xl text-gold-600 dark:text-gold-300">{data.counts.junior}</strong>{" "}
              <span className="muted">junior</span>
            </span>
            <span>
              <strong className="font-display text-2xl text-gold-600 dark:text-gold-300">{data.counts.members}</strong>{" "}
              <span className="muted">support</span>
            </span>
          </div>
        ) : null}
      </PublicPageHeader>

      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GROUP_CARDS.map((card) => (
            <Card key={card.title} className="p-5">
              <p className="font-display text-xl font-semibold text-gold-600 dark:text-gold-300">{card.title}</p>
              <p className="muted mt-2 text-sm">{card.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-black/5 bg-white py-14 dark:border-gold-400/10 dark:bg-charcoal-900">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600 dark:text-gold-300">
              How we are run
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold">One choir, three parts, one Chairman</h2>
            <ul className="muted mt-5 flex flex-col gap-3 text-sm">
              <li>
                <strong className="text-current">Junior group</strong> — applications, attendance and discipline are
                handled by the Junior administrator.
              </li>
              <li>
                <strong className="text-current">Senior group</strong> — led by the Senior leader, who reviews senior
                applications and performances.
              </li>
              <li>
                <strong className="text-current">Support members</strong> — managed by the Members administrator, who
                looks after everyone serving behind the scenes.
              </li>
              <li>
                <strong className="text-current">Chairman</strong> — reads every group's records, sets the choir's
                direction and owns the public pages you are reading now.
              </li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <img
              src={hero}
              alt="Chorale La Porte d'Or"
              className="col-span-2 h-56 w-full rounded-2xl object-cover"
            />
            {strip.slice(0, 2).map((photo) => (
              <img
                key={photo.key}
                src={photo.thumb}
                alt={photo.alt}
                loading="lazy"
                className="h-40 w-full rounded-2xl object-cover"
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold">See the choir</h2>
            <p className="muted mt-1 text-sm">Photographs from our rehearsals and performances.</p>
          </div>
          <Link to="/gallery" className="btn btn-gold">
            Open the gallery
          </Link>
        </div>
      </section>
    </div>
  )
}
