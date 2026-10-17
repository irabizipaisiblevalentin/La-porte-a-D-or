import { useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: { label: string; to?: string }[]
}) {
  return (
    <header className="flex flex-col gap-3">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="muted flex items-center gap-1.5 text-xs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? <ChevronRight size={12} /> : null}
              {crumb.to ? (
                <a href={crumb.to} className="link">
                  {crumb.label}
                </a>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
          {description ? <p className="muted mt-1 max-w-2xl text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "gold",
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: "gold" | "neutral"
}) {
  return (
    <div className="card flex items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="muted text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="mt-1 font-display text-3xl font-semibold leading-none">{value}</p>
        {hint ? <p className="muted mt-1.5 text-xs">{hint}</p> : null}
      </div>
      {icon ? (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: tone === "gold" ? "color-mix(in srgb, var(--color-gold-400) 15%, transparent)" : "color-mix(in srgb, currentColor 8%, transparent)",
            color: tone === "gold" ? "var(--color-gold-500)" : undefined,
          }}
        >
          {icon}
        </div>
      ) : null}
    </div>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: ReactNode }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b hairline" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className="relative px-3.5 py-2 text-sm font-medium transition-colors"
            style={{ color: selected ? "var(--color-gold-500)" : undefined }}
            data-active={selected}
          >
            {tab.label}
            {selected ? (
              <span
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                style={{ background: "var(--color-gold-400)" }}
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function ProgressBar({ value, max = 100, tone = "gold" }: { value: number; max?: number; tone?: "gold" | "positive" | "danger" }) {
  const safeMax = max <= 0 ? 1 : max
  const percent = Math.max(0, Math.min(100, (value / safeMax) * 100))
  const colors: Record<string, string> = {
    gold: "linear-gradient(90deg, var(--color-gold-500), var(--color-gold-300))",
    positive: "linear-gradient(90deg, #2f7a52, #64b487)",
    danger: "linear-gradient(90deg, #a0433a, #d07a70)",
  }
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, currentColor 12%, transparent)" }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${percent}%`, background: colors[tone] }} />
    </div>
  )
}

export function Pagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number
  pageCount: number
  total?: number
  onChange: (page: number) => void
}) {
  if (pageCount <= 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="muted text-xs">
        Page {page} of {pageCount}
        {typeof total === "number" ? ` · ${total} record${total === 1 ? "" : "s"}` : ""}
      </p>
      <div className="flex items-center gap-2">
        <button className="btn btn-outline btn-sm" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={15} />
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => onChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

export function useTabState(initial: string) {
  const [active, setActive] = useState(initial)
  return { active, setActive }
}
