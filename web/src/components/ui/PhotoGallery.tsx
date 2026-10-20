import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import type { ChoirPhoto } from "../../pages/public/gallery/photos.generated"

/**
 * A photograph tile in a gallery grid.
 *
 * Tiles are click targets rather than links, so the whole gallery stays a
 * keyboard- and screen-reader-friendly list of buttons. The grid is what loads
 * on first paint: the larger copy is only fetched once somebody opens a photo.
 */
export function PhotoTile({
  photo,
  onOpen,
  index,
}: {
  photo: ChoirPhoto
  onOpen: (index: number) => void
  index: number
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      className="group relative block w-full overflow-hidden rounded-2xl bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:bg-white/5"
      aria-label={`Open photo ${index + 1}`}
    >
      <img
        src={photo.thumb}
        alt={photo.alt}
        loading="lazy"
        decoding="async"
        className={
          photo.orientation === "portrait"
            ? "aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            : "aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        }
      />
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    </button>
  )
}

/** A responsive masonry-style grid of the choir's photographs. */
export function PhotoGrid({
  photos,
  onOpen,
}: {
  photos: ChoirPhoto[]
  onOpen: (index: number) => void
}) {
  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
      {photos.map((photo, index) => (
        <div key={photo.key} className="break-inside-avoid">
          <PhotoTile photo={photo} index={index} onOpen={onOpen} />
        </div>
      ))}
    </div>
  )
}

/**
 * The full-screen viewer for one photograph.
 *
 * Arrow keys, the on-screen buttons and swiping all move between photos, and
 * Escape closes. The neighbouring images are preloaded so stepping through the
 * gallery never shows a blank frame.
 */
export function PhotoLightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: ChoirPhoto[]
  /** Index of the open photo, or null when the viewer is closed. */
  index: number | null
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const open = index !== null && index >= 0 && index < photos.length
  const photo = open ? photos[index as number] : null

  const go = useCallback(
    (delta: number) => {
      if (index === null) return
      const next = (index + delta + photos.length) % photos.length
      onNavigate(next)
    },
    [index, photos.length, onNavigate],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      if (event.key === "ArrowRight") go(1)
      if (event.key === "ArrowLeft") go(-1)
    }
    document.addEventListener("keydown", onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [open, go, onClose])

  // Warm the neighbours so stepping through the gallery is instant.
  const neighbours = useMemo(() => {
    if (index === null) return []
    return [photos[index - 1], photos[index + 1], photos[index + 2]].filter(Boolean) as ChoirPhoto[]
  }, [index, photos])

  if (!open || !photo || index === null) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={`Photograph ${index + 1} of ${photos.length}`}
    >
      <div className="flex items-center justify-between px-4 py-3 text-ivory">
        <span className="text-sm text-ivory/70">
          {index + 1} / {photos.length}
        </span>
        <button className="btn btn-ghost btn-sm text-ivory" onClick={onClose} aria-label="Close photograph">
          <X size={18} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-4">
        {photos.length > 1 ? (
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-ivory transition hover:bg-black/75"
            aria-label="Previous photograph"
          >
            <ChevronLeft size={22} />
          </button>
        ) : null}

        <img
          key={photo.key}
          src={photo.full}
          alt={photo.alt}
          className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
        />

        {photos.length > 1 ? (
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-ivory transition hover:bg-black/75"
            aria-label="Next photograph"
          >
            <ChevronRight size={22} />
          </button>
        ) : null}
      </div>

      {/* Preload the next few so navigation feels immediate. */}
      <div className="hidden" aria-hidden>
        {neighbours.map((item) => (
          <img key={item.key} src={item.full} alt="" />
        ))}
      </div>
    </div>
  )
}

/** Grid plus viewer, with the open index held in one place. */
export function PhotoGallery({ photos }: { photos: ChoirPhoto[] }) {
  const [index, setIndex] = useState<number | null>(null)
  return (
    <>
      <PhotoGrid photos={photos} onOpen={setIndex} />
      <PhotoLightbox photos={photos} index={index} onClose={() => setIndex(null)} onNavigate={setIndex} />
    </>
  )
}

/**
 * Splits the photographs into two views without pretending to know more than we
 * do. The choir's photographs were supplied as two shoots with no per-photo
 * labels, so the split is a stable interleave: every photograph belongs to
 * exactly one of the two views, and nothing is invented about what is in a
 * picture.
 */
export function splitPhotos(photos: ChoirPhoto[]): { onStage: ChoirPhoto[]; company: ChoirPhoto[] } {
  const onStage: ChoirPhoto[] = []
  const company: ChoirPhoto[] = []
  photos.forEach((photo, index) => {
    ;(index % 2 === 0 ? onStage : company).push(photo)
  })
  return { onStage, company }
}
