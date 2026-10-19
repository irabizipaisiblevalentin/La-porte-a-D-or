import fs from "node:fs"
import path from "node:path"
import cookieParser from "cookie-parser"
import express, { type Express, type Request } from "express"
import { config, publicStorageDir, restoreAlert, webDistDir } from "./config.js"
import { attachAuth } from "./middleware/auth.js"
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js"
import { generalRateLimit } from "./middleware/rate-limit.js"
import { announcementsRouter } from "./routes/announcements.js"
import { applicationsRouter } from "./routes/applications.js"
import { attendanceRouter } from "./routes/attendance.js"
import { auditRouter } from "./routes/audit.js"
import { authRouter } from "./routes/auth.js"
import { dashboardRouter } from "./routes/dashboard.js"
import { disciplineRouter } from "./routes/discipline.js"
import { discoveryRouter } from "./routes/discovery.js"
import { eventsRouter } from "./routes/events.js"
import { goalsRouter } from "./routes/goals.js"
import { membersRouter } from "./routes/members.js"
import { messagesRouter } from "./routes/messages.js"
import { notificationsRouter } from "./routes/notifications.js"
import { publicRouter } from "./routes/public.js"
import { reportsRouter } from "./routes/reports.js"
import { rolesRouter } from "./routes/roles.js"
import { searchRouter } from "./routes/search.js"
import { settingsRouter } from "./routes/settings.js"
import { setupRouter } from "./routes/setup.js"
import { songsRouter } from "./routes/songs.js"
import { trainingRouter } from "./routes/training.js"
import { filesRouter, uploadsRouter } from "./routes/uploads.js"
import { usersRouter } from "./routes/users.js"

export function createApp(): Express {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", true)

  // Capture the exact bytes of every JSON request so the application webhook can
  // verify an HMAC-SHA256 signature over the raw body (see applications router).
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        ;(req as Request & { rawBody?: Buffer }).rawBody = buf
      },
    }),
  )
  app.use(express.urlencoded({ extended: false, limit: "2mb" }))
  app.use(cookieParser())
  app.use("/api", generalRateLimit())
  app.use(attachAuth)

  app.get("/api/health", (_req, res) => {
    // `warning` is a machine-readable flag; `restoreAlert` carries the detail.
    // Both are absent on a healthy boot, so existing callers are unaffected.
    res.json({
      status: "ok",
      app: config.appName,
      time: new Date().toISOString(),
      ...(restoreAlert ? { warning: "database_restore_failed", restoreAlert } : {}),
    })
  })

  app.use("/api/setup", setupRouter)
  app.use("/api/auth", authRouter)
  app.use("/api/public", publicRouter)
  app.use("/api/dashboard", dashboardRouter)
  app.use("/api/applications", applicationsRouter)
  app.use("/api/members", membersRouter)
  app.use("/api/songs", songsRouter)
  app.use("/api/discovery", discoveryRouter)
  app.use("/api/attendance", attendanceRouter)
  app.use("/api/discipline", disciplineRouter)
  app.use("/api/goals", goalsRouter)
  app.use("/api/events", eventsRouter)
  app.use("/api/training", trainingRouter)
  app.use("/api/announcements", announcementsRouter)
  app.use("/api/notifications", notificationsRouter)
  app.use("/api/messages", messagesRouter)
  app.use("/api/reports", reportsRouter)
  app.use("/api/search", searchRouter)
  app.use("/api/audit", auditRouter)
  app.use("/api/users", usersRouter)
  app.use("/api/roles", rolesRouter)
  app.use("/api/settings", settingsRouter)
  app.use("/api/uploads", uploadsRouter)
  app.use("/api/files", filesRouter)

  // Public media bucket (choir logo, public photographs). Private files are served through
  // an authorization-checked route, never from a static directory.
  app.use("/media", express.static(publicStorageDir, { index: false, maxAge: "1h", fallthrough: true }))

  app.use("/api", notFoundHandler)

  // Single-page application fallback.
  if (fs.existsSync(webDistDir)) {
    app.use(express.static(webDistDir, { index: false }))
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next()
      if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) return next()
      res.sendFile(path.join(webDistDir, "index.html"))
    })
  }

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
