import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react"

type ToastVariant = "success" | "error" | "info"

interface ToastItem {
  id: number
  variant: ToastVariant
  message: string
}

interface ToastContextValue {
  push: (message: string, variant?: ToastVariant) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const

const COLORS: Record<ToastVariant, string> = {
  success: "#3f8f66",
  error: "#b4544a",
  info: "#d4af37",
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current, { id, variant, message }])
      window.setTimeout(() => remove(id), variant === "error" ? 7000 : 4500)
    },
    [remove],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (message: string) => push(message, "success"),
      error: (message: string) => push(message, "error"),
      info: (message: string) => push(message, "info"),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.variant]
          return (
            <div key={toast.id} className="card pointer-events-auto flex items-start gap-3 px-4 py-3" role="status">
              <Icon size={18} style={{ color: COLORS[toast.variant], flexShrink: 0, marginTop: 2 }} />
              <p className="flex-1 text-sm">{toast.message}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(toast.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error("useToast must be used within ToastProvider")
  return context
}
