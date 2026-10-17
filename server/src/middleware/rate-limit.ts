import type { NextFunction, Request, Response } from "express"
import { config } from "../config.js"
import { tooMany } from "../lib/errors.js"

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function clientKey(req: Request, scope: string): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown"
  return `${scope}:${ip}`
}

function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  bucket.count += 1
  return bucket.count <= max
}

/** Fixed-window per-IP limiter. Sufficient for a single-node deployment; swap for a shared store when clustered. */
export function rateLimit(scope: string, max: number, windowMs = config.security.rateLimitWindowMs) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (hit(clientKey(req, scope), max, windowMs)) return next()
    next(tooMany())
  }
}

export function authRateLimit() {
  return rateLimit("auth", config.security.rateLimitMaxAuth)
}

export function generalRateLimit() {
  return rateLimit("general", config.security.rateLimitMaxGeneral)
}

/** Periodically drops expired buckets so the map cannot grow without bound. */
export function rateLimitMaintenance(): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function resetRateLimits(): void {
  buckets.clear()
}
