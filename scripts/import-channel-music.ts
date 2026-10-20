/**
 * Brings the choir's YouTube channel into the music catalogue.
 *
 * Run against a specific database via the app's own modules, so every row it
 * writes is identical to what the in-app admin action writes:
 *
 *   DATA_DIR=/tmp/opencode/importtest \
 *   DATABASE_FILE=/tmp/opencode/importtest/chorale.db \
 *   npx tsx scripts/import-channel-music.ts
 *
 * The song list and the rules live in `server/src/services/channel-import.ts`,
 * which the Chairman-only admin action also calls. Prefer that action against
 * the live site: it writes through the running application, so the change is
 * replicated normally. This script is for local databases and verification.
 */
import { one } from "../server/src/db/index.js"
import { importChannelMusic, CHANNEL_TITLE } from "../server/src/services/channel-import.js"

function main() {
  const chairman = one<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM users WHERE email = 'chairman@laportedor.local' ORDER BY created_at LIMIT 1",
  )
  if (!chairman) throw new Error("No Chairman account found — refusing to import without an author for the audit trail.")

  const report = importChannelMusic(chairman.id)

  console.log("Imported from", CHANNEL_TITLE)
  console.log(`  songs created  : ${report.songsCreated}`)
  console.log(`  songs re-used  : ${report.songsReused}`)
  console.log(`  videos linked  : ${report.videosLinked}`)
  console.log(`  group links    : ${report.groupsAssigned}`)
  console.log(`  active songs   : ${report.activeSongs}`)
  console.log(`  playable songs : ${report.playableSongs}`)
}

main()
