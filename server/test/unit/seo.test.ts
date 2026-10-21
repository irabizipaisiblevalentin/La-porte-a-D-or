/**
 * The search-engine surface.
 *
 * Before this existed the site was, to a crawler, one page repeated at every
 * address: `robots.txt` and `sitemap.xml` returned the app shell with HTTP 200,
 * every URL returned the same ~1.4 KB HTML with an empty `#root` and an identical
 * `<title>`, and a URL that did not exist was indistinguishable from one that did.
 *
 * These tests pin the properties that fix that, and — just as importantly — the
 * ones that must not regress while fixing it: the app itself still loads, private
 * areas stay out of the sitemap, and no member data leaks into rendered HTML.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "node:http"

const dataDir = mkdtempSync(path.join(tmpdir(), "chorale-seo-"))
process.env.DATA_DIR = dataDir
process.env.DATABASE_FILE = path.join(dataDir, "chorale.db")
process.env.APP_SECRET = "seo-test-secret-at-least-16chars"
delete process.env.NODE_ENV
delete process.env.SESSION_COOKIE_SECURE
process.env.ALLOW_DEFAULT_ACCOUNTS = "1"
process.env.PUBLIC_SITE_URL = "https://choir.example.org"

const { migrate, one, run } = await import("../../src/db/index.js")
const { seed } = await import("../../src/db/seed.js")
const { seedDefaultAccounts, defaultAccounts } = await import("../../src/db/seed-admins.js")
const { createApp } = await import("../../src/app.js")
const { nowIso } = await import("../../src/lib/time.js")
const { escapeHtml, summarise, publicPages, robotsTxt, sitemapXml, verificationTags } = await import("../../src/services/seo.js")
const { isClientRoute, injectVerificationTags } = await import("../../src/routes/seo.js")

let server: Server
let base: string

async function get(url: string) {
  const res = await fetch(base + url)
  const text = await res.text()
  return { status: res.status, text, type: res.headers.get("content-type") ?? "" }
}

before(async () => {
  migrate()
  seed()
  seedDefaultAccounts(() => {}, defaultAccounts(), "create-missing")

  // Real public content, so a rendered page has something in it.
  run(
    `INSERT INTO app_settings (key, value, label, description, updated_at)
     VALUES ('public.about', 'Chorale La Porte d''Or sings in Rwamagana, Rwanda.', 'About', '', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    nowIso(),
  )
  run(
    `INSERT INTO events (id, name, event_type, date, start_time, end_time, location, description,
                         audience_public, is_public, created_at, updated_at)
     VALUES ('evt_seo_concert', 'Umuganura Concert', 'concert', '2026-12-01', '18:00', '20:00',
             'Rwamagana', 'A celebration of the first harvest.', 1, 1, ?, ?)`,
    nowIso(), nowIso(),
  )
  // A private event, which must never appear on a public page.
  run(
    `INSERT INTO events (id, name, event_type, date, location, audience_public, is_public, created_at, updated_at)
     VALUES ('evt_seo_private', 'Junior Committee Meeting', 'meeting', '2026-12-02', 'Choir hall', 0, 0, ?, ?)`,
    nowIso(), nowIso(),
  )

  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

after(() => {
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test("robots.txt is a text file, not the application shell", async () => {
  const res = await get("/robots.txt")
  assert.equal(res.status, 200)
  assert.match(res.type, /text\/plain/)
  assert.doesNotMatch(res.text, /<!doctype/i, "the app shell must never be served as robots.txt")
  assert.match(res.text, /User-agent: \*/)
  assert.match(res.text, /Disallow: \/app\//)
  assert.match(res.text, /Sitemap: https:\/\/choir\.example\.org\/sitemap\.xml/)
})

