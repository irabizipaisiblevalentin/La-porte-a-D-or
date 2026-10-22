import { useEffect, useState } from "react"
import { BellRing, Smartphone, X } from "lucide-react"
import { Button, Modal } from "../../components/ui"
import type { PushNotificationsState } from "./usePushNotifications"

/**
 * Asks a newly signed-in person to turn notifications on for this device.
 *
 * Browsers only allow the permission prompt from a user gesture, so a page cannot
 * simply call `Notification.requestPermission()` on load — the request is ignored
 * or the permission is refused outright. What a site *can* do is explain why the
 * question is worth answering and let the person press the button: that press is
 * the gesture, and the browser's own prompt follows it.
 *
 * Three rules keep this from being an annoyance:
 *
 *   1. It appears once per device. Dismissing it writes a marker to `localStorage`,
 *      so the same laptop is never asked twice.
 *   2. It never appears when it cannot help: an unsupported browser, a device
 *      already registered, or a permission the person has already blocked.
 *   3. It waits a moment after sign-in. Slamming a dialog over the dashboard before
 *      it has drawn reads as a pop-up advert; a short pause reads as a suggestion.
 */
const DISMISSED_KEY = "chorale.push.promptDismissed"

function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1"
  } catch {
    // Private browsing can refuse storage. Showing the prompt again is the safe
    // failure: it is only a suggestion, and the person can dismiss it.
    return false
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1")
  } catch {
    // Nothing to do — the prompt will simply be offered again next time.
  }
}

export function NotificationPrompt({ push }: { push: PushNotificationsState }) {
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState(false)

  // `askable` is the whole gate: everything that would make the prompt pointless
  // or impossible is checked once, here.
  const askable =
    push.supported && !push.registered && push.permission === "default" && !isDismissed()

  useEffect(() => {
    if (!askable || asked) return
    const timer = window.setTimeout(() => {
      setOpen(true)
      setAsked(true)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [askable, asked])

  // A device that becomes registered elsewhere (the account page, say) closes the
  // prompt instead of leaving a stale question on screen.
  useEffect(() => {
    if (push.registered) setOpen(false)
  }, [push.registered])

  function dismiss() {
    rememberDismissed()
    setOpen(false)
  }

  async function allow() {
    // `enable()` must run from this click: it is the gesture the browser requires.
    await push.enable()
    rememberDismissed()
    setOpen(false)
  }

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title="Turn on notifications for this device?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={dismiss} disabled={push.busy}>
            Not now
          </Button>
          <Button variant="gold" icon={<BellRing size={16} />} loading={push.busy} onClick={allow}>
            Allow notifications
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          The choir can then reach you on this device — a new announcement, a change to a rehearsal, or a message from
          an administrator — even when this website is closed.
        </p>
        <div className="flex items-start gap-3 rounded-xl border hairline px-3 py-2.5">
          <Smartphone size={18} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-400" />
          <p className="muted text-xs">
            Your browser will ask for permission next. You can turn notifications off again at any time from{" "}
            <strong>My Account</strong>, and blocking them never affects your access to the choir platform.
          </p>
        </div>
        <button
          type="button"
          className="muted inline-flex items-center gap-1 self-start text-xs underline-offset-2 hover:underline"
          onClick={dismiss}
        >
          <X size={12} />
          Do not ask again on this device
        </button>
      </div>
    </Modal>
  )
}
