/**
 * Search-engine surface for the public site.
 *
 * WHY THIS EXISTS
 *
 * The web app is a client-rendered React bundle. The HTML the server sends is a
 * ~1.4 KB shell with an empty `<div id="root">` — no headings, no text, and the
 * same `<title>` and description on every URL. A crawler that fetches
 * `/about` and `/events` therefore sees two identical, empty documents, and the
 * only real content on the site is invisible until JavaScript runs, which is
 * slower and less reliable than plain HTML (and unreliable at all on a free
 * instance that sleeps).
 *
 * This module fixes that by rendering the genuinely public pages to real HTML on
 * the server, and by answering `robots.txt` and `sitemap.xml` as themselves
 * rather than as the app shell.
 *
 * WHAT IS PUBLIC, AND WHAT IS NOT
 *
 * Only the pages a visitor can reach without signing in: the landing page, about,
 * events, music, contact and the gallery. Everything else — `/app`, `/login`,
 * `/admin`, `/setup`, invitation and reset links, and every `/api` route — is
 * either private or worthless to a crawler, and is explicitly disallowed.
 *
 * The rendered content is built from the SAME data the public JSON endpoints
 * serve. Nothing member-shaped is included: no names, no applications, no
 * reports, no contributions beyond what the public events feed already exposes.
 */
import { all, one } from "../db/index.js"
import { today } from "../lib/time.js"

/** The public site's own address, used for canonical URLs. Overridable per deployment. */
export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")
  return "https://la-porte-ador.onrender.com"
}

