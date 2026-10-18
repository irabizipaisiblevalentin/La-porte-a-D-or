import nodemailer from "nodemailer"
import { one, run } from "../db/index.js"
import { decryptSecret } from "../lib/secrets-box.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string | null
  password: string | null
  from: string
}

function integrationValue(key: string): string | null {
  const row = one<{ value_plain: string | null; value_encrypted: string | null; is_secret: number }>(
    "SELECT value_plain, value_encrypted, is_secret FROM integration_settings WHERE key = ?",
    key,
  )
  if (!row) return null
  const raw = row.is_secret === 1 ? decryptSecret(row.value_encrypted) : row.value_plain
  const text = raw?.trim()
  return text ? text : null
}

/**
 * Reads the SMTP relay from Settings → Integrations. Returns null until a host
 * and a sender address are both present — that pair is what "email delivery is
 * configured" means everywhere else in the app.
 */
export function loadSmtpConfig(): SmtpConfig | null {
  const host = integrationValue("smtp_host")
  if (!host) return null
  const numericPort = Number(integrationValue("smtp_port") ?? 587)
  const port = Number.isInteger(numericPort) && numericPort > 0 ? numericPort : 587
  const user = integrationValue("smtp_user")
  const password = user ? integrationValue("smtp_password") : null
  const from = integrationValue("smtp_from") ?? user
  if (!from) return null
  return { host, port, secure: port === 465, user, password, from }
}

export function emailDeliveryConfigured(): boolean {
  return loadSmtpConfig() !== null
}

export interface MailResult {
  ok: boolean
  to?: string
  reason?: "not_configured" | "no_recipient" | "send_failed"
  error?: string
}

/**
 * Sends one message through the configured relay.
 *
 * Deliberately never throws: an approval creates the member first and delivers
 * afterwards, so an unreachable mail server must not undo a real membership.
 * The caller decides what to tell the administrator. Every attempt is recorded
 * in `integration_runs` so a failure can be seen after the fact.
 */
export async function sendMail(input: {
  to: string | null | undefined
  subject: string
  text: string
  trigger: string
}): Promise<MailResult> {
  const to = input.to?.trim()
  if (!to) return { ok: false, reason: "no_recipient" }
  const smtp = loadSmtpConfig()
  if (!smtp) return { ok: false, reason: "not_configured", to }

  const runId = id()
  run(
    `INSERT INTO integration_runs (id, integration, trigger, status, summary, detail, started_at, finished_at)
     VALUES (?, 'smtp', ?, 'running', ?, NULL, ?, NULL)`,
    runId, input.trigger, input.subject, nowIso(),
  )

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
    await transporter.sendMail({ from: smtp.from, to, subject: input.subject, text: input.text })
    run("UPDATE integration_runs SET status = 'success', finished_at = ? WHERE id = ?", nowIso(), runId)
    return { ok: true, to }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    run(
      "UPDATE integration_runs SET status = 'error', detail = ?, finished_at = ? WHERE id = ?",
      message.slice(0, 500), nowIso(), runId,
    )
    return { ok: false, reason: "send_failed", to, error: message }
  }
}
