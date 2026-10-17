import { migrate } from "./index.js"

const applied = migrate((message) => console.log(`[migrate] ${message}`))
if (applied.length === 0) console.log("[migrate] database already up to date")
else console.log(`[migrate] applied ${applied.length} migration(s)`)
