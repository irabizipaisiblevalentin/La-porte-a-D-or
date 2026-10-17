import { all, one } from "../db/index.js"

export interface GroupRow {
  id: string
  key: "senior" | "junior" | "members"
  name: string
  description: string
  is_minor_group: number
}

export function listGroups(): GroupRow[] {
  return all<GroupRow>("SELECT * FROM groups ORDER BY CASE key WHEN 'senior' THEN 1 WHEN 'junior' THEN 2 ELSE 3 END")
}

export function getGroupById(id: string | null | undefined): GroupRow | undefined {
  if (!id) return undefined
  return one<GroupRow>("SELECT * FROM groups WHERE id = ?", id)
}

export function getGroupByKey(key: string): GroupRow | undefined {
  return one<GroupRow>("SELECT * FROM groups WHERE key = ?", key)
}

export function groupExists(id: string | null | undefined): boolean {
  return Boolean(getGroupById(id))
}

export interface VoiceSectionRow {
  id: string
  key: string
  name: string
  sort_order: number
}

export function listVoiceSections(): VoiceSectionRow[] {
  return all<VoiceSectionRow>("SELECT * FROM voice_sections ORDER BY sort_order")
}

export function listLocations() {
  return all("SELECT id, name, address, notes FROM locations ORDER BY name")
}
