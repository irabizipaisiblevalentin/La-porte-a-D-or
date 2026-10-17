import type { ReactNode } from "react"

type Tone = "gold" | "neutral" | "positive" | "warn" | "danger"

const TONE_CLASS: Record<Tone, string> = {
  gold: "badge-gold",
  neutral: "badge-neutral",
  positive: "badge-positive",
  warn: "badge-warn",
  danger: "badge-danger",
}

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`badge ${TONE_CLASS[tone]} ${className}`}>{children}</span>
}

const STATUS_TONES: Record<string, Tone> = {
  active: "positive",
  present: "positive",
  approved: "positive",
  published: "positive",
  completed: "positive",
  resolved: "positive",
  configured: "positive",
  ready_for_performance: "positive",
  late: "warn",
  under_review: "warn",
  more_info_required: "warn",
  scheduled: "warn",
  in_progress: "warn",
  section_work: "warn",
  planned: "warn",
  invited: "warn",
  pending: "warn",
  excused: "neutral",
  absent: "danger",
  rejected: "danger",
  error: "danger",
  locked: "danger",
  suspended: "danger",
  withdrawn: "neutral",
  inactive: "neutral",
  cancelled: "neutral",
  archived: "neutral",
  draft: "neutral",
  not_configured: "neutral",
  open: "warn",
  closed: "neutral",
}

export function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted text-xs">—</span>
  const tone = STATUS_TONES[status] ?? "neutral"
  return <Badge tone={tone}>{humanize(status)}</Badge>
}
