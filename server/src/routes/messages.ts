import { Router } from "express"
import { z } from "zod"
import { can } from "../auth/access.js"
import { all, one, run } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden, notFound } from "../lib/errors.js"
import { makePage, pagination, parse, queryBool, queryString } from "../lib/http.js"
import { id } from "../lib/security.js"
import { nowIso } from "../lib/time.js"
import { requireAuth, requirePermission } from "../middleware/auth.js"
import { notify } from "../services/notifications.js"

export const messagesRouter: Router = Router()

const DEFAULT_SUBJECT = "Message for the Chairman"

interface MessageRow {
  id: string
  sender_user_id: string
  sender_name: string
  sender_email: string | null
  recipient_user_id: string | null
  subject: string
  body: string
  read_at: string | null
  reply_body: string | null
  reply_at: string | null
  replied_by: string | null
  created_at: string
}

const sendSchema = z.object({
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1, "Write a message before sending.").max(4000, "Please keep the message under 4000 characters."),
})

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a reply before sending.").max(4000, "Please keep the reply under 4000 characters."),
})

/** The single active Chairman account that receives members' messages. */
function activeChairman(): { id: string; display_name: string } | undefined {
  return one<{ id: string; display_name: string }>(
    `SELECT u.id, u.display_name
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'chairman' AND u.status = 'active'
      ORDER BY u.created_at
      LIMIT 1`,
  )
}

function toView(row: MessageRow) {
  return {
    id: row.id,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    subject: row.subject,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
    reply: row.reply_body ? { body: row.reply_body, at: row.reply_at } : null,
  }
}

/** Send a private message to the Chairman. Available to every signed-in member. */
messagesRouter.post("/", requireAuth, requirePermission("messages.send", "own"), (req, res) => {
  const input = parse(sendSchema, req.body)
  const chairman = activeChairman()
  if (!chairman) throw badRequest("There is no Chairman account to receive messages yet.")

  const messageId = id()
  const subject = input.subject?.trim() || DEFAULT_SUBJECT
  run(
    `INSERT INTO messages (id, sender_user_id, sender_name, sender_email, recipient_user_id, subject, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    messageId, req.auth!.id, req.auth!.displayName, req.auth!.email, chairman.id, subject, input.body, nowIso(),
  )

  notify({
    userId: chairman.id,
    type: "message",
    title: `New message from ${req.auth!.displayName}`,
    body: subject,
    link: "/app/messages",
  })

  res.status(201).json(toView(one<MessageRow>("SELECT * FROM messages WHERE id = ?", messageId)!))
})

/**
 * Lists messages. The Chairman (messages.read) sees the inbox of messages addressed
 * to them; everyone else sees the messages they have sent, together with any reply.
 */
messagesRouter.get("/", requireAuth, (req, res) => {
  const p = pagination(req)
  const canReadInbox = can(req.auth!, "messages.read", "global")
  const requested = queryString(req, "box")
  const box = requested ?? (canReadInbox ? "inbox" : "sent")

  if (box === "inbox" && !canReadInbox) throw forbidden()
  if (box !== "inbox" && box !== "sent") throw badRequest("Unknown mailbox. Use 'inbox' or 'sent'.")

  const unreadOnly = queryBool(req, "unread") === true
  const filters: string[] = []
  const params: (string | number)[] = []

  if (box === "inbox") {
    filters.push("recipient_user_id = ?")
    params.push(req.auth!.id)
    if (unreadOnly) filters.push("read_at IS NULL")
  } else {
    filters.push("sender_user_id = ?")
    params.push(req.auth!.id)
  }
  const where = `WHERE ${filters.join(" AND ")}`

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM messages ${where}`, ...params)?.c ?? 0
  const items = all<MessageRow>(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ...params, p.limit, p.offset,
  ).map(toView)

  res.json(makePage(items, total, p))
})

/** Unread inbox count for the signed-in Chairman (0 for everyone else). */
messagesRouter.get("/unread-count", requireAuth, (req, res) => {
  if (!can(req.auth!, "messages.read", "global")) {
    res.json({ count: 0, latest: null })
    return
  }
  const count = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM messages WHERE recipient_user_id = ? AND read_at IS NULL",
    req.auth!.id,
  )?.c ?? 0
  // The newest unread message lets the client name the sender in a desktop alert.
  const latest = one<{ id: string; sender_name: string; subject: string; created_at: string }>(
    `SELECT id, sender_name, subject, created_at
       FROM messages
      WHERE recipient_user_id = ? AND read_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    req.auth!.id,
  )
  res.json({
    count,
    latest: latest
      ? { id: latest.id, senderName: latest.sender_name, subject: latest.subject, createdAt: latest.created_at }
      : null,
  })
})

/** Marks a received message as read. */
messagesRouter.post("/:id/read", requireAuth, requirePermission("messages.read", "global"), (req, res) => {
  const message = one<{ id: string; read_at: string | null; recipient_user_id: string | null }>(
    "SELECT id, read_at, recipient_user_id FROM messages WHERE id = ?", String(req.params.id),
  )
  if (!message) throw notFound("That message does not exist.")
  if (!message.read_at) run("UPDATE messages SET read_at = ? WHERE id = ?", nowIso(), message.id)
  res.json({ ok: true })
})

/** Replies to a member's message as the Chairman. */
messagesRouter.post("/:id/reply", requireAuth, requirePermission("messages.reply", "global"), (req, res) => {
  const input = parse(replySchema, req.body)
  const message = one<MessageRow>("SELECT * FROM messages WHERE id = ?", String(req.params.id))
  if (!message) throw notFound("That message does not exist.")

  const timestamp = nowIso()
  run(
    "UPDATE messages SET reply_body = ?, reply_at = ?, replied_by = ?, read_at = COALESCE(read_at, ?) WHERE id = ?",
    input.body, timestamp, req.auth!.id, timestamp, message.id,
  )

  notify({
    userId: message.sender_user_id,
    type: "message_reply",
    title: "The Chairman replied to your message",
    body: input.body.slice(0, 160),
    link: "/app/messages",
  })

  recordAudit({
    actorId: req.auth!.id,
    actorName: req.auth!.displayName,
    action: "messages.reply",
    entityType: "message",
    entityId: message.id,
    summary: `Replied to a message from ${message.sender_name}`,
  })

  res.json(toView(one<MessageRow>("SELECT * FROM messages WHERE id = ?", message.id)!))
})
