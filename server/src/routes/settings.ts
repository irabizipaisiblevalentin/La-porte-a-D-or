import { Router } from "express"
import { z } from "zod"
import { all, run, transaction } from "../db/index.js"
import { refreshIntegrationStatuses } from "../db/seed.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest } from "../lib/errors.js"
import { parse } from "../lib/http.js"
import { encryptSecret } from "../lib/secrets-box.js"
import { nowIso } from "../lib/time.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"

export const settingsRouter: Router = Router()

interface SettingDef {
  key: string
  label: string
  description: string
  /** When present the incoming value must be one of these (after string coercion). */
  allowedValues?: string[]
}

/** The only app settings an administrator may change. Kept in sync with the seed. */
const SETTING_DEFS: SettingDef[] = [
  {
    key: "attendance.late_policy",
    label: "How 'late' is counted",
    description: "Attendance percentages count a Late member as present by default. Switch to counts_as_absent to exclude them from the numerator.",
    allowedValues: ["counts_as_present", "counts_as_absent"],
  },
  {
    key: "attendance.excused_policy",
    label: "How 'excused' is counted",
    description: "Excused absences are excluded from the attendance denominator by default so approved absences do not lower a member's rate. Switch to included to count them as absences.",
    allowedValues: ["excluded_from_denominator", "included"],
  },
  {
    key: "public.application_form_url",
    label: "Official membership application form",
    description: "The only route to apply for membership. There is no public registration.",
  },
  {
    key: "public.contact_email",
    label: "Public contact email",
    description: "Shown on the public landing page when set.",
  },
  {
    key: "public.contact_phone",
    label: "Public contact phone",
    description: "Shown on the public landing page when set.",
  },
  {
    key: "public.about",
    label: "Public introduction",
    description: "Short introduction of the choir shown on the landing page.",
  },
  {
    key: "public.gallery_enabled",
    label: "Show gallery on landing page",
    description: "Display uploaded choir photographs on the public landing page.",
    allowedValues: ["true", "false"],
  },
]

/**
 * Display hints for each integration. The `integration_settings` table stores
 * labels but not hints, so the canonical seed text is mirrored here for display.
 */
const INTEGRATION_HINTS: Record<string, string> = {
  youtube_api_key: "Server-side secret. Used to discover and catalogue public videos from the official channel.",
  youtube_channel_id: "Confirmed by the Chairman after channel verification (starts with UC).",
  youtube_channel_title: "Display name of the verified channel.",
  youtube_channel_verified_at: "Timestamp of the Chairman channel confirmation.",
  google_sheet_id: "The spreadsheet connected to the official Google Form.",
  google_service_account: "Server-side secret used for the Sheets API. Never sent to the browser.",
  google_webhook_url: "Alternative to the Sheets API: an Apps Script that posts form responses to this server.",
  google_webhook_secret: "Shared secret used to verify inbound webhook payloads.",
  smtp_host: "Required before email notifications can be sent. Until then, notifications appear in-app only.",
  smtp_port: "Usually 587 (STARTTLS) or 465 (implicit TLS).",
  smtp_user: "Login for the SMTP relay.",
  smtp_password: "Server-side secret for the SMTP relay.",
  smtp_from: "From address shown on outgoing email.",
}

interface AppSettingRow {
  key: string
  value: string
  label: string
  description: string
  updated_at: string
}

interface IntegrationRow {
  id: string
  key: string
  label: string
  value_plain: string | null
  is_secret: number
  status: string
  updated_at: string
}

interface IntegrationRunRow {
  id: string
  integration: string
  trigger: string
  status: string
  summary: string | null
  detail: string | null
  started_at: string
  finished_at: string | null
}

function loadSettings() {
  return all<AppSettingRow>(
    "SELECT key, value, label, description, updated_at FROM app_settings ORDER BY key",
  ).map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description,
    value: row.value,
  }))
}

/**
 * Never returns a decrypted secret. Secret integrations expose only whether a
 * value is configured via `status`; `valuePlain` stays null for them.
 */
function loadIntegrations() {
  return all<IntegrationRow>(
    `SELECT id, key, label, value_plain, is_secret, status, updated_at
       FROM integration_settings
      ORDER BY label COLLATE NOCASE`,
  ).map((row) => ({
    key: row.key,
    label: row.label,
    hint: INTEGRATION_HINTS[row.key] ?? "",
    isSecret: row.is_secret === 1,
    status: row.status,
    valuePlain: row.is_secret === 1 ? null : row.value_plain,
    updatedAt: row.updated_at,
  }))
}

