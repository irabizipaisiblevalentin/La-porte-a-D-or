import { useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useAuth } from "../../auth/AuthProvider"
import { useQuery } from "../../api/hooks"
import { api, ApiError } from "../../api/client"
import { AuthLayout } from "./AuthLayout"
import { Button, EmptyState, Field, Input, Spinner } from "../../components/ui"

export function InvitePage() {
  const { token = "" } = useParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const invitation = useQuery<{
    invitation: { email: string | null; username: string | null; fullName: string; hasEmail: boolean }
  }>(token ? `/auth/invitation/${token}` : null)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

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
      await api.post(`/auth/invitation/${token}`, { password })
      await refresh()
      navigate("/app", { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Activation failed.")
      }
    } finally {
      setSaving(false)
    }
  }

  if (invitation.loading) {
    return (
      <AuthLayout title="Activate your account">
        <div className="flex items-center justify-center gap-2 py-6">
          <Spinner /> <span className="muted text-sm">Validating your invitation…</span>
        </div>
      </AuthLayout>
    )
  }

  if (invitation.error) {
    return (
      <AuthLayout title="Activate your account" footer={<Link to="/login" className="link">Back to sign in</Link>}>
        <EmptyState
          tone="danger"
          title="This invitation is no longer valid"
          description="Invitation links expire and can be used only once. Ask a choir administrator to issue a new one."
        />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Welcome"
      subtitle={invitation.data ? `Set a password for ${invitation.data.invitation.fullName}.` : undefined}
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        {error ? <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div> : null}
        {invitation.data ? (
          <div className="rounded-xl border border-gold-400/35 bg-gold-400/10 px-3 py-2 text-sm">
            {invitation.data.invitation.hasEmail && invitation.data.invitation.email ? (
              <>Sign in with your email: <span className="font-medium">{invitation.data.invitation.email}</span></>
            ) : (
              <>
                You joined without an email address, so you sign in with your name:
                <span className="font-medium"> {invitation.data.invitation.username ?? invitation.data.invitation.fullName}</span>
              </>
            )}
          </div>
        ) : null}
        <Field label="Choose a password" htmlFor="password" required error={fields.password} hint="At least 10 characters with upper, lower and a number.">
          <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" required>
          <Input id="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
        </Field>
        <Button type="submit" variant="gold" loading={saving}>
          Activate account
        </Button>
      </form>
    </AuthLayout>
  )
}
