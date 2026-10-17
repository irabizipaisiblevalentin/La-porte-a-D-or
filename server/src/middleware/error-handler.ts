import type { NextFunction, Request, Response } from "express"
import Database from "better-sqlite3"
import { config, isProd } from "../config.js"
import { HttpError } from "../lib/errors.js"

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/")) {
    return next(new HttpError(404, "not_found", "The requested API endpoint does not exist."))
  }
  next()
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details ?? null } })
    return
  }

  if (error instanceof Database.SqliteError) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      res.status(409).json({ error: { code: "conflict", message: "That record already exists.", details: null } })
      return
    }
    if (error.code.startsWith("SQLITE_CONSTRAINT")) {
      res.status(409).json({ error: { code: "constraint", message: "The request conflicts with an existing record or a required value is missing.", details: null } })
      return
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  if (!isProd) console.error("[error]", error)
  else console.error("[error]", message)

  res.status(500).json({
    error: {
      code: "server_error",
      message: "Something went wrong on our side.",
      details: isProd ? null : { message },
    },
  })
}
