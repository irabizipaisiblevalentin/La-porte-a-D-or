import { Router } from "express"
import { config } from "../config.js"
import { all, one } from "../db/index.js"
import { nowIso, today } from "../lib/time.js"

export const publicRouter: Router = Router()

/** Reads a public setting value verbatim. Missing values stay empty — never invented. */
function settingValue(key: string): string {
  return one<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", key)?.value ?? ""
}

/** Maps a stored `public/...` path to its served `/media/...` URL. */
function publicUrl(path: string): string {
  return `/media/${path.replace(/^public\//, "")}`
}

interface UpcomingEvent {
  id: string
  name: string
  eventType: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
  description: string | null
}

interface FeaturedSong {
  id: string
  title: string
  category: string | null
  thumbnailUrl: string | null
  /** The YouTube id to play when the card is clicked; null when only a still exists. */
  youtubeVideoId: string | null
}

// GET /public/landing — the only public read model. No member, report or admin data.
publicRouter.get("/landing", (_req, res) => {
  const about = settingValue("public.about")
  const contactEmail = settingValue("public.contact_email")
  const contactPhone = settingValue("public.contact_phone")
  const applicationFormUrl = settingValue("public.application_form_url")
  const galleryEnabled = settingValue("public.gallery_enabled") !== "false"

  const brandFiles = all<{ path: string }>(
    `SELECT path FROM file_uploads
      WHERE bucket = 'public' AND entity_type = 'brand'
      ORDER BY created_at DESC, id DESC`,
  )
  const galleryFiles = galleryEnabled
    ? all<{ path: string }>(
        `SELECT path FROM file_uploads
          WHERE bucket = 'public' AND entity_type = 'gallery'
          ORDER BY created_at DESC, id DESC`,
      )
    : []

  const logoUrl = brandFiles.length > 0 ? publicUrl(brandFiles[0].path) : null
  // Hero art falls back to the logo so the landing page always has a usable image.
  const heroImageUrl = galleryFiles.length > 0
    ? publicUrl(galleryFiles[0].path)
    : brandFiles.length > 0 ? publicUrl(brandFiles[0].path) : null
  const galleryUrls = galleryFiles.map((file) => publicUrl(file.path))

  const upcomingEvents = all<{
    id: string
    name: string
    event_type: string
    date: string
    start_time: string | null
    end_time: string | null
    location: string | null
    description: string | null
  }>(
    `SELECT id, name, event_type, date, start_time, end_time, location, description
       FROM events
      WHERE is_public = 1 AND date >= ?
      ORDER BY date ASC, start_time ASC
      LIMIT 6`,
    today(),
  )

  const featuredSongs = all<{
    id: string
    title: string
    category: string | null
    thumbnail_url: string | null
    video_id: string | null
  }>(
    `SELECT s.id, s.title, sc.name AS category,
            COALESCE(
              -- The playable video itself, so a card can start playback on click
              -- instead of only showing a still picture.
              (SELECT v.youtube_video_id FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved' AND v.is_primary = 1
                ORDER BY v.created_at DESC LIMIT 1),
              (SELECT v.youtube_video_id FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved'
                ORDER BY v.created_at DESC LIMIT 1)
            ) AS video_id,
            COALESCE(
              (SELECT v.thumbnail_url FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved' AND v.is_primary = 1
                  AND v.thumbnail_url IS NOT NULL
                ORDER BY v.created_at DESC LIMIT 1),
              (SELECT v.thumbnail_url FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved' AND v.thumbnail_url IS NOT NULL
                ORDER BY v.created_at DESC LIMIT 1)
            ) AS thumbnail_url
       FROM songs s
       LEFT JOIN song_categories sc ON sc.id = s.category_id
      WHERE s.status = 'active'
        AND EXISTS (SELECT 1 FROM videos v WHERE v.song_id = s.id AND v.status = 'approved')
      ORDER BY s.title COLLATE NOCASE
      LIMIT 6`,
  )

  const groupCounts = all<{ group_key: string; c: number }>(
    `SELECT g.key AS group_key, COUNT(m.id) AS c
       FROM groups g
       LEFT JOIN members m ON m.group_id = g.id AND m.status = 'active'
      GROUP BY g.key`,
  )

  const events: UpcomingEvent[] = upcomingEvents.map((row) => ({
    id: row.id,
    name: row.name,
    eventType: row.event_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    description: row.description,
  }))

  const songs: FeaturedSong[] = featuredSongs.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    thumbnailUrl: row.thumbnail_url,
    youtubeVideoId: row.video_id,
  }))

  const countFor = (key: string): number => groupCounts.find((row) => row.group_key === key)?.c ?? 0
  const senior = countFor("senior")
  const junior = countFor("junior")
  const members = countFor("members")

  res.json({
    about,
    contact: { email: contactEmail, phone: contactPhone },
    applicationFormUrl,
    logoUrl,
    heroImageUrl,
    galleryUrls,
    upcomingEvents: events,
    featuredSongs: songs,
    counts: { senior, junior, members, total: senior + junior + members },
  })
})

