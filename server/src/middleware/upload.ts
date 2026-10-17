import multer from "multer"
import { config } from "../config.js"
import { badRequest } from "../lib/errors.js"

/**
 * All uploads are held in memory, validated by MIME type and size, then written
 * to the correct bucket by the storage service using a generated filename.
 */
const memory = multer.memoryStorage()

function build(limit: number, allowed: string[]) {
  return multer({
    storage: memory,
    limits: { fileSize: limit, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!allowed.includes(file.mimetype)) {
        callback(badRequest(`Unsupported file type (${file.mimetype}). Allowed: ${allowed.join(", ")}.`))
        return
      }
      callback(null, true)
    },
  })
}

export const imageUpload = build(config.uploads.maxImageBytes, config.uploads.allowedImageTypes)
export const audioUpload = build(config.uploads.maxAudioBytes, config.uploads.allowedAudioTypes)
export const documentUpload = build(config.uploads.maxDocumentBytes, config.uploads.allowedDocumentTypes)
