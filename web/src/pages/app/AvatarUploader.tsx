import { useEffect, useRef, useState } from "react"
import { Camera, Loader2, Trash2 } from "lucide-react"
import { api, ApiError } from "../../api/client"
import { useAuth } from "../../auth/AuthProvider"
import { Button, useToast } from "../../components/ui"
import { Avatar } from "../../components/ui/Avatar"

/**
 * Lets the signed-in person set their own profile picture.
 *
 * A picture is what makes a list of names feel like a choir, so this is offered
 * to everyone — a member, a group leader, the Chairman — rather than to
 * administrators only. The server stores it against the account, which means it
 * follows the person into the top bar, the member lists and everywhere else the
 * avatar is drawn.
 *
 * The image is checked before it is sent: a phone photo is often 5–10 MB, and
 * uploading one only to be refused for size wastes the member's data. The file is
 * downscaled in the browser to a square, so every avatar is the same shape and the
 * upload stays small.
 */
const MAX_INPUT_BYTES = 12 * 1024 * 1024
const OUTPUT_SIZE = 512

interface CropResult {
  blob: Blob
  previewUrl: string
}

/**
 * Downscales and centre-crops the chosen image to a square.
 *
 * `createImageBitmap` with `imageOrientation: "from-image"` honours the EXIF
 * rotation flag, which is what stops a portrait photo taken on a phone from
 * arriving on its side.
 */
async function toSquareAvatar(file: File): Promise<CropResult> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = Math.floor((bitmap.width - side) / 2)
  const sy = Math.floor((bitmap.height - side) / 2)
  const target = Math.min(OUTPUT_SIZE, side)

  const canvas = document.createElement("canvas")
  canvas.width = target
  canvas.height = target
  const context = canvas.getContext("2d")
  if (!context) throw new Error("This browser cannot process images.")
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, target, target)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88))
  if (!blob) throw new Error("The image could not be processed.")
  return { blob, previewUrl: canvas.toDataURL("image/jpeg", 0.7) }
}

export function AvatarUploader() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  // A stale preview from the previous account must never be shown after a switch.
  useEffect(() => {
    setPreview(null)
  }, [user?.id])

  if (!user) return null

  async function onFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file (JPEG, PNG or WebP).")
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast.error("That image is too large. Choose one under 12 MB.")
      return
    }

    setBusy(true)
    try {
      const { blob, previewUrl } = await toSquareAvatar(file)
      setPreview(previewUrl)

      const form = new FormData()
      // The server keys off the extension when it names the stored file, so a JPEG
      // is what the canvas produced.
      form.append("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }))
      await api.upload<{ avatarPath: string }>("/auth/avatar", form)
      await refresh()
      toast.success("Your profile picture has been updated.")
    } catch (caught) {
      setPreview(null)
      toast.error(caught instanceof ApiError ? caught.message : "The picture could not be uploaded.")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function removePicture() {
    setBusy(true)
    try {
      await api.del<{ ok: boolean }>("/auth/avatar")
      setPreview(null)
      await refresh()
      toast.success("Your profile picture has been removed.")
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The picture could not be removed.")
    } finally {
      setBusy(false)
    }
  }

  const shown = preview ?? user.avatarPath

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Avatar src={shown} name={user.displayName} size={88} className="shrink-0" />

      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-medium">Profile picture</p>
          <p className="muted text-xs">
            Shown in the top bar, the member directory and anywhere else your name appears. A square photo works best.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onFile(file)
            }}
          />
          <Button
            variant="outline"
            size="sm"
            icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {user.avatarPath || preview ? "Change picture" : "Upload picture"}
          </Button>
          {shown ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={15} />}
              disabled={busy}
              onClick={removePicture}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
