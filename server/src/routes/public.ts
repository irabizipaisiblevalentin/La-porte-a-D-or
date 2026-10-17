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
  }>(
    `SELECT s.id, s.title, sc.name AS category,
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

// GET /public/health — alias of /api/health for unauthenticated probes.
publicRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", app: config.appName, time: nowIso() })
})
