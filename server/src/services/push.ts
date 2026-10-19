import webpush from "web-push"
import { config } from "../config.js"
import { all, one, run } from "../db/index.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"

/**
 * Device notifications (Web Push).
 *
 * A notification row in the database is only seen by someone already looking at
 * the site. This service puts the same message onto the phones and laptops of
 * the people who need it, delivered by their browser's own push service even
 * when the choir platform is closed — which is the point for an administrator
 * who has to answer a new application.
 *
 * Nothing here is allowed to break the request that triggered it: a new
 * application is filed successfully even if every push fails, and the failures
 * are kept on the subscription row so an administrator can see that a phone has
 * gone quiet.
 */

/** One browser/device that agreed to receive notifications. */
export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** What the device shows; `link` is where a tap lands. */
export interface PushPayload {
  title: string
  body?: string | null
  link?: string | null
}

export interface PushResult {
  /** Devices that accepted the message. */
  sent: number
  /** Devices that could not be reached this time. */
  failed: number
  /** Subscriptions the push service reported as gone, and which were deleted. */
  removed: number
}

interface SubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface SubscriptionRowFull extends SubscriptionRow {
  user_agent: string | null
  created_at: string
  last_success_at: string | null
  last_failure_at: string | null
  failure_reason: string | null
}

interface VapidPair {
  publicKey: string
  privateKey: string
}

type Sender = (subscription: PushSubscriptionInput, payload: string) => Promise<{ statusCode: number }>

const defaultSender: Sender = (subscription, payload) =>
  webpush.sendNotification(subscription, payload, {
    vapidDetails: { subject: subject(), ...vapidKeys() },
    timeout: config.push.timeoutMs,
    // Hold a message for an hour when the phone is off or offline: the browser's
    // push service delivers it as soon as the device comes back, which is what
    // makes this reliable for an administrator who is asleep.
    TTL: 3600,
    urgency: "high",
  })

/** Swappable so tests exercise delivery, pruning and payload shape with no network. */
let sender: Sender = defaultSender

export function setPushSenderForTesting(next: Sender | null): void {
  sender = next ?? defaultSender
}

let cachedKeys: VapidPair | null = null

function subject(): string {
  const value = config.push.subject
  return value.includes(":") ? value : `mailto:${value}`
}

function storedKeys(): VapidPair | null {
  const row = one<{ public_key: string; private_key: string }>(
    "SELECT public_key, private_key FROM push_vapid_keys ORDER BY created_at LIMIT 1",
  )
  return row ? { publicKey: row.public_key, privateKey: row.private_key } : null
}

/**
 * The signing identity for this deployment's pushes.
 *
 * Environment variables win — a deployment that wants one identity shared across
 * instances can set them — but they are optional on purpose: without them the
 * pair is generated once and stored in the database, which Litestream restores
 * on every boot. Regenerating it would be silent breakage, because every device
 * that had already subscribed is tied to the old public key.
 */
export function vapidKeys(): VapidPair {
  if (cachedKeys) return cachedKeys
  if (config.push.publicKey && config.push.privateKey) {
    cachedKeys = { publicKey: config.push.publicKey, privateKey: config.push.privateKey }
    return cachedKeys
  }
  const existing = storedKeys()
  if (existing) {
    cachedKeys = existing
    return cachedKeys
  }
  const generated = webpush.generateVAPIDKeys()
  run(
    "INSERT INTO push_vapid_keys (id, public_key, private_key, created_at) VALUES (?, ?, ?, ?)",
    id(), generated.publicKey, generated.privateKey, nowIso(),
  )
  cachedKeys = generated
  return cachedKeys
}

/** The public half — what a browser needs before it may subscribe. */
export function vapidPublicKey(): string {
  return vapidKeys().publicKey
}

/**
 * Stores one device. Subscribing again on the same device replaces the row
 * (including a different account that signed in on it), so a shared phone never
 * keeps notifying the person who used it last.
 */
