import { Router } from "express"
import { all, one } from "../db/index.js"
import { makePage, pagination, queryString } from "../lib/http.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"

export const auditRouter: Router = Router()

interface AuditRow {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  change_detail: string | null
  ip_address: string | null
  created_at: string
}

interface AuditDto {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  summary: string
  detail: unknown
  ipAddress: string | null
  createdAt: string
}

/** Parses the stored structured change detail; never throws on malformed history. */
function parseDetail(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function toDto(row: AuditRow): AuditDto {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    detail: parseDetail(row.change_detail),
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  }
}

/** Extends a date-only boundary to the end of that day so same-day entries are included. */
function endOfRange(value: string): string {
  return value.length === 10 ? `${value}T23:59:59.999Z` : value
}

// GET /audit — append-only history with filters. There is deliberately no write route.
auditRouter.get("/", requireAuth, requirePermission("audit.read"), (req, res) => {
  const p = pagination(req)
  const entityType = queryString(req, "entityType")
  const action = queryString(req, "action")
  const actorId = queryString(req, "actorId")
  const from = queryString(req, "from")
  const to = queryString(req, "to")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (entityType) {
    clauses.push("entity_type = ?")
    params.push(entityType)
  }
  if (action) {
    clauses.push("action = ?")
    params.push(action)
  }
  if (actorId) {
    clauses.push("actor_id = ?")
    params.push(actorId)
  }
  if (from) {
    clauses.push("created_at >= ?")
    params.push(from)
  }
  if (to) {
    clauses.push("created_at <= ?")
    params.push(endOfRange(to))
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_logs ${where}`, ...params)?.c ?? 0
  const rows = all<AuditRow>(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(rows.map(toDto), total, p))
})

// GET /audit/entity/:type/:id — history for a single entity.
auditRouter.get("/entity/:type/:id", requireAuth, requirePermission("audit.read"), (req, res) => {
  const p = pagination(req)
  const entityType = String(req.params.type)
  const entityId = String(req.params.id)

  const total = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM audit_logs WHERE entity_type = ? AND entity_id = ?",
    entityType, entityId,
  )?.c ?? 0
  const rows = all<AuditRow>(
    `SELECT * FROM audit_logs
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    entityType, entityId, p.limit, p.offset,
  )
  res.json(makePage(rows.map(toDto), total, p))
})
