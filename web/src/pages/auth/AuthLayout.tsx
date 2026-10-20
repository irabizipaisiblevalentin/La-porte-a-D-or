import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { ThemeToggle } from "../../components/ui"
import { CHOIR_HERO_PHOTO } from "../../pages/public/gallery/photos.generated"

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10" style={{ background: "var(--color-charcoal-950)" }}>
      <div className="absolute inset-0 -z-10">
        <img src={CHOIR_HERO_PHOTO} alt="" className="h-full w-full object-cover opacity-15" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,11,15,0.85), rgba(10,11,15,0.97))" }} />
      </div>
      <div className="absolute right-4 top-4">
        <ThemeToggle className="text-ivory" />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Link to="/">
            <img src="/logo.png" alt="Chorale La Porte d'Or" className="h-20 w-20 object-contain" />
          </Link>
          <h1 className="mt-3 font-display text-3xl font-semibold text-ivory">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-sm text-sm text-ivory/65">{subtitle}</p> : null}
        </div>
        <div className="card p-6">{children}</div>
        {footer ? <div className="mt-4 text-center text-sm text-ivory/60">{footer}</div> : null}
      </div>
    </div>
  )
}
