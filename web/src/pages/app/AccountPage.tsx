import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { LogOut, ShieldCheck } from "lucide-react"
import { useAuth, type PermissionScope } from "../../auth/AuthProvider"
import { api, ApiError } from "../../api/client"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  PageHeader,
  ThemeToggle,
  useToast,
} from "../../components/ui"

export function AccountPage() {
  const { user, logout, refresh } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!user) return null

  const permissionEntries = Object.entries(user.permissions) as [string, PermissionScope[]][]
  // Read before the change: a temporary password closes the rest of the platform,
  // and that is what decides whether to move on to the dashboard afterwards.
  const wasTemporary = user.mustChangePassword

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    if (newPassword !== confirm) {
      setFields({ confirm: "The passwords do not match." })
      return
    }
    setSaving(true)
    try {
      await api.post("/auth/password", { currentPassword, newPassword })
      setCurrentPassword("")
      setNewPassword("")
      setConfirm("")
      await refresh()
      toast.success("Your password has been updated.")
      // The rest of the platform opens up now; go there instead of leaving the
      // member staring at the form that just closed.
      if (wasTemporary) navigate("/app", { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFields(caught.fields ?? {})
      } else {
        setError("Could not update your password.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Account"
        description="Your sign-in details, security and appearance preferences."
      />

      {user.mustChangePassword ? (
        <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm">
          <p className="font-medium">Set your own password to open the rest of the platform</p>
          <p className="muted mt-0.5">
            You signed in with the password an administrator gave you. Choose a new one below — until you do,
            every other page stays closed.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" description="This is the identity you sign in with." />
          <CardBody className="flex flex-col gap-4">
            <Row label="Name" value={user.displayName} />
            <Row label="Email" value={user.email} />
            <Row label="Member number" value={user.memberNo ?? "—"} />
            <Row label="Group" value={user.groupName ?? "—"} />
            <div className="flex flex-col gap-1.5">
              <span className="muted text-xs font-medium uppercase tracking-wide">Roles</span>
              <div className="flex flex-wrap gap-1">
                {user.roles.length > 0 ? (
                  user.roles.map((role) => (
                    <Badge key={role} tone="gold">
                      {role.replace(/_/g, " ")}
                    </Badge>
                  ))
                ) : (
                  <span className="muted text-sm">No roles assigned</span>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Appearance" description="Choose how the platform looks on this device." />
          <CardBody className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Light or dark theme</p>
              <p className="muted text-xs">Stored on this device only.</p>
            </div>
            <ThemeToggle />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Change password" description="Use at least 10 characters with upper, lower and a number." />
          <CardBody>
            <form className="flex flex-col gap-4" onSubmit={changePassword}>
              {error ? (
                <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">
                  {error}
                </div>
              ) : null}
              <Field label="Current password" htmlFor="current" required error={fields.currentPassword}>
                <Input
                  id="current"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </Field>
              <Field label="New password" htmlFor="new" required error={fields.newPassword}>
                <Input
                  id="new"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm" required error={fields.confirm}>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="gold" loading={saving} icon={<ShieldCheck size={16} />}>
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Permissions"
            description="Everything your roles currently allow. Contact the Chairman to change these."
          />
          <CardBody className="flex flex-col gap-2">
            {permissionEntries.length > 0 ? (
              permissionEntries.map(([key, scopes]) => (
                <div key={key} className="flex items-center justify-between gap-3 border-b hairline py-1.5 last:border-0">
                  <span className="text-sm">{key}</span>
                  <span className="flex flex-wrap gap-1">
                    {scopes.map((scope) => (
                      <Badge key={scope} tone="neutral">
                        {scope}
                      </Badge>
                    ))}
                  </span>
                </div>
              ))
            ) : (
              <p className="muted text-sm">No permissions are attached to your account.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Session" description="Sign out of this device." />
        <CardBody>
          <Button
            variant="outline"
            icon={<LogOut size={16} />}
            onClick={async () => {
              await logout()
              navigate("/login", { replace: true })
            }}
          >
            Sign out
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
