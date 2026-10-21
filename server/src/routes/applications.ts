import { Router, type Request } from "express"
import { z } from "zod"
import { can, groupScope, loadAuthUser, type AuthUser } from "../auth/access.js"
import { all, one, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { constantTimeEqual, generatePassword, hmacSha256Hex, id } from "../lib/security.js"
import { decryptSecret } from "../lib/secrets-box.js"
import { nowIso } from "../lib/time.js"
import { assertGroupAccess, permittedGroupIds, requireAuth, requirePermission } from "../middleware/auth.js"
import { documentUpload } from "../middleware/upload.js"
import { applicantProfileFromAnswers } from "../services/application-profile.js"
import { hashAndRemember } from "../services/credentials.js"
import { getGroupById, getGroupByKey, type GroupRow } from "../services/groups.js"
import { createMemberRecord, getMemberDetail } from "../services/members.js"
import { groupAdminUserIds, notifyMany } from "../services/notifications.js"
import { deliverLoginDetails } from "../services/onboarding.js"
import { cleanDisplayName, NO_EMAIL_DOMAIN, normalizeUsername, placeholderEmail, sharedEmailAlias } from "../services/usernames.js"
import { saveUpload } from "../services/uploads.js"

export const applicationsRouter: Router = Router()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApplicationRow {
  id: string
  external_id: string | null
  source: string
  submitted_at: string
  full_name: string
  email: string | null
  phone: string | null
  requested_group_id: string | null
  assigned_group_id: string | null
  status: string
  duplicate_of: string | null
  member_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  decision_note: string | null
  raw_payload: string | null
  created_at: string
  updated_at: string
}

interface ApplicationListRow extends ApplicationRow {
  requested_group_name: string | null
  requested_group_key: string | null
  assigned_group_name: string | null
  assigned_group_key: string | null
}

interface AnswerRow {
  id: string
  question_key: string
  question_label: string
  answer: string | null
}

interface ReviewRow {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  from_status: string | null
  to_status: string | null
  from_group_id: string | null
  to_group_id: string | null
  notes: string | null
  created_at: string
}

interface NormalizedAnswer {
  questionKey: string
  questionLabel: string
  answer: string | null
}

// JOINs groups on both the requested and the assigned group so a list row can
// always show which group(s) an application belongs to.
const APPLICATION_SELECT = `
  SELECT a.*,
         rg.name AS requested_group_name, rg.key AS requested_group_key,
         ag.name AS assigned_group_name, ag.key AS assigned_group_key
    FROM applications a
    LEFT JOIN groups rg ON rg.id = a.requested_group_id
    LEFT JOIN groups ag ON ag.id = a.assigned_group_id`

const APPLICATION_GROUP_IDS = ["grp_senior", "grp_junior", "grp_members"] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApplication(id: string): ApplicationListRow | undefined {
  return one<ApplicationListRow>(`${APPLICATION_SELECT} WHERE a.id = ?`, id)
}

/**
 * Authorizes a caller for a single application. An application "belongs to" the
 * group it is assigned to once reviewed, but remains visible to the group it was
 * originally requested for. We therefore accept access when EITHER the assigned
 * group OR the requested group falls inside the caller's permitted scopes. This
 * mirrors the OR semantics used by the list query below.
 */
function assertApplicationAccess(user: AuthUser, key: string, application: ApplicationRow): void {
  if (can(user, key, "global")) return
  for (const groupId of [application.assigned_group_id, application.requested_group_id]) {
    const scope = groupScope(groupId)
    if (scope && can(user, key, scope)) return
  }
  throw forbidden()
}

function listAnswers(applicationId: string) {
  return all<AnswerRow>(
    "SELECT id, question_key, question_label, answer FROM application_answers WHERE application_id = ? ORDER BY rowid",
    applicationId,
  ).map((row) => ({ id: row.id, questionKey: row.question_key, questionLabel: row.question_label, answer: row.answer }))
}

function listReviews(applicationId: string) {
  return all<ReviewRow>(
    `SELECT r.id, r.actor_id, u.display_name AS actor_name, r.action, r.from_status, r.to_status,
            r.from_group_id, r.to_group_id, r.notes, r.created_at
       FROM application_reviews r
       LEFT JOIN users u ON u.id = r.actor_id
      WHERE r.application_id = ?
      ORDER BY r.created_at, r.rowid`,
    applicationId,
  ).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    fromGroupId: row.from_group_id,
    toGroupId: row.to_group_id,
    notes: row.notes,
    createdAt: row.created_at,
  }))
}