test("sitemap.xml is real XML listing only public pages", async () => {
  const res = await get("/sitemap.xml")
  assert.equal(res.status, 200)
  assert.match(res.type, /xml/)
  assert.match(res.text, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
  assert.match(res.text, /<loc>https:\/\/choir\.example\.org\/<\/loc>/)
  assert.match(res.text, /<loc>https:\/\/choir\.example\.org\/about<\/loc>/)
  // Private areas must never be advertised to a crawler.
  for (const forbidden of ["/app", "/login", "/admin", "/api/", "/checkin", "/invite", "/setup"]) {
    assert.equal(res.text.includes(`<loc>https://choir.example.org${forbidden}`), false, `${forbidden} must not be in the sitemap`)
  }
})

test("each public page has its own title, description, canonical and h1", async () => {
  const seenTitles = new Set<string>()
  for (const [page, expected] of [
    ["/", "Chorale La Porte d'Or"],
    ["/about", "About"],
    ["/events", "Umuganura Concert"],
    ["/music", "Music"],
    ["/contact", "Contact"],
  ] as const) {
    const res = await get(page)
    assert.equal(res.status, 200, `${page} should be served`)

    const title = /<title>([\s\S]*?)<\/title>/i.exec(res.text)?.[1] ?? ""
    const description = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(res.text)?.[1] ?? ""
    assert.ok(title.length > 5, `${page} needs a real title`)
    assert.ok(description.length > 20, `${page} needs a real description`)
    seenTitles.add(title)

    // The canonical address tells a crawler which URL is the real one.
    assert.match(res.text, new RegExp(`rel="canonical" href="https://choir\\.example\\.org${page}"`))
    // Visible content, server-rendered — this is what a crawler reads.
    assert.match(res.text, /<h1[^>]*>/, `${page} needs a server-rendered h1`)
    assert.ok(res.text.includes(expected), `${page} should contain "${expected}"`)
    assert.match(res.text, /application\/ld\+json/)
  }
  assert.equal(seenTitles.size, 5, "every page must be distinguishable by title alone")
})

test("the rendered pages contain real content, and no private data", async () => {
  const events = await get("/events")
  assert.ok(events.text.includes("Umuganura Concert"), "a public event appears")
  assert.equal(events.text.includes("Junior Committee Meeting"), false, "a private event must never be rendered")

  const home = await get("/")
  const structured = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(home.text)?.[1]
  assert.ok(structured, "structured data is present")
  const parsed = JSON.parse(structured!) as { "@graph": Array<{ "@type": string }> }
  const types = parsed["@graph"].map((node) => node["@type"])
  assert.ok(types.includes("MusicGroup"), "the choir is described as a MusicGroup")
  assert.ok(types.includes("WebSite"))
})

test("a URL that does not exist is a real 404, not a duplicate of the home page", async () => {
  for (const bogus of [
    "/this-page-does-not-exist",
    "/about/nonsense/deep",
    "/gallery/not-a-real-collection",
    "/gallery/performances/extra",
    "/application",
  ]) {
    const res = await get(bogus)
    assert.equal(res.status, 404, `${bogus} must be a real 404`)
  }
})

test("every genuine route still works", async () => {
  for (const real of [
    "/", "/about", "/events", "/music", "/contact", "/gallery",
    "/gallery/august-2026", "/gallery/july-2026", "/gallery/performances", "/gallery/members",
    "/login", "/admin", "/admin/login", "/setup", "/reset-password",
    "/app", "/app/members", "/checkin/abc123", "/invite/abc123",
  ]) {
    const res = await get(real)
    assert.equal(res.status, 200, `${real} should be served`)
  }
})

test("the app still loads over a rendered page", async () => {
  // The server-rendered content sits inside #root and React replaces it on mount.
  // Serving it must not remove the bundle that does the replacing.
  const res = await get("/about")
  assert.match(res.text, /<div id="root">/)
  assert.match(res.text, /<script type="module"/)
})

test("the route allow-list is exact, so no page family is invented", () => {
  assert.equal(isClientRoute("/"), true)
  assert.equal(isClientRoute("/gallery/performances"), true)
  assert.equal(isClientRoute("/app/members"), true)
  assert.equal(isClientRoute("/checkin/abc"), true)
  assert.equal(isClientRoute("/gallery/anything-else"), false, "an unlisted gallery path is not a route")
  assert.equal(isClientRoute("/application"), false, "the /app prefix must anchor to a segment boundary")
  assert.equal(isClientRoute("/api/health"), false)
  assert.equal(isClientRoute("/nonsense"), false)
})

test("rendered text is escaped, so content can never break out of a tag", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
  assert.equal(escapeHtml("O'Brien & Sons"), "O&#39;Brien &amp; Sons")
  // The choir's own apostrophe is the live case: it must not terminate an attribute.
  assert.ok(!escapeHtml("La Porte d'Or").includes("'"))
})

