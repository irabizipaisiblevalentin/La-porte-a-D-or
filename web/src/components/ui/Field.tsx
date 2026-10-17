import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react"

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  htmlFor?: string
  children: ReactNode
}

export function Field({ label, hint, error, required, htmlFor, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
          {required ? <span className="text-[#b4544a]"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-xs text-[#b4544a]">{error}</p> : null}
      {!error && hint ? <p className="muted text-xs">{hint}</p> : null}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={`field ${className}`} aria-invalid={invalid ? "true" : undefined} {...rest} />
})

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = "", invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`field ${className}`} aria-invalid={invalid ? "true" : undefined} {...rest}>
      {children}
    </select>
  )
})

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className = "", invalid, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea ref={ref} rows={rows} className={`field ${className}`} aria-invalid={invalid ? "true" : undefined} {...rest} />
  )
})
