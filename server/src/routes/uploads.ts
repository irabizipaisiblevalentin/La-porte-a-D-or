import { Router } from "express"
import { z } from "zod"
import { canActOnMember } from "../auth/access.js"
import { one, all } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden, notFound } from "../lib/errors.js"
import { queryString } from "../lib/http.js"
import { imageUpload } from "../middleware/upload.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { deleteFile, openStoredFile, saveUpload, type FileRow } from "../services/uploads.js"

export const uploadsRouter: Router = Router()

const entityTypeSchema = z.object({
  entityType: z.enum(["gallery", "brand", "document"]).default("gallery"),
})

uploadsRouter.post(
  "/brand/logo",
  requireAuth,
  requirePermission("settings.write"),
  imageUpload.single("file"),
  (req, res) => {
    if (!req.file) throw badRequest("Choose an image file to upload.")
    const saved = saveUpload({
      bucket: "public",
      entityType: "brand",
      entityId: null,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      data: req.file.buffer,
      uploadedBy: req.auth!.id,
    })
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "settings.logo_update", entityType: "file", entityId: saved.id,
      summary: "Choir logo updated", ip: req.ip,
    })
    res.status(201).json({ file: saved })
  },
)

uploadsRouter.post(
  "/gallery",
  requireAuth,
  requirePermission("settings.write"),
  imageUpload.single("file"),
  (req, res) => {
    if (!req.file) throw badRequest("Choose an image file to upload.")
    const input = entityTypeSchema.parse(req.body ?? {})
    const saved = saveUpload({
      bucket: "public",
      entityType: input.entityType === "gallery" ? "gallery" : "brand",
      entityId: null,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      data: req.file.buffer,
      uploadedBy: req.auth!.id,
    })
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "gallery.upload", entityType: "file", entityId: saved.id,
      summary: `Gallery image uploaded: ${req.file.originalname.slice(0, 80)}`, ip: req.ip,
    })
    res.status(201).json({ file: saved })
  },
)

uploadsRouter.get("/", requireAuth, requirePermission("settings.read"), (req, res) => {
  const entityType = queryString(req, "entityType")
  const rows = entityType
    ? all<FileRow>("SELECT * FROM file_uploads WHERE entity_type = ? ORDER BY created_at DESC", entityType)
    : all<FileRow>("SELECT * FROM file_uploads ORDER BY created_at DESC LIMIT 200")
  res.json({ files: rows.map(toDto) })
})

uploadsRouter.delete("/:id", requireAuth, (req, res) => {
  const file = one<FileRow>("SELECT * FROM file_uploads WHERE id = ?", String(req.params.id))
  if (!file) throw notFound("That file does not exist.")
  const canDelete =
    (file.bucket === "public" && (canSettings(req) )) ||
    (file.entity_type === "member_photo" && canMemberPhoto(req, file.entity_id)) ||
    (file.entity_type?.startsWith("song_") && canMusic(req))
  if (!canDelete) throw forbidden()
  deleteFile(file)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "file.delete", entityType: "file", entityId: file.id,
    summary: `File deleted: ${file.original_name}`, ip: req.ip,
  })
  res.json({ ok: true })
})

/** Streams a private file after an explicit authorization check on its owning record. */
export const filesRouter: Router = Router()

filesRouter.get("/:id", requireAuth, async (req, res) => {
  const file = one<FileRow>("SELECT * FROM file_uploads WHERE id = ?", String(req.params.id))
  if (!file) throw notFound("That file does not exist.")
  if (file.bucket === "public") {
    res.redirect(302, `/media/${file.path.replace("public/", "")}`)
    return
  }
  if (!authorizeFileAccess(req, file)) throw forbidden()
  // Served from local disk when it is still there, otherwise pulled back out of
  // the object bucket (and cached locally for the next request).
  const opened = await openStoredFile(file)
  if (!opened) throw notFound("That file is no longer available.")
  res.setHeader("Content-Type", file.mime_type ?? opened.mimeType ?? "application/octet-stream")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.original_name)}"`)
  if (opened.size !== null) res.setHeader("Content-Length", String(opened.size))
  opened.stream.pipe(res)
})

function authorizeFileAccess(req: { auth?: import("../auth/access.js").AuthUser }, file: FileRow): boolean {
  const user = req.auth
  if (!user) return false
  switch (file.entity_type) {
    case "member_photo": {
      const member = one<{ id: string; group_id: string }>("SELECT id, group_id FROM members WHERE id = ?", file.entity_id)
      return canActOnMember(user, "member.read", member)
    }
    case "song_audio":
    case "song_lyrics_document":
      return user.permissions["music.read"] !== undefined
    case "application_document": {
      const application = one<{ assigned_group_id: string | null; requested_group_id: string | null }>(
        "SELECT assigned_group_id, requested_group_id FROM applications WHERE id = ?", file.entity_id)
      if (!application) return user.permissions["application.read"] !== undefined
      const groupId = application.assigned_group_id ?? application.requested_group_id
      if (user.permissions["application.read"]?.includes("global")) return true
      const scope = groupId === "grp_senior" ? "senior" : groupId === "grp_junior" ? "junior" : groupId === "grp_members" ? "members" : undefined
      return Boolean(scope && user.permissions["application.read"]?.includes(scope))
    }
    default:
      return user.permissions["settings.read"]?.includes("global") ?? false
  }
}

function canSettings(req: { auth?: import("../auth/access.js").AuthUser }): boolean {
  return req.auth?.permissions["settings.write"]?.includes("global") ?? false
}

function canMusic(req: { auth?: import("../auth/access.js").AuthUser }): boolean {
  return (req.auth?.permissions["music.write"]?.length ?? 0) > 0
}

function canMemberPhoto(req: { auth?: import("../auth/access.js").AuthUser }, memberId: string | null): boolean {
  if (!memberId) return false
  const member = one<{ id: string; group_id: string }>("SELECT id, group_id FROM members WHERE id = ?", memberId)
  return canActOnMember(req.auth!, "member.write", member)
}

function toDto(row: FileRow) {
  return {
    id: row.id,
    bucket: row.bucket,
    path: row.path,
    url: row.bucket === "public" ? `/media/${row.path.replace("public/", "")}` : `/api/files/${row.id}`,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.file_size,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: row.created_at,
  }
}
