import type { RequestHandler } from "express"
import { one } from "../db/index.js"
import { openStoredFile, type FileRow } from "../services/uploads.js"

/**
 * Serves a public upload from the object bucket when the local copy is gone —
 * which is what happens after every restart on hosts with an ephemeral disk.
 *
 * Runs after `express.static`, so the common case (the file is on disk) never
 * touches the bucket. The lookup only happens for paths that exist in
 * `file_uploads`, so an unknown URL can never turn into a bucket request — that
 * would burn through Backblaze's daily transaction allowance.
 */
export const serveMissingPublicMedia: RequestHandler = async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next()

  const relative = safeRelativePath(req.path)
  if (!relative) return next()

  const storedPath = `public/${relative}`
  const file = one<FileRow>(
    "SELECT * FROM file_uploads WHERE bucket = 'public' AND path = ?",
    storedPath,
  )
  if (!file) return next()

  const opened = await openStoredFile(file)
  if (!opened) return next()

  res.setHeader("Content-Type", file.mime_type ?? opened.mimeType ?? "application/octet-stream")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Cache-Control", "public, max-age=3600")
  if (opened.size !== null) res.setHeader("Content-Length", String(opened.size))
  if (req.method === "HEAD") {
    res.end()
    return
  }
  opened.stream.pipe(res)
}

/**
 * Returns the part of a request path after `/media/`, or `null` when it is not a
 * plain relative path (encoded separators, `..`, backslashes and NUL die here).
 */
export function safeRelativePath(requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  const relative = decoded.replace(/^\/+/, "")
  if (!relative) return null
  if (relative.includes("\0") || relative.includes("\\")) return null
  if (relative.split("/").some((segment) => segment === ".." || segment === "")) return null
  return relative
}
