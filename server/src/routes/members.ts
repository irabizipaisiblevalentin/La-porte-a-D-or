import { Router } from "express"
import { z } from "zod"
import { can, canActOnMember, groupScope } from "../auth/access.js"
import { one, all, run, transaction } from "../db/index.js"
import { getGroupById, listGroups, listVoiceSections } from "../services/groups.js"
import { assertGroupAccess, permittedGroupIds, requireAuth, requirePermission } from "../middleware/auth.js"
import { createMemberRecord, getMember, getMemberDetail } from "../services/members.js"
import { rememberedPassword, hashAndRemember } from "../services/credentials.js"
import { deliverLoginDetails } from "../services/onboarding.js"
import { badRequest, forbidden, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryString } from "../lib/http.js"
import { recordAudit } from "../lib/audit.js"
import { generatePassword } from "../lib/security.js"
import { revokeAllSessions } from "../auth/session.js"
import { imageUpload } from "../middleware/upload.js"
import { deleteFile, saveUpload, type FileRow } from "../services/uploads.js"
import { nowIso } from "../lib/time.js"

export const membersRouter: Router = Router()

membersRouter.get("/meta", requireAuth, (_req, res) => {
  res.json({ groups: listGroups(), voiceSections: listVoiceSections() })
})

membersRouter.get("/", requireAuth, requirePermission("member.read"), (req, res) => {
  const readable = permittedGroupIds(req.auth!, "member.read")
  if (readable !== "all" && readable.length === 0) {
    // Only own-record access: a directory listing is not permitted.
    throw forbidden("Your role can view only your own record.")
  }
  const p = pagination(req)
  const groupFilter = queryString(req, "groupId")
  const statusFilter = queryString(req, "status")
  const voiceFilter = queryString(req, "voiceSectionId")
  const search = queryString(req, "search")

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (readable !== "all") {
    clauses.push(`m.group_id IN (${readable.map(() => "?").join(",")})`)
    params.push(...readable)
  }
  if (groupFilter) {
    if (readable !== "all" && !readable.includes(groupFilter)) throw forbidden()
    clauses.push("m.group_id = ?")
    params.push(groupFilter)
  }
  if (statusFilter) {
    clauses.push("m.status = ?")
    params.push(statusFilter)
  }
  if (voiceFilter) {
    clauses.push("m.voice_section_id = ?")
    params.push(voiceFilter)
  }
  if (search) {
    clauses.push("(m.full_name LIKE ? OR m.member_no LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM members m ${where}`, ...params)?.c ?? 0
  const items = all(
    `SELECT m.id, m.member_no, m.full_name, m.status, m.joined_at, m.photo_path, m.group_id,
            g.key AS group_key, g.name AS group_name, vs.name AS voice_section_name
       FROM members m
       JOIN groups g ON g.id = m.group_id
       LEFT JOIN voice_sections vs ON vs.id = m.voice_section_id
       ${where}
       ORDER BY m.full_name COLLATE NOCASE
       LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  )
  res.json(makePage(items, total, p))
})

membersRouter.get("/me", requireAuth, (req, res) => {
  if (!req.auth!.memberId) {
    res.json({ member: null })
    return
  }
  const detail = getMemberDetail(req.auth!.memberId, { includeSensitive: true, includeCredentials: true })
  if (!detail) throw notFound("Your member record could not be found.")
  res.json({ member: detail })
})

const contactPatch = z.object({
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email("Enter a valid email address.").max(200).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
})

const selfUpdateSchema = z.object({
  contact: contactPatch.optional(),
  senior: z.object({
    occupation: z.string().trim().max(160).nullable().optional(),
    workplace: z.string().trim().max(160).nullable().optional(),
    singing_experience: z.string().trim().max(1000).nullable().optional(),
  }).optional(),
  junior: z.object({
    school: z.string().trim().max(160).nullable().optional(),
    current_class: z.string().trim().max(80).nullable().optional(),
    guardian_name: z.string().trim().max(160).nullable().optional(),
    guardian_relationship: z.string().trim().max(80).nullable().optional(),
    guardian_phone: z.string().trim().max(40).nullable().optional(),
    emergency_contact_name: z.string().trim().max(160).nullable().optional(),
    emergency_contact_phone: z.string().trim().max(40).nullable().optional(),
  }).optional(),
  support: z.object({
    skills: z.string().trim().max(1000).nullable().optional(),
    availability: z.string().trim().max(300).nullable().optional(),
  }).optional(),
})

membersRouter.patch("/me", requireAuth, (req, res) => {
  const member = getMember(req.auth!.memberId ?? "")
  if (!member) throw notFound("Your member record could not be found.")
  if (!canActOnMember(req.auth!, "member.write", member)) throw forbidden()
  const input = parse(selfUpdateSchema, req.body)
  applyProfileUpdate(member.id, member.group_id, input, { admin: false })
  run("UPDATE members SET updated_at = ? WHERE id = ?", nowIso(), member.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.self_update", entityType: "member", entityId: member.id,
    summary: `${member.full_name} updated their own profile`, ip: req.ip,
  })
  res.json({ member: getMemberDetail(member.id, { includeSensitive: true, includeCredentials: true }) })
})

const adminCreateSchema = z.object({
  groupId: z.enum(["grp_senior", "grp_junior", "grp_members"]),
  fullName: z.string().trim().min(2, "Enter the full name.").max(160),
  gender: z.string().trim().max(40).nullable().optional(),
  dateOfBirth: z.string().trim().max(20).nullable().optional(),
  joinedAt: z.string().trim().max(20).nullable().optional(),
  status: z.enum(["active", "inactive", "suspended", "withdrawn"]).optional(),
  voiceSectionId: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

membersRouter.post("/", requireAuth, requirePermission("member.write"), (req, res) => {
  const input = parse(adminCreateSchema, req.body)
  assertGroupAccess(req.auth!, "member.write", input.groupId)
  const created = createMemberRecord({
    groupId: input.groupId,
    fullName: input.fullName,
    joinedAt: input.joinedAt ?? undefined,
    gender: input.gender ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    status: input.status,
    voiceSectionId: input.voiceSectionId ?? null,
    notes: input.notes ?? null,
  })
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.create", entityType: "member", entityId: created.id,
    summary: `Member ${created.memberNo} (${input.fullName}) created in ${input.groupId}`, ip: req.ip,
  })
  res.status(201).json({ member: getMemberDetail(created.id, { includeSensitive: true }) })
})

membersRouter.get("/:id", requireAuth, requirePermission("member.read"), (req, res) => {
  const member = getMember(String(req.params.id))
  if (!member) throw notFound("That member does not exist.")
  if (!canActOnMember(req.auth!, "member.read", member)) throw forbidden()
  const includeSensitive = can(req.auth!, "member.sensitive.read", groupScope(member.group_id))
  res.json({
    member: getMemberDetail(member.id, {
      includeSensitive: includeSensitive || req.auth!.memberId === member.id,
      // Anyone who may edit the record (or owns it) can read the sign-in details
      // back out. View-only roles never receive them.
      includeCredentials: canActOnMember(req.auth!, "member.write", member),
    }),
  })
})

const adminUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  gender: z.string().trim().max(40).nullable().optional(),
  dateOfBirth: z.string().trim().max(20).nullable().optional(),
  status: z.enum(["active", "inactive", "suspended", "withdrawn"]).optional(),
  voiceSectionId: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  contact: contactPatch.optional(),
  senior: selfUpdateSchema.shape.senior,
  junior: selfUpdateSchema.shape.junior,
  support: z.object({
    department: z.string().trim().max(160).nullable().optional(),
    primary_responsibility: z.string().trim().max(200).nullable().optional(),
    skills: z.string().trim().max(1000).nullable().optional(),
    experience: z.string().trim().max(1000).nullable().optional(),
    availability: z.string().trim().max(300).nullable().optional(),
  }).optional(),
})

membersRouter.patch("/:id", requireAuth, requirePermission("member.write"), (req, res) => {
  const member = getMember(String(req.params.id))
  if (!member) throw notFound("That member does not exist.")
  assertGroupAccess(req.auth!, "member.write", member.group_id)
  const input = parse(adminUpdateSchema, req.body)
  const timestamp = nowIso()

  transaction(() => {
    const memberFields: string[] = []
    const memberParams: (string | null)[] = []
    if (input.fullName !== undefined) { memberFields.push("full_name = ?"); memberParams.push(input.fullName) }
    if (input.gender !== undefined) { memberFields.push("gender = ?"); memberParams.push(input.gender ?? null) }
    if (input.dateOfBirth !== undefined) { memberFields.push("date_of_birth = ?"); memberParams.push(input.dateOfBirth ?? null) }
    if (input.status !== undefined) { memberFields.push("status = ?"); memberParams.push(input.status) }
    if (input.voiceSectionId !== undefined) { memberFields.push("voice_section_id = ?"); memberParams.push(input.voiceSectionId) }
    if (input.notes !== undefined) { memberFields.push("notes = ?"); memberParams.push(input.notes ?? null) }
    if (memberFields.length > 0) {
      memberFields.push("updated_at = ?")
      memberParams.push(timestamp)
      run(`UPDATE members SET ${memberFields.join(", ")} WHERE id = ?`, ...memberParams, member.id)
    }
    applyProfileUpdate(member.id, member.group_id, input, { admin: true })
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.update", entityType: "member", entityId: member.id,
    summary: `Member ${member.member_no} updated`, detail: { fields: Object.keys(input) }, ip: req.ip,
  })
  const includeSensitive = can(req.auth!, "member.sensitive.read", groupScope(member.group_id))
  res.json({
    member: getMemberDetail(member.id, {
      includeSensitive,
      includeCredentials: canActOnMember(req.auth!, "member.write", member),
    }),
  })
})

/**
 * Removes a member record for good.
 *
 * Who may do it: the Chairman anywhere (`member.delete` at global scope) and a
 * group administrator for their own group's members, the same way they already
 * manage those records. The check is `canActOnMember`, so a senior leader cannot
 * reach across into the junior group by guessing an id.
 *
 * An active member can be erased in one step, but only when the caller says so
 * explicitly (`confirmActive: true`). Without it, an active record is refused and
 * the message points at withdrawal — a single accidental DELETE must not be able
 * to empty the register. This is a real confirmation, not a formality: the account
 * the member signs in with, their photograph and every link to them go with it.
 *
 * What survives: the application the member came from (its member link is
 * cleared) and the immutable audit trail, so the choir can still prove who applied
 * and who removed them. An administrator's own account is never removed by this
 * route; the role must be taken away first.
 */
membersRouter.delete("/:id", requireAuth, requirePermission("member.delete"), (req, res) => {
  const member = getMember(String(req.params.id))
  if (!member) throw notFound("That member does not exist.")
  if (!canActOnMember(req.auth!, "member.delete", member)) throw forbidden()

  const confirmActive = req.body?.confirmActive === true
  if (member.status !== "withdrawn" && !confirmActive) {
    throw badRequest(
      `${member.full_name} is ${member.status}. Withdraw the member first, or confirm you want the active record erased.`,
    )
  }

  // A member account must never take an administrator's account with it.
  const adminRole = member.user_id
    ? one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM user_roles
          WHERE user_id = ? AND role_id IN ('role_chairman','role_senior_leader','role_junior_admin','role_members_admin','role_events_coordinator')`,
        member.user_id,
      )?.c ?? 0
    : 0
  if (adminRole > 0) throw badRequest("That record is linked to an administrator account; remove the administrator role first.")

  const photos = all<FileRow>(
    "SELECT * FROM file_uploads WHERE entity_type = 'member_photo' AND entity_id = ?",
    member.id,
  )

  transaction(() => {
    for (const photo of photos) deleteFile(photo)
    if (member.user_id) run("DELETE FROM users WHERE id = ?", member.user_id)
    run("DELETE FROM members WHERE id = ?", member.id)
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.delete", entityType: "member", entityId: member.id,
    summary: `Member ${member.member_no} (${member.full_name}) removed from the register`,
    detail: {
      memberNo: member.member_no, fullName: member.full_name, status: member.status,
      accountRemoved: Boolean(member.user_id), photosRemoved: photos.length,
    },
    ip: req.ip,
  })
  res.json({ ok: true, memberNo: member.member_no, fullName: member.full_name })
})

/**
 * Emails the member their sign-in details again — the automatic message at
 * approval, on demand. Useful after an address is corrected, or the first time
 * a relay is configured.
 */
membersRouter.post("/:id/send-credentials", requireAuth, requirePermission("member.write"), async (req, res) => {
  const member = getMember(String(req.params.id))
  if (!member) throw notFound("That member does not exist.")
  if (!canActOnMember(req.auth!, "member.write", member)) throw forbidden()
  const account = member.user_id
    ? one<{ email: string; username: string | null }>("SELECT email, username FROM users WHERE id = ?", member.user_id)
    : undefined
  if (!account) throw badRequest("This member has no sign-in account yet.")
  const password = rememberedPassword(member.user_id)
  if (!password) throw badRequest("No password is stored for this member. Issue a password reset instead.")

  const delivery = await deliverLoginDetails({
    fullName: member.full_name,
    username: account.username,
    email: account.email,
    password,
    groupName: member.group_name,
    signInUrl: `${req.protocol}://${req.get("host") ?? ""}`,
  })
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.credentials_sent", entityType: "member", entityId: member.id,
    summary: delivery.sent
      ? `Sign-in details for ${member.full_name} emailed to ${delivery.to}`
      : `Sign-in details for ${member.full_name} were not emailed (${delivery.reason})`,
    detail: { reason: delivery.reason, to: delivery.to },
    ip: req.ip,
  })
  res.json({ delivery })
})

