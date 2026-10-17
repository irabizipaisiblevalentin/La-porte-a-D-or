import { useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "../../auth/AuthProvider"
import { useQuery } from "../../api/hooks"
import { api, ApiError } from "../../api/client"
import { AuthLayout } from "./AuthLayout"
import { Button, Field, Input, Spinner } from "../../components/ui"

export function SetupPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const status = useQuery<{ needsSetup: boolean; setupTokenFile: string | null }>("/setup/status")
  const [token, setToken] = useState("")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  if (status.loading) {
    return (
      <AuthLayout title="First-time setup">
        <div className="flex items-center justify-center gap-2 py-6">
          <Spinner /> <span className="muted text-sm">Checking setup status…</span>
        </div>
      </AuthLayout>
    )
  }

  if (status.data && !status.data.needsSetup) return <Navigate to="/login" replace />

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
      await api.post("/setup", { token, fullName, email, password })
      await refresh()
      navigate("/app", { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Setup failed.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthLayout
      title="Create the Chairman"
      subtitle="This one-time setup runs only once. The token is written to the server console and to a file in the server's data directory."
      footer={<Link to="/login" className="link">Back to sign in</Link>}
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="rounded-xl border border-gold-400/35 bg-gold-400/10 px-3 py-2 text-xs">
          <p className="font-medium">Where to find your setup token</p>
          <p className="muted mt-1">
            Look in the server console output, or open the file:
            <br />
            <code className="text-[11px]">{status.data?.setupTokenFile ?? "server/data/FIRST-ADMIN-SETUP.txt"}</code>
          </p>
        </div>
        {error ? <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">{error}</div> : null}
        <Field label="Setup token" htmlFor="token" required error={fields.token}>
          <Input id="token" value={token} onChange={(event) => setToken(event.target.value)} required autoFocus />
        </Field>
        <Field label="Full name" htmlFor="fullName" required error={fields.fullName}>
          <Input id="fullName" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
        </Field>
        <Field label="Email address" htmlFor="email" required error={fields.email}>
          <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password" required error={fields.password} hint="At least 10 characters with upper, lower and a number.">
          <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" required>
          <Input id="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
        </Field>
        <Button type="submit" variant="gold" loading={saving}>
          Create Chairman account
        </Button>
      </form>
    </AuthLayout>
  )
}