/** Escapes text for HTML, so database content can never break out of a tag. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Collapses whitespace and truncates on a word boundary — for meta descriptions. */
export function summarise(value: string, max = 158): string {
  const flat = value.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.]$/, "")}…`
}

function settingValue(key: string): string {
  return one<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", key)?.value ?? ""
}

/** The choir's own name as the site presents it. */
export const SITE_NAME = "Chorale La Porte d'Or"

/** Every public page, with the title and description a search engine should show. */
export interface PublicPage {
  path: string
  title: string
  description: string
  /** Roughly how often the content changes; guides the sitemap's `changefreq`. */
  changefreq: "daily" | "weekly" | "monthly"
  priority: string
  /** True when a signed-out visitor actually has something to read here. */
  indexable: boolean
}

const GALLERY_COLLECTIONS = ["august-2026", "july-2026"] as const

/**
 * The public pages worth indexing, in the order they appear in the sitemap.
 *
 * Deliberately built from a fixed list rather than by walking the React router:
 * a page becomes indexable only when someone decides it should be, so a new
 * private route can never leak into the sitemap by accident.
 */
export function publicPages(): PublicPage[] {
  const about = settingValue("public.about")
  const pages: PublicPage[] = [
    {
      path: "/",
      title: `${SITE_NAME} — choir of the Golden Gate`,
      description: summarise(
        about || `${SITE_NAME} is a choir in Rwamagana, Rwanda, with Junior, Senior and Support Members groups. Music, events, photographs and how to join.`,
      ),
      changefreq: "weekly",
      priority: "1.0",
      indexable: true,
    },
    {
      path: "/about",
      title: `About ${SITE_NAME} — who we are and how to join`,
      description: summarise(
        about || `Learn about ${SITE_NAME}: its history, its three groups and how to join.`,
      ),
      changefreq: "monthly",
      priority: "0.9",
      indexable: true,
    },
    {
      path: "/events",
      title: `${SITE_NAME} events — concerts, rehearsals and performances`,
      description: `Upcoming and past events at ${SITE_NAME}: concerts, festivals, rehearsals and celebrations. Public events are listed here.`,
      changefreq: "daily",
      priority: "0.9",
      indexable: true,
    },
    {
      path: "/music",
      title: `${SITE_NAME} music — song catalogue and performances`,
      description: `The music of ${SITE_NAME}: every song the choir performs, with videos from its own YouTube channel.`,
      changefreq: "weekly",
      priority: "0.9",
      indexable: true,
    },
    {
      path: "/gallery",
      title: `${SITE_NAME} gallery — photographs and performances`,
      description: `Photographs of ${SITE_NAME}: performances, rehearsals and the members who make the choir.`,
      changefreq: "weekly",
      priority: "0.8",
      indexable: true,
    },
    {
      path: "/contact",
      title: `Contact ${SITE_NAME}`,
      description: `How to reach ${SITE_NAME} about joining, inviting the choir to sing, or supporting its work.`,
      changefreq: "monthly",
      priority: "0.7",
      indexable: true,
    },
  ]

  for (const collection of GALLERY_COLLECTIONS) {
    const label = collection.replace("-", " ")
    pages.push({
      path: `/gallery/${collection}`,
      title: `${SITE_NAME} gallery — ${label}`,
      description: `Photographs from ${label} at ${SITE_NAME}.`,
      changefreq: "monthly",
      priority: "0.5",
      indexable: true,
    })
  }
  pages.push(
    {
      path: "/gallery/performances",
      title: `${SITE_NAME} gallery — performances`,
      description: `Performance photographs from ${SITE_NAME}.`,
      changefreq: "monthly",
      priority: "0.5",
      indexable: true,
    },
    {
      path: "/gallery/members",
      title: `${SITE_NAME} gallery — members`,
      description: `Photographs of the members of ${SITE_NAME}.`,
      changefreq: "monthly",
      priority: "0.5",
      indexable: true,
    },
  )

  return pages
}

/**
 * `robots.txt`.
 *
 * The private areas are disallowed outright. They are also worth disallowing for
 * a second reason: Render's free instance sleeps, and crawl budget spent on
 * login pages is budget not spent on the pages that can actually rank.
 */
export function robotsTxt(): string {
  const origin = siteOrigin()
  const disallow = [
    "/app/",
    "/api/",
    "/admin",
    "/login",
    "/setup",
    "/invite/",
    "/reset-password",
    "/checkin/",
    "/media/private",
  ]
  return [
    "# Chorale La Porte d'Or",
    "User-agent: *",
    ...disallow.map((path) => `Disallow: ${path}`),
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n")
}

/** `sitemap.xml` for the public pages, with the last time the public content changed. */
export function sitemapXml(): string {
  const origin = siteOrigin()

  // The newest date any public content changed: the latest public event, song or
  // gallery upload. One honest timestamp beats per-page guesses.
  const stamps = [
    one<{ at: string | null }>("SELECT MAX(date) AS at FROM events WHERE is_public = 1")?.at,
    one<{ at: string | null }>("SELECT MAX(updated_at) AS at FROM songs WHERE status = 'active'")?.at,
    one<{ at: string | null }>(
      "SELECT MAX(created_at) AS at FROM file_uploads WHERE bucket = 'public'",
    )?.at,
  ].filter((value): value is string => Boolean(value))
  const lastmod = (stamps.sort().at(-1) ?? today()).slice(0, 10)

  const entries = publicPages()
    .filter((page) => page.indexable)
    .map((page) =>
      [
        "  <url>",
        `    <loc>${escapeHtml(origin + page.path)}</loc>`,
        `    <lastmod>${escapeHtml(lastmod)}</lastmod>`,
        `    <changefreq>${page.changefreq}</changefreq>`,
        `    <priority>${page.priority}</priority>`,
        "  </url>",
      ].join("\n"),
    )
    .join("\n")

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</urlset>",
    "",
  ].join("\n")
}

/** The `<title>` and meta description for a given public path, or null if not a public page. */
export function metaFor(pathname: string): PublicPage | null {
  const clean = pathname !== "/" ? pathname.replace(/\/+$/, "") : "/"
  return publicPages().find((page) => page.path === clean) ?? null
}

/** A public event, as much as a visitor may see. */
interface PublicEventRow {
  id: string
  name: string
  event_type: string
  date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  description: string | null
}

function upcomingPublicEvents(limit = 20): PublicEventRow[] {
  return all<PublicEventRow>(
    `SELECT id, name, event_type, date, start_time, end_time, location, description
       FROM events
      WHERE is_public = 1 AND date >= ?
      ORDER BY date ASC, start_time ASC
      LIMIT ?`,
    today(),
    limit,
  )
}

function activeSongs(limit = 40): { id: string; title: string; category: string | null }[] {
  return all<{ id: string; title: string; category: string | null }>(
    `SELECT s.id, s.title, sc.name AS category
       FROM songs s
       LEFT JOIN song_categories sc ON sc.id = s.category_id
      WHERE s.status = 'active'
        AND EXISTS (SELECT 1 FROM videos v WHERE v.song_id = s.id AND v.status = 'approved')
      ORDER BY s.title COLLATE NOCASE
      LIMIT ?`,
    limit,
  )
}

function galleryImageUrls(limit = 24): string[] {
  if (settingValue("public.gallery_enabled") === "false") return []
  return all<{ path: string }>(
    `SELECT path FROM file_uploads
      WHERE bucket = 'public' AND entity_type = 'gallery'
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    limit,
  ).map((row) => `/media/${row.path.replace(/^public\//, "")}`)
}

