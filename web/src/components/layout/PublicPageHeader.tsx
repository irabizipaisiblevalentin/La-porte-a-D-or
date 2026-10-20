import type { ReactNode } from "react"

/**
 * The banner every public page opens with, so About, Gallery, Events, Contact
 * and Music all look like parts of one site. `children` is the supporting copy
 * (counts, links, filters) that sits under the title.
 */
export function PublicPageHeader({
  eyebrow = "Chorale La Porte d'Or",
  title,
  description,
  children,
}: {
  eyebrow?: string
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="border-b border-black/10 bg-white px-5 pb-10 pt-28 dark:border-gold-400/15 dark:bg-charcoal-900">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600 dark:text-gold-300">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">{title}</h1>
        {description ? <div className="muted mt-4 max-w-3xl text-base">{description}</div> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </section>
  )
}
