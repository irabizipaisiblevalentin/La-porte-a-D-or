/**
 * The search-engine and social-sharing surface.
 *
 * Mounted before the single-page-app fallback so `robots.txt`, `sitemap.xml` and
 * the public pages are answered as themselves — see `services/seo.ts` for why.
 *
 * The public pages get real HTML here AND still load the React app: the rendered
 * content sits inside `<div id="root">`, which React replaces on mount. A crawler
 * that never runs JavaScript sees the content; a visitor sees the app. Neither is
 * sacrificed for the other.
 */
import fs from "node:fs"
import path from "node:path"
import { Router } from "express"
import { webDistDir } from "../config.js"
import { bodyFor, escapeHtml, metaFor, renderContext, robotsTxt, siteOrigin, sitemapXml, structuredData, verificationTags } from "../services/seo.js"

export const seoRouter: Router = Router()

/** Paths the app shell serves but no crawler should index. */
const PRIVATE_PREFIXES = [
  "/app",
  "/api",
  "/admin",
  "/login",
  "/setup",
  "/invite",
  "/reset-password",
  "/checkin",
]

let cachedShell: string | null = null
let cachedShellAt = 0

/** The built `index.html`, re-read when it changes so a deploy is picked up. */
function appShell(): string | null {
  const file = path.join(webDistDir, "index.html")
  try {
    const stat = fs.statSync(file)
    if (cachedShell && stat.mtimeMs === cachedShellAt) return cachedShell
    cachedShell = fs.readFileSync(file, "utf8")
    cachedShellAt = stat.mtimeMs
    return cachedShell
  } catch {
    return null
  }
}

/**
 * Builds the page HTML: the app's own shell, with the head corrected for this URL
 * and the server-rendered content placed inside the root element.
 *
 * Starting from the built shell (rather than a fresh template) means the asset
 * hashes, fonts and the theme script stay exactly as the build produced them.
 */
export function renderPublicPage(pathname: string): string | null {
  const shell = appShell()
  const context = renderContext(pathname)
  if (!shell || !context) return null

  const { meta, origin } = context
  const canonical = `${origin}${meta.path}`
  const socialImage = context.logoUrl ? `${origin}${context.logoUrl}` : null

  // Replace the shell's single generic title and description with this page's.
  let html = shell
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/?>/i,
      `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    )

  const head = [
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    // Search-console ownership tags, so verifying the site (and re-verifying it
    // after a change) is an environment change rather than a code change.
    ...verificationTags(),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml("Chorale La Porte d'Or")}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    socialImage ? `<meta property="og:image" content="${escapeHtml(socialImage)}" />` : "",
    socialImage ? `<meta name="twitter:image" content="${escapeHtml(socialImage)}" />` : "",
    `<script type="application/ld+json">${structuredData(context)}</script>`,
  ]
    .filter(Boolean)
    .join("\n    ")

  html = html.replace(/<\/head>/i, `  ${head}\n  </head>`)

  // The visible content goes inside the root element, which React then replaces
  // when it mounts. It is NOT hidden: a crawler that never runs JavaScript, and a
  // visitor whose bundle is slow to arrive on a sleeping free instance, both need
  // to see real content rather than an empty page. React removes it on mount.
  const body = bodyFor(pathname, context)
  html = html.replace(
    /<div id="root">\s*<\/div>/i,
    `<div id="root"><div id="seo-static">${body}</div></div>`,
  )
  return html
}

/**
 * `robots.txt`, served as a text file rather than falling through to the app shell.
 *
 * Before this the file returned the HTML shell with HTTP 200, so crawlers had no
 * instructions at all and the sitemap was never discovered.
 */
seoRouter.get("/robots.txt", (_req, res) => {
  res.type("text/plain").setHeader("Cache-Control", "public, max-age=3600")
  res.send(robotsTxt())
})

seoRouter.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml").setHeader("Cache-Control", "public, max-age=3600")
  res.send(sitemapXml())
})

/**
 * A public page, rendered server-side.
 *
 * Only the pages `publicPages()` knows about are answered here; everything else
 * falls through to the app shell or a real 404. That is what stops `/anything`
 * from returning 200 with the shell — the "soft 404" that makes a search engine
 * treat every URL as a duplicate of the home page.
 */
seoRouter.get(/^\/(?:about|events|music|contact|gallery(?:\/.*)?)?$/, (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next()
  if (PRIVATE_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next()
  if (!metaFor(req.path)) return next()

  const html = renderPublicPage(req.path)
  if (!html) return next()
  res.setHeader("Cache-Control", "no-cache")
  res.type("html").send(html)
})

/**
 * A page that does not exist must say so.
 *
 * The app shell is served for the exact routes the client actually handles, so
 * deep links keep working. The public pages are listed individually rather than by
 * prefix: `/gallery/anything` would otherwise return 200 with the shell, inventing
 * an endless family of pages that are all duplicates of the gallery — the same
 * soft-404 problem this module exists to remove.
 */
const EXACT_PUBLIC_ROUTES = [
  "/",
  "/about",
  "/events",
  "/music",
  "/contact",
  "/gallery",
  "/gallery/august-2026",
  "/gallery/july-2026",
  "/gallery/performances",
  "/gallery/members",
  "/login",
  "/admin",
  "/admin/login",
  "/setup",
  "/reset-password",
]

/** Routes with a parameter, matched exactly one segment deep. */
const PARAMETERISED_ROUTES = [/^\/checkin\/[^/]+$/, /^\/invite\/[^/]+$/]

/**
 * The signed-in application, whose pages are all under `/app`.
 *
 * Matched as a prefix because the app routes are many and all private — but the
 * prefix is anchored to a segment boundary, so `/application` does not match.
 */
const APP_PREFIX = /^\/app(\/|$)/

export function isClientRoute(pathname: string): boolean {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  if (EXACT_PUBLIC_ROUTES.includes(clean)) return true
  if (APP_PREFIX.test(clean)) return true
  return PARAMETERISED_ROUTES.some((pattern) => pattern.test(clean))
}

/**
 * Injects the search-console ownership tags into any HTML the app serves.
 *
 * A search console proves ownership by fetching one URL and looking for its tag.
 * Which URL it fetches is not always the homepage — and the app serves the React
 * shell for `/login`, `/setup` and every `/app` page. Putting the tag into the
 * shell as well means verification succeeds whichever URL the console chooses,
 * instead of depending on it picking a page that happens to be server-rendered.
 *
 * When no token is configured this returns the HTML untouched, so the common
 * case costs nothing.
 */
export function injectVerificationTags(html: string): string {
  const tags = verificationTags()
  if (tags.length === 0) return html
  if (!html.includes("</head>")) return html
  return html.replace(/<\/head>/i, `  ${tags.join("\n    ")}\n  </head>`)
}
