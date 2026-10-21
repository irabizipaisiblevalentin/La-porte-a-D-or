/**
 * The one-time administrator password reset, over HTTP.
 *
 * Unauthenticated on purpose: the accounts this fixes are the ones you cannot sign
 * in with. The secret in the request body is what proves the caller is the
 * deploying owner, in the same spirit as the first-administrator setup token.
 *
 * Three things keep it from being dangerous:
 *
 *   1. The route refuses to do anything unless the deployment supplied
 *      `ADMIN_PASSWORD_RESET_TOKEN`. Unarmed, it answers 403 and stops — so an
 *      ordinary deployment carries no usable endpoint at all.
 *
 *   2. It runs once. The use is recorded in the database, so it cannot be
 *      replayed after a restart, and a second call is refused even with the
 *      correct secret.
 *
 *   3. It is rate limited hard, and the token is compared in constant time.
 */
import { Router } from "express"
import { z } from "zod"
import { parse } from "../lib/http.js"
import { rateLimit } from "../middleware/rate-limit.js"
import { resetAdministratorPasswords, resetIsArmed, resetSpentAt } from "../services/admin-password-reset.js"

export const adminResetRouter: Router = Router()

const bodySchema = z.object({
  token: z.string().trim().min(1, "Supply the reset token."),
})

/**
 * Whether the reset is available, without revealing the token.
 *
 * Public and harmless: it says only whether the deployment was armed and whether
 * the single use has been spent. The token itself is never echoed.
 */
adminResetRouter.get("/status", (_req, res) => {
  res.json({ armed: resetIsArmed(), spentAt: resetSpentAt() })
})

// Only a handful of tries in a wide window: a correct call happens once, ever.
adminResetRouter.post("/", rateLimit("admin-reset", 5, 15 * 60 * 1000), (req, res) => {
  const input = parse(bodySchema, req.body)
  const outcome = resetAdministratorPasswords({
    token: input.token,
    // No session is involved — this route exists precisely for when signing in is
    // not possible. The audit entry records the change and the accounts it
    // touched, which is the accountability that matters here.
    actorId: null,
    actorName: "One-time administrator password reset",
    ip: req.ip,
  })

  res.json({
    ok: true,
    changed: outcome.changed,
    untouched: outcome.untouched,
    spentAt: outcome.spentAt,
    message: `Password set for ${outcome.changed.length} administrator account${outcome.changed.length === 1 ? "" : "s"}. This reset will not run again.`,
  })
})
