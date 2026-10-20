import { NavLink, Outlet } from "react-router-dom"
import { PublicPageHeader } from "../../../components/layout/PublicPageHeader"
import { CHOIR_PHOTOS } from "./photos.generated"

export interface GallerySection {
  /** Path segment after `/gallery`; empty string for the "All" page. */
  to: string
  label: string
  description: string
}

/**
 * One page per gallery navigation item. Each section is a real address, so it
 * can be linked to, bookmarked and shared on its own.
 */
export const GALLERY_SECTIONS: GallerySection[] = [
  { to: "", label: "All photos", description: "Every photograph of the choir, newest collection first." },
  { to: "august-2026", label: "August 2026", description: "The choir's most recent collection of photographs." },
  { to: "july-2026", label: "July 2026", description: "Photographs from the choir's July gathering." },
  { to: "performances", label: "Performances", description: "The choir on stage and in rehearsal." },
  { to: "members", label: "Members", description: "The singers and the people who serve the choir." },
]

/**
 * The gallery shell: the shared masthead and sub-navigation. Each child route
 * renders its own collection underneath.
 */
export function GalleryLayout() {
  return (
    <div className="min-h-dvh bg-ivory dark:bg-charcoal-950">
      <PublicPageHeader
        title="Gallery"
        description={`${CHOIR_PHOTOS.length} photographs of Chorale La Porte d'Or — our singers, our rehearsals and our performances.`}
      >
        <nav className="flex flex-wrap gap-2" aria-label="Gallery sections">
          {GALLERY_SECTIONS.map((section) => (
            <NavLink
              key={section.to || "all"}
              to={section.to ? `/gallery/${section.to}` : "/gallery"}
              end={section.to === ""}
              className={({ isActive }) =>
                `btn btn-sm ${isActive ? "btn-gold" : "btn-outline"}`
              }
            >
              {section.label}
            </NavLink>
          ))}
        </nav>
      </PublicPageHeader>

      <Outlet />

      <div className="mx-auto max-w-7xl px-5 pb-16">
        <p className="muted text-center text-xs">
          Every photograph here was taken of and supplied by Chorale La Porte d'Or.
        </p>
      </div>
    </div>
  )
}
