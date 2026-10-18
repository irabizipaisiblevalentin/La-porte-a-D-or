import { db, migrate, one, transaction } from "./index.js"
import { nowIso } from "../lib/time.js"
import { PERMISSIONS, ROLES, permissionId } from "../auth/permissions.js"
import { decryptSecret } from "../lib/secrets-box.js"

const GROUPS = [
  { id: "grp_senior", key: "senior", name: "Senior", description: "Grown singers who are out of school.", is_minor_group: 0 },
  { id: "grp_junior", key: "junior", name: "Junior", description: "Young singers who are still in school. Records are especially sensitive.", is_minor_group: 1 },
  { id: "grp_members", key: "members", name: "Members / Support Members", description: "People who support the choir but are not registered as singers.", is_minor_group: 0 },
]

const VOICE_SECTIONS = [
  { id: "vs_soprano", key: "soprano", name: "Soprano", sort_order: 1 },
  { id: "vs_alto", key: "alto", name: "Alto", sort_order: 2 },
  { id: "vs_tenor", key: "tenor", name: "Tenor", sort_order: 3 },
  { id: "vs_bass", key: "bass", name: "Bass", sort_order: 4 },
]

const SONG_CATEGORIES = [
  { id: "sc_official_performance", key: "official_performance", name: "Official performances", sort_order: 1 },
  { id: "sc_full_choir", key: "full_choir", name: "Full choir songs", sort_order: 2 },
  { id: "sc_live_performance", key: "live_performance", name: "Live performances", sort_order: 3 },
  { id: "sc_rehearsal", key: "rehearsal", name: "Rehearsals", sort_order: 4 },
  { id: "sc_song_tutorial", key: "song_tutorial", name: "Song tutorials", sort_order: 5 },
  { id: "sc_section_practice", key: "section_practice", name: "Section practice", sort_order: 6 },
  { id: "sc_instrumental_backing", key: "instrumental_backing", name: "Instrumental / backing tracks", sort_order: 7 },
  { id: "sc_other_choir_music", key: "other_choir_music", name: "Other choir-related music", sort_order: 8 },
]

const LEARNING_STAGES = [
  { id: "ls_learning", key: "learning", name: "Learning", sort_order: 1 },
  { id: "ls_rehearsing", key: "rehearsing", name: "Rehearsing", sort_order: 2 },
  { id: "ls_section_work", key: "section_work", name: "Section Work", sort_order: 3 },
  { id: "ls_full_choir", key: "full_choir", name: "Full Choir", sort_order: 4 },
  { id: "ls_ready_for_performance", key: "ready_for_performance", name: "Ready for Performance", sort_order: 5 },
]

const DISCIPLINE_CATEGORIES = [
  { id: "dc_late_arrival", key: "late_arrival", label: "Late arrival", kind: "negative", sort_order: 1 },
  { id: "dc_unexcused_absence", key: "unexcused_absence", label: "Unexcused absence", kind: "negative", sort_order: 2 },
  { id: "dc_rule_violation", key: "rule_violation", label: "Failure to follow choir rules", kind: "negative", sort_order: 3 },
  { id: "dc_misconduct", key: "misconduct", label: "Misconduct", kind: "negative", sort_order: 4 },
  { id: "dc_missed_assignment", key: "missed_assignment", label: "Missed assignment", kind: "negative", sort_order: 5 },
  { id: "dc_other_negative", key: "other_negative", label: "Other", kind: "negative", sort_order: 6 },
  { id: "dc_excellent_attendance", key: "excellent_attendance", label: "Excellent attendance", kind: "positive", sort_order: 7 },
  { id: "dc_outstanding_commitment", key: "outstanding_commitment", label: "Outstanding commitment", kind: "positive", sort_order: 8 },
  { id: "dc_leadership", key: "leadership", label: "Leadership", kind: "positive", sort_order: 9 },
  { id: "dc_helping_others", key: "helping_others", label: "Helping others", kind: "positive", sort_order: 10 },
]

