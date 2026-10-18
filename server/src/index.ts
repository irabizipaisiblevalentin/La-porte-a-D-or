import { createApp } from "./app.js"
import { config } from "./config.js"
import { migrate } from "./db/index.js"
import { seed } from "./db/seed.js"
import { seedDefaultAccounts } from "./db/seed-admins.js"
import { sessionMaintenance } from "./auth/session.js"
import { rateLimitMaintenance } from "./middleware/rate-limit.js"
import { clearExpiredLockouts, publishDueAnnouncements } from "./services/scheduler.js"
import { issueSetupToken, needsInitialSetup } from "./routes/setup.js"

migrate((message) => console.log(`[migrate] ${message}`))
seed((message) => console.log(`[seed] ${message}`))

/**
 * First-boot administrator bootstrap.
 *
 * When the deployer has explicitly opted in with ALLOW_DEFAULT_ACCOUNTS=1, the
 * four default administrator accounts are created — but only the ones that do
 * not exist yet (passwords overridable via CHAIRMAN_PASSWORD /
 * SENIOR_ADMIN_PASSWORD / JUNIOR_ADMIN_PASSWORD / MEMBERS_ADMIN_PASSWORD).
 * Existing accounts are NEVER modified: a password changed by the chairman in
 * the UI survives every restart. Accounts still carrying the public sample
 * password are forced to pick their own at first sign-in (production only).
 *
 * Without the flag, behaviour is unchanged: a one-time setup token is issued
 * only while no administrator exists at all.
 */
function bootstrapAdministrators(): void {
  if (process.env.ALLOW_DEFAULT_ACCOUNTS === "1") {
    try {
      console.log("[setup] ALLOW_DEFAULT_ACCOUNTS=1 — creating any default administrator account that is missing")
      seedDefaultAccounts((message) => console.log(`[setup]   ✓ ${message}`), undefined, "create-missing")
      console.log("[setup] done — existing accounts (passwords, roles) were left untouched")
    } catch (error) {
      console.error("[setup] could not create default administrator accounts:", error)
    }
  }

  if (needsInitialSetup()) issueSetupToken()
  else console.log("[setup] administrator account present")
}

bootstrapAdministrators()

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
