import { useState, type FormEvent, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { MessageCircle, Phone, Send } from "lucide-react"
import { api } from "../../api/client"
import { useMutation } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import { Button, Field, Input, Modal, Textarea, useToast } from "../../components/ui"
import { APPLICATION_FORM_URL } from "./PublicLayout"

/** The Chairman's direct phone number, shown to anyone who opens the contact dialog. */
export const CHAIRMAN_PHONE = "0736894204"

/** Short "you can also call the Chairman" note, reused across the composer and info dialog. */
function PhoneNote() {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-gold-400/30 bg-gold-400/10 px-4 py-3">
      <Phone size={18} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
      <p className="text-sm">
        You can also talk to the Chairman by phone on{" "}
        <a href={`tel:${CHAIRMAN_PHONE}`} className="link font-semibold">
          {CHAIRMAN_PHONE}
        </a>
        .
      </p>
    </div>
  )
}

/** Modal composer shared by the floating button and the Messages page. */
function Composer({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent?: () => void }) {
  const toast = useToast()
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const send = useMutation((payload: { subject?: string; body: string }) => api.post("/messages", payload))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!body.trim()) return
    const result = await send.run({ subject: subject.trim() || undefined, body: body.trim() })
    if (!result) {
      if (send.error) toast.error(send.error.message)
      return
    }
    toast.success("Your message has been sent to the Chairman.")
    setSubject("")
    setBody("")
    onClose()
    onSent?.()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Message the Chairman"
      description="Write a private message. Only the Chairman will see it, and any reply appears in your Messages."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.saving}>
            Cancel
          </Button>
          <Button variant="gold" icon={<Send size={15} />} loading={send.saving} disabled={!body.trim()} onClick={onSubmit}>
            Send message
          </Button>
        </>
      }
    >
      <PhoneNote />
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Field label="Subject" htmlFor="chairman-subject" hint="Optional — a short summary of your message.">
          <Input
            id="chairman-subject"
            value={subject}
            maxLength={160}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="e.g. Request for an excused absence"
          />
        </Field>
        <Field label="Message" htmlFor="chairman-body" required>
          <Textarea
            id="chairman-body"
            value={body}
            rows={6}
            maxLength={4000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Type your message to the Chairman…"
            required
          />
        </Field>
      </form>
    </Modal>
  )
}

/**
 * Shown to signed-out visitors (e.g. on the public landing page). They cannot send a
 * message through the site without an account, so this dialog leads with the Chairman's
 * phone number and points them to sign-in or the application form.
 */
function ContactInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Contact the Chairman"
      description="Reach the Chairman directly by phone, or sign in to send a private message here."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Link to="/login" className="btn btn-gold btn-sm" onClick={onClose}>
            Member login
          </Link>
        </>
      }
    >
      <PhoneNote />
      <p className="text-sm">
        To send a private message through this website, please{" "}
        <Link to="/login" className="link" onClick={onClose}>
          sign in
        </Link>
        . New members can{" "}
        <a href={APPLICATION_FORM_URL} target="_blank" rel="noopener noreferrer" className="link">
          apply through the official form
        </a>
        .
      </p>
    </Modal>
  )
}

/** An ordinary button that opens the "Message the Chairman" composer (used on the Messages page). */
export function MessageChairmanButton({
  variant = "gold",
  size = "md",
  label = "Message the Chairman",
  icon,
  onSent,
}: {
  variant?: "gold" | "outline" | "ghost"
  size?: "sm" | "md"
  label?: string
  icon?: ReactNode
  onSent?: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant={variant} size={size} icon={icon ?? <MessageCircle size={15} />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Composer open={open} onClose={() => setOpen(false)} onSent={onSent} />
    </>
  )
}

/**
 * Floating "Message the Chairman" button, rendered on every page (public and signed-in).
 *
 * It is hidden only for the Chairman themselves (`messages.read`), who has no reason to
 * message themselves. Signed-in members open a private composer; signed-out visitors get a
 * dialog that leads with the Chairman's phone number. Both dialogs show the phone note.
 */
export function ContactChairman() {
  const { user, can } = useAuth()
  const [open, setOpen] = useState(false)

  const visible = !can("messages.read", "global")
  if (!visible) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg transition hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 bottom-[calc(1.25rem+env(safe-area-inset-bottom))]"
        style={{ background: "var(--color-gold-400)", color: "#221a06" }}
        aria-label="Message the Chairman"
      >
        <MessageCircle size={18} />
        <span className="hidden sm:inline">Message the Chairman</span>
      </button>
      {user && can("messages.send") ? (
        <Composer open={open} onClose={() => setOpen(false)} />
      ) : (
        <ContactInfoModal open={open} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
