import { Router } from "express"
import { z } from "zod"
import { all, one, run, transaction } from "../db/index.js"
import { refreshIntegrationStatuses } from "../db/seed.js"
import { badRequest, conflict, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { recordAudit } from "../lib/audit.js"
import { decryptSecret } from "../lib/secrets-box.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { YouTubeApiError, getVideos, listChannelUploads, searchChannels, type VideoMetadata } from "../integrations/youtube.js"

export const discoveryRouter: Router = Router()

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

interface IntegrationRow {
  value_plain: string | null
  value_encrypted: string | null
  status: string
}

interface RunRow {
  id: string
  integration: string
  trigger: string
  status: string
  summary: string | null
  detail: string | null
  started_at: string
  finished_at: string | null
}

interface VideoRow {
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
  added_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface ChannelConfig {
  id: string
  title: string | null
  verifiedAt: string | null
}

function integrationRow(key: string): IntegrationRow | undefined {
  return one<IntegrationRow>(
    "SELECT value_plain, value_encrypted, status FROM integration_settings WHERE key = ?",
    key,
  )
}

function integrationValue(key: string): string | null {
  const row = integrationRow(key)
  if (!row) return null
  if (row.value_plain && row.value_plain.trim()) return row.value_plain.trim()
  return decryptSecret(row.value_encrypted)
}

function youtubeApiKey(): string | null {
  const row = integrationRow("youtube_api_key")
  if (!row || row.status !== "configured") return null
  return decryptSecret(row.value_encrypted)
}

function configuredChannel(): ChannelConfig | null {
  const channelId = integrationValue("youtube_channel_id")
  if (!channelId) return null
  return {
    id: channelId,
    title: integrationValue("youtube_channel_title"),
    verifiedAt: integrationValue("youtube_channel_verified_at"),
  }
}

function runDto(row: RunRow) {
  return {
    id: row.id,
    integration: row.integration,
    trigger: row.trigger,
    status: row.status,
    summary: row.summary,
    detail: row.detail,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

function getVideo(videoId: string): VideoRow | undefined {
  return one<VideoRow>("SELECT * FROM videos WHERE id = ?", videoId)
}

/** Best-effort classification into an existing song-category key. Never overwrites an admin choice. */
function guessCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase()
  if (/(instrumental|backing track|karaoke|playback|minus one)/.test(text)) return "instrumental_backing"
  if (/(tutorial|how to sing|learn the|voice part|lesson|sing along)/.test(text)) return "song_tutorial"
  if (/(soprano|alto|tenor|bass|section practice|part practice|voice parts)/.test(text)) return "section_practice"
  if (/(rehearsal|rehearsing|practice session)/.test(text)) return "rehearsal"
  if (/(live|concert|on stage|performance at)/.test(text)) return "live_performance"
  if (/(official|full choir|choir performance)/.test(text)) return "official_performance"
  return "other_choir_music"
}

/** Extracts an 11-character video ID from a YouTube URL or a bare video ID. */
export function parseYouTubeId(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^[\w-]{11}$/.test(value)) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase()
  if (host === "youtu.be") {
    const candidate = url.pathname.split("/").filter(Boolean)[0]
    return candidate && /^[\w-]{11}$/.test(candidate) ? candidate : null
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const queryId = url.searchParams.get("v")
    if (queryId && /^[\w-]{11}$/.test(queryId)) return queryId
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
      const candidate = parts[1]
      return /^[\w-]{11}$/.test(candidate) ? candidate : null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

discoveryRouter.get("/status", requireAuth, requirePermission("music.discovery"), (_req, res) => {
  const apiConfigured = integrationRow("youtube_api_key")?.status === "configured"
  const channel = configuredChannel()
  const lastRun = one<RunRow>(
    "SELECT * FROM integration_runs WHERE integration = 'youtube' ORDER BY started_at DESC, rowid DESC LIMIT 1",
  )
  res.json({
    apiConfigured,
    channel: channel ? { id: channel.id, title: channel.title, verifiedAt: channel.verifiedAt } : null,
    lastRun: lastRun ? runDto(lastRun) : null,
  })
})

// ---------------------------------------------------------------------------
// Channel search & verification
// ---------------------------------------------------------------------------

discoveryRouter.get("/channels", requireAuth, requirePermission("music.discovery"), async (req, res) => {
  const configured = integrationRow("youtube_api_key")?.status === "configured"
  if (!configured) {
    res.json({
      configured: false,
      candidates: [],
      message: "The YouTube Data API key is not configured. Add it in Settings before searching for the official channel.",
    })
    return
  }
  const query = queryString(req, "q")
  if (!query) throw badRequest("Enter a channel name or search term.")
  const apiKey = youtubeApiKey()
  if (!apiKey) throw badRequest("The YouTube Data API key is not configured.")
  const candidates = await searchChannels(apiKey, query)
  res.json({ configured: true, candidates })
})

const verifyChannelSchema = z.object({
  channelId: z.string().trim().min(1, "Enter the channel ID.").max(120),
  title: z.string().trim().min(1, "Enter the channel name.").max(200),
})

discoveryRouter.post("/verify-channel", requireAuth, requirePermission("music.discovery"), (req, res) => {
  const input = parse(verifyChannelSchema, req.body)
  if (!/^UC[\w-]+$/.test(input.channelId)) {
    throw badRequest("A YouTube channel ID starts with 'UC'. Check the value.", { fields: { channelId: "Channel IDs start with UC." } })
  }
  const timestamp = nowIso()
  transaction(() => {
    run("UPDATE integration_settings SET value_plain = ?, updated_by = ?, updated_at = ? WHERE key = 'youtube_channel_id'",
      input.channelId, req.auth!.id, timestamp)
    run("UPDATE integration_settings SET value_plain = ?, updated_by = ?, updated_at = ? WHERE key = 'youtube_channel_title'",
      input.title, req.auth!.id, timestamp)
    run("UPDATE integration_settings SET value_plain = ?, updated_by = ?, updated_at = ? WHERE key = 'youtube_channel_verified_at'",
      timestamp, req.auth!.id, timestamp)
  })
  refreshIntegrationStatuses()
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "integration.youtube_channel_verify", entityType: "integration", entityId: input.channelId,
    summary: `Official YouTube channel verified: ${input.title}`, detail: { channelId: input.channelId }, ip: req.ip,
  })
  res.json({ channel: { id: input.channelId, title: input.title, verifiedAt: timestamp } })
})

// ---------------------------------------------------------------------------
// Discovery run
// ---------------------------------------------------------------------------

const runSchema = z.object({
  maxResults: z.number().int().min(1).max(50).optional(),
  includePlaylists: z.boolean().optional(),
})

discoveryRouter.post("/run", requireAuth, requirePermission("music.discovery"), async (req, res) => {
  const input = parse(runSchema, req.body ?? {})
  const apiKey = youtubeApiKey()
  if (!apiKey) throw badRequest("The YouTube Data API key is not configured. Add it in Settings before running discovery.")
  const channel = configuredChannel()
  if (!channel) throw badRequest("No official YouTube channel has been verified yet.")

  const runId = id()
  const startedAt = nowIso()
  run(
    "INSERT INTO integration_runs (id, integration, trigger, status, summary, detail, started_at, finished_at) VALUES (?, 'youtube', 'manual', 'running', NULL, NULL, ?, NULL)",
    runId, startedAt,
  )

  try {
    const uploads = await listChannelUploads(apiKey, channel.id, input.maxResults ?? 25)
    let fetched = 0
    let inserted = 0
    let updated = 0
    transaction(() => {
      for (const video of uploads.videos) {
        fetched += 1
        const category = guessCategory(video.title, video.description)
        const result = run(
          `INSERT OR IGNORE INTO videos (id, youtube_video_id, title, url, thumbnail_url, published_at, channel_id, channel_title,
                                          discovery_category, status, song_id, is_primary, added_by, reviewed_by, reviewed_at, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', NULL, 0, ?, NULL, NULL, NULL, ?, ?)`,
          id(), video.id, video.title, video.url, video.thumbnailUrl, video.publishedAt,
          video.channelId ?? channel.id, video.channelTitle ?? channel.title, category,
          req.auth!.id, startedAt, startedAt,
        )
        if (result.changes > 0) {
          inserted += 1
          continue
        }
        // Existing row: refresh metadata only, preserving admin-set status, song link and category.
        run(
          `UPDATE videos
              SET title = ?, url = ?, thumbnail_url = ?, published_at = ?, channel_id = ?, channel_title = ?,
                  discovery_category = COALESCE(discovery_category, ?), updated_at = ?
            WHERE youtube_video_id = ?`,
          video.title, video.url, video.thumbnailUrl, video.publishedAt,
          video.channelId ?? channel.id, video.channelTitle ?? channel.title, category,
          nowIso(), video.id,
        )
        updated += 1
      }
    })

    const summary = `${fetched} videos checked from ${channel.title ?? channel.id}; ${inserted} new, ${updated} refreshed`
    run(
      "UPDATE integration_runs SET status = 'success', summary = ?, detail = ?, finished_at = ? WHERE id = ?",
      summary,
      JSON.stringify({ fetched, inserted, updated, includePlaylists: input.includePlaylists ?? false }),
      nowIso(), runId,
    )
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "integration.youtube_run", entityType: "integration", entityId: runId,
      summary, detail: { fetched, inserted, updated }, ip: req.ip,
    })
    res.json({ fetched, inserted, updated, runId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube discovery failed."
    run("UPDATE integration_runs SET status = 'error', summary = ?, finished_at = ? WHERE id = ?", message, nowIso(), runId)
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "integration.youtube_run_failed", entityType: "integration", entityId: runId,
      summary: message, ip: req.ip,
    })
    if (error instanceof YouTubeApiError) throw badRequest(message)
    throw error
  }
})

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

