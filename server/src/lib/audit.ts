import { db } from "../db/index.js"
import { id } from "./security.js"
import { nowIso } from "./time.js"

export interface AuditInput {
  actorId?: string | null
  actorName?: string | null
  action: string
  entityType: string
  entityId?: string | null
  summary: string
  /** Structured change summary. Must never contain passwords, tokens or unnecessary personal data. */
  detail?: Record<string, unknown> | null
  ip?: string | null
}

/**
 * Appends an immutable audit entry. The audit_logs table has SQLite triggers that
 * reject UPDATE and DELETE, so history cannot be rewritten from the application.
 */
export function recordAudit(input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, summary, change_detail, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id(),
    input.actorId ?? null,
    input.actorName ?? null,
    input.action,
    input.entityType,
    input.entityId ?? null,
    input.summary,
    input.detail ? JSON.stringify(redact(input.detail)) : null,
    input.ip ?? null,
    nowIso(),
  )
}

const REDACT_KEYS = ["password", "password_hash", "token", "secret", "access_token", "refresh_token", "authorization", "credential", "credential_json", "service_account"]

function redact(detail: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (REDACT_KEYS.some((needle) => key.toLowerCase().includes(needle))) {
      output[key] = "[redacted]"
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = redact(value as Record<string, unknown>)
    } else {
      output[key] = value
    }
  }
  return output
}