function parseDetail(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function loadRuns() {
  return all<IntegrationRunRow>(
    `SELECT id, integration, trigger, status, summary, detail, started_at, finished_at
       FROM integration_runs
      ORDER BY started_at DESC
      LIMIT 20`,
  ).map((row) => ({
    id: row.id,
    integration: row.integration,
    trigger: row.trigger,
    status: row.status,
    summary: row.summary,
    detail: parseDetail(row.detail),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }))
}

settingsRouter.get("/", requireAuth, requirePermission("settings.read"), (_req, res) => {
  const runs = loadRuns()
  res.json({
    settings: loadSettings(),
    integrations: loadIntegrations(),
    ...(runs.length > 0 ? { runs } : {}),
  })
})

const settingValueSchema = z.union([z.string(), z.boolean(), z.number()])

const settingsPatchSchema = z.object({
  settings: z.record(z.string(), settingValueSchema),
})

function normalizeSettingValue(def: SettingDef, raw: string | boolean | number): string {
  const text = typeof raw === "string" ? raw : typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw)
  if (def.allowedValues && !def.allowedValues.includes(text)) {
    throw badRequest(`Invalid value for ${def.label}.`, {
      fields: { [def.key]: `Allowed values: ${def.allowedValues.join(", ")}.` },
    })
  }
  return text
}

settingsRouter.patch("/", requireAuth, requirePermission("settings.write"), (req, res) => {
  const input = parse(settingsPatchSchema, req.body)
  const entries = Object.entries(input.settings)
  if (entries.length === 0) throw badRequest("No settings were provided.")

  const definitions = new Map(SETTING_DEFS.map((def) => [def.key, def]))
  for (const [key] of entries) {
    if (!definitions.has(key)) throw badRequest(`Unknown setting: ${key}.`)
  }

  const timestamp = nowIso()
  const changed: string[] = []

  transaction(() => {
    for (const [key, raw] of entries) {
      const def = definitions.get(key)
      if (!def) throw badRequest(`Unknown setting: ${key}.`)
      const value = normalizeSettingValue(def, raw)
      const result = run(
        "UPDATE app_settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?",
        value, req.auth!.id, timestamp, key,
      )
      if (result.changes === 0) {
        run(
          `INSERT INTO app_settings (key, value, label, description, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          key, value, def.label, def.description, req.auth!.id, timestamp,
        )
      }
      changed.push(key)
    }
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "settings.update", entityType: "app_setting", entityId: null,
    summary: `Application settings updated: ${changed.join(", ")}`,
    detail: { keys: changed },
    ip: req.ip,
  })

  res.json({ settings: loadSettings() })
})

const integrationValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

const integrationsPatchSchema = z.object({
  values: z.record(z.string(), integrationValueSchema),
})

function stringifyIntegrationValue(raw: string | number | boolean): string {
  if (typeof raw === "string") return raw
  if (typeof raw === "boolean") return raw ? "true" : "false"
  return String(raw)
}

settingsRouter.patch("/integrations", requireAuth, requirePermission("settings.write"), (req, res) => {
  const input = parse(integrationsPatchSchema, req.body)
  const entries = Object.entries(input.values)
  if (entries.length === 0) throw badRequest("No integration values were provided.")

  const known = new Map(
    all<{ key: string; is_secret: number }>("SELECT key, is_secret FROM integration_settings")
      .map((row) => [row.key, row.is_secret === 1] as const),
  )
  for (const [key] of entries) {
    if (!known.has(key)) throw badRequest(`Unknown integration setting: ${key}.`)
  }

  const timestamp = nowIso()
  const changed: string[] = []

  transaction(() => {
    for (const [key, raw] of entries) {
      const isSecret = known.get(key)
      if (isSecret === undefined) throw badRequest(`Unknown integration setting: ${key}.`)
      if (isSecret) {
        const encrypted = raw === null ? null : encryptSecret(stringifyIntegrationValue(raw))
        run(
          "UPDATE integration_settings SET value_encrypted = ?, updated_by = ?, updated_at = ? WHERE key = ?",
          encrypted, req.auth!.id, timestamp, key,
        )
      } else {
        const plain = raw === null ? null : stringifyIntegrationValue(raw)
        run(
          "UPDATE integration_settings SET value_plain = ?, updated_by = ?, updated_at = ? WHERE key = ?",
          plain, req.auth!.id, timestamp, key,
        )
      }
      changed.push(key)
    }
  })

  refreshIntegrationStatuses()

  // Audited per key with the key name only — never the value, secret or not.
  for (const key of changed) {
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "settings.integration_update", entityType: "integration_setting", entityId: key,
      summary: `Integration setting "${key}" updated`,
      detail: { key },
      ip: req.ip,
    })
  }

  res.json({ integrations: loadIntegrations() })
})
