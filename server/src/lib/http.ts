import type { Request } from "express"
import type { ZodType } from "zod"
import { badRequest } from "./errors.js"

/** Validates untrusted input and throws a 400 with per-field messages. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_form"
    if (!fields[path]) fields[path] = issue.message
  }
  throw badRequest("Please correct the highlighted fields.", { fields })
}

export interface Pagination {
  page: number
  pageSize: number
  limit: number
  offset: number
}

export function pagination(req: Request, defaultSize = 25, maxSize = 100): Pagination {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1)
  const pageSize = Math.min(maxSize, Math.max(1, Number(req.query.pageSize ?? defaultSize) || defaultSize))
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize }
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export function makePage<T>(items: T[], total: number, p: Pagination): Page<T> {
  return { items, total, page: p.page, pageSize: p.pageSize, pageCount: Math.max(1, Math.ceil(total / p.pageSize)) }
}

export function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

export function queryBool(req: Request, key: string): boolean | undefined {
  const value = queryString(req, key)
  if (value === undefined) return undefined
  return value === "true" || value === "1"
}