const INTEGRATIONS = [
  { id: "int_youtube_api_key", key: "youtube_api_key", label: "YouTube Data API key", is_secret: 1, value_plain: null, hint: "Server-side secret. Used to discover and catalogue public videos from the official channel." },
  { id: "int_youtube_channel_id", key: "youtube_channel_id", label: "Official YouTube channel ID", is_secret: 0, value_plain: null, hint: "Confirmed by the Chairman after channel verification (starts with UC)." },
  { id: "int_youtube_channel_title", key: "youtube_channel_title", label: "Official YouTube channel name", is_secret: 0, value_plain: null, hint: "Display name of the verified channel." },
  { id: "int_youtube_channel_verified_at", key: "youtube_channel_verified_at", label: "Channel verified at", is_secret: 0, value_plain: null, hint: "Timestamp of the Chairman channel confirmation." },
  { id: "int_google_sheet_id", key: "google_sheet_id", label: "Google Sheet ID of the application register", is_secret: 0, value_plain: null, hint: "The spreadsheet connected to the official Google Form." },
  { id: "int_google_service_account", key: "google_service_account", label: "Google service account credentials (JSON)", is_secret: 1, value_plain: null, hint: "Server-side secret used for the Sheets API. Never sent to the browser." },
  { id: "int_google_webhook_url", key: "google_webhook_url", label: "Google Apps Script webhook URL", is_secret: 0, value_plain: null, hint: "Alternative to the Sheets API: an Apps Script that posts form responses to this server." },
  { id: "int_google_webhook_secret", key: "google_webhook_secret", label: "Google webhook signing secret", is_secret: 1, value_plain: null, hint: "Shared secret used to verify inbound webhook payloads." },
  { id: "int_smtp_host", key: "smtp_host", label: "Email (SMTP) host", is_secret: 0, value_plain: null, hint: "Required before email notifications can be sent. Until then, notifications appear in-app only." },
  { id: "int_smtp_port", key: "smtp_port", label: "Email (SMTP) port", is_secret: 0, value_plain: null, hint: "Usually 587 (STARTTLS) or 465 (implicit TLS)." },
  { id: "int_smtp_user", key: "smtp_user", label: "Email (SMTP) username", is_secret: 0, value_plain: null, hint: "Login for the SMTP relay." },
  { id: "int_smtp_password", key: "smtp_password", label: "Email (SMTP) password", is_secret: 1, value_plain: null, hint: "Server-side secret for the SMTP relay." },
  { id: "int_smtp_from", key: "smtp_from", label: "Email sender address", is_secret: 0, value_plain: null, hint: "From address shown on outgoing email." },
]

const APP_SETTINGS = [
  { key: "attendance.late_policy", value: "counts_as_present", label: "How 'late' is counted", description: "Attendance percentages count a Late member as present by default. Switch to counts_as_absent to exclude them from the numerator." },
  { key: "attendance.excused_policy", value: "excluded_from_denominator", label: "How 'excused' is counted", description: "Excused absences are excluded from the attendance denominator by default so approved absences do not lower a member's rate. Switch to included to count them as absences." },
  { key: "public.application_form_url", value: "https://forms.gle/JZJmWZNMQAYNm5uq5", label: "Official membership application form", description: "The only route to apply for membership. There is no public registration." },
  { key: "public.contact_email", value: "", label: "Public contact email", description: "Shown on the public landing page when set." },
  { key: "public.contact_phone", value: "", label: "Public contact phone", description: "Shown on the public landing page when set." },
  { key: "public.about", value: "", label: "Public introduction", description: "Short introduction of the choir shown on the landing page." },
  { key: "public.gallery_enabled", value: "true", label: "Show gallery on landing page", description: "Display uploaded choir photographs on the public landing page." },
  { key: "chairman.founders", value: "[]", label: "Founders of the choir", description: "The founding members listed in the Chairman's dashboard section. A JSON list of { name, role, photo } objects, e.g. [{\"name\":\"Jane A\",\"role\":\"Founder\",\"photo\":\"\"}]. Leave empty for none." },
]

