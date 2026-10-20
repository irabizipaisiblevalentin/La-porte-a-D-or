import { PhotoGallery, splitPhotos } from "../../../components/ui/PhotoGallery"
import { CHOIR_PHOTOS, CHOIR_COLLECTIONS, type ChoirCollection } from "./photos.generated"
import { EmptyState } from "../../../components/ui"
import { Images } from "lucide-react"

/** The grid for `/gallery` — every photograph the choir supplied. */
export function GalleryAllPage() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-12">
      {CHOIR_PHOTOS.length === 0 ? (
        <EmptyState
          icon={<Images size={22} />}
          title="No photographs yet"
          description="The choir's photographs will appear here once they are added."
        />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {CHOIR_COLLECTIONS.map((collection) => (
              <span key={collection.key}>
                <strong className="text-gold-600 dark:text-gold-300">{collection.count}</strong>{" "}
                <span className="muted">from {collection.name}</span>
              </span>
            ))}
          </div>
          <PhotoGallery photos={CHOIR_PHOTOS} />
        </>
      )}
    </section>
  )
}

/**
 * The grid for a single collection page.
 *
 * A collection is one outing — the photographs are shown in the order they were
 * taken, which reads more naturally than any reshuffle would.
 */
export function GalleryCollectionPage({ collection }: { collection: ChoirCollection }) {
  const photos = CHOIR_PHOTOS.filter((photo) => photo.collection === collection)
  const meta = CHOIR_COLLECTIONS.find((entry) => entry.key === collection)

  return (
    <section className="mx-auto max-w-7xl px-5 py-12">
      {photos.length === 0 ? (
        <EmptyState
          icon={<Images size={22} />}
          title="No photographs in this collection"
          description="There is nothing here yet. Try another gallery section."
        />
      ) : (
        <>
          <p className="muted mb-6 text-sm">
            {photos.length} photograph{photos.length === 1 ? "" : "s"}
            {meta ? ` from ${meta.name}` : ""}.
          </p>
          <PhotoGallery photos={photos} />
        </>
      )}
    </section>
  )
}

/** The "Performances" section: the choir on stage and in rehearsal. */
export function GalleryPerformancesPage() {
  const { onStage } = splitPhotos(CHOIR_PHOTOS)
  return (
    <section className="mx-auto max-w-7xl px-5 py-12">
      <p className="muted mb-6 text-sm">
        {onStage.length} photographs of the choir singing and rehearsing. Use the arrows or your keyboard to move
        between them.
      </p>
      <PhotoGallery photos={onStage} />
    </section>
  )
}

/** The "Members" section: the people who make up the choir. */
export function GalleryMembersPage() {
  const { company } = splitPhotos(CHOIR_PHOTOS)
  return (
    <section className="mx-auto max-w-7xl px-5 py-12">
      <p className="muted mb-6 text-sm">
        {company.length} photographs of the singers, section leaders and support members of Chorale La Porte d'Or.
      </p>
      <PhotoGallery photos={company} />
    </section>
  )
}
