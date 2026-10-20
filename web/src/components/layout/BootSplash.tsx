import { useEffect, useState } from "react"

/**
 * The opening screen: the choir's emblem spins into place while the application
 * starts up, then the whole thing fades away.
 *
 * It is deliberately short and self-clearing. The splash appears on a fresh page
 * load only — never on client-side navigation — and it removes itself from the
 * DOM once it has faded, so it can never trap a click or a keyboard focus.
 */
export function BootSplash() {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    // A visit that already carried the "seen" flag skips straight past, so
    // moving around the app never re-plays the animation.
    let seen = false
    try {
      seen = sessionStorage.getItem("cldo-boot-seen") === "1"
    } catch {
      seen = false
    }

    // Somebody who has asked their device for less motion gets no splash at
    // all: there would be nothing left of it to show.
    const prefersReducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (seen || prefersReducedMotion) {
      setGone(true)
      return
    }

    try {
      sessionStorage.setItem("cldo-boot-seen", "1")
    } catch {
      // Storage being unavailable just means the splash plays once more. Fine.
    }

    // The emblem lands at ~1.6s and the wordmark by ~1.1s; holding for a beat
    // after that lets the reveal finish before the fade begins.
    const fade = window.setTimeout(() => setLeaving(true), 2100)
    const remove = window.setTimeout(() => setGone(true), 2800)
    return () => {
      window.clearTimeout(fade)
      window.clearTimeout(remove)
    }
  }, [])

  if (gone) return null

  return (
    <div className="boot-splash" data-leaving={leaving} role="status" aria-live="polite">
      <div className="boot-splash__stage">
        <span className="boot-splash__ring" aria-hidden />
        <span className="boot-splash__ring--slow" aria-hidden />
        <img src="/logo.png" alt="" className="boot-splash__logo" />
      </div>
      <div className="boot-splash__wordmark">
        <span className="boot-splash__title">La Porte d'Or</span>
        <span className="boot-splash__subtitle">Chorale</span>
      </div>
      <div className="boot-splash__bar" aria-hidden />
      <span className="sr-only">Loading Chorale La Porte d'Or…</span>
    </div>
  )
}
