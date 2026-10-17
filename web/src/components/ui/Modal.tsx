import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "./Button"

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: "sm" | "md" | "lg"
}

const SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
}

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Dialog"}
        className={`card relative z-10 max-h-[92dvh] w-full ${SIZE[size]} overflow-y-auto`}
      >
        <div className="flex items-start justify-between gap-4 border-b hairline px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            {description ? <p className="muted mt-0.5 text-sm">{description}</p> : null}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        {children ? <div className="px-5 py-4">{children}</div> : null}
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t hairline px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "gold",
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: "gold" | "danger"
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "gold"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm">{message}</p>
    </Modal>
  )
}