discoveryRouter.get("/queue", requireAuth, requirePermission("music.discovery"), (req, res) => {
  const p = pagination(req)
  const status = queryString(req, "status")
  const category = queryString(req, "category")
  const search = queryString(req, "search")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (status) {
    clauses.push("v.status = ?")
    params.push(status)
  }
  if (category) {
    clauses.push("v.discovery_category = ?")
    params.push(category)
  }
  if (search) {
    clauses.push("(v.title LIKE ? OR v.channel_title LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM videos v ${where}`, ...params)?.c ?? 0
  const items = all(
    `SELECT v.*, s.title AS song_title
       FROM videos v
       LEFT JOIN songs s ON s.id = v.song_id
       ${where}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items, total, p))
})

// ---------------------------------------------------------------------------
// Manual import (works without an API key)
// ---------------------------------------------------------------------------

const importSchema = z.object({
  youtubeUrl: z.string().trim().max(500).optional(),
  videoId: z.string().trim().max(200).optional(),
  title: z.string().trim().max(300).optional(),
  songId: z.string().trim().nullable().optional(),
  category: z.enum(DISCOVERY_CATEGORIES).nullable().optional(),
})

discoveryRouter.post("/import", requireAuth, requirePermission("music.discovery"), async (req, res) => {
  const input = parse(importSchema, req.body)
  const raw = input.videoId ?? input.youtubeUrl ?? ""
  const videoId = parseYouTubeId(raw)
  if (!videoId) {
    throw badRequest("That does not look like a YouTube URL or video ID.", {
      fields: { youtubeUrl: "Enter a YouTube URL or an 11-character video ID." },
    })
  }

  const existing = one<{ id: string }>("SELECT id FROM videos WHERE youtube_video_id = ?", videoId)
  if (existing) throw conflict("That video is already in the music catalogue.", { videoId: existing.id })

  let songId: string | null = null
  if (input.songId) {
    const song = one<{ id: string }>("SELECT id FROM songs WHERE id = ?", input.songId)
    if (!song) throw badRequest("That song does not exist.")
    songId = song.id
  }

  let metadata: VideoMetadata | null = null
  const apiKey = youtubeApiKey()
  if (apiKey) {
    const results = await getVideos(apiKey, [videoId])
    metadata = results[0] ?? null
  }

  const title = metadata?.title ?? input.title?.trim()
  if (!title) {
    throw badRequest("A title is required when the YouTube API is not configured.", { fields: { title: "Enter the video title." } })
  }

  const timestamp = nowIso()
  const status = songId ? "approved" : "discovered"
  const category = input.category ?? guessCategory(title, metadata?.description ?? "")
  const rowId = id()
  run(
    `INSERT INTO videos (id, youtube_video_id, title, url, thumbnail_url, published_at, channel_id, channel_title,
                          discovery_category, status, song_id, is_primary, added_by, reviewed_by, reviewed_at, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)`,
    rowId, videoId, title, metadata?.url ?? `https://www.youtube.com/watch?v=${videoId}`,
    metadata?.thumbnailUrl ?? null, metadata?.publishedAt ?? null,
    metadata?.channelId ?? integrationValue("youtube_channel_id"),
    metadata?.channelTitle ?? integrationValue("youtube_channel_title"),
    category, status, songId, req.auth!.id, songId ? req.auth!.id : null, songId ? timestamp : null,
    timestamp, timestamp,
  )

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "video.import", entityType: "video", entityId: rowId,
    summary: `Video imported: ${title}`, detail: { youtubeVideoId: videoId, songId }, ip: req.ip,
  })
  res.status(201).json({ video: getVideo(rowId) })
})

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

