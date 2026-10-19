import { useCallback, useEffect, useState } from "react"
import { api } from "../../api/client"
import { useQuery } from "../../api/hooks"
import { useToast } from "../../components/ui"

/**
 * Device notifications (Web Push) for the signed-in account.
 *
 * The in-page poller (`useDesktopNotifications`) can only speak while a tab is
 * open. This registers the *device* with the browser's push service instead, so
 * a new application reaches the administrator's phone or laptop even when the
 * site is closed — which is the whole point for somebody who has to answer it.
 *
 * A device is registered per browser, not per account: the same person may have
 * a phone and an office PC, and each is enabled separately (and can be turned
 * off separately).
 */

export type PushPermission = "default" | "granted" | "denied" | "unsupported"

export interface PushDevice {
  id: string
  userAgent: string | null
  createdAt: string
  lastSuccessAt: string | null
  lastFailureAt: string | null
  failureReason: string | null
}

export interface PushConfig {
  enabled: boolean
  publicKey: string
  deviceCount: number
  devices: PushDevice[]
}

export interface PushNotificationsState {
  supported: boolean
  permission: PushPermission
  /** This browser/device is registered and will ring. */
  registered: boolean
  busy: boolean
  deviceCount: number
  devices: PushDevice[]
  enable: () => Promise<void>
  disable: () => Promise<void>
  sendTest: () => Promise<void>
  reload: () => void
}

function browserSupportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/** A VAPID key travels as base64url; the Push API wants the raw bytes. */
function applicationServerKey(base64: string): ArrayBuffer {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(normalized)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return buffer
}

/** True on iOS, where a site can only notify once it is added to the Home Screen. */
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document)
  return ios && !("standalone" in navigator && (navigator as { standalone?: boolean }).standalone)
}

function subscribeFailureHint(): string {
  return isIosSafari()
    ? "On an iPhone or iPad, add this site to your Home Screen first (Share → Add to Home Screen), then turn notifications on."
    : "Notifications could not be enabled on this device."
}

export function usePushNotifications({ enabled = true }: { enabled?: boolean } = {}): PushNotificationsState {
  const toast = useToast()
  const config = useQuery<PushConfig>(enabled ? "/push/config" : null)
  const supported = browserSupportsPush()
  const [permission, setPermission] = useState<PushPermission>(
    supported ? (Notification.permission as PushPermission) : "unsupported",
  )
  const [registered, setRegistered] = useState(false)
  const [busy, setBusy] = useState(false)

  // Is this device already registered? It may have been enabled on an earlier
  // visit, or the browser may have dropped the subscription in the meantime.
  useEffect(() => {
    if (!supported || !enabled) return
    let cancelled = false
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (!cancelled) setRegistered(Boolean(subscription))
      } catch {
        // No worker registered yet — nothing is subscribed.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supported, enabled])

  const enable = useCallback(async () => {
    if (!supported) {
      toast.error(subscribeFailureHint())
      return
    }
    const publicKey = config.data?.publicKey
    if (!publicKey) {
      toast.error("Notifications are not ready yet — please try again in a moment.")
      return
    }
    setBusy(true)
    try {
      const result = await Notification.requestPermission()
      setPermission(result as PushPermission)
      if (result !== "granted") {
        toast.error("Notifications are blocked. Allow them for this site in your browser settings, then try again.")
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }))
      const keys = subscription.toJSON().keys ?? {}
      await api.post("/push/subscribe", {
        endpoint: subscription.endpoint,
        keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" },
      })
      setRegistered(true)
      config.reload()
      toast.success("Notifications are on for this device.")
    } catch {
      toast.error(subscribeFailureHint())
    } finally {
      setBusy(false)
    }
  }, [config, supported, toast])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api.post("/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => undefined)
        await subscription.unsubscribe().catch(() => undefined)
      }
      setRegistered(false)
      config.reload()
      toast.info("Notifications are off for this device.")
    } catch {
      toast.error("Notifications could not be turned off.")
    } finally {
      setBusy(false)
    }
  }, [config, toast])

  const sendTest = useCallback(async () => {
    setBusy(true)
    try {
      const result = await api.post<{ sent: number; failed: number }>("/push/test", {})
      if (result.sent > 0) toast.success(`Test sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`)
      else if (result.failed > 0) toast.error("The test could not be delivered — check that notifications are allowed for this site.")
      else toast.error("No device is registered yet — turn notifications on first.")
      config.reload()
    } catch {
      toast.error("The test notification could not be sent.")
    } finally {
      setBusy(false)
    }
  }, [config, toast])

  return {
    supported,
    permission,
    registered,
    busy,
    deviceCount: config.data?.deviceCount ?? 0,
    devices: config.data?.devices ?? [],
    enable,
    disable,
    sendTest,
    reload: config.reload,
  }
}
