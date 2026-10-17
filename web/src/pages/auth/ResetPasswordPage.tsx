import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { api, ApiError } from "../../api/client"
import { AuthLayout } from "./AuthLayout"
import { Button, EmptyState, Field, Input } from "../../components/ui"

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get("token") ?? ""
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  if (!token) {
    return (
      <AuthLayout title="Reset your password" footer={<Link to="/login" className="link">Back to sign in</Link>}>
        <EmptyState tone="danger" title="Reset link is incomplete" description="Open the full reset link provided to you." />
      </AuthLayout>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    if (password !== confirm) {
      setFields({ password: "The passwords do not match." })
      return
    }
    setSaving(true)
    try {
      await api.post("/auth/password/reset", { token, password })
      navigate("/login", { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Reset failed.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="All other sessions will be signed out for your security.">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        {error ? <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div> : null}
        <Field label="New password" htmlFor="password" required error={fields.password} hint="At least 10 characters with upper, lower and a number.">
          <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" required>
          <Input id="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
        </Field>
        <Button type="submit" variant="gold" loading={saving}>
          Set new password
        </Button>
      </form>
    </AuthLayout>
  )
}
