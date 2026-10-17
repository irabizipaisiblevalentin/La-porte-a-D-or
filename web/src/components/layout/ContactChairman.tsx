import { useState, type FormEvent, type ReactNode } from "react"
import { MessageCircle, Send } from "lucide-react"
import { api } from "../../api/client"
import { useMutation } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import { Button, Field, Input, Modal, Textarea, useToast } from "../../components/ui"

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
      description="Need to speak to the Chairman? Write a private message. Only the Chairman will see it, and the reply appears in your Messages."
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
 * Floating "Message the Chairman" button for singers and members.
 *
 * The Chairman (and only the Chairman) has `messages.read`; everyone else who can
 * send a message (`messages.send`) sees this button. Pressing it opens a small
 * composer that sends a private message which the Chairman reads in their inbox.
 */
export function ContactChairman() {
  const { can } = useAuth()
  const [open, setOpen] = useState(false)

  const visible = can("messages.send") && !can("messages.read", "global")
  if (!visible) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg transition hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ background: "var(--color-gold-400)", color: "#221a06" }}
        aria-label="Message the Chairman"
      >
        <MessageCircle size={18} />
        <span className="hidden sm:inline">Message the Chairman</span>
      </button>
      <Composer open={open} onClose={() => setOpen(false)} />
    </>
  )
}