const videoPatchSchema = z.object({
  status: z.enum(["discovered", "approved", "rejected"]).optional(),
  songId: z.string().trim().nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(DISCOVERY_CATEGORIES).nullable().optional(),
})

discoveryRouter.patch("/videos/:id", requireAuth, requirePermission("music.write"), (req, res) => {
  const video = getVideo(String(req.params.id))
  if (!video) throw notFound("That video does not exist.")
  const input = parse(videoPatchSchema, req.body)
  const timestamp = nowIso()

  const fields: string[] = []
  const params: (string | number | null)[] = []
  const set = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`)
    params.push(value)
  }

  let nextStatus = video.status
  let nextSongId = video.song_id
  let nextPrimary = video.is_primary

  if (input.status !== undefined) {
    nextStatus = input.status
    set("status", input.status)
    set("reviewed_by", req.auth!.id)
    set("reviewed_at", timestamp)
  }
  if (input.songId !== undefined) {
    const songId = input.songId?.trim() ? input.songId : null
    if (songId) {
      const song = one<{ id: string }>("SELECT id FROM songs WHERE id = ?", songId)
      if (!song) throw badRequest("That song does not exist.")
    }
    nextSongId = songId
    set("song_id", songId)
  }
  if (input.category !== undefined) set("discovery_category", input.category)
  if (input.notes !== undefined) set("notes", input.notes ?? null)
  if (input.isPrimary !== undefined) {
    nextPrimary = input.isPrimary ? 1 : 0
    set("is_primary", nextPrimary)
  }

  // Approving a song's first video makes it primary unless the caller chose otherwise.
  if (input.isPrimary === undefined && nextStatus === "approved" && nextSongId && nextPrimary !== 1) {
    const primary = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM videos WHERE song_id = ? AND is_primary = 1 AND id <> ?",
      nextSongId, video.id,
    )
    if ((primary?.c ?? 0) === 0) {
      nextPrimary = 1
      set("is_primary", 1)
    }
  }

  if (fields.length === 0) {
    res.json({ video })
    return
  }
  set("updated_at", timestamp)
  run(`UPDATE videos SET ${fields.join(", ")} WHERE id = ?`, ...params, video.id)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "video.update", entityType: "video", entityId: video.id,
    summary: `Video "${video.title}" updated`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ video: getVideo(video.id) })
})

discoveryRouter.post("/videos/:id/reject", requireAuth, requirePermission("music.write"), (req, res) => {
  const video = getVideo(String(req.params.id))
  if (!video) throw notFound("That video does not exist.")
  const timestamp = nowIso()
  run(
    "UPDATE videos SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
    req.auth!.id, timestamp, timestamp, video.id,
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "video.reject", entityType: "video", entityId: video.id,
    summary: `Video rejected: ${video.title}`, ip: req.ip,
  })
  res.json({ video: getVideo(video.id) })
})
