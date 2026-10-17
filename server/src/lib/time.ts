export function nowIso(): string {
  return new Date().toISOString()
}

export function isoPlusMs(ms: number, from = Date.now()): string {
  return new Date(from + ms).toISOString()
}

export function isExpired(iso: string | null | undefined, at = Date.now()): boolean {
  if (!iso) return false
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return false
  return time <= at
}

/** `YYYY-MM-DD` for a date column. Accepts `YYYY-MM-DD` or a full ISO timestamp. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function isValidDateString(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isValidTimeString(value: unknown): boolean {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}
