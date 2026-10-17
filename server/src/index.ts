import { createApp } from "./app.js"
import { config } from "./config.js"
import { migrate } from "./db/index.js"
import { seed } from "./db/seed.js"
import { sessionMaintenance } from "./auth/session.js"
import { rateLimitMaintenance } from "./middleware/rate-limit.js"
import { clearExpiredLockouts, publishDueAnnouncements } from "./services/scheduler.js"
import { issueSetupToken, needsInitialSetup } from "./routes/setup.js"

migrate((message) => console.log(`[migrate] ${message}`))
seed((message) => console.log(`[seed] ${message}`))

if (needsInitialSetup()) issueSetupToken()
else console.log("[setup] administrator account present")

const app = createApp()
const server = app.listen(config.port, config.host, () => {
  console.log(`[server] ${config.appName} listening on http://${config.host}:${config.port}`)
  console.log(`[server] environment: ${config.env}`)
  if (config.secretIsGenerated) {
    console.log("[server] APP_SECRET was not provided; a local secret was generated at data/.app-secret. Set APP_SECRET in production.")
  }
})

// Real periodic maintenance: publish scheduled announcements, clear expired locks and sessions.
const maintenance = setInterval(() => {
  try {
    const published = publishDueAnnouncements()
    if (published > 0) console.log(`[scheduler] published ${published} scheduled announcement(s)`)
    clearExpiredLockouts()
    sessionMaintenance()
    rateLimitMaintenance()
  } catch (error) {
    console.error("[scheduler]", error)
  }
}, 60_000)
maintenance.unref?.()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`)
    clearInterval(maintenance)
    server.close(() => process.exit(0))
  })
}
