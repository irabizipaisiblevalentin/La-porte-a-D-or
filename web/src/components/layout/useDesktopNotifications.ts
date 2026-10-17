import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../api/client"
import { useAuth } from "../../auth/AuthProvider"
import { useToast } from "../../components/ui"

export type NotificationPermission = "default" | "granted" | "denied" | "unsupported"

interface UnreadCount {
  count: number
}

interface NotificationItem {
  id: string
  title: string
  body: string | null
  link: string | null
}

interface MessageUnreadCount {
  count: number
  latest: { id: string; senderName: string; subject: string; createdAt: string } | null
}

function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window
}

/**
 * Desktop / phone notifications while the app is open.
 *
 * Polls the notification and (for the Chairman) message unread counts. When a
 * count rises, it shows a browser notification — on a laptop that is a desktop
 * pop-up, on Android Chrome a system notification. It also raises an in-app
 * toast so nothing is missed when notifications are not granted.
 *
 * This is the practical, no-third-party-service option. Web notifications only
 * fire while the site is open in a tab (or installed as an app); true background
 * push would need a push service (e.g. VAPID web-push) or SMS/e-mail.
 */
export function useDesktopNotifications() {
  const { can } = useAuth()
  const toast = useToast()
  const [permission, setPermission] = useState<NotificationPermission>(
    supported() ? (Notification.permission as NotificationPermission) : "unsupported",
  )

  const lastNotificationCount = useRef<number | null>(null)
  const lastMessageCount = useRef<number | null>(null)
  const canReadMessages = can("messages.read", "global")

  const show = useCallback((title: string, body?: string, tag?: string, link?: string | null) => {
    if (!supported() || Notification.permission !== "granted") return
    try {
      const notification = new Notification(title, { body, tag, icon: "/logo.png" })
      notification.onclick = () => {
        window.focus()
        if (link) window.location.assign(link)
        notification.close()
      }
      window.setTimeout(() => notification.close(), 12_000)
    } catch {
      // Some browsers reject constructing notifications without a service worker.
    }
  }, [])

  const request = useCallback(async () => {
    if (!supported()) {
      toast.error("This browser does not support desktop notifications.")
      return
    }
    try {
      const result = await Notification.requestPermission()
      setPermission(result as NotificationPermission)
      if (result === "granted") toast.success("Notifications enabled on this device.")
      else if (result === "denied") toast.error("Notifications are blocked — enable them in your browser settings.")
    } catch {
      toast.error("Notifications could not be enabled.")
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const notifications = await api.get<UnreadCount>("/notifications/unread-count")
        if (cancelled) return
        if (lastNotificationCount.current !== null && notifications.count > lastNotificationCount.current) {
          const list = await api.get<{ items: NotificationItem[] }>("/notifications?unread=true&page=1&pageSize=1")
          const item = list.items[0]
          if (item) {
            show(item.title, item.body ?? undefined, item.id, item.link)
            toast.info(item.title)
          }
        }
        lastNotificationCount.current = notifications.count

        if (canReadMessages) {
          const messages = await api.get<MessageUnreadCount>("/messages/unread-count")
          if (cancelled) return
          if (lastMessageCount.current !== null && messages.count > lastMessageCount.current && messages.latest) {
            show(
              `New message from ${messages.latest.senderName}`,
              messages.latest.subject,
              messages.latest.id,
              "/app/messages",
            )
            toast.info(`New message from ${messages.latest.senderName}`)
          }
          lastMessageCount.current = messages.count
        }
      } catch {
        // Polling failures are non-fatal; the next tick tries again.
      }
    }

    void poll()
    const timer = window.setInterval(poll, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [canReadMessages, show, toast])

  return { permission, request, supported: supported() }
}