function toDto(row: ApplicationListRow) {
  return {
    id: row.id,
    externalId: row.external_id,
    source: row.source,
    submittedAt: row.submitted_at,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    requestedGroupId: row.requested_group_id,
    requestedGroupName: row.requested_group_name,
    requestedGroupKey: row.requested_group_key,
    assignedGroupId: row.assigned_group_id,
    assignedGroupName: row.assigned_group_name,
    assignedGroupKey: row.assigned_group_key,
    status: row.status,
    memberId: row.member_id,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Loads an application with its answers, review history and group names. */
function loadApplicationDetail(applicationId: string) {
  const row = getApplication(applicationId)
  if (!row) return null
  return { ...toDto(row), answers: listAnswers(applicationId), reviews: listReviews(applicationId) }
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed === "" ? null : trimmed
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return null
}

function slugify(value: string, fallbackIndex: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return slug || `question_${fallbackIndex + 1}`
}

function humanize(key: string): string {
  const text = key.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim()
  return text || key
}

/**
 * Accepts the answer shapes used by the Google Form payload and the manual
 * intake form: an array of `{ question, answer }` objects (optionally with an
 * explicit key/label) or a plain `{ questionKey: answer }` object map.
 */
function normalizeAnswers(raw: unknown): NormalizedAnswer[] {
  const answers: NormalizedAnswer[] = []
  if (raw === null || raw === undefined) return answers

  if (Array.isArray(raw)) {
    raw.forEach((entry, index) => {
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>
        const label = stringOrNull(record.question) ?? stringOrNull(record.questionLabel) ?? stringOrNull(record.label) ?? `Question ${index + 1}`
        const key = stringOrNull(record.questionKey) ?? stringOrNull(record.key) ?? slugify(label, index)
        answers.push({ questionKey: key, questionLabel: label, answer: stringOrNull(record.answer ?? record.value) })
      } else if (typeof entry === "string") {
        const label = entry.trim()
        if (label) answers.push({ questionKey: slugify(label, index), questionLabel: label, answer: null })
      }
    })
    return answers
  }

  if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      answers.push({ questionKey: key, questionLabel: humanize(key), answer: stringOrNull(value) })
    }
  }
  return answers
}

/** Inserts the answers, de-duplicating question keys (the table requires uniqueness per application). */
function insertAnswers(applicationId: string, answers: NormalizedAnswer[]): void {
  const used = new Set<string>()
  for (const item of answers) {
    const base = item.questionKey || "answer"
    let key = base
    let suffix = 2
    while (used.has(key)) key = `${base}_${suffix++}`
    used.add(key)
    run(
      "INSERT INTO application_answers (id, application_id, question_key, question_label, answer) VALUES (?, ?, ?, ?, ?)",
      id(), applicationId, key, item.questionLabel, item.answer,
    )
  }
}

/** Default login role for a newly approved member, chosen from the target group. */
function defaultRoleForGroup(group: GroupRow): string {
  if (group.key === "junior") return "role_junior_singer"
  if (group.key === "senior") return "role_senior_singer"
  return "role_support_member"
}

/**
 * Maps a free-text group answer ("Junior", "Senior group", "Support member", …)
 * to one of the three official groups. Returns null when nothing matches.
 */
function groupIdFromText(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.toLowerCase()
  if (/\bjunior\b|\byouth\b|\bkid/.test(text)) return "grp_junior"
  if (/\bsenior\b|\badult\b|\bgrown/.test(text)) return "grp_senior"
  if (/support|associate|non-?sing|non-?singing|friend of the choir|volunteer/.test(text)) return "grp_members"
  if (/\bmember(?:s)?\b/.test(text)) return "grp_members"
  return null
}

/**
 * Best-effort group detection from the answers themselves: a Google Form usually
 * asks "Which group are you applying for?" — we look for an answer whose question
 * mentions a group and map the chosen option text to an official group. This means
 * a correctly worded form works even when its Apps Script does not send `group`.
 */
function inferGroupIdFromAnswers(answers: NormalizedAnswer[]): string | null {
  // Pass 1: the explicit group question ("Which choir group are you applying
  // for?"). This wins even if the answers arrive out of order, so a later
  // "Which singing section…?" (Soprano/Alto/Tenor/Bass) can never override it.
  for (const item of answers) {
    const question = `${item.questionKey} ${item.questionLabel}`.toLowerCase()
    if (!/group|category|joining as|member type|register as|position|choir part/.test(question)) continue
    const fromAnswer = groupIdFromText(item.answer)
    if (fromAnswer) return fromAnswer
  }
  // Pass 2: any other question that asks about a section/role and whose answer names a group.
  for (const item of answers) {
    const question = `${item.questionKey} ${item.questionLabel}`.toLowerCase()
    if (!/section|apply|application|choir|member/.test(question)) continue
    const fromAnswer = groupIdFromText(item.answer)
    if (fromAnswer) return fromAnswer
  }
  // Pass 3: any answer that clearly names a group, regardless of the question.
  for (const item of answers) {
    const fromAnswer = groupIdFromText(item.answer)
    if (fromAnswer) return fromAnswer
  }
  return null
}

const RESERVED_WEBHOOK_KEYS = new Set([
  "externalId", "responseId", "id", "fullName", "name", "email", "phone",
  "groupId", "group", "answers", "secret", "submittedAt",
])

/**
 * Google Forms / Sheets sometimes post a flat object of `{ "Question": "Answer" }`
 * with no `answers` wrapper. Turn the unknown top-level keys into answers so those
 * submissions are still captured (and can still be grouped by their answers).
 */