/**
 * Gives one member a brand-new sign-in password and hands it over.
 *
 * This is the group administrator's own remedy for a member who lost their
 * password, so nobody has to wait for the Chairman. It is deliberately heavier
 * than sending the old details: a reset is often the answer to "someone else is
 * using my account", so the previous password stops working, every outstanding
 * reset link is voided and the member's live sessions are closed.
 */
membersRouter.post("/:id/reset-password", requireAuth, requirePermission("member.reset_password"), async (req, res) => {
  const member = getMember(String(req.params.id))
  if (!member) throw notFound("That member does not exist.")
  if (!canActOnMember(req.auth!, "member.reset_password", member)) throw forbidden()
  const userId = member.user_id
  if (!userId) throw badRequest("This member has no sign-in account yet.")
  const account = one<{ email: string; username: string | null }>(
    "SELECT email, username FROM users WHERE id = ?", userId,
  )
  if (!account) throw badRequest("This member has no sign-in account yet.")

  const password = generatePassword()
  // `hash` is what the next sign-in is checked against, `enc` keeps the plain
  // text readable so the administrator can hand it over — same pair as approval.
  const { hash, enc } = hashAndRemember(password)
  const timestamp = nowIso()
  transaction(() => {
    run(
      `UPDATE users SET password_hash = ?, password_enc = ?, must_change_password = 1,
                        failed_login_count = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
      hash, enc, timestamp, userId,
    )
    // Anything tied to the old password dies with it.
    run("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL", userId)
    revokeAllSessions(userId)
  })

  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.password_reset", entityType: "member", entityId: member.id,
    summary: `Sign-in password reset for ${member.full_name}`,
    detail: { memberNo: member.member_no, username: account.username, groupId: member.group_id },
    ip: req.ip,
  })

  const delivery = await deliverLoginDetails({
    fullName: member.full_name,
    username: account.username,
    email: account.email,
    password,
    groupName: member.group_name,
    signInUrl: `${req.protocol}://${req.get("host") ?? ""}`,
  })
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.credentials_sent", entityType: "member", entityId: member.id,
    summary: delivery.sent
      ? `New sign-in details for ${member.full_name} emailed to ${delivery.to}`
      : `New sign-in details for ${member.full_name} were not emailed (${delivery.reason})`,
    detail: { reason: delivery.reason, to: delivery.to },
    ip: req.ip,
  })

  res.json({ credentials: { username: account.username, password }, delivery })
})

