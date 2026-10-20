import { useRef, useState } from "react"
import { Camera, ImageOff, Trash2 } from "lucide-react"
import { api } from "../../api/client"
import { useMutation } from "../../api/hooks"
import { Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, useToast } from "../../components/ui"

/**
 * Photographs taken at an event.
 *
 * A performance happens once and is gone; the pictures are what the choir keeps
 * of it, and what it shows the world afterwards. They live beside the event
 * rather than in a separate gallery, so the person who was there — or who ran it
 * — uploads them without leaving the page.
 *
 * A photograph is stored publicly whenever the event itself is public, which is
 * why this panel warns before publishing: whatever is added here can appear on
 * the public events page.
 */

export interface EventPhoto {
  id: string
  url: string
  originalName: string
  createdAt: string
}

export function EventPhotoGallery({
  eventId,
  photos,
  canWrite,
  isPublic,
  onChanged,
}: {
  eventId: string
  photos: EventPhoto[]
  canWrite: boolean
  isPublic: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [removeTarget, setRemoveTarget] = useState<EventPhoto | null>(null)

  const upload = useMutation(async (file: File) => {
    const body = new FormData()
    body.append("file", file)
    return api.upload<{ photos: EventPhoto[] }>(`/events/${eventId}/photos`, body)
  })

  const remove = useMutation((photoId: string) =>
    api.del<{ photos: EventPhoto[] }>(`/events/${eventId}/photos/${photoId}`),
  )

  async function onChosen(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    const result = await upload.run(file)
    // Reset the input so choosing the same file twice still fires a change.
    if (fileInput.current) fileInput.current.value = ""
    if (!result) {
      toast.error(upload.error?.message ?? "The photograph could not be uploaded.")
      return
    }
    toast.success("Photograph added.")
    onChanged()
  }

  async function confirmRemove() {
    if (!removeTarget) return
    const result = await remove.run(removeTarget.id)
    setRemoveTarget(null)
    if (!result) {
      toast.error(remove.error?.message ?? "The photograph could not be removed.")
      return
    }
    toast.success("Photograph removed.")
    onChanged()
  }

  return (
    <Card>
      <CardHeader
        title="Photographs"
        description={
          photos.length === 0
            ? "Pictures of this event. Nothing added yet."
            : `${photos.length} picture${photos.length === 1 ? "" : "s"} from this event.`
        }
        actions={
          canWrite ? (
            <Button
              variant="outline"
              size="sm"
              icon={<Camera size={15} />}
              loading={upload.saving}
              onClick={() => fileInput.current?.click()}
            >
              Add photograph
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-4">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => onChosen(event.target.files)}
          aria-label="Choose a photograph to add to this event"
        />

        {canWrite && isPublic ? (
          <p className="muted text-xs">
            This event is published to the public site, so a photograph added here appears on the public
            events page too.
          </p>
        ) : null}

        {photos.length === 0 ? (
          <EmptyState
            icon={<ImageOff size={20} />}
            title="No photographs yet"
            description={
              canWrite
                ? "Add the first picture from this event."
                : "Pictures will appear here once the organisers add them."
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo) => (
              <figure key={photo.id} className="group relative overflow-hidden rounded-xl border hairline">
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <img
                    src={photo.url}
                    alt={photo.originalName}
                    loading="lazy"
                    className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </a>
                {canWrite ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1.5 top-1.5"
                    icon={<Trash2 size={14} />}
                    aria-label={`Remove ${photo.originalName}`}
                    onClick={() => setRemoveTarget(photo)}
                  >
                    {""}
                  </Button>
                ) : null}
              </figure>
            ))}
          </div>
        )}
      </CardBody>

      <ConfirmDialog
        open={removeTarget !== null}
        onCancel={() => setRemoveTarget(null)}
        title="Remove this photograph?"
        message={
          removeTarget
            ? isPublic
              ? `"${removeTarget.originalName}" will be removed from this event and from the public site. This cannot be undone.`
              : `"${removeTarget.originalName}" will be removed from this event. This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        tone="danger"
        loading={remove.saving}
        onConfirm={confirmRemove}
      />
    </Card>
  )
}
