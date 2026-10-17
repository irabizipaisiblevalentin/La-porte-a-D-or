import { config } from "../config.js"
import { all, one, run, transaction } from "../db/index.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { getGroupById } from "./groups.js"

export interface MemberRow {
  id: string
  member_no: string
  group_id: string
  user_id: string | null
  full_name: string
  gender: string | null
  date_of_birth: string | null
  status: string
  joined_at: string
  photo_path: string | null
  voice_section_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deactivated_at: string | null
}

/** Generates the next sequential member number for the joining year, e.g. CHR-2026-0001. */
export function nextMemberNo(joinedAt = new Date()): string {
  const prefix = `${config.memberNo.prefix}-${joinedAt.getUTCFullYear()}-`
  const row = one<{ max: string | null }>("SELECT MAX(member_no) AS max FROM members WHERE member_no LIKE ?", `${prefix}%`)
  const last = row?.max ? Number.parseInt(row.max.slice(prefix.length), 10) : 0
  const next = Number.isFinite(last) ? last + 1 : 1
  return `${prefix}${String(next).padStart(4, "0")}`
}

export interface CreateMemberInput {
  groupId: string
  fullName: string
  joinedAt?: string
  gender?: string | null
  dateOfBirth?: string | null
  status?: string
  voiceSectionId?: string | null
  notes?: string | null
  userId?: string | null
  photoPath?: string | null
}

/** Creates the member row together with its group-specific profile row in one transaction. */
export function createMemberRecord(input: CreateMemberInput): { id: string; memberNo: string } {
  const timestamp = nowIso()
  const joinedAt = input.joinedAt ?? timestamp.slice(0, 10)
  return transaction(() => {
    const memberId = id()
    const memberNo = nextMemberNo(new Date(`${joinedAt}T00:00:00.000Z`))
    run(
      `INSERT INTO members (id, member_no, group_id, user_id, full_name, gender, date_of_birth, status, joined_at,
                            photo_path, voice_section_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      memberId, memberNo, input.groupId, input.userId ?? null, input.fullName,
      input.gender ?? null, input.dateOfBirth ?? null, input.status ?? "active", joinedAt,
      input.photoPath ?? null, input.voiceSectionId ?? null, input.notes ?? null, timestamp, timestamp,
    )
    const group = getGroupById(input.groupId)
    if (group?.key === "senior") {
      run("INSERT INTO member_senior (member_id, updated_at) VALUES (?, ?)", memberId, timestamp)
    } else if (group?.key === "junior") {
      run("INSERT INTO member_junior (member_id, updated_at) VALUES (?, ?)", memberId, timestamp)
    } else {
      run("INSERT INTO member_support (member_id, updated_at) VALUES (?, ?)", memberId, timestamp)
    }
    run("INSERT INTO member_contacts (member_id, updated_at) VALUES (?, ?)", memberId, timestamp)
    return { id: memberId, memberNo }
  })
}

export function getMember(id: string): (MemberRow & { group_key: string; group_name: string; voice_section_name: string | null }) | undefined {
  return one(
    `SELECT m.*, g.key AS group_key, g.name AS group_name, vs.name AS voice_section_name
       FROM members m
       JOIN groups g ON g.id = m.group_id
       LEFT JOIN voice_sections vs ON vs.id = m.voice_section_id
      WHERE m.id = ?`,
    id,
  )
}

export function getMemberByUserId(userId: string): MemberRow | undefined {
  return one<MemberRow>("SELECT * FROM members WHERE user_id = ?", userId)
}

export interface FullMember {
  member: MemberRow & { group_key: string; group_name: string; voice_section_name: string | null; email: string | null }
  contact: Record<string, unknown> | null
  senior: Record<string, unknown> | null
  junior: Record<string, unknown> | null
  support: Record<string, unknown> | null
}

/**
 * Loads a member with all profile facets. Sensitive junior fields are removed
 * unless the viewer holds `member.sensitive.read` for the junior group.
 */
export function getMemberDetail(memberId: string, options: { includeSensitive: boolean }): FullMember | null {
  const member = getMember(memberId)
  if (!member) return null
  const contact = one<Record<string, unknown>>(
    `SELECT mc.*, u.email AS account_email
       FROM member_contacts mc
       LEFT JOIN users u ON u.id = ?
      WHERE mc.member_id = ?`,
    member.user_id, memberId,
  )
  const senior = one<Record<string, unknown>>("SELECT * FROM member_senior WHERE member_id = ?", memberId)
  const junior = one<Record<string, unknown>>("SELECT * FROM member_junior WHERE member_id = ?", memberId)
  const support = one<Record<string, unknown>>("SELECT * FROM member_support WHERE member_id = ?", memberId)

  const account = member.user_id
    ? one<{ email: string }>("SELECT email FROM users WHERE id = ?", member.user_id)
    : undefined

  const sensitiveJunior = junior && !options.includeSensitive
    ? {
        school: junior.school,
        current_class: junior.current_class,
        // guardian and emergency contact details withheld
      }
    : junior

  return {
    member: { ...member, email: account?.email ?? (contact?.email as string | null) ?? null },
    contact: contact ?? null,
    senior: senior ?? null,
    junior: sensitiveJunior ?? null,
    support: support ?? null,
  }
}

export function listMembersByGroup(groupId: string): MemberRow[] {
  return all<MemberRow>("SELECT * FROM members WHERE group_id = ? ORDER BY full_name", groupId)
}

export function memberGroupId(memberId: string): string | null {
  const row = one<{ group_id: string }>("SELECT group_id FROM members WHERE id = ?", memberId)
  return row?.group_id ?? null
}
