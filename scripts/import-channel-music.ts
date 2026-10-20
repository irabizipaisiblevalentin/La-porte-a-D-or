/**
 * One-off: bring the choir's YouTube channel into the music catalogue.
 *
 * Run against a specific database via the app's own modules, so every row it
 * writes is identical to what the admin UI would write:
 *
 *   DATA_DIR=/tmp/opencode/pubtest \
 *   DATABASE_FILE=/tmp/opencode/pubtest/chorale.db \
 *   npx tsx scripts/import-channel-music.ts
 *
 * The video list is the channel's public RSS feed (no API key needed): the same
 * uploads the YouTube Data API would return, and the cover for each is derivable
 * from the video id.
 *
 * Rules, agreed with the choir's Chairman:
 *  - live streams and concert recordings are NOT songs, so they are not imported;
 *  - every imported video is linked to a song and approved + primary, which is
 *    what makes it playable and visible on the public music page;
 *  - every song is assigned to all three groups (full-choir repertoire);
 *  - a song already in the catalogue is re-used and its video linked, never
 *    duplicated.
 */
import { all, one, run, transaction } from "../server/src/db/index.js"
import { nowIso } from "../server/src/lib/time.js"
import { id } from "../server/src/lib/security.js"

interface ChannelEntry {
  videoId: string
  /** The song title, cleaned of the channel's naming noise. */
  title: string
  language: string | null
  categoryKey: string
  publishedAt: string
  /** YouTube's own title, kept as the video's title so nothing is invented. */
  sourceTitle: string
}

// The individual songs from https://www.youtube.com/@laportedor. Live streams
// and concert recordings are deliberately absent — they are not songs.
const SONGS: ChannelEntry[] = [
  {
    videoId: "rQcRy3XuFL4",
    title: "Nzavuga Urukundo",
    language: "Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2026-04-20T00:00:00.000Z",
    sourceTitle: "Nzavuga urukundo",
  },
  {
    videoId: "nuQEhMHrTgE",
    title: "Ihema",
    language: "Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2026-02-27T00:00:00.000Z",
    sourceTitle: "IHEMA by laporte dor choir from KASS",
  },
  {
    videoId: "Fb24-HVwf_o",
    title: "Iherezo Ryiza",
    language: "Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2025-01-24T00:00:00.000Z",
    sourceTitle: "IHEREZO RYIZA SONG BY La Porte D'or choir from KASS",
  },
  {
    videoId: "ZjU1I8amLrU",
    title: "To God Be The Glory (Imana Ihimbazwe)",
    language: "English / Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2025-01-17T00:00:00.000Z",
    sourceTitle: "TO GOD BE THE GLORY  ( IMANA IHIMBAZWE )  By La Porte D'or choir from KASS -",
  },
  {
    videoId: "XtmVmVnIUjw",
    title: "Amarembo",
    language: "Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2025-01-03T00:00:00.000Z",
    sourceTitle: "AMAREMBO  by La Porte D'or choir from KASS",
  },
  {
    videoId: "bFfrPBE07sA",
    title: "Azadufasha",
    language: "Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2024-12-13T00:00:00.000Z",
    sourceTitle: "La Porte D'Or   AZADUFASHA",
  },
  {
    videoId: "cfFLGP4AOrk",
    title: "High & Exalted",
    language: "English",
    categoryKey: "official_performance",
    publishedAt: "2024-11-29T00:00:00.000Z",
    sourceTitle: "La Porte D'Or   HIGH & EXALTED",
  },
  {
    videoId: "xWnoLfmlmUs",
    title: "Atubereve Maso",
    language: "Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2024-11-15T00:00:00.000Z",
    sourceTitle: "La Porte D'Or - ATUBEREYE MASO",
  },
  {
    videoId: "H7dDcrNlmoI",
    title: "Ayi Rutare (Ladies Version)",
    language: "Kinyarwanda",
    categoryKey: "official_performance",
    publishedAt: "2024-10-18T00:00:00.000Z",
    sourceTitle: "La Porte D'Or - AYI RUTARE Ladies Version",
  },
]

/** Already catalogued before this import; linked rather than duplicated. */
const ARAKUMVA = {
  videoId: "Vy8EfKqQNus",
  title: "Arakumva",
  language: "Kinyarwanda",
  categoryKey: "full_choir",
  publishedAt: "2024-01-01T00:00:00.000Z",
  sourceTitle: "La Porte d'Or - ARAKUMVA (Lyrics)",
} satisfies ChannelEntry

const CHANNEL_ID = "UCC--cO2Y7TaXv9lBKBTv-dA"
const CHANNEL_TITLE = "La Porte d'Or"

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** YouTube's own cover for a video, so no tile is ever blank. */
function coverFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

interface Report {
  songsCreated: number
  songsReused: number
  videosLinked: number
  groupsAssigned: number
}