test("descriptions are trimmed to a sensible length on a word boundary", () => {
  const long = "word ".repeat(80)
  const short = summarise(long, 100)
  assert.ok(short.length <= 101, `expected <=101, got ${short.length}`)
  assert.ok(short.endsWith("…"))
  assert.equal(summarise("A short line."), "A short line.")
})

test("every sitemap entry is a page the server actually serves", async () => {
  // A sitemap that advertises 404s is worse than no sitemap: it burns crawl
  // budget on nothing. Each listed URL must resolve.
  const listed = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
  assert.ok(listed.length >= 6, `expected several pages, got ${listed.length}`)
  for (const url of listed) {
    const pathOnly = new URL(url).pathname
    assert.equal(isClientRoute(pathOnly), true, `${pathOnly} is advertised but is not a served route`)
  }
})

test("the page list and robots agree on what is public", () => {  const indexable = publicPages().filter((page) => page.indexable)
  assert.ok(indexable.length >= 6)
  // Compare whole directive lines: "Disallow: /app/" contains "Disallow: /", so a
  // substring check would wrongly report the home page as disallowed.
  const disallowed = new Set(
    robotsTxt()
      .split("\n")
      .filter((line) => line.startsWith("Disallow:"))
      .map((line) => line.slice("Disallow:".length).trim()),
  )
  for (const page of indexable) {
    assert.equal(disallowed.has(page.path), false, `${page.path} is indexable but disallowed`)
  }
  // Sanity: the sitemap carries exactly the indexable pages.
  const count = [...sitemapXml().matchAll(/<loc>/g)].length
  assert.equal(count, indexable.length)
})

test("a search-console token is published on every page, when configured", async () => {
  // Unset: nothing is emitted, so the common case costs nothing and no empty
  // tag is ever served.
  assert.deepEqual(verificationTags({}), [])

  // The token is what goes inside `content`, taken from the environment so
  // verifying the site needs no code change.
  const tags = verificationTags({ GOOGLE_SITE_VERIFICATION: "abc123token-_" })
  assert.deepEqual(tags, ['<meta name="google-site-verification" content="abc123token-_" />'])
  assert.deepEqual(verificationTags({ BING_SITE_VERIFICATION: "bing-token" }), [
    '<meta name="msvalidate.01" content="bing-token" />',
  ])

  // A token is never allowed to break out of its attribute, even if someone
  // pastes fragments of the whole tag instead of just the value.
  const hostile = verificationTags({ GOOGLE_SITE_VERIFICATION: 'x"><script>alert(1)</script>' })
  assert.equal(hostile.length, 1)
  // Check the attribute value itself: the tag's own markup legitimately contains
  // `<` and `"`, so the whole string cannot be tested for them.
  const value = /content="([^"]*)"/.exec(hostile[0])?.[1] ?? ""
  assert.doesNotMatch(value, /[<>"']/, "no tag-breaking characters survive: " + value)
})

test("the token reaches every served page, including private ones", () => {
  // The token is read from the environment at call time, so a test can set it
  // without re-booting the server.
  const shell = '<html><head><title>x</title></head><body><div id="root"></div></body></html>'
  const previous = process.env.GOOGLE_SITE_VERIFICATION
  try {
    process.env.GOOGLE_SITE_VERIFICATION = "verify-me-123"
    const injected = injectVerificationTags(shell)
    assert.match(injected, /<meta name="google-site-verification" content="verify-me-123" \/>/)
    // ...and the app is otherwise untouched.
    assert.match(injected, /<div id="root"><\/div>/)
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_SITE_VERIFICATION
    else process.env.GOOGLE_SITE_VERIFICATION = previous
  }

  // With no token configured, HTML passes through byte for byte.
  assert.equal(injectVerificationTags(shell), shell)
})
