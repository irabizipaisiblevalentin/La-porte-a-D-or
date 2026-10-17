import type { HTMLAttributes, ReactNode } from "react"

export function Card({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 border-b hairline px-5 py-4 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description ? <p className="muted mt-0.5 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 py-4 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardFooter({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 border-t hairline px-5 py-3 ${className}`} {...rest}>
      {children}
    </div>
  )
}