function brandLogoUrl(): string | null {
  const row = one<{ path: string }>(
    `SELECT path FROM file_uploads
      WHERE bucket = 'public' AND entity_type = 'brand'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
  )
  return row ? `/media/${row.path.replace(/^public\//, "")}` : null
}

export interface RenderContext {
  origin: string
  meta: PublicPage
  logoUrl: string | null
  about: string
  contactEmail: string
  contactPhone: string
}

/** Everything the public pages need, gathered once. */
export function renderContext(pathname: string): RenderContext | null {
  const meta = metaFor(pathname)
  if (!meta) return null
  return {
    origin: siteOrigin(),
    meta,
    logoUrl: brandLogoUrl(),
    about: settingValue("public.about"),
    contactEmail: settingValue("public.contact_email"),
    contactPhone: settingValue("public.contact_phone"),
  }
}

/**
 * `schema.org` structured data for the choir.
 *
 * A `MusicGroup` entity is what lets a search engine show the choir's own name,
 * logo and social profiles as a knowledge panel rather than a plain blue link.
 * Only fields that are actually known are emitted — an empty property is worse
 * than an absent one.
 */
export function structuredData(context: RenderContext): string {
  const graph: Record<string, unknown>[] = [
    {
      "@type": "MusicGroup",
      "@id": `${context.origin}/#choir`,
      name: SITE_NAME,
      alternateName: "La Porte d'Or",
      url: `${context.origin}/`,
      ...(context.logoUrl ? { logo: `${context.origin}${context.logoUrl}` } : {}),
      ...(context.about ? { description: summarise(context.about, 300) } : {}),
      ...(context.contactEmail ? { email: context.contactEmail } : {}),
      ...(context.contactPhone ? { telephone: context.contactPhone } : {}),
      address: {
        "@type": "PostalAddress",
        addressLocality: "Rwamagana",
        addressCountry: "RW",
      },
      ...(process.env.PUBLIC_YOUTUBE_URL ? { sameAs: [process.env.PUBLIC_YOUTUBE_URL] } : {}),
    },
    {
      "@type": "WebSite",
      "@id": `${context.origin}/#website`,
      url: `${context.origin}/`,
      name: SITE_NAME,
      inLanguage: "en",
      publisher: { "@id": `${context.origin}/#choir` },
    },
  ]
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph })
}

/**
 * The real HTML body for a public page.
 *
 * This is what a crawler reads before JavaScript runs, and what a visitor sees if
 * the bundle is slow to arrive. It mirrors the React page's content, not its
 * layout: the app still takes over and renders the interactive version.
 */
export function bodyFor(pathname: string, context: RenderContext): string {
  const clean = pathname !== "/" ? pathname.replace(/\/+$/, "") : "/"
  const e = escapeHtml

  if (clean === "/events") {
    const events = upcomingPublicEvents()
    const items = events.length
      ? `<ul class="seo-list">${events
          .map((event) => {
            const when = [event.date, event.start_time ?? ""].filter(Boolean).join(" ")
            const where = event.location ? ` — ${e(event.location)}` : ""
            const what = event.description ? `<p>${e(event.description)}</p>` : ""
            return `<li><h2>${e(event.name)}</h2><p>${e(when)}${where}</p>${what}</li>`
          })
          .join("")}</ul>`
      : `<p>No public events are scheduled right now. Please check back soon.</p>`
    return `<h1>Events at ${e(SITE_NAME)}</h1>
<p>Concerts, festivals, rehearsals and celebrations. These events are open to the public.</p>
${items}`
  }

  if (clean === "/music") {
    const songs = activeSongs()
    const items = songs.length
      ? `<ul class="seo-list">${songs
          .map((song) => `<li>${e(song.title)}${song.category ? ` — ${e(song.category)}` : ""}</li>`)
          .join("")}</ul>`
      : `<p>The song catalogue is being prepared. Please check back soon.</p>`
    return `<h1>Music of ${e(SITE_NAME)}</h1>
<p>Every song the choir performs, with videos from its own YouTube channel.</p>
${items}`
  }

  if (clean === "/about") {
    const about = settingValue("public.about")
    return `<h1>About ${e(SITE_NAME)}</h1>
${about ? `<p>${e(about)}</p>` : `<p>${e(SITE_NAME)} is a choir with Junior, Senior and Support Members groups.</p>`}
<p>The choir welcomes new voices. ${context.contactEmail ? `Write to <a href="mailto:${e(context.contactEmail)}">${e(context.contactEmail)}</a> to find out how to join.` : "Use the contact page to find out how to join."}</p>`
  }

  if (clean === "/contact") {
    const lines = [
      context.contactEmail ? `<p>Email: <a href="mailto:${e(context.contactEmail)}">${e(context.contactEmail)}</a></p>` : "",
      context.contactPhone ? `<p>Telephone: ${e(context.contactPhone)}</p>` : "",
    ].join("")
    return `<h1>Contact ${e(SITE_NAME)}</h1>
<p>Reach the choir about joining, inviting it to sing, or supporting its work.</p>
${lines || "<p>Contact details are published on this page in the app.</p>"}`
  }

  if (clean.startsWith("/gallery")) {
    const images = galleryImageUrls(12)
    const figures = images
      .map((url) => `<li><img src="${e(url)}" alt="${e(SITE_NAME)} photograph" loading="lazy" /></li>`)
      .join("")
    return `<h1>${e(SITE_NAME)} gallery</h1>
<p>Photographs of the choir: performances, rehearsals and the members who make it.</p>
${images.length ? `<ul class="seo-list">${figures}</ul>` : "<p>Photographs are being added.</p>"}`
  }

  // Landing page.
  const events = upcomingPublicEvents(6)
  const songs = activeSongs(6)
  const eventList = events.length
    ? `<ul class="seo-list">${events
        .map((event) => `<li>${e(event.name)} — ${e(event.date)}${event.location ? ` — ${e(event.location)}` : ""}</li>`)
        .join("")}</ul>`
    : ""
  const songList = songs.length
    ? `<ul class="seo-list">${songs.map((song) => `<li>${e(song.title)}</li>`).join("")}</ul>`
    : ""
  const about = settingValue("public.about")
  return `<h1>${e(SITE_NAME)}</h1>
<p>${e(about || `${SITE_NAME} is a choir in Rwamagana, Rwanda, with Junior, Senior and Support Members groups.`)}</p>
${eventList ? `<h2>Upcoming events</h2>${eventList}` : ""}
${songList ? `<h2>Our music</h2>${songList}` : ""}
<p><a href="/about">About the choir</a> · <a href="/events">Events</a> · <a href="/music">Music</a> · <a href="/gallery">Gallery</a> · <a href="/contact">Contact</a></p>`
}
