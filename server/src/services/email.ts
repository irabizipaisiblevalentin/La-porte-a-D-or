import nodemailer from "nodemailer"
import { one, run } from "../db/index.js"
import { decryptSecret } from "../lib/secrets-box.js"
import { hmacSha256Hex, id } from "../lib/security.js"
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

export interface MailWebhookConfig {
  url: string
  secret: string
}

/**
 * The alternative to SMTP: a Google Apps Script web app that sends the message
 * from the choir's own Gmail account (`MailApp`). Nothing to sign up for and no
 * app password — the script the choir already runs for the application form
 * gains a `doPost` handler and is deployed once as a web app.
 *
 * The shared signing secret is required, not optional: the web app URL is open
 * to the world, so an unsigned call must never be able to send mail as the
 * choir. Signing reuses `google_webhook_secret`, which the script already has.
 */
export function loadMailWebhook(): MailWebhookConfig | null {
  const url = integrationValue("mail_webhook_url")
  if (!url) return null
  const secret = integrationValue("google_webhook_secret")
  if (!secret) return null
  return { url, secret }
}

/** The exact string the mail web app signs and verifies (newline separated). */
export function mailWebhookSignature(secret: string, mail: { ts: string; to: string; subject: string; text: string }): string {
  return hmacSha256Hex(secret, [mail.ts, mail.to, mail.subject, mail.text].join("\n"))
}

/**
 * Typographic characters rewritten as their plain-ASCII equivalent. Em dashes,
 * arrows and curly quotes are what the app's own copy is written with, so they
 * turn up in mail bodies and subjects all the time.
 */
const TYPOGRAPHIC_TO_ASCII: Array<[RegExp, string]> = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, "-"],
  [/\u2192/g, "->"],
  [/\u2190/g, "<-"],
  [/\u2026/g, "..."],
  [/[\u00A0\u2007\u202F]/g, " "],
  [/[\u00B7\u2022\u25CF]/g, "-"],
  [/\u00D7/g, "x"],
]

/**
 * Makes a subject or body safe to sign for the Apps Script mail web app.
 *
 * `Utilities.computeHmacSha256Signature` converts a String message to 7-bit
 * ASCII, writing every character outside that set as a single "?". That was
 * proved against the live deployment: a message containing "é" verifies only
 * when each such character is signed as one "?". Node signs the real UTF-8
 * bytes, so any name with an accent, or the "->" arrow in our own wording, would
 * make the two digests differ — the script would refuse the call with
 * "bad signature" and no mail would go out at all.
 *
 * Transliterating before signing removes the disagreement entirely: what we
 * sign is plain ASCII, so the bytes are unambiguous on both sides whatever the
 * runtime does with them. Accents are folded ("François" -> "Francois") rather
 * than dropped, and anything still outside ASCII becomes "?".
 */
export function asciiSafeMailText(value: string): string {
  let out = value
  for (const [pattern, replacement] of TYPOGRAPHIC_TO_ASCII) out = out.replace(pattern, replacement)
  out = out.normalize("NFKD").replace(/[\u0300-\u036F]/g, "")
  return out.replace(/[^\t\n\r\x20-\x7E]/g, "?")
}

export function emailDeliveryConfigured(): boolean {
  return loadMailWebhook() !== null || loadSmtpConfig() !== null
}

export interface MailResult {
  ok: boolean
  to?: string
  reason?: "not_configured" | "no_recipient" | "send_failed"
  error?: string
}

/**
 * Sends one message: through the Apps Script mail web app when it is configured,
 * otherwise through the SMTP relay.
 *
 * Deliberately never throws: an approval creates the member first and delivers
 * afterwards, so an unreachable mail channel must not undo a real membership.
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
  const webhook = loadMailWebhook()
  const smtp = webhook ? null : loadSmtpConfig()
  if (!webhook && !smtp) return { ok: false, reason: "not_configured", to }

  const channel = webhook ? "apps_script_mail" : "smtp"
  const runId = id()
  run(
    `INSERT INTO integration_runs (id, integration, trigger, status, summary, detail, started_at, finished_at)
     VALUES (?, ?, ?, 'running', ?, NULL, ?, NULL)`,
    runId, channel, input.trigger, input.subject, nowIso(),
  )

  try {
    if (webhook) {
      await sendViaWebhook(webhook, { to, subject: input.subject, text: input.text })
    } else {
      await sendViaSmtp(smtp!, { to, subject: input.subject, text: input.text })
    }
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

async function sendViaSmtp(smtp: SmtpConfig, mail: { to: string; subject: string; text: string }): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  await transporter.sendMail({ from: smtp.from, to: mail.to, subject: mail.subject, text: mail.text })
}

export const MAIL_WEBHOOK_TIMEOUT_MS = 20_000

/**
 * Posts one message to the Apps Script web app.
 *
 * Apps Script runs `doPost` on the POST to `/exec` itself, and answers with a 302
 * to a one-time `script.googleusercontent.com/macros/echo` URL that **only serves
 * the buffered reply over GET** (a POST there answers 405). So the redirect is
 * followed by hand — POST first, then GET for the answer — rather than by a
 * redirect-following client, whose behaviour is exactly backwards: it would
 * re-POST or downgrade ambiguously and hide the reply. Verified against a real
 * deployment, not assumed.
 *
 * A 200 that carries `{"ok":false}` means the script ran but refused the message
 * (quota, bad address, bad signature); that is a failure and is reported as one.
 */
async function sendViaWebhook(webhook: MailWebhookConfig, mail: { to: string; subject: string; text: string }): Promise<void> {
  const ts = nowIso()
  // Signed and sent in plain ASCII (see asciiSafeMailText): Apps Script signs a
  // 7-bit view of the message, so anything else would never verify.
  const safe = { to: mail.to, subject: asciiSafeMailText(mail.subject), text: asciiSafeMailText(mail.text) }
  const body = JSON.stringify({
    action: "sendMail",
    ts,
    ...safe,
    signature: mailWebhookSignature(webhook.secret, { ts, ...safe }),
  })
  const headers = { "content-type": "application/json" }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MAIL_WEBHOOK_TIMEOUT_MS)
  try {
    // The POST is what sends the message.
    let response = await fetch(webhook.url, {
      method: "POST", headers, body, redirect: "manual", signal: controller.signal,
    })
    let hops = 0
    while (response.status >= 300 && response.status < 400 && hops < 3) {
      const location = response.headers.get("location")
      if (!location) throw new Error(`The mail web app redirected without a location (HTTP ${response.status}).`)
      // GET, without the body: the reply for the POST already made is buffered here.
      response = await fetch(location, { method: "GET", redirect: "manual", signal: controller.signal })
      hops += 1
    }

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`)
    }
    let parsed: { ok?: boolean; error?: string } | null = null
    try { parsed = JSON.parse(text) as { ok?: boolean; error?: string } } catch { parsed = null }
    if (parsed && parsed.ok === false) {
      throw new Error(String(parsed.error ?? "The mail web app reported a failure.").slice(0, 300))
    }
  } finally {
    clearTimeout(timer)
  }
}
