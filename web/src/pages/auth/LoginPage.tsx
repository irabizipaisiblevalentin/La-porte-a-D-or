import { useState, type FormEvent } from "react"
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../auth/AuthProvider"
import { useQuery } from "../../api/hooks"
import { api, ApiError } from "../../api/client"
import { AuthLayout } from "./AuthLayout"
import { Button, Field, Input } from "../../components/ui"
import { APPLICATION_FORM_URL } from "../../components/layout/PublicLayout"

type LoginVariant = "member" | "admin"

const COPY: Record<
  LoginVariant,
  { title: string; subtitle: string; submit: string; switchLabel: string; switchTo: string; switchText: string }
> = {
  member: {
    title: "Member sign in",
    subtitle: "Accounts are created only after an application has been approved by a choir administrator.",
    submit: "Sign in",
    switchLabel: "Administrator sign in",
    switchTo: "/admin/login",
    switchText: "Choir administrator?",
  },
  admin: {
    title: "Administrator sign in",
    subtitle: "Sign in with your choir administrator account. Every administrative action is recorded in the audit log.",
    submit: "Sign in to dashboard",
    switchLabel: "Member sign in",
    switchTo: "/login",
    switchText: "Not an administrator?",
  },
}

export function LoginPage() {
  return <SignInScreen variant="member" />
}

export function AdminLoginPage() {
  return <SignInScreen variant="admin" />
}

function SignInScreen({ variant }: { variant: LoginVariant }) {
  const copy = COPY[variant]
  const { user, login, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [forgot, setForgot] = useState(false)

  const setupStatus = useQuery<{ needsSetup: boolean }>("/setup/status")

  if (!loading && user) return <Navigate to="/app" replace />

  const from = (location.state as { from?: string } | null)?.from ?? "/app"

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const account = await login(identifier, password)
      navigate(account.mustChangePassword ? "/app/account" : from, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Sign in failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthLayout
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        <div className="flex flex-col gap-1">
          <Link to={copy.switchTo} className="link font-medium">
            {copy.switchLabel}
          </Link>
          <a href={APPLICATION_FORM_URL} target="_blank" rel="noopener noreferrer" className="link">
            Apply for Membership
          </a>
          <span>Only approved members can sign in.</span>
        </div>
      }
    >
      {setupStatus.data?.needsSetup ? (
        <div className="mb-4 rounded-xl border border-gold-400/35 bg-gold-400/10 px-3 py-2 text-sm">
          No administrator account exists yet.{" "}
          <Link to="/setup" className="link font-medium">
            Complete the first-time setup
          </Link>
          .
        </div>
      ) : null}

      {forgot ? (
        <ForgotPassword onDone={() => setForgot(false)} />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {error ? (
            <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div>
          ) : null}
          <Field
            label="Email address or username"
            htmlFor="identifier"
            hint="Use your username if you joined without an email address."
            required
          >
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Password" htmlFor="password" required>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="gold" loading={saving}>
            {copy.submit}
          </Button>
          <button type="button" className="link self-center text-sm" onClick={() => setForgot(true)}>
            Forgot your password?
          </button>
          <p className="muted text-center text-xs">
            {copy.switchText}{" "}
            <Link to={copy.switchTo} className="link">
              {copy.switchLabel}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}

function ForgotPassword({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [deliveryConfigured, setDeliveryConfigured] = useState(true)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await api.post<{ message: string; emailDeliveryConfigured: boolean }>("/auth/password/request", { email })
      setMessage(result.message)
      setDeliveryConfigured(result.emailDeliveryConfigured)
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : "Request failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <p className="muted text-sm">
        Enter your email address. If an account exists, a reset will be recorded.
      </p>
      {message ? (
        <div className="rounded-xl border border-gold-400/35 bg-gold-400/10 px-3 py-2 text-sm">
          {message}
          {!deliveryConfigured ? (
            <span className="mt-1 block text-xs">
              Email delivery is not configured on this deployment, so the Chairman will provide the reset link
              directly.
            </span>
          ) : null}
        </div>
      ) : null}
      <Field label="Email address" htmlFor="reset-email" required>
        <Input id="reset-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="gold" loading={saving}>
          Request reset
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Back to sign in
        </Button>
      </div>
    </form>
  )
}
