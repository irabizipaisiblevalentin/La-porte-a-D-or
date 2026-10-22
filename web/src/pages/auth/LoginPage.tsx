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
  const { user, login, loading, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [forgot, setForgot] = useState(false)

  const setupStatus = useQuery<{ needsSetup: boolean }>("/setup/status")

  // A signed-in visitor is sent on to the platform rather than shown a form they
  // have already filled, *unless* they asked for the form deliberately — an
  // administrator using a shared computer, or somebody who wants to sign in as a
  // different account. `?switch=1` is how the "not you?" link and the dashboard
  // sign-out confirm that intent, so signing in is never forced on anyone who has
  // a session, but the form is always reachable.
  const wantsForm = new URLSearchParams(location.search).get("switch") === "1"
  if (!loading && user && !wantsForm) {
    return <Navigate to={user.mustChangePassword ? "/app/account" : "/app"} replace />
  }

  // Where to land after signing in. Router state is how the auth guards send
  // someone here; `?next=` is how a scanned check-in link does, because it arrives
  // as a plain URL from a QR code and carries no router state with it. Only a
  // same-site path is honoured, so a crafted link cannot bounce anyone off-site.
  const requested = new URLSearchParams(location.search).get("next")
  const from =
    (location.state as { from?: string } | null)?.from ??
    (requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/app")

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
      {user ? (
        // Reached with `?switch=1`: the visitor has a live session but asked for the
        // form. Say so, and give them the two honest choices rather than pretending
        // they are signed out.
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-gold-400/35 bg-gold-400/10 px-3 py-2.5 text-sm">
          <p>
            You are still signed in as <strong>{user.displayName}</strong>.
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            <Link to="/app" className="link font-medium">
              Continue to the platform
            </Link>
            <button
              type="button"
              className="link font-medium"
              onClick={() => {
                void logout().then(() => navigate("/login?switch=1", { replace: true }))
              }}
            >
              Sign out and use another account
            </button>
          </div>
        </div>
      ) : null}

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
