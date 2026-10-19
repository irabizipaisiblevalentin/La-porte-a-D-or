import { Router } from "express"
import { z } from "zod"
import { parse } from "../lib/http.js"
import { requireAuth } from "../middleware/auth.js"
import {
  deviceCount,
  devicesFor,
  removeSubscription,
  saveSubscription,
  sendToUsers,
  vapidPublicKey,
} from "../services/push.js"

export const pushRouter: Router = Router()

const subscriptionSchema = z.object({
  endpoint: z.string().url("A push endpoint must be a URL.").max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(400),
    auth: z.string().min(1).max(400),
  }),
})

/**
 * What the browser needs before it can ask for notifications: the deployment's
 * public VAPID key, and which devices this account has already registered.
 *
 * The key is generated on first request when the deployment has not been given
 * one, so enabling notifications on a phone needs no hosting-dashboard work.
 */
pushRouter.get("/config", requireAuth, (req, res) => {
  res.json({
    enabled: true,
    publicKey: vapidPublicKey(),
    deviceCount: deviceCount(req.auth!.id),
    devices: devicesFor(req.auth!.id),
  })
})

/** Registers one device — the phone or laptop that is being enabled right now. */
pushRouter.post("/subscribe", requireAuth, (req, res) => {
  const input = parse(subscriptionSchema, req.body)
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 300) : null
  const count = saveSubscription(req.auth!.id, input, userAgent)
  res.json({ ok: true, deviceCount: count })
})

/** Forgets a device (turned off from the notification card, or after signing out of it). */
pushRouter.post("/unsubscribe", requireAuth, (req, res) => {
  const input = parse(z.object({ endpoint: z.string().min(1).max(2000) }), req.body)
  res.json({ ok: true, deviceCount: removeSubscription(req.auth!.id, input.endpoint) })
})

/**
 * Sends to this account's own devices, so an administrator can prove the phone
 * rings before a real application depends on it.
 */
pushRouter.post("/test", requireAuth, async (req, res) => {
  const result = await sendToUsers([req.auth!.id], {
    title: "Chorale La Porte d'Or",
    body: "Device notifications are on. This phone will be told when something needs you.",
    link: "/app/notifications",
  })
  res.json({ ok: true, ...result })
})
