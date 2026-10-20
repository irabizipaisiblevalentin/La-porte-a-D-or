import { useEffect, useState, type ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"
import { LogIn, Menu, X } from "lucide-react"
import { ThemeToggle } from "../../components/ui"

const LINKS = [
  { label: "Home", to: "/" },
  { label: "About", to: "/about" },
  { label: "Music", to: "/music" },
  { label: "Gallery", to: "/gallery" },
  { label: "Events", to: "/events" },
  { label: "Contact", to: "/contact" },
]

export const APPLICATION_FORM_URL = "https://forms.gle/JZJmWZNMQAYNm5uq5"
export const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@laportedor"

export function PublicLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => setOpen(false), [location.pathname, location.hash])

  return (
    <div className="min-h-dvh bg-ivory dark:bg-charcoal-950">
      <header
        className="fixed inset-x-0 top-0 z-40 border-b transition-colors"
        style={{
          borderColor: scrolled ? "color-mix(in srgb, var(--color-gold-400) 22%, transparent)" : "transparent",
          background: scrolled ? "color-mix(in srgb, var(--color-charcoal-950) 88%, transparent)" : "transparent",
          backdropFilter: scrolled ? "blur(10px)" : "none",
        }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5 text-ivory">
            <img src="/logo.png" alt="Chorale La Porte d'Or" className="h-10 w-10 object-contain drop-shadow" />
            <span className="leading-tight">
              <span className="block font-display text-lg font-semibold">La Porte d'Or</span>
              <span className="block text-[10px] uppercase tracking-[0.2em] text-gold-300">Chorale</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="btn btn-ghost btn-sm text-ivory/85">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle className="text-ivory" />
            <a href={APPLICATION_FORM_URL} target="_blank" rel="noopener noreferrer" className="btn btn-gold btn-sm hidden sm:inline-flex">
              Apply for Membership
            </a>
            <Link to="/login" className="btn btn-outline btn-sm text-ivory" aria-label="Member login">
              <LogIn size={15} /> <span className="hidden sm:inline">Member Login</span>
            </Link>
            <Link to="/admin/login" className="btn btn-ghost btn-sm hidden text-ivory md:inline-flex">
              Admin
            </Link>
            <button className="btn btn-ghost btn-sm text-ivory lg:hidden" onClick={() => setOpen((value) => !value)} aria-label="Toggle menu">
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-gold-400/20 bg-charcoal-950/95 px-5 py-3 lg:hidden">
            <nav className="flex flex-col">
              {LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="sidebar-link text-ivory hover:text-gold-200"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <a href={APPLICATION_FORM_URL} target="_blank" rel="noopener noreferrer" className="btn btn-gold btn-sm mt-2">
                Apply for Membership
              </a>
              <Link to="/login" className="sidebar-link text-ivory hover:text-gold-200" onClick={() => setOpen(false)}>
                Member Login
              </Link>
              <Link to="/admin/login" className="sidebar-link text-ivory hover:text-gold-200" onClick={() => setOpen(false)}>
                Administrator Login
              </Link>
            </nav>
          </div>
        ) : null}
      </header>

      <main>{children}</main>

      <footer className="border-t border-black/10 bg-white px-5 py-10 dark:border-gold-400/15 dark:bg-charcoal-900">
        <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="" className="h-11 w-11 object-contain" />
              <div>
                <p className="font-display text-lg font-semibold">Chorale La Porte d'Or</p>
                <p className="muted text-xs uppercase tracking-[0.18em]">Digital Choir Platform</p>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-600 dark:text-gold-300">Membership</p>
            <p className="muted mt-2 text-sm">
              Applications are received exclusively through the official membership form. There is no public
              self-registration.
            </p>
            <a href={APPLICATION_FORM_URL} target="_blank" rel="noopener noreferrer" className="link mt-2 inline-block text-sm">
              Open the official application form
            </a>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-600 dark:text-gold-300">Explore</p>
            <Link to="/music" className="link mt-2 block text-sm">
              Our music
            </Link>
            <Link to="/gallery" className="link mt-1 block text-sm">
              Gallery
            </Link>
            <Link to="/events" className="link mt-1 block text-sm">
              Events
            </Link>
            <Link to="/about" className="link mt-1 block text-sm">
              About the choir
            </Link>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-600 dark:text-gold-300">Members</p>
            <Link to="/contact" className="link mt-2 block text-sm">
              Contact us
            </Link>
            <Link to="/admin/login" className="link mt-1 block text-sm">
              Administrator login
            </Link>
            <Link to="/login" className="link mt-1 block text-sm">
              Member login
            </Link>
          </div>
        </div>
        <p className="muted mx-auto mt-8 max-w-7xl text-xs">
          © {new Date().getFullYear()} Chorale La Porte d'Or. Private member data is never published on these pages.
        </p>
      </footer>
    </div>
  )
}