export function seed(log: (message: string) => void = () => {}): void {
  const timestamp = nowIso()

  transaction(() => {
    for (const permission of PERMISSIONS) {
      db.prepare(`INSERT OR IGNORE INTO permissions (id, key, name, description, scopes)
                  VALUES (?, ?, ?, ?, ?)`)
        .run(permissionId(permission.key), permission.key, permission.name, permission.description, permission.scopes.join(","))
    }
    log(`permissions: ${one<{ c: number }>("SELECT COUNT(*) AS c FROM permissions")?.c ?? 0}`)

    const insertRole = db.prepare(`INSERT OR IGNORE INTO roles (id, key, name, description, is_system, created_at)
                                   VALUES (?, ?, ?, ?, 1, ?)`)
    for (const role of ROLES) insertRole.run(`role_${role.key}`, role.key, role.name, role.description, timestamp)

    // Legacy rename: `senior_admin` (Senior Administrator) became `chairman` (Chairman).
    // Older databases still hold role_senior_admin. Move its assignments across before the
    // legacy row is deleted (user_roles cascades on role delete, which would otherwise strip
    // the account of its supreme-administrator role) so the one-time setup token stays closed.
    if (one("SELECT id FROM roles WHERE id = 'role_senior_admin'")) {
      db.prepare(`UPDATE OR IGNORE user_roles SET role_id = 'role_chairman' WHERE role_id = 'role_senior_admin'`).run()
      db.prepare(`UPDATE OR IGNORE role_permissions SET role_id = 'role_chairman' WHERE role_id = 'role_senior_admin'`).run()
      db.prepare(`DELETE FROM role_permissions WHERE role_id = 'role_senior_admin'`).run()
      db.prepare(`DELETE FROM roles WHERE id = 'role_senior_admin'`).run()
      log("roles: migrated legacy senior_admin to chairman")
    }

    // System roles are defined in code. Reconcile their grants on every seed so
    // that a grant removed from the definitions is also removed from the database
    // (INSERT OR IGNORE alone would leave stale permissions behind).
    const clearGrants = db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`)
    const insertGrant = db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)`)
    for (const role of ROLES) {
      clearGrants.run(`role_${role.key}`)
      for (const grant of role.grants) insertGrant.run(`role_${role.key}`, permissionId(grant.key), grant.scope)
    }
    log(`roles: ${one<{ c: number }>("SELECT COUNT(*) AS c FROM roles")?.c ?? 0}`)

    const insertGroup = db.prepare(`INSERT OR IGNORE INTO groups (id, key, name, description, is_minor_group, created_at)
                                    VALUES (?, ?, ?, ?, ?, ?)`)
    for (const group of GROUPS) insertGroup.run(group.id, group.key, group.name, group.description, group.is_minor_group, timestamp)

    const insertVoice = db.prepare(`INSERT OR IGNORE INTO voice_sections (id, key, name, sort_order) VALUES (?, ?, ?, ?)`)
    for (const section of VOICE_SECTIONS) insertVoice.run(section.id, section.key, section.name, section.sort_order)

    const insertCategory = db.prepare(`INSERT OR IGNORE INTO song_categories (id, key, name, sort_order) VALUES (?, ?, ?, ?)`)
    for (const category of SONG_CATEGORIES) insertCategory.run(category.id, category.key, category.name, category.sort_order)

    const insertStage = db.prepare(`INSERT OR IGNORE INTO learning_stages (id, key, name, sort_order) VALUES (?, ?, ?, ?)`)
    for (const stage of LEARNING_STAGES) insertStage.run(stage.id, stage.key, stage.name, stage.sort_order)

    const insertDiscipline = db.prepare(`INSERT OR IGNORE INTO discipline_categories (id, key, label, kind, active, sort_order)
                                         VALUES (?, ?, ?, ?, 1, ?)`)
    for (const category of DISCIPLINE_CATEGORIES) insertDiscipline.run(category.id, category.key, category.label, category.kind, category.sort_order)

    const insertIntegration = db.prepare(`INSERT OR IGNORE INTO integration_settings
        (id, key, label, value_encrypted, value_plain, is_secret, status, error_message, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, NULL, NULL, ?, 'not_configured', NULL, NULL, ?, ?)`)
    for (const integration of INTEGRATIONS) {
      insertIntegration.run(integration.id, integration.key, integration.label, integration.is_secret, timestamp, timestamp)
    }

    const insertSetting = db.prepare(`INSERT OR IGNORE INTO app_settings (key, value, label, description, updated_at) VALUES (?, ?, ?, ?, ?)`)
    for (const setting of APP_SETTINGS) insertSetting.run(setting.key, setting.value, setting.label, setting.description, timestamp)

    log(`groups ${GROUPS.length}, voice sections ${VOICE_SECTIONS.length}, song categories ${SONG_CATEGORIES.length}, stages ${LEARNING_STAGES.length}, discipline categories ${DISCIPLINE_CATEGORIES.length}`)
  })

  refreshIntegrationStatuses()
}

/** Recomputes each integration's status from its stored values — no invented success states. */
export function refreshIntegrationStatuses(): void {
  const rows = db.prepare("SELECT id, key, is_secret, value_encrypted, value_plain FROM integration_settings").all() as {
    id: string
    key: string
    is_secret: number
    value_encrypted: string | null
    value_plain: string | null
  }[]
  const update = db.prepare("UPDATE integration_settings SET status = ?, updated_at = ? WHERE id = ?")
  const timestamp = nowIso()
  for (const row of rows) {
    const configured = row.is_secret
      ? Boolean(row.value_encrypted && decryptSecret(row.value_encrypted)?.trim())
      : Boolean(row.value_plain && row.value_plain.trim() !== "")
    update.run(configured ? "configured" : "not_configured", timestamp, row.id)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate((message) => console.log(`[migrate] ${message}`))
  seed((message) => console.log(`[seed] ${message}`))
  console.log("[seed] reference data ready")
}