membersRouter.post("/:id/photo", requireAuth, requirePermission("member.write"), imageUpload.single("file"), (req, res) => {
  const member = getMember(String(req.params.id))
  if (!member) throw notFound("That member does not exist.")
  if (!canActOnMember(req.auth!, "member.write", member)) throw forbidden()
  if (!req.file) throw badRequest("Choose an image file to upload.")
  const saved = saveUpload({
    bucket: "private", entityType: "member_photo", entityId: member.id,
    originalName: req.file.originalname, mimeType: req.file.mimetype, data: req.file.buffer, uploadedBy: req.auth!.id,
  })
  run("UPDATE members SET photo_path = ?, updated_at = ? WHERE id = ?", saved.url, nowIso(), member.id)
  recordAudit({
    actorId: req.auth!.id, actorName: req.auth!.displayName,
    action: "member.photo_update", entityType: "member", entityId: member.id,
    summary: `Photograph updated for member ${member.member_no}`, ip: req.ip,
  })
  res.status(201).json({ photoPath: saved.url })
})

interface ProfileUpdate {
  contact?: Record<string, string | null | undefined>
  senior?: Record<string, string | null | undefined>
  junior?: Record<string, string | null | undefined>
  support?: Record<string, string | null | undefined>
}

function applyProfileUpdate(memberId: string, groupId: string, input: ProfileUpdate, options: { admin: boolean }): void {
  const timestamp = nowIso()
  const group = getGroupById(groupId)

  if (input.contact) {
    const fields = input.contact as Record<string, string | null | undefined>
    updateFacet("member_contacts", memberId, fields, [
      "phone", "email", "address", "city", "region", "country",
    ], timestamp)
  }
  if (group?.key === "senior" && input.senior) {
    updateFacet("member_senior", memberId, input.senior, ["occupation", "workplace", "singing_experience"], timestamp)
  }
  if (group?.key === "junior" && input.junior) {
    // Junior guardian/emergency data is written only by authorised administrators.
    const allowedSelf = ["school", "current_class", "guardian_name", "guardian_relationship", "guardian_phone", "emergency_contact_name", "emergency_contact_phone"]
    updateFacet("member_junior", memberId, input.junior, allowedSelf, timestamp)
  }
  if (group?.key === "members" && input.support) {
    updateFacet("member_support", memberId, input.support, ["department", "primary_responsibility", "skills", "experience", "availability"], timestamp)
  }
}

function updateFacet(
  table: string,
  memberId: string,
  values: Record<string, string | null | undefined>,
  allowed: string[],
  timestamp: string,
): void {
  const fields: string[] = []
  const params: (string | null)[] = []
  for (const key of allowed) {
    if (values[key] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(values[key] ?? null)
    }
  }
  if (fields.length === 0) return
  fields.push("updated_at = ?")
  params.push(timestamp)
  run(`UPDATE ${table} SET ${fields.join(", ")} WHERE member_id = ?`, ...params, memberId)
}
