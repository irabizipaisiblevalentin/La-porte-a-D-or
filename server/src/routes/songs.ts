import { Router } from "express"
import { z } from "zod"
import { all, one, run, transaction } from "../db/index.js"
import { badRequest, conflict, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryBool, queryString } from "../lib/http.js"
import { recordAudit } from "../lib/audit.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { audioUpload } from "../middleware/upload.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { listGroups } from "../services/groups.js"
import { deleteFile, saveUpload, type FileRow } from "../services/uploads.js"

export const songsRouter: Router = Router()

const AUDIO_TRACK_TYPES = ["full", "soprano", "alto", "tenor", "bass", "instrumental", "practice", "metronome", "other"] as const
const LYRIC_SECTIONS = ["verse", "chorus", "bridge", "ending", "intro", "interlude"] as const

/**
 * Normalizes a song title for duplicate detection: lowercase, accents stripped,
 * punctuation collapsed to single spaces.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

interface SongRow {
  id: string
  title: string
  normalized_title: string
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
}

interface ProgressRow {
  id: string
  song_id: string
  group_id: string | null
  from_stage_id: string | null
  to_stage_id: string
  progress_percent: number | null
  notes: string | null
  recorded_by: string | null
  created_at: string
  from_stage_key?: string | null
  from_stage_name?: string | null
  to_stage_key?: string | null
  to_stage_name?: string | null
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

const SONG_SELECT = `SELECT s.*, c.key AS category_key, c.name AS category_name,
                            l.key AS stage_key, l.name AS stage_name
                       FROM songs s
                       LEFT JOIN song_categories c ON c.id = s.category_id
                       LEFT JOIN learning_stages l ON l.id = s.learning_stage_id`

function getSong(songId: string): SongRow | undefined {
  return one<SongRow>(`${SONG_SELECT} WHERE s.id = ?`, songId)
}

function optionalId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function assertReference(value: string | null, table: string, label: string): void {
  if (value === null) return
  const row = one<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, value)
  if (!row) throw badRequest(`That ${label} does not exist.`)
}

function listAssignments(songId: string) {
  return all(
    `SELECT sga.group_id, g.key AS group_key, g.name AS group_name, sga.assigned_at, sga.assigned_by
       FROM song_group_assignments sga
       JOIN groups g ON g.id = sga.group_id
      WHERE sga.song_id = ?
      ORDER BY g.name`,
    songId,
  )
}

function getLyric(lyricId: string) {
  return one("SELECT * FROM song_lyrics WHERE id = ?", lyricId)
}

function getProgress(progressId: string): ProgressRow | undefined {
  return one<ProgressRow>(
    `SELECT sph.*, fs.key AS from_stage_key, fs.name AS from_stage_name,
            ts.key AS to_stage_key, ts.name AS to_stage_name
       FROM song_progress_history sph
       LEFT JOIN learning_stages fs ON fs.id = sph.from_stage_id
       JOIN learning_stages ts ON ts.id = sph.to_stage_id
      WHERE sph.id = ?`,
    progressId,
  )
}

interface AudioRow {
  id: string
  song_id: string
  label: string
  track_type: string
  file_path: string
  mime_type: string | null
  file_size: number | null
  duration_seconds: number | null
  rights_note: string | null
  is_authorized: number
  uploaded_by: string | null
  created_at: string
  file_id?: string | null
}

function getAudio(audioId: string): AudioRow | undefined {
  return one<AudioRow>(
    `SELECT a.*, f.id AS file_id
       FROM song_audio_resources a
       LEFT JOIN file_uploads f ON f.path = a.file_path
      WHERE a.id = ?`,
    audioId,
  )
}

function getVideo(videoId: string): VideoRow | undefined {
  return one<VideoRow>("SELECT * FROM videos WHERE id = ?", videoId)
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

songsRouter.get("/taxonomy", requireAuth, (_req, res) => {
  const categories = all("SELECT id, key, name, sort_order FROM song_categories ORDER BY sort_order, name")
  const stages = all("SELECT id, key, name, sort_order FROM learning_stages ORDER BY sort_order, name")
  res.json({ categories, stages, groups: listGroups() })
})

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

songsRouter.get("/", requireAuth, requirePermission("music.read"), (req, res) => {
  const p = pagination(req)
  const search = queryString(req, "search")
  const categoryId = queryString(req, "categoryId")
  const stageId = queryString(req, "stageId")
  const groupId = queryString(req, "groupId")
  const status = queryString(req, "status")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (search) {
    clauses.push("(s.title LIKE ? OR s.composer LIKE ? OR s.arranger LIKE ?)")
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (categoryId) {
    clauses.push("s.category_id = ?")
    params.push(categoryId)
  }
  if (stageId) {
    clauses.push("s.learning_stage_id = ?")
    params.push(stageId)
  }
  if (status) {
    clauses.push("s.status = ?")
    params.push(status)
  }
  if (groupId) {
    clauses.push("s.id IN (SELECT song_id FROM song_group_assignments WHERE group_id = ?)")
    params.push(groupId)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM songs s ${where}`, ...params)?.c ?? 0
  const items = all<SongRow>(
    `${SONG_SELECT} ${where} ORDER BY s.title COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items, total, p))
})

const songCreateSchema = z.object({
  title: z.string().trim().min(1, "Enter the song title.").max(200),
  composer: z.string().trim().max(200).nullable().optional(),
  arranger: z.string().trim().max(200).nullable().optional(),
  language: z.string().trim().max(80).nullable().optional(),
  genre: z.string().trim().max(120).nullable().optional(),
  musicalKey: z.string().trim().max(40).nullable().optional(),
  bpm: z.number().int().min(1).max(400).nullable().optional(),
  timeSignature: z.string().trim().max(20).nullable().optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
  choirSection: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  categoryId: z.string().trim().nullable().optional(),
  stageId: z.string().trim().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
  adminNotes: z.string().trim().max(4000).nullable().optional(),
  youtubeChannelId: z.string().trim().max(120).nullable().optional(),
  force: z.boolean().optional(),
})

songsRouter.post("/", requireAuth, requirePermission("music.write"), (req, res) => {
  const input = parse(songCreateSchema, req.body)
  const normalized = normalizeTitle(input.title)
  if (input.force !== true) {
    const duplicate = one<{ id: string }>(
      "SELECT id FROM songs WHERE normalized_title = ? AND status = 'active'",
      normalized,
    )
    if (duplicate) throw conflict("A song with a similar title already exists. Confirm to add it anyway.", { songId: duplicate.id })
  }

  const categoryId = optionalId(input.categoryId)
  const stageId = optionalId(input.stageId)
  assertReference(categoryId, "song_categories", "song category")
  assertReference(stageId, "learning_stages", "learning stage")

  const songId = id()
  const timestamp = nowIso()
  run(
    `INSERT INTO songs (id, title, normalized_title, composer, arranger, language, genre, musical_key, bpm,
                        time_signature, difficulty, choir_section, description, category_id, learning_stage_id,
                        youtube_channel_id, status, admin_notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    songId, input.title, normalized, input.composer ?? null, input.arranger ?? null, input.language ?? null,
    input.genre ?? null, input.musicalKey ?? null, input.bpm ?? null, input.timeSignature ?? null,
    input.difficulty ?? null, input.choirSection ?? null, input.description ?? null, categoryId, stageId,
    input.youtubeChannelId ?? null, input.status ?? "active", input.adminNotes ?? null,
    req.auth!.id, timestamp, timestamp,
  )

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.create", entityType: "song", entityId: songId,
    summary: `Song "${input.title}" created`, ip: req.ip,
  })
  res.status(201).json({ song: getSong(songId) })
})

songsRouter.get("/:id", requireAuth, requirePermission("music.read"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")

  const videos = all<VideoRow>(
    `SELECT * FROM videos WHERE song_id = ? ORDER BY is_primary DESC, published_at DESC, title COLLATE NOCASE`,
    song.id,
  )
  const lyrics = all("SELECT * FROM song_lyrics WHERE song_id = ? ORDER BY section_order, created_at", song.id)
  const audio = all<AudioRow>(
    `SELECT a.*, f.id AS file_id
       FROM song_audio_resources a
       LEFT JOIN file_uploads f ON f.path = a.file_path
      WHERE a.song_id = ?
      ORDER BY a.created_at`,
    song.id,
  )
  const progress = all<ProgressRow>(
    `SELECT sph.*, fs.key AS from_stage_key, fs.name AS from_stage_name,
            ts.key AS to_stage_key, ts.name AS to_stage_name
       FROM song_progress_history sph
       LEFT JOIN learning_stages fs ON fs.id = sph.from_stage_id
       JOIN learning_stages ts ON ts.id = sph.to_stage_id
      WHERE sph.song_id = ?
      ORDER BY sph.created_at DESC`,
    song.id,
  )
  const assignments = listAssignments(song.id)
  const events = all(
    `SELECT e.id, e.name, e.event_type, e.date, e.status, es.added_at
       FROM event_songs es
       JOIN events e ON e.id = es.event_id
      WHERE es.song_id = ?
      ORDER BY e.date DESC`,
    song.id,
  )
  res.json({ song, videos, lyrics, audio, progress, assignments, events })
})

const songUpdateSchema = songCreateSchema.partial()

songsRouter.patch("/:id", requireAuth, requirePermission("music.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const input = parse(songUpdateSchema, req.body)

  if (input.title !== undefined && input.force !== true) {
    const duplicate = one<{ id: string }>(
      "SELECT id FROM songs WHERE normalized_title = ? AND status = 'active' AND id <> ?",
      normalizeTitle(input.title), song.id,
    )
    if (duplicate) throw conflict("Another song with a similar title already exists. Confirm to save anyway.", { songId: duplicate.id })
  }

  const fields: string[] = []
  const params: (string | number | null)[] = []
  const set = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`)
    params.push(value)
  }

  if (input.title !== undefined) {
    set("title", input.title)
    set("normalized_title", normalizeTitle(input.title))
  }
  if (input.composer !== undefined) set("composer", input.composer ?? null)
  if (input.arranger !== undefined) set("arranger", input.arranger ?? null)
  if (input.language !== undefined) set("language", input.language ?? null)
  if (input.genre !== undefined) set("genre", input.genre ?? null)
  if (input.musicalKey !== undefined) set("musical_key", input.musicalKey ?? null)
  if (input.bpm !== undefined) set("bpm", input.bpm ?? null)
  if (input.timeSignature !== undefined) set("time_signature", input.timeSignature ?? null)
  if (input.difficulty !== undefined) set("difficulty", input.difficulty ?? null)
  if (input.choirSection !== undefined) set("choir_section", input.choirSection ?? null)
  if (input.description !== undefined) set("description", input.description ?? null)
  if (input.adminNotes !== undefined) set("admin_notes", input.adminNotes ?? null)
  if (input.youtubeChannelId !== undefined) set("youtube_channel_id", input.youtubeChannelId ?? null)
  if (input.status !== undefined) set("status", input.status)
  if (input.categoryId !== undefined) {
    const categoryId = optionalId(input.categoryId)
    assertReference(categoryId, "song_categories", "song category")
    set("category_id", categoryId)
  }
  if (input.stageId !== undefined) {
    const stageId = optionalId(input.stageId)
    assertReference(stageId, "learning_stages", "learning stage")
    set("learning_stage_id", stageId)
  }

  if (fields.length === 0) {
    res.json({ song })
    return
  }
  set("updated_at", nowIso())
  run(`UPDATE songs SET ${fields.join(", ")} WHERE id = ?`, ...params, song.id)

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.update", entityType: "song", entityId: song.id,
    summary: `Song "${song.title}" updated`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  res.json({ song: getSong(song.id) })
})

const REFERENCE_TABLES: [string, string][] = [
  ["videos", "song_id"],
  ["song_lyrics", "song_id"],
  ["song_audio_resources", "song_id"],
  ["song_progress_history", "song_id"],
  ["song_group_assignments", "song_id"],
  ["event_songs", "song_id"],
]

function countSongReferences(songId: string): number {
  let total = 0
  for (const [table, column] of REFERENCE_TABLES) {
    const row = one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`, songId)
    total += row?.c ?? 0
  }
  return total
}

songsRouter.delete("/:id", requireAuth, requirePermission("music.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")

  if (queryBool(req, "hard") === true) {
    if (countSongReferences(song.id) > 0) {
      throw conflict("This song has related records (videos, lyrics, audio, progress, assignments or events) and cannot be deleted permanently.")
    }
    run("DELETE FROM songs WHERE id = ?", song.id)
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "song.delete", entityType: "song", entityId: song.id,
      summary: `Song "${song.title}" permanently deleted`, ip: req.ip,
    })
    res.json({ ok: true })
    return
  }

  run("UPDATE songs SET status = 'archived', updated_at = ? WHERE id = ?", nowIso(), song.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.archive", entityType: "song", entityId: song.id,
    summary: `Song "${song.title}" archived`, ip: req.ip,
  })
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------

const lyricCreateSchema = z.object({
  sectionType: z.enum(LYRIC_SECTIONS),
  sectionOrder: z.number().int().min(0).optional(),
  content: z.string().min(1, "Enter the lyrics."),
  language: z.string().trim().max(80).nullable().optional(),
  rightsNote: z.string().trim().max(1000).nullable().optional(),
})

songsRouter.post("/:id/lyrics", requireAuth, requirePermission("music.lyrics.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const input = parse(lyricCreateSchema, req.body)

  const lyricId = id()
  const timestamp = nowIso()
  run(
    `INSERT INTO song_lyrics (id, song_id, section_type, section_order, content, language, rights_note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lyricId, song.id, input.sectionType, input.sectionOrder ?? 0, input.content,
    input.language ?? null, input.rightsNote ?? null, req.auth!.id, timestamp, timestamp,
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.lyrics_add", entityType: "song_lyric", entityId: lyricId,
    summary: `${input.sectionType} lyrics added to "${song.title}"`, ip: req.ip,
  })
  res.status(201).json({ lyric: getLyric(lyricId) })
})

const lyricUpdateSchema = lyricCreateSchema.partial()

songsRouter.patch("/:id/lyrics/:lyricId", requireAuth, requirePermission("music.lyrics.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const lyric = one<{ id: string }>(
    "SELECT id FROM song_lyrics WHERE id = ? AND song_id = ?",
    String(req.params.lyricId), song.id,
  )
  if (!lyric) throw notFound("That lyric section does not exist.")

  const input = parse(lyricUpdateSchema, req.body)
  const fields: string[] = []
  const params: (string | number | null)[] = []
  if (input.sectionType !== undefined) { fields.push("section_type = ?"); params.push(input.sectionType) }
  if (input.sectionOrder !== undefined) { fields.push("section_order = ?"); params.push(input.sectionOrder) }
  if (input.content !== undefined) { fields.push("content = ?"); params.push(input.content) }
  if (input.language !== undefined) { fields.push("language = ?"); params.push(input.language ?? null) }
  if (input.rightsNote !== undefined) { fields.push("rights_note = ?"); params.push(input.rightsNote ?? null) }

  if (fields.length > 0) {
    fields.push("updated_at = ?")
    params.push(nowIso())
    run(`UPDATE song_lyrics SET ${fields.join(", ")} WHERE id = ?`, ...params, lyric.id)
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "song.lyrics_update", entityType: "song_lyric", entityId: lyric.id,
      summary: `Lyrics updated for "${song.title}"`, detail: { fields: Object.keys(input) }, ip: req.ip,
    })
  }
  res.json({ lyric: getLyric(lyric.id) })
})

songsRouter.delete("/:id/lyrics/:lyricId", requireAuth, requirePermission("music.lyrics.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const lyric = one<{ id: string }>(
    "SELECT id FROM song_lyrics WHERE id = ? AND song_id = ?",
    String(req.params.lyricId), song.id,
  )
  if (!lyric) throw notFound("That lyric section does not exist.")

  run("DELETE FROM song_lyrics WHERE id = ?", lyric.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.lyrics_delete", entityType: "song_lyric", entityId: lyric.id,
    summary: `Lyrics removed from "${song.title}"`, ip: req.ip,
  })
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Audio (private, authorised practice tracks)
// ---------------------------------------------------------------------------

const audioCreateSchema = z.object({
  label: z.string().trim().min(1, "Enter a label for this track.").max(160),
  trackType: z.enum(AUDIO_TRACK_TYPES),
  rightsNote: z.string().trim().max(1000).nullable().optional(),
})

songsRouter.post("/:id/audio", requireAuth, requirePermission("music.audio.write"), audioUpload.single("file"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  if (!req.file) throw badRequest("Choose an audio file to upload.")
  const input = parse(audioCreateSchema, req.body)

  const saved = saveUpload({
    bucket: "private",
    entityType: "song_audio",
    entityId: song.id,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    data: req.file.buffer,
    uploadedBy: req.auth!.id,
  })

  const audioId = id()
  run(
    `INSERT INTO song_audio_resources (id, song_id, label, track_type, file_path, mime_type, file_size,
                                       duration_seconds, rights_note, is_authorized, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
    audioId, song.id, input.label, input.trackType, saved.path, req.file.mimetype, req.file.size,
    input.rightsNote ?? null, req.auth!.id, nowIso(),
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.audio_upload", entityType: "song_audio", entityId: audioId,
    summary: `Audio "${input.label}" (${input.trackType}) uploaded for "${song.title}"`, ip: req.ip,
  })
  res.status(201).json({ audio: getAudio(audioId) })
})

songsRouter.delete("/:id/audio/:audioId", requireAuth, requirePermission("music.audio.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const audio = one<{ id: string; file_path: string; label: string }>(
    "SELECT id, file_path, label FROM song_audio_resources WHERE id = ? AND song_id = ?",
    String(req.params.audioId), song.id,
  )
  if (!audio) throw notFound("That audio resource does not exist.")

  transaction(() => {
    const file = one<FileRow>("SELECT * FROM file_uploads WHERE path = ?", audio.file_path)
    if (file) deleteFile(file)
    run("DELETE FROM song_audio_resources WHERE id = ?", audio.id)
  })
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.audio_delete", entityType: "song_audio", entityId: audio.id,
    summary: `Audio "${audio.label}" removed from "${song.title}"`, ip: req.ip,
  })
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const progressCreateSchema = z.object({
  stageId: z.string().trim().min(1, "Choose a learning stage."),
  groupId: z.string().trim().nullable().optional(),
  progressPercent: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

songsRouter.post("/:id/progress", requireAuth, requirePermission("music.progress.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const input = parse(progressCreateSchema, req.body)

  const stage = one<{ id: string; name: string }>("SELECT id, name FROM learning_stages WHERE id = ?", input.stageId)
  if (!stage) throw badRequest("That learning stage does not exist.")
  const groupId = optionalId(input.groupId)
  if (groupId) assertReference(groupId, "groups", "group")

  const progressId = id()
  const timestamp = nowIso()
  transaction(() => {
    run(
      `INSERT INTO song_progress_history (id, song_id, group_id, from_stage_id, to_stage_id, progress_percent, notes, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      progressId, song.id, groupId, song.learning_stage_id, stage.id,
      input.progressPercent ?? null, input.notes ?? null, req.auth!.id, timestamp,
    )
    run("UPDATE songs SET learning_stage_id = ?, updated_at = ? WHERE id = ?", stage.id, timestamp, song.id)
  })
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.progress_update", entityType: "song", entityId: song.id,
    summary: `"${song.title}" moved to stage "${stage.name}"`,
    detail: { stageId: stage.id, groupId, progressPercent: input.progressPercent ?? null }, ip: req.ip,
  })
  res.status(201).json({ progress: getProgress(progressId), song: getSong(song.id) })
})

// ---------------------------------------------------------------------------
// Group assignments
// ---------------------------------------------------------------------------

const groupsAssignSchema = z.object({
  groupIds: z.array(z.string().trim().min(1)).max(20),
})

songsRouter.post("/:id/groups", requireAuth, requirePermission("music.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const input = parse(groupsAssignSchema, req.body)
  const groupIds = Array.from(new Set(input.groupIds))
  for (const groupId of groupIds) assertReference(groupId, "groups", "group")

  const timestamp = nowIso()
  transaction(() => {
    run("DELETE FROM song_group_assignments WHERE song_id = ?", song.id)
    for (const groupId of groupIds) {
      run(
        "INSERT INTO song_group_assignments (song_id, group_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)",
        song.id, groupId, timestamp, req.auth!.id,
      )
    }
  })
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "song.groups_update", entityType: "song", entityId: song.id,
    summary: `Group assignments for "${song.title}" updated`, detail: { groupIds }, ip: req.ip,
  })
  res.json({ assignments: listAssignments(song.id) })
})

// ---------------------------------------------------------------------------
// Video linking
// ---------------------------------------------------------------------------

songsRouter.post("/:id/videos/:videoId/link", requireAuth, requirePermission("music.write"), (req, res) => {
  const song = getSong(String(req.params.id))
  if (!song) throw notFound("That song does not exist.")
  const video = one<{ id: string; status: string }>("SELECT id, status FROM videos WHERE id = ?", String(req.params.videoId))
  if (!video) throw notFound("That video does not exist.")

  const timestamp = nowIso()
  run(
    `UPDATE videos SET song_id = ?, status = 'approved', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
    song.id, req.auth!.id, timestamp, timestamp, video.id,
  )
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "video.link", entityType: "video", entityId: video.id,
    summary: `Video linked to song "${song.title}"`, detail: { songId: song.id }, ip: req.ip,
  })
  res.json({ video: getVideo(video.id) })
})
