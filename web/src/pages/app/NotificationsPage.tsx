import { useState } from "react"
import { Link } from "react-router-dom"
import { Bell, BellOff, CheckCheck } from "lucide-react"
import { api, toQuery } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Pagination,
  PageHeader,
  humanize,
  useToast,
} from "../../components/ui"

interface NotificationRow {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
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

/**
 * Notification links are stored relative to the app root (e.g. "/announcements/:id"), so
 * prefix the "/app" segment for internal navigation. Absolute URLs are left untouched.
 */
function resolveLink(link: string | null): string | null {
  if (!link) return null
  if (link.startsWith("/app/") || link === "/app") return link
  if (link.startsWith("/")) return `/app${link}`
  return link
}

function isExternal(link: string): boolean {
  return link.startsWith("http://") || link.startsWith("https://")
}

export function NotificationsPage() {
  const toast = useToast()

  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)

  const query = toQuery({ unread: unreadOnly ? true : undefined, page })
  const list = useQuery<Page<NotificationRow>>(`/notifications${query}`)
  const unread = useQuery<{ count: number }>("/notifications/unread-count")

  const markRead = useMutation((notificationId: string) => api.post(`/notifications/${notificationId}/read`))
  const markAllRead = useMutation(() => api.post<{ ok: boolean; updated: number }>("/notifications/read-all"))

  const rows = list.data?.items ?? []
  const unreadCount = unread.data?.count ?? 0

  function refresh() {
    list.reload()
    unread.reload()
  }

  async function handleMarkRead(notificationId: string) {
    const result = await markRead.run(notificationId)
    if (!result) return
    refresh()
  }

  async function handleMarkAllRead() {
    const result = await markAllRead.run()
    if (!result) return
    toast.success(
      result.updated > 0
        ? `Marked ${result.updated} notification${result.updated === 1 ? "" : "s"} as read.`
        : "You are all caught up.",
    )
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Updates about announcements, events, training and other activity addressed to you."
        actions={
          <>
            {unreadCount > 0 ? <Badge tone="gold">{unreadCount} unread</Badge> : null}
            <Button
              variant="outline"
              size="sm"
              icon={<CheckCheck size={15} />}
              onClick={handleMarkAllRead}
              loading={markAllRead.saving}
              disabled={unreadCount === 0}
            >
              Mark all read
            </Button>
          </>
        }
      />

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant={unreadOnly ? "gold" : "outline"}
              size="sm"
              icon={<BellOff size={15} />}
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
              icon={<Bell size={15} />}
              onClick={() => {
                setUnreadOnly(false)
                setPage(1)
              }}
            >
              All
            </Button>
          </div>
          {list.data ? (
            <p className="muted text-xs">
              {list.data.total} notification{list.data.total === 1 ? "" : "s"}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        {list.loading ? (
          <CardBody>
            <LoadingBlock label="Loading notifications…" rows={4} />
          </CardBody>
        ) : list.error ? (
          <CardBody>
            <ErrorState title="Could not load notifications" description={list.error.message} />
          </CardBody>
        ) : rows.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<BellOff size={22} />}
              title={unreadOnly ? "No unread notifications" : "No notifications yet"}
              description={
                unreadOnly
                  ? "You have read everything. Switch to “All” to review past notifications."
                  : "When announcements or activity concern you, they will appear here."
              }
            />
          </CardBody>
        ) : (
          <ul className="flex flex-col">
            {rows.map((notification) => {
              const isUnread = !notification.read_at
              const link = resolveLink(notification.link)
              return (
                <li
                  key={notification.id}
                  className="flex items-start gap-3 border-b hairline px-5 py-4 last:border-0"
                  style={isUnread ? { background: "color-mix(in srgb, var(--color-gold-400) 7%, transparent)" } : undefined}
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: isUnread ? "var(--color-gold-400)" : "transparent",
                      border: isUnread ? "none" : "1px solid color-mix(in srgb, currentColor 30%, transparent)",
                    }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {link && !isExternal(link) ? (
                        <Link to={link} className="link text-sm font-semibold">
                          {notification.title}
                        </Link>
                      ) : link && isExternal(link) ? (
                        <a href={link} target="_blank" rel="noreferrer" className="link text-sm font-semibold">
                          {notification.title}
                        </a>
                      ) : (
                        <span className={isUnread ? "text-sm font-semibold" : "text-sm font-medium"}>
                          {notification.title}
                        </span>
                      )}
                      <Badge tone="neutral">{humanize(notification.type)}</Badge>
                      {isUnread ? <span className="muted text-xs">Unread</span> : null}
                    </div>
                    {notification.body ? (
                      <p className="muted mt-1 text-sm whitespace-pre-wrap">{notification.body}</p>
                    ) : null}
                    <p className="muted mt-1 text-xs">{formatDateTime(notification.created_at)}</p>
                  </div>
                  {isUnread ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleMarkRead(notification.id)}
                      loading={markRead.saving}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {list.data ? (
          <div className="px-5 pb-4">
            <Pagination
              page={list.data.page}
              pageCount={list.data.pageCount}
              total={list.data.total}
              onChange={setPage}
            />
          </div>
        ) : null}
      </Card>
    </div>
  )
}
