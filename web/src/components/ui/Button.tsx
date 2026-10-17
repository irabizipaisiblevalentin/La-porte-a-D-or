import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

type Variant = "gold" | "outline" | "ghost" | "danger"
type Size = "sm" | "md"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
}

const VARIANT_CLASS: Record<Variant, string> = {
  gold: "btn-gold",
  outline: "btn-outline",
  ghost: "btn-ghost",
  danger: "btn-danger",
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", loading = false, icon, iconRight, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`btn ${VARIANT_CLASS[variant]} ${size === "sm" ? "btn-sm" : ""} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={size === "sm" ? 14 : 16} className="animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  )
})