export function saveSubscription(userId: string, input: PushSubscriptionInput, userAgent: string | null): number {
  const now = nowIso()
  run(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       updated_at = excluded.updated_at,
       last_failure_at = NULL,
       failure_reason = NULL`,
    id(), userId, input.endpoint, input.keys.p256dh, input.keys.auth, userAgent, now, now,
  )
  return deviceCount(userId)
}

export function removeSubscription(userId: string, endpoint: string): number {
  run("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", userId, endpoint)
  return deviceCount(userId)
}

export function deviceCount(userId: string): number {
  return one<{ c: number }>("SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?", userId)?.c ?? 0
}

/** The devices an account has registered, for the "which of my phones are on?" list. */
export function devicesFor(userId: string): Array<{
  id: string
  userAgent: string | null
  createdAt: string
  lastSuccessAt: string | null
  lastFailureAt: string | null
  failureReason: string | null
}> {
  return all<SubscriptionRowFull>(
    `SELECT id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_success_at, last_failure_at, failure_reason
       FROM push_subscriptions WHERE user_id = ? ORDER BY created_at`,
    userId,
  ).map((row) => ({
    id: row.id,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    failureReason: row.failure_reason,
  }))
}

const BODY_LIMIT = 180

/** Notification bodies are one or two lines on a lock screen; keep them short. */
function shorten(body: string | null | undefined): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim()
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT - 1).trimEnd()}…` : text
}

function statusCodeOf(error: unknown): number {
  const value = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof value === "number" ? value : 0
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 200)
}

async function deliver(row: SubscriptionRow, message: string): Promise<"sent" | "failed" | "gone"> {
  try {
    await sender({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message)
    run("UPDATE push_subscriptions SET last_success_at = ?, failure_reason = NULL WHERE id = ?", nowIso(), row.id)
    return "sent"
  } catch (error) {
    const status = statusCodeOf(error)
    // 404/410 mean the browser has thrown the subscription away: the app was
    // uninstalled, notifications were revoked, or site data was cleared. Retrying
    // forever would keep a dead address alive, so the row goes.
    if (status === 404 || status === 410) {
      run("DELETE FROM push_subscriptions WHERE id = ?", row.id)
      return "gone"
    }
    run(
      "UPDATE push_subscriptions SET last_failure_at = ?, failure_reason = ? WHERE id = ?",
      nowIso(), describe(error), row.id,
    )
    return "failed"
  }
}

/**
 * Sends to every device belonging to the given accounts. Never throws: an
 * undelivered notification must not fail the work that produced it.
 */
export async function sendToUsers(userIds: string[], payload: PushPayload): Promise<PushResult> {
  const recipients = [...new Set(userIds.filter(Boolean))]
  if (recipients.length === 0) return { sent: 0, failed: 0, removed: 0 }

  const rows = all<SubscriptionRow>(
    `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions
      WHERE user_id IN (${recipients.map(() => "?").join(",")})`,
    ...recipients,
  )
  if (rows.length === 0) return { sent: 0, failed: 0, removed: 0 }

  const message = JSON.stringify({
    title: payload.title,
    body: shorten(payload.body),
    url: payload.link ?? "/app/notifications",
  })

  const outcomes = await Promise.all(rows.map((row) => deliver(row, message)))
  return {
    sent: outcomes.filter((outcome) => outcome === "sent").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    removed: outcomes.filter((outcome) => outcome === "gone").length,
  }
}

/** Pushes started by the notification path, so a caller can wait for them. */
const inFlight = new Set<Promise<unknown>>()

/**
 * Delivers without holding up the caller: notifying never waits on Google's or
 * Mozilla's push service. The notification row is already committed, so a slow
 * or failing push costs nothing.
 */
export function sendInBackground(userIds: string[], payload: PushPayload): void {
  const task = sendToUsers(userIds, payload).catch(() => undefined)
  inFlight.add(task)
  void task.then(() => inFlight.delete(task))
}

/** Waits for the pushes started by `sendInBackground` (used by tests). */
export async function pushIdle(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight])
}