function findOrCreateSong(entry: ChannelEntry, actorId: string, report: Report): string {
  const normalized = normalizeTitle(entry.title)
  const existing = one<{ id: string }>(
    "SELECT id FROM songs WHERE normalized_title = ? AND status = 'active'",
    normalized,
  )
  if (existing) {
    report.songsReused += 1
    return existing.id
  }

  const categoryId = one<{ id: string }>("SELECT id FROM song_categories WHERE key = ?", entry.categoryKey)?.id ?? null
  const stageId = one<{ id: string }>("SELECT id FROM learning_stages WHERE key = 'learning'")?.id ?? null
  const songId = id()
  const timestamp = nowIso()
  run(
    `INSERT INTO songs (id, title, normalized_title, composer, arranger, language, genre, musical_key, bpm,
                        time_signature, difficulty, choir_section, description, category_id, learning_stage_id,
                        youtube_channel_id, status, admin_notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, 'gospel', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 'active', NULL, ?, ?, ?)`,
    songId, entry.title, normalized, entry.language, categoryId, stageId, CHANNEL_ID, actorId, timestamp, timestamp,
  )
  report.songsCreated += 1
  return songId
}

function linkVideo(entry: ChannelEntry, songId: string, actorId: string, report: Report): void {
  const existing = one<{ id: string }>("SELECT id FROM videos WHERE youtube_video_id = ?", entry.videoId)
  const timestamp = nowIso()

  // Only one primary per song; anything already linked for this song keeps it.
  const primaryTaken = (one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM videos WHERE song_id = ? AND is_primary = 1 AND youtube_video_id <> ?",
    songId, entry.videoId,
  )?.c ?? 0) > 0

  if (existing) {
    run(
      `UPDATE videos
          SET title = ?, url = ?, thumbnail_url = COALESCE(thumbnail_url, ?), published_at = COALESCE(published_at, ?),
              channel_id = ?, channel_title = ?, discovery_category = ?, status = 'approved', song_id = ?,
              is_primary = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?`,
      entry.sourceTitle, watchUrl(entry.videoId), coverFor(entry.videoId), entry.publishedAt,
      CHANNEL_ID, CHANNEL_TITLE, entry.categoryKey, songId,
      primaryTaken ? 0 : 1, actorId, timestamp, timestamp, existing.id,
    )
  } else {
    run(
      `INSERT INTO videos (id, youtube_video_id, title, url, thumbnail_url, published_at, channel_id, channel_title,
                            discovery_category, status, song_id, is_primary, added_by, reviewed_by, reviewed_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      id(), entry.videoId, entry.sourceTitle, watchUrl(entry.videoId), coverFor(entry.videoId), entry.publishedAt,
      CHANNEL_ID, CHANNEL_TITLE, entry.categoryKey, songId, primaryTaken ? 0 : 1,
      actorId, actorId, timestamp, timestamp, timestamp,
    )
  }
  report.videosLinked += 1
}

function assignGroups(songId: string, groups: { id: string }[], actorId: string, report: Report): void {
  const timestamp = nowIso()
  for (const group of groups) {
    const already = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM song_group_assignments WHERE song_id = ? AND group_id = ?",
      songId, group.id,
    )?.c ?? 0
    if (already > 0) continue
    run(
      "INSERT INTO song_group_assignments (song_id, group_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)",
      songId, group.id, timestamp, actorId,
    )
    report.groupsAssigned += 1
  }
}

function main() {
  const chairman = one<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM users WHERE email = 'chairman@laportedor.local' ORDER BY created_at LIMIT 1",
  )
  if (!chairman) throw new Error("No Chairman account found — refusing to import without an author for the audit trail.")

  const groups = all<{ id: string; key: string }>("SELECT id, key FROM groups ORDER BY key")
  if (groups.length === 0) throw new Error("No groups found — the database does not look seeded.")

  const report: Report = { songsCreated: 0, songsReused: 0, videosLinked: 0, groupsAssigned: 0 }
  const entries = [ARAKUMVA, ...SONGS]

  transaction(() => {
    for (const entry of entries) {
      const songId = findOrCreateSong(entry, chairman.id, report)
      linkVideo(entry, songId, chairman.id, report)
      assignGroups(songId, groups, chairman.id, report)
    }
  })

  const songs = one<{ c: number }>("SELECT COUNT(*) AS c FROM songs WHERE status = 'active'")?.c ?? 0
  const playable = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM songs s WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM videos v WHERE v.song_id = s.id AND v.status = 'approved')",
  )?.c ?? 0

  console.log("Imported from", CHANNEL_TITLE)
  console.log(`  songs created  : ${report.songsCreated}`)
  console.log(`  songs re-used  : ${report.songsReused}`)
  console.log(`  videos linked  : ${report.videosLinked}`)
  console.log(`  group links    : ${report.groupsAssigned} (groups: ${groups.map((g) => g.key).join(", ")})`)
  console.log(`  active songs   : ${songs}`)
  console.log(`  playable songs : ${playable}`)
}

main()
