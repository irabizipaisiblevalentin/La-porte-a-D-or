/**
 * A person's picture, or their initial when there is none.
 *
 * Two shapes of the same idea kept being written by hand — the top-bar circle,
 * the member row, the profile header — each with its own idea of what to show when
 * a picture is missing. Centralising it here means an account with no picture
 * always falls back the same way and always reads as a deliberate initial rather
 * than as a broken image.
 *
 * The `<img>` is decorative (`alt=""`): every place this is used shows the person's
 * name next to it, and a screen reader announcing the name twice is noise. Callers
 * that show the avatar on its own should give the wrapper an accessible label.
 */
const SIZE_CLASS: Record<number, string> = {
  20: "h-5 w-5 text-[9px]",
  24: "h-6 w-6 text-[10px]",
  32: "h-8 w-8 text-xs",
  40: "h-10 w-10 text-sm",
  48: "h-12 w-12 text-base",
  64: "h-16 w-16 text-lg",
  88: "h-[88px] w-[88px] text-2xl",
}

/** The first letter of the first two name parts, e.g. "Jean Luc" → "JL". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function Avatar({
  src,
  name,
  size = 32,
  className = "",
}: {
  src?: string | null
  name: string
  size?: number
  className?: string
}) {
  // Any size that is not in the map falls back to an inline box, so a caller can
  // ask for an exact size without the component having to enumerate them.
  const sized = SIZE_CLASS[size]
  const style = sized ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.36) }

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-gold-400/25 font-semibold uppercase text-gold-700 dark:bg-gold-400/15 dark:text-gold-400",
        sized ?? "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        initialsOf(name) || "?"
      )}
    </span>
  )
}