function answersFromFlatBody(body: Record<string, unknown>): NormalizedAnswer[] {
  const answers: NormalizedAnswer[] = []
  for (const [key, value] of Object.entries(body)) {
    if (RESERVED_WEBHOOK_KEYS.has(key)) continue
    const answer = stringOrNull(value)
    if (answer === null) continue
    answers.push({ questionKey: slugify(key, answers.length), questionLabel: humanize(key), answer })
  }
  return answers
}

/**
 * Reads the applicant's full name out of the answers when it was not supplied at
 * the top level — the flat Google-Forms case where the only "name" is a
 * "Full name" question. Nicknames/usernames are deliberately ignored.
 */
function nameFromAnswers(answers: NormalizedAnswer[]): string | null {
  for (const item of answers) {
    const question = `${item.questionKey} ${item.questionLabel}`.toLowerCase()
    const answer = item.answer?.trim() ?? ""
    if (!answer) continue
    if (/nick ?name|user ?name|username|choir name|stage name/.test(question)) continue
    if (/emergency|guardian|parent|next of kin|\bkin\b|contact/.test(question)) continue
    if (/name/.test(question)) return answer
  }
  return null
}

/** Pulls an applicant's email/phone out of the answers when not supplied at the top level. */
function contactFromAnswers(answers: NormalizedAnswer[]): { email: string | null; phone: string | null } {
  let email: string | null = null
  let phone: string | null = null
  for (const item of answers) {
    const question = `${item.questionKey} ${item.questionLabel}`.toLowerCase()
    const answer = item.answer?.trim() ?? ""
    if (!answer) continue
    if (!email && /e-?mail/.test(question) && /@/.test(answer)) email = answer
    if (!phone && /phone|contact|mobile|whatsapp|tel/.test(question) && !/emergency|guardian|parent/.test(question)) phone = answer
  }
  return { email, phone }
}

/**
 * Notifies the group's own administrator that an application arrived. Only that
 * group's administrator is told — the Chairman sees the record on his dashboard
 * but is not pinged for every application.
 */
function notifyApplicationIntake(applicationId: string, fullName: string, group: GroupRow | undefined, groupId: string | null): void {
  const recipients = groupAdminUserIds(groupId)
  if (recipients.length === 0) return
  const where = group ? `for the ${group.name} group` : "with no group selected — please assign one"
  notifyMany(
    recipients.map((userId) => ({
      userId,
      type: "application",
      title: `New application: ${fullName}`,
      body: `A new membership application was submitted ${where}. Open Applications to review it.`,
      link: `/app/applications/${applicationId}`,
    })),
  )
}

function effectiveGroupId(application: ApplicationRow): string | null {
  return application.assigned_group_id ?? application.requested_group_id
}

/**
 * Picks a unique sign-in name from the applicant's full name — "Irabizi Valentin"
 * first, then "Irabizi Valentin 2" and so on when that name is already taken.
 * Used for every approved applicant, and is the only way to sign in when they
 * left the form's (optional) email question blank.
 */
function allocateUsername(fullName: string): { username: string; normalized: string } {
  const base = cleanDisplayName(fullName) || "Member"
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const username = suffix === 1 ? base : `${base} ${suffix}`
    const normalized = normalizeUsername(username)
    if (!normalized) continue
    const taken = one<{ id: string }>("SELECT id FROM users WHERE username_normalized = ?", normalized)
    if (!taken) return { username, normalized }
  }
  const fallback = `${normalizeUsername(base) || "member"}-${Date.now().toString(36)}`
  return { username: fallback, normalized: fallback }
}

/**
 * The stored login email for a new account given the address the applicant used.
 *
 * Returns the address itself when nothing holds it. When another account already
 * does — a parent enrolling two children on one address, say — returns a unique
 * reserved alias instead of refusing. The member record still carries the real
 * address, so the family is reachable there and both members read the same in the
 * admin lists; the alias exists only because a login email must identify exactly
 * one account.
 */
function uniqueLoginEmail(email: string, normalizedUsername: string): string {
  const normalized = email.toLowerCase()
  if (!one<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", normalized)) return email

  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const alias = sharedEmailAlias(email, attempt)
    if (!one<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", alias.toLowerCase())) return alias
  }
  // Vanishingly unlikely; fall back to something guaranteed unique.
  return sharedEmailAlias(`${normalizedUsername}-${Date.now().toString(36)}@${NO_EMAIL_DOMAIN}`, 1)
}

// ---------------------------------------------------------------------------
// GET / — list with filters
// ---------------------------------------------------------------------------

applicationsRouter.get("/", requireAuth, requirePermission("application.read"), (req, res) => {
  const readable = permittedGroupIds(req.auth!, "application.read")
  if (readable !== "all" && readable.length === 0) {
    throw forbidden("Your role cannot view applications.")
  }
  const p = pagination(req)
  const statusFilter = queryString(req, "status")
  const groupFilter = queryString(req, "groupId")
  const search = queryString(req, "search")

  const clauses: string[] = []
  const params: (string | number)[] = []

  // Group scoping (and the explicit groupId filter) match an application when
  // EITHER its requested OR assigned group is permitted. Using OR rather than
  // COALESCE(assigned, requested) means a pending application is never hidden
  // from the group that originally owns it, and a reassigned application stays
  // visible to both groups that have a stake in it.
  if (readable !== "all") {
    const placeholders = readable.map(() => "?").join(",")
    clauses.push(`(a.requested_group_id IN (${placeholders}) OR a.assigned_group_id IN (${placeholders}))`)
    params.push(...readable, ...readable)
  }
  if (groupFilter) {
    if (readable !== "all" && !readable.includes(groupFilter)) throw forbidden()
    clauses.push("(a.requested_group_id = ? OR a.assigned_group_id = ?)")
    params.push(groupFilter, groupFilter)
  }
  if (statusFilter) {
    clauses.push("a.status = ?")
    params.push(statusFilter)
  }
  if (search) {
    clauses.push("(a.full_name LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)")
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM applications a ${where}`, ...params)?.c ?? 0
  const items = all<ApplicationListRow>(
    `${APPLICATION_SELECT} ${where} ORDER BY a.submitted_at DESC, a.created_at DESC LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items.map(toDto), total, p))
})

