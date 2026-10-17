import { useState } from "react"
import { Mail, MailOpen, MessageCircle, Reply, Send } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import { MessageChairmanButton } from "../../components/layout/ContactChairman"
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Textarea,
  useToast,
} from "../../components/ui"

interface MessageView {
  id: string
  senderName: string
  senderEmail: string | null
  subject: string
  body: string
  readAt: string | null
  createdAt: string
  reply: { body: string; at: string | null } | null
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function MessagesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const isChairman = can("messages.read", "global")

  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [replyTo, setReplyTo] = useState<MessageView | null>(null)
  const [replyBody, setReplyBody] = useState("")

  const query = toQuery({ page, box: isChairman ? "inbox" : "sent", unread: unreadOnly ? true : undefined })
  const list = useQuery<Page<MessageView>>(`/messages${query}`)
  const unread = useQuery<{ count: number }>(isChairman ? "/messages/unread-count" : null)

  const markRead = useMutation((messageId: string) => api.post(`/messages/${messageId}/read`))
  const reply = useMutation((payload: { id: string; body: string }) => api.post(`/messages/${payload.id}/reply`, { body: payload.body }))

  const rows = list.data?.items ?? []
  const unreadCount = unread.data?.count ?? 0

  async function handleMarkRead(messageId: string) {
    if (!(await markRead.run(messageId))) return
    list.reload()
    unread.reload()
  }

  async function handleReply(event: React.FormEvent) {
    event.preventDefault()
    if (!replyTo || !replyBody.trim()) return
    const result = await reply.run({ id: replyTo.id, body: replyBody.trim() })
    if (!result) {
      if (reply.error) toast.error(reply.error.message)
      return
    }
    toast.success("Your reply has been sent.")
    setReplyTo(null)
    setReplyBody("")
    list.reload()
    unread.reload()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isChairman ? "Messages" : "My messages to the Chairman"}
        description={
          isChairman
            ? "Private messages members have sent to you. Read them here and reply directly."
            : "Messages you have sent to the Chairman. Replies from the Chairman appear below each message."
        }
        actions={
          <>
            {isChairman && unreadCount > 0 ? <Badge tone="gold">{unreadCount} unread</Badge> : null}
            {!isChairman ? <MessageChairmanButton onSent={() => list.reload()} /> : null}
          </>
        }
      />

      {isChairman ? (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <Button
              variant={unreadOnly ? "gold" : "outline"}
              size="sm"
              icon={<MailOpen size={15} />}
              onClick={() => {
                setUnreadOnly(true)
                setPage(1)
              }}
            >
              Unread only
            </Button>
            <Button
              variant={!unreadOnly ? "gold" : "outline"}
              size="sm"
              icon={<Mail size={15} />}
              onClick={() => {
                setUnreadOnly(false)
                setPage(1)
              }}
            >
              All messages
            </Button>
            {list.data ? (
              <span className="muted ml-auto text-xs">
                {list.data.total} message{list.data.total === 1 ? "" : "s"}
              </span>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        {list.loading ? (
          <CardBody>
            <LoadingBlock label="Loading messages…" rows={4} />
          </CardBody>
        ) : list.error ? (
          <CardBody>
            <ErrorState title="Could not load messages" description={list.error.message} />
          </CardBody>
        ) : rows.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<MessageCircle size={22} />}
              title={isChairman ? (unreadOnly ? "No unread messages" : "No messages yet") : "No messages sent yet"}
              description={
                isChairman
                  ? unreadOnly
                    ? "You have read everything. Switch to “All messages” to review past messages."
                    : "When a member sends you a message it will appear here."
                  : "Use the “Message the Chairman” button to start a private conversation."
              }
            />
          </CardBody>
        ) : (
          <ul className="flex flex-col">
            {rows.map((message) => {
              const isUnread = isChairman && !message.readAt
              return (
                <li
                  key={message.id}
                  className="flex flex-col gap-3 border-b hairline px-5 py-4 last:border-0"
                  style={isUnread ? { background: "color-mix(in srgb, var(--color-gold-400) 7%, transparent)" } : undefined}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={isUnread ? "text-sm font-semibold" : "text-sm font-medium"}>{message.subject}</span>
                        {isUnread ? <Badge tone="gold">Unread</Badge> : null}
                      </div>
                      <p className="muted mt-0.5 text-xs">
                        {isChairman ? `From ${message.senderName}` : "To the Chairman"} · {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                    {isUnread ? (
                      <Button variant="ghost" size="sm" onClick={() => handleMarkRead(message.id)} loading={markRead.saving}>
                        Mark read
                      </Button>
                    ) : null}
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{message.body}</p>

                  {message.reply ? (
                    <div
                      className="rounded-xl border px-4 py-3"
                      style={{ borderColor: "color-mix(in srgb, var(--color-gold-400) 40%, transparent)", background: "color-mix(in srgb, var(--color-gold-400) 8%, transparent)" }}
                    >
                      <p className="text-xs font-semibold text-gold-600 dark:text-gold-300">The Chairman replied</p>
                      <p className="mt-1 text-sm whitespace-pre-wrap">{message.reply.body}</p>
                      <p className="muted mt-1 text-xs">{formatDateTime(message.reply.at)}</p>
                    </div>
                  ) : null}

                  {isChairman && !message.reply ? (
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Reply size={15} />}
                        onClick={() => {
                          setReplyTo(message)
                          setReplyBody("")
                        }}
                      >
                        Reply
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {list.data ? (
          <div className="px-5 pb-4">
            <Pagination page={list.data.page} pageCount={list.data.pageCount} total={list.data.total} onChange={setPage} />
          </div>
        ) : null}
      </Card>

      <Modal
        open={Boolean(replyTo)}
        onClose={() => setReplyTo(null)}
        title="Reply to member"
        description={replyTo ? `Replying to ${replyTo.senderName} about “${replyTo.subject}”.` : undefined}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplyTo(null)} disabled={reply.saving}>
              Cancel
            </Button>
            <Button variant="gold" icon={<Send size={15} />} loading={reply.saving} disabled={!replyBody.trim()} onClick={handleReply}>
              Send reply
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleReply}>
          <Field label="Your reply" htmlFor="reply-body" required>
            <Textarea
              id="reply-body"
              rows={6}
              maxLength={4000}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder="Type your reply…"
              required
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