// GET /public/music — the whole performance catalogue, for the public music page.
// Every song that has an approved video, with the video a click should play.
// No member, application, report or admin data: only what is already public on
// the choir's YouTube channel, presented as the choir's own library.
publicRouter.get("/music", (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
  const category = typeof req.query.category === "string" ? req.query.category.trim() : ""

  const clauses: string[] = ["s.status = 'active'", "EXISTS (SELECT 1 FROM videos v WHERE v.song_id = s.id AND v.status = 'approved')"]
  const params: string[] = []
  if (search) {
    clauses.push("(s.title LIKE ? OR s.composer LIKE ? OR s.arranger LIKE ?)")
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (category) {
    clauses.push("sc.key = ?")
    params.push(category)
  }

  const songs = all<{
    id: string
    title: string
    composer: string | null
    arranger: string | null
    language: string | null
    category_key: string | null
    category_name: string | null
    stage_name: string | null
    description: string | null
    video_id: string | null
    video_title: string | null
    video_published_at: string | null
    thumbnail_url: string | null
    video_count: number
  }>(
    `SELECT s.id, s.title, s.composer, s.arranger, s.language, s.description,
            sc.key AS category_key, sc.name AS category_name, ls.name AS stage_name,
            COALESCE(
              (SELECT v.youtube_video_id FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved' AND v.is_primary = 1
                ORDER BY v.created_at DESC LIMIT 1),
              (SELECT v.youtube_video_id FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved'
                ORDER BY v.created_at DESC LIMIT 1)
            ) AS video_id,
            (SELECT v.title FROM videos v
              WHERE v.song_id = s.id AND v.status = 'approved'
              ORDER BY v.is_primary DESC, v.created_at DESC LIMIT 1) AS video_title,
            (SELECT v.published_at FROM videos v
              WHERE v.song_id = s.id AND v.status = 'approved'
              ORDER BY v.is_primary DESC, v.created_at DESC LIMIT 1) AS video_published_at,
            COALESCE(
              (SELECT v.thumbnail_url FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved' AND v.is_primary = 1
                  AND v.thumbnail_url IS NOT NULL
                ORDER BY v.created_at DESC LIMIT 1),
              (SELECT v.thumbnail_url FROM videos v
                WHERE v.song_id = s.id AND v.status = 'approved' AND v.thumbnail_url IS NOT NULL
                ORDER BY v.created_at DESC LIMIT 1)
            ) AS thumbnail_url,
            (SELECT COUNT(*) FROM videos v WHERE v.song_id = s.id AND v.status = 'approved') AS video_count
       FROM songs s
       LEFT JOIN song_categories sc ON sc.id = s.category_id
       LEFT JOIN learning_stages ls ON ls.id = s.learning_stage_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY s.title COLLATE NOCASE`,
    ...params,
  )

  // Only the categories actually in use, so the filter never offers an empty tab.
  const categories = all<{ key: string; name: string; c: number }>(
    `SELECT sc.key, sc.name, COUNT(*) AS c
       FROM songs s
       JOIN song_categories sc ON sc.id = s.category_id
      WHERE s.status = 'active'
        AND EXISTS (SELECT 1 FROM videos v WHERE v.song_id = s.id AND v.status = 'approved')
      GROUP BY sc.key, sc.name
      ORDER BY sc.name COLLATE NOCASE`,
  )

  const videosTotal = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM videos WHERE status = 'approved'",
  )?.c ?? 0

  res.json({
    songs: songs.map((row) => ({
      id: row.id,
      title: row.title,
      composer: row.composer,
      arranger: row.arranger,
      language: row.language,
      description: row.description,
      categoryKey: row.category_key,
      categoryName: row.category_name,
      stageName: row.stage_name,
      youtubeVideoId: row.video_id,
      videoTitle: row.video_title,
      publishedAt: row.video_published_at,
      thumbnailUrl: row.thumbnail_url,
      videoCount: row.video_count,
    })),
    categories: categories.map((row) => ({ key: row.key, name: row.name, count: row.c })),
    totals: { songs: songs.length, videos: videosTotal },
  })
})

// GET /public/health — alias of /api/health for unauthenticated probes.
publicRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", app: config.appName, time: nowIso() })
})