// ---------------------------------------------------------------------------
// POST /webhook — Google Sheets / Apps Script intake (no auth; signed)
// ---------------------------------------------------------------------------

// `.nullish()` (not just `.optional()`): the Google Form script sends an explicit
// `null` for contact fields the applicant left blank, which must be treated as
// "absent" rather than rejected. A 400 here silently drops a real application.
const webhookSchema = z.object({
  externalId: z.string().trim().min(1).nullish(),
  responseId: z.string().trim().min(1).nullish(),
  id: z.string().trim().min(1).nullish(),
  fullName: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  groupId: z.string().trim().nullish(),
  group: z.string().trim().nullish(),
  answers: z.unknown().optional(),
  secret: z.string().optional(),
  submittedAt: z.string().trim().max(40).nullish(),
}).passthrough()

/**
 * Verifies the signature for the Google webhook. Two schemes are accepted:
 *
 *  1. `HMAC-SHA256(rawBody, secret)` as a lowercase hex string — the recommended
 *     scheme (the secret itself never travels over the wire).
 *  2. The shared secret verbatim — a simple fallback for quick setups.
 *
 * The value is read from the `x-chorale-signature` header, or from a `secret`
 * field in the body. When no secret is configured the endpoint stays open
 * (first-run / trusted network); as soon as an admin configures
 * `google_webhook_secret`, every call must be signed.
 */
function verifyWebhookSignature(provided: string, secret: string, rawBody: Buffer | undefined): void {
  if (!provided) throw forbidden("Invalid webhook signature.")

  // 1) HMAC-SHA256 of the exact request bytes (preferred).
  if (rawBody && rawBody.length > 0) {
    const expectedHex = hmacSha256Hex(secret, rawBody)
    if (constantTimeEqual(provided.trim().toLowerCase(), expectedHex)) return
  }

  // 2) The plain shared secret (no HMAC).
  if (constantTimeEqual(provided, secret)) return

  throw forbidden("Invalid webhook signature.")
}

