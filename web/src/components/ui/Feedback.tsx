import type { ReactNode } from "react"
import { AlertTriangle, Inbox, Loader2 } from "lucide-react"

export function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-label="Loading" role="status" />
}

export function LoadingBlock({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <div className="flex items-center gap-2">
        <Spinner />
        <span className="muted text-sm">{label}</span>
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-10 w-full" />
      ))}
    </div>
  )
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

export function EmptyState({
  title,
  description,
  action,
  tone = "neutral",
  icon,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  tone?: "neutral" | "danger"
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{
          background: tone === "danger" ? "color-mix(in srgb, #b4544a 12%, transparent)" : "color-mix(in srgb, var(--color-gold-400) 14%, transparent)",
          color: tone === "danger" ? "#b4544a" : "var(--color-gold-500)",
        }}
      >
        {icon ?? (tone === "danger" ? <AlertTriangle size={22} /> : <Inbox size={22} />)}
      </div>
      <h4 className="text-base font-semibold">{title}</h4>
      {description ? <p className="muted max-w-md text-sm">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ title = "Something went wrong", description }: { title?: string; description?: ReactNode }) {
  return <EmptyState tone="danger" title={title} description={description} />
}