applicationsRouter.post("/webhook", (req, res) => {
  const input = parse(webhookSchema, req.body)

  const secretRow = one<{ value_encrypted: string | null; value_plain: string | null; is_secret: number }>(
    "SELECT value_encrypted, value_plain, is_secret FROM integration_settings WHERE key = ?",
    "google_webhook_secret",
  )
  const configuredSecret = secretRow
    ? (secretRow.is_secret ? decryptSecret(secretRow.value_encrypted) : secretRow.value_plain)
    : null
  if (configuredSecret && configuredSecret.trim() !== "") {
    const headerSignature = req.get("x-chorale-signature") ?? ""
    const bodySignature = typeof input.secret === "string" ? input.secret : ""
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody
    try {
      verifyWebhookSignature(headerSignature || bodySignature, configuredSecret, rawBody)
    } catch (error) {
      // Record rejected signatures without ever logging the secret itself.
      recordAudit({
        actorId: null, actorName: "google_webhook",
        action: "application.webhook_rejected", entityType: "application", entityId: null,
        summary: "Rejected an unsigned or incorrectly signed Google form webhook", ip: req.ip,
      })
      throw error
    }
  }

  const externalId = input.externalId ?? input.responseId ?? input.id ?? null
  if (externalId) {
    const existing = one<{ id: string }>("SELECT id FROM applications WHERE external_id = ?", externalId)
    if (existing) {
      res.json({ ok: true, duplicate: true })
      return
    }
  }

  const submittedAt = input.submittedAt && !Number.isNaN(Date.parse(input.submittedAt))
    ? new Date(input.submittedAt).toISOString()
    : nowIso()
  // Accept either a wrapped `answers` array/object or a flat Google-Forms object.
  const answers = input.answers !== undefined
    ? normalizeAnswers(input.answers)
    : answersFromFlatBody((req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>)

  // The name may arrive at the top level or only as a "Full name" answer.
  const fullName = input.fullName ?? input.name ?? nameFromAnswers(answers)
  if (!fullName) throw badRequest("The webhook payload is missing the applicant's full name.", { fields: { fullName: "Required." } })

  // Group may be supplied by id or by key; an unrecognised/missing value falls back
  // to reading the group the applicant selected in their answers.
  const groupRef = input.groupId ?? input.group ?? null
  const group = groupRef ? (getGroupById(groupRef) ?? getGroupByKey(groupRef)) : undefined
  const requestedGroupId = group?.id ?? inferGroupIdFromAnswers(answers)

  // Contact details may arrive at the top level or only inside the answers.
  const inferredContact = contactFromAnswers(answers)
  const email = input.email?.trim() || inferredContact.email || null
  const phone = input.phone?.trim() || inferredContact.phone || null

  const applicationId = id()
  const timestamp = nowIso()

  // Preserve the verbatim provider payload, but never persist the shared secret.
  const rawBody: Record<string, unknown> = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? { ...(req.body as Record<string, unknown>) }
    : {}
  delete rawBody.secret

  transaction(() => {
    run(
      `INSERT INTO applications (id, external_id, source, submitted_at, full_name, email, phone,
                                 requested_group_id, assigned_group_id, status, duplicate_of, member_id,
                                 reviewed_by, reviewed_at, decision_note, raw_payload, created_at, updated_at)
       VALUES (?, ?, 'google_form', ?, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      applicationId, externalId, submittedAt, fullName.trim(),
      email, phone, requestedGroupId,
      JSON.stringify(rawBody), timestamp, timestamp,
    )
    insertAnswers(applicationId, answers)
  })

  recordAudit({
    actorId: null, actorName: "google_webhook",
    action: "application.webhook_intake", entityType: "application", entityId: applicationId,
    summary: `Application received via webhook${externalId ? ` (${externalId})` : ""}`,
    detail: { groupId: requestedGroupId, answerCount: answers.length }, ip: req.ip,
  })

  // Tell the Chairman and the group's own administrator an application is waiting.
  const resolvedGroup = requestedGroupId ? getGroupById(requestedGroupId) : undefined
  notifyApplicationIntake(applicationId, fullName.trim(), resolvedGroup, requestedGroupId)

  res.status(201).json({ ok: true, applicationId, requestedGroupId })
})

// ---------------------------------------------------------------------------
// GET /:id — detail
// ---------------------------------------------------------------------------

applicationsRouter.get("/:id", requireAuth, requirePermission("application.read"), (req, res) => {
  const application = getApplication(String(req.params.id))
  if (!application) throw notFound("That application does not exist.")
  assertApplicationAccess(req.auth!, "application.read", application)
  res.json({ application: loadApplicationDetail(application.id) })
})

// ---------------------------------------------------------------------------
// POST / — manual intake
// ---------------------------------------------------------------------------

const manualSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name.").max(160),
  email: z.string().trim().email("Enter a valid email address.").max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  groupId: z.enum(APPLICATION_GROUP_IDS),
  answers: z.unknown().optional(),
})

applicationsRouter.post("/", requireAuth, requirePermission("application.review"), (req, res) => {
  const input = parse(manualSchema, req.body)
  const group = getGroupById(input.groupId)
  if (!group) throw badRequest("That group does not exist.", { fields: { groupId: "Unknown group." } })
  assertGroupAccess(req.auth!, "application.review", input.groupId)

  const answers = normalizeAnswers(input.answers)
  const applicationId = id()
  const timestamp = nowIso()

  transaction(() => {
    run(
      `INSERT INTO applications (id, external_id, source, submitted_at, full_name, email, phone,
                                 requested_group_id, assigned_group_id, status, duplicate_of, member_id,
                                 reviewed_by, reviewed_at, decision_note, raw_payload, created_at, updated_at)
       VALUES (?, NULL, 'manual', ?, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      applicationId, timestamp, input.fullName.trim(),
      input.email ? input.email : null, input.phone ? input.phone : null, input.groupId,
      timestamp, timestamp,
    )
    insertAnswers(applicationId, answers)
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "application.create", entityType: "application", entityId: applicationId,
    summary: `Manual application entered for ${input.fullName.trim()} (${group.name})`,
    detail: { groupId: input.groupId, answerCount: answers.length }, ip: req.ip,
  })
  res.status(201).json({ application: loadApplicationDetail(applicationId) })
})

// ---------------------------------------------------------------------------
// PATCH /:id — review (status / group / note)
// ---------------------------------------------------------------------------

// Approve/reject deliberately live on POST /:id/decision so member creation is
// never bypassed; this endpoint only moves an application through review states.
const reviewPatchSchema = z.object({
  status: z.enum(["pending", "under_review", "more_info_required"]).optional(),
  assignedGroupId: z.enum(APPLICATION_GROUP_IDS).optional(),
  note: z.string().trim().max(2000).optional(),
})

applicationsRouter.patch("/:id", requireAuth, requirePermission("application.review"), (req, res) => {
  const application = getApplication(String(req.params.id))
  if (!application) throw notFound("That application does not exist.")
  assertApplicationAccess(req.auth!, "application.review", application)
  const input = parse(reviewPatchSchema, req.body)

  if (input.assignedGroupId) {
    const group = getGroupById(input.assignedGroupId)
    if (!group) throw badRequest("That group does not exist.", { fields: { assignedGroupId: "Unknown group." } })
    assertGroupAccess(req.auth!, "application.review", input.assignedGroupId)
  }

  const statusChanged = input.status !== undefined && input.status !== application.status
  const groupChanged = input.assignedGroupId !== undefined && input.assignedGroupId !== application.assigned_group_id
  if (!statusChanged && !groupChanged && input.note === undefined) {
    throw badRequest("Provide a status, group assignment or note to record a review.")
  }

  const action = statusChanged && groupChanged
    ? "status_and_group_change"
    : statusChanged ? "status_change" : groupChanged ? "group_change" : "note"
  const timestamp = nowIso()

  transaction(() => {
    const fields: string[] = ["reviewed_by = ?", "reviewed_at = ?", "updated_at = ?"]
    const params: (string | null)[] = [req.auth!.id, timestamp, timestamp]
    if (input.status !== undefined) { fields.push("status = ?"); params.push(input.status) }
    if (input.assignedGroupId !== undefined) { fields.push("assigned_group_id = ?"); params.push(input.assignedGroupId) }
    run(`UPDATE applications SET ${fields.join(", ")} WHERE id = ?`, ...params, application.id)

    run(
      `INSERT INTO application_reviews (id, application_id, actor_id, action, from_status, to_status,
                                        from_group_id, to_group_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id(), application.id, req.auth!.id, action,
      application.status, input.status ?? application.status,
      application.assigned_group_id, input.assignedGroupId ?? application.assigned_group_id,
      input.note ?? null, timestamp,
    )
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "application.update", entityType: "application", entityId: application.id,
    summary: `Application reviewed (${action}) for ${application.full_name}`,
    detail: { status: input.status ?? null, assignedGroupId: input.assignedGroupId ?? null, noteProvided: input.note !== undefined },
    ip: req.ip,
  })
  res.json({ application: loadApplicationDetail(application.id) })
})

// ---------------------------------------------------------------------------
// POST /:id/decision — approve / reject
// ---------------------------------------------------------------------------

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional(),
  assignedGroupId: z.enum(APPLICATION_GROUP_IDS).optional(),
})

type ApprovalOutcome =
  | {
      created: true
      memberId: string
      userId: string
      username: string
      initialPassword: string
      /** Carried out of the transaction so the member can be emailed afterwards. */
      fullName: string
      /**
       * The login account's stored email. Unique by necessity, and a reserved
       * alias when the applicant's address already belongs to another member.
       */
      email: string
      /**
       * The address the applicant actually gave — where credentials are sent and
       * what the member's contact record holds. Null when the form left it blank.
       */
      contactEmail: string | null
      /** True when the email is shared, so the username is the only sign-in. */
      usernameIsOnlySignIn: boolean
      groupName: string
    }
  | { created: false; memberId: string; userId: string | null }

applicationsRouter.post("/:id/decision", requireAuth, requirePermission("application.decide"), async (req, res) => {
  const application = getApplication(String(req.params.id))
  if (!application) throw notFound("That application does not exist.")
  assertApplicationAccess(req.auth!, "application.decide", application)
  const input = parse(decisionSchema, req.body)

  if (input.decision === "reject") {
    const timestamp = nowIso()
    transaction(() => {
      const fresh = getApplication(application.id)
      if (!fresh) throw notFound("That application does not exist.")
      // An approved application owns a member record and (possibly) a live
      // account. Reverting it to "rejected" would leave an active member under a
      // rejected application, with no API able to correct the state again.
      if (fresh.member_id || fresh.status === "approved") {
        throw conflict(
          "This application has already been approved and its member account exists. Deactivate the member instead of rejecting the application.",
        )
      }
      run(
        `UPDATE applications SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, decision_note = ?, updated_at = ?
          WHERE id = ?`,
        req.auth!.id, timestamp, input.note ?? null, timestamp, fresh.id,
      )
      run(
        `INSERT INTO application_reviews (id, application_id, actor_id, action, from_status, to_status,
                                          from_group_id, to_group_id, notes, created_at)
         VALUES (?, ?, ?, 'reject', ?, 'rejected', ?, NULL, ?, ?)`,
        id(), fresh.id, req.auth!.id, fresh.status, effectiveGroupId(fresh), input.note ?? null, timestamp,
      )
      recordAudit({
        actorId: req.auth!.id, actorName: req.auth!.displayName,
        action: "application.reject", entityType: "application", entityId: fresh.id,
        summary: `Application rejected for ${fresh.full_name}`, ip: req.ip,
      })
    })
    res.json({ application: loadApplicationDetail(application.id) })
    return
  }

  const targetGroupId = input.assignedGroupId ?? application.assigned_group_id ?? application.requested_group_id
  if (!targetGroupId) throw badRequest("Choose a group before approving this application.", { fields: { assignedGroupId: "Required to approve." } })
  const group = getGroupById(targetGroupId)
  if (!group) throw badRequest("That group does not exist.", { fields: { assignedGroupId: "Unknown group." } })
  assertGroupAccess(req.auth!, "application.decide", targetGroupId)

  const outcome = transaction<ApprovalOutcome>(() => {
    // Re-read inside the transaction and stop if a member was already created:
    // approving twice must never create a second member or account.
    const fresh = getApplication(application.id)
    if (!fresh) throw notFound("That application does not exist.")
    if (fresh.member_id) {
      const linked = one<{ user_id: string | null }>("SELECT user_id FROM members WHERE id = ?", fresh.member_id)
      // Re-approving repairs an application whose status drifted away from its
      // member (e.g. it was rejected after approval in an earlier release): the
      // application and the member it points at can never disagree.
      if (fresh.status !== "approved") {
        const repairAt = nowIso()
        run(
          `UPDATE applications SET status = 'approved', reviewed_by = ?, reviewed_at = ?, decision_note = ?,
                                  updated_at = ?
            WHERE id = ?`,
          req.auth!.id, repairAt, input.note ?? fresh.decision_note, repairAt, fresh.id,
        )
        run(
          `INSERT INTO application_reviews (id, application_id, actor_id, action, from_status, to_status,
                                            from_group_id, to_group_id, notes, created_at)
           VALUES (?, ?, ?, 'approve', ?, 'approved', ?, ?, ?, ?)`,
          id(), fresh.id, req.auth!.id, fresh.status, effectiveGroupId(fresh),
          effectiveGroupId(fresh), input.note ?? fresh.decision_note, repairAt,
        )
        recordAudit({
          actorId: req.auth!.id, actorName: req.auth!.displayName,
          action: "application.approve", entityType: "application", entityId: fresh.id,
          summary: `Application re-confirmed for ${fresh.full_name}; status corrected to approved`,
          detail: { memberId: fresh.member_id, correctedFrom: fresh.status },
          ip: req.ip,
        })
      }
      return { created: false as const, memberId: fresh.member_id, userId: linked?.user_id ?? null }
    }

    const timestamp = nowIso()
    // The email is optional on the form. An applicant who left it blank still
    // gets an account: they sign in with a username derived from their full name.
    const applicantEmail = fresh.email?.trim() || null
    const { username, normalized: usernameNormalized } = allocateUsername(fresh.full_name)
    // The users table requires a unique, non-null email, so a name-only account
    // stores a reserved, non-routable placeholder that is never emailed.
    //
    // An email that is already used by another member is not a reason to refuse
    // the approval: one family applying for two people is ordinary, and both are
    // real members who both need credentials. The second account keeps a unique
    // reserved alias of the shared address (see sharedEmailAlias) while the
    // member record below carries the real address, so both people are contacted
    // there and both appear with the same email in every list.
    const email = applicantEmail
      ? uniqueLoginEmail(applicantEmail, usernameNormalized)
      : placeholderEmail(usernameNormalized)
    const emailNormalized = email.toLowerCase()
    const sharesEmailWithExistingAccount =
      applicantEmail !== null && emailNormalized !== applicantEmail.toLowerCase()

    // Carry whatever the applicant supplied (date of birth, gender, voice
    // section, address, occupation, etc.) into the member record.
    const profile = applicantProfileFromAnswers(listAnswers(fresh.id))

    // Create the account with credentials generated on the spot, so the
    // administrator can hand a username and password over immediately (email
    // delivery is not configured). The member picks their own password the
    // first time they sign in.
    const userId = id()
    const initialPassword = generatePassword()
    // `hash` verifies the sign-in, `enc` keeps the password readable so the
    // administrator (and the member's own record) can show it again later.
    const { hash: passwordHash, enc: passwordEnc } = hashAndRemember(initialPassword)
    run(
      `INSERT INTO users (id, email, email_normalized, username, username_normalized, password_hash, password_enc,
                          display_name, status, must_change_password, failed_login_count, last_login_at,
                          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 0, NULL, ?, ?)`,
      userId, email, emailNormalized, username, usernameNormalized, passwordHash, passwordEnc,
      fresh.full_name, timestamp, timestamp,
    )
    run(
      "INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?)",
      userId, defaultRoleForGroup(group), req.auth!.id, timestamp,
    )

    const created = createMemberRecord({
      groupId: targetGroupId,
      fullName: fresh.full_name,
      userId,
      status: "active",
      gender: profile.gender ?? undefined,
      dateOfBirth: profile.dateOfBirth ?? undefined,
      voiceSectionId: profile.voiceSectionId ?? undefined,
    })
    run(
      `UPDATE member_contacts SET email = ?, phone = ?, address = ?, city = ?, region = ?, updated_at = ?
        WHERE member_id = ?`,
      applicantEmail, fresh.phone ?? null, profile.address ?? null, profile.city ?? null,
      profile.region ?? null, timestamp, created.id,
    )

    // Carry the group-specific answers into the matching profile table. The
    // columns only exist per group, so write the ones that apply.
    if (group.key === "senior") {
      run(
        `UPDATE member_senior SET occupation = ?, singing_experience = ?, updated_at = ?
          WHERE member_id = ?`,
        profile.occupation ?? null, profile.singingExperience ?? null, timestamp, created.id,
      )
    } else if (group.key === "junior") {
      run(
        `UPDATE member_junior SET current_class = ?, emergency_contact_name = ?,
                                   emergency_contact_phone = ?, updated_at = ?
          WHERE member_id = ?`,
        profile.currentClass ?? null, profile.emergencyContactName ?? null,
        profile.emergencyContactPhone ?? null, timestamp, created.id,
      )
    } else {
      run(
        `UPDATE member_support SET skills = ?, updated_at = ? WHERE member_id = ?`,
        profile.skills ?? null, timestamp, created.id,
      )
    }

    run(
      `UPDATE applications SET status = 'approved', assigned_group_id = ?, member_id = ?, reviewed_by = ?,
                                reviewed_at = ?, decision_note = ?, updated_at = ?
        WHERE id = ?`,
      targetGroupId, created.id, req.auth!.id, timestamp, input.note ?? null, timestamp, fresh.id,
    )
    run(
      `INSERT INTO application_reviews (id, application_id, actor_id, action, from_status, to_status,
                                        from_group_id, to_group_id, notes, created_at)
       VALUES (?, ?, ?, 'approve', ?, 'approved', ?, ?, ?, ?)`,
      id(), fresh.id, req.auth!.id, fresh.status, effectiveGroupId(fresh), targetGroupId, input.note ?? null, timestamp,
    )
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "application.approve", entityType: "application", entityId: fresh.id,
      summary: `Application approved for ${fresh.full_name} (${group.name}); member ${created.memberNo} created with account ${username}`,
      detail: { memberId: created.id, memberNo: created.memberNo, userId, groupId: targetGroupId, username },
      ip: req.ip,
    })

    return {
      created: true as const,
      memberId: created.id,
      userId,
      username,
      initialPassword,
      fullName: fresh.full_name,
      // The login account's stored email: unique, and a reserved alias when the
      // applicant's address already belongs to another member.
      email,
      // The address the applicant actually gave, which is where credentials must
      // be sent and what the member's contact record holds. Equal to `email`
      // except when the address is shared with an existing account.
      contactEmail: applicantEmail,
      usernameIsOnlySignIn: sharesEmailWithExistingAccount,
      groupName: group.name,
    }
  })

  if (outcome.created) {
    // Deliver the credentials, then answer. Approval is already committed, so a
    // mail failure changes only what the administrator is told — never the
    // member record.
    //
    // Addressed to the real contact address, never the reserved alias: when two
    // members share one email, each person's own credentials must reach that same
    // real inbox, not an address derived from it.
    const delivery = await deliverLoginDetails({
      fullName: outcome.fullName,
      username: outcome.username,
      email: outcome.contactEmail,
      // Two people sharing one inbox each get their own message; naming the
      // member in the subject keeps the two apart at a glance.
      sharedMailbox: outcome.usernameIsOnlySignIn,
      password: outcome.initialPassword,
      groupName: outcome.groupName,
      signInUrl: `${req.protocol}://${req.get("host") ?? ""}`,
    })

    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "application.credentials_delivered", entityType: "application", entityId: application.id,
      summary: delivery.sent
        ? `Sign-in details for ${outcome.fullName} emailed to ${delivery.to}`
        : `Sign-in details for ${outcome.fullName} were not emailed (${delivery.reason})`,
      detail: {
        username: outcome.username, to: delivery.to, reason: delivery.reason,
        sharedMailbox: outcome.usernameIsOnlySignIn, error: delivery.error ?? null,
      },
      ip: req.ip,
    })

    res.status(201).json({
      member: getMemberDetail(outcome.memberId, { includeSensitive: true, includeCredentials: true }),
      user: loadAuthUser(outcome.userId),
      credentials: { username: outcome.username, password: outcome.initialPassword },
      delivery,
    })
    return
  }

  // Already approved: return the existing member without minting a new invitation
  // (the raw token is only ever available at creation time).
  res.json({
    member: getMemberDetail(outcome.memberId, { includeSensitive: true }),
    user: outcome.userId ? loadAuthUser(outcome.userId) : null,
    invitation: null,
    duplicate: true,
  })
})

// ---------------------------------------------------------------------------
// POST /:id/documents — private attachment upload
// ---------------------------------------------------------------------------

applicationsRouter.post(
  "/:id/documents",
  requireAuth,
  requirePermission("application.review"),
  documentUpload.single("file"),
  (req, res) => {
    const application = getApplication(String(req.params.id))
    if (!application) throw notFound("That application does not exist.")
    assertApplicationAccess(req.auth!, "application.review", application)
    if (!req.file) throw badRequest("Choose a document to upload.")

    const saved = saveUpload({
      bucket: "private",
      entityType: "application_document",
      entityId: application.id,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      data: req.file.buffer,
      uploadedBy: req.auth!.id,
    })
    recordAudit({
      actorId: req.auth!.id, actorName: req.auth!.displayName,
      action: "application.document_upload", entityType: "application", entityId: application.id,
      summary: `Document uploaded for application of ${application.full_name}`,
      detail: { fileId: saved.id, mimeType: saved.mimeType }, ip: req.ip,
    })
    res.status(201).json({ file: saved })
  },
)
