import { useState, type FormEvent } from "react"
import {
  Copy,
  KeyRound,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react"
import { api, ApiError, toQuery } from "../../api/client"
import { useDebounced, useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  humanize,
  useToast,
  type Column,
} from "../../components/ui"

// --- Response shapes (mirroring server/src/routes/users.ts, roles.ts) -------

interface MemberLink {
  id: string
  memberNo: string | null
  fullName: string | null
  groupId: string | null
  groupKey: string | null
}

interface UserAccount {
  id: string
  email: string
  displayName: string
  status: string
  mustChangePassword: boolean
  avatarPath: string | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  deactivatedAt: string | null
  roles: string[]
  member: MemberLink | null
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface RoleCatalogue {
  roles: { key: string; name: string; description: string; grants: { key: string; scope: string }[] }[]
  permissions: { key: string; name: string; description: string; scopes: string[] }[]
}

interface InviteResponse {
  user: UserAccount
  invitation: { url: string; expiresAt: string }
}

interface ResetResponse {
  resetUrl: string
  expiresAt: string
}

interface MemberLite {
  id: string
  member_no: string
  full_name: string
  status: string
  group_name: string | null
}

const STATUS_OPTIONS = ["active", "inactive", "invited", "locked"]

function absoluteUrl(path: string): string {
  try {
    return new URL(path, window.location.origin).href
  } catch {
    return path
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export function AccountsPage() {
  const { can } = useAuth()
  const toast = useToast()

  const [status, setStatus] = useState("")
  const [role, setRole] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  const canManage = can("users.manage")
  const canManageRoles = can("roles.manage")
  const canReadMembers = can("member.read")

  const rolesCatalogue = useQuery<RoleCatalogue>("/roles")
  const list = useQuery<Page<UserAccount>>(`/users${toQuery({ status, role, search, page })}`)

  // --- Invite ---------------------------------------------------------------
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteName, setInviteName] = useState("")
  const [inviteRoles, setInviteRoles] = useState<string[]>([])
  const [inviteMemberId, setInviteMemberId] = useState("")
  const [inviteMemberSearch, setInviteMemberSearch] = useState("")
  const [inviteResult, setInviteResult] = useState<string | null>(null)
  const [inviteFields, setInviteFields] = useState<Record<string, string>>({})

  const debouncedMemberSearch = useDebounced(inviteMemberSearch, 300)
  const memberMatches = useQuery<Page<MemberLite>>(
    canReadMembers && inviteOpen && debouncedMemberSearch.trim().length >= 2
      ? `/members${toQuery({ search: debouncedMemberSearch, pageSize: 10 })}`
      : null,
  )

  const invite = useMutation((payload: { email: string; displayName: string; roles: string[]; memberId?: string }) =>
    api.post<InviteResponse>("/users/invite", payload),
  )

  // --- Roles ----------------------------------------------------------------
  const [rolesTarget, setRolesTarget] = useState<UserAccount | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const rolesMutation = useMutation((payload: { id: string; roles: string[] }) =>
    api.post<{ user: UserAccount }>(`/users/${payload.id}/roles`, { roles: payload.roles }),
  )

  // --- Lifecycle ------------------------------------------------------------
  const [confirm, setConfirm] = useState<{ kind: "deactivate" | "reset"; user: UserAccount } | null>(null)
  const [resetResult, setResetResult] = useState<string | null>(null)

  const deactivate = useMutation((id: string) => api.post(`/users/${id}/deactivate`))
  const activate = useMutation((id: string) => api.post(`/users/${id}/activate`))
  const reset = useMutation((id: string) => api.post<ResetResponse>(`/users/${id}/reset`))

  function updateFilter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value)
      setPage(1)
    }
  }

  function resetInviteForm() {
    setInviteEmail("")
    setInviteName("")
    setInviteRoles([])
    setInviteMemberId("")
    setInviteMemberSearch("")
    setInviteResult(null)
    setInviteFields({})
    invite.reset()
  }

  async function submitInvite(event: FormEvent) {
    event.preventDefault()
    setInviteFields({})
    const result = await invite.run({
      email: inviteEmail.trim(),
      displayName: inviteName.trim(),
      roles: inviteRoles,
      ...(inviteMemberId ? { memberId: inviteMemberId } : {}),
    })
    if (result) {
      setInviteResult(result.invitation.url)
      toast.success(`Invitation created for ${result.user.email}.`)
      list.reload()
    } else if (invite.error instanceof ApiError) {
      setInviteFields(invite.error.fields ?? {})
    }
  }

  function openRoles(user: UserAccount) {
    setRolesTarget(user)
    setSelectedRoles(user.roles)
    rolesMutation.reset()
  }

  async function submitRoles() {
    if (!rolesTarget) return
    const result = await rolesMutation.run({ id: rolesTarget.id, roles: selectedRoles })
    if (result) {
      toast.success(`Roles updated for ${rolesTarget.displayName}.`)
      setRolesTarget(null)
      list.reload()
    }
  }

  async function confirmLifecycle() {
    if (!confirm) return
    if (confirm.kind === "deactivate") {
      const done = await deactivate.run(confirm.user.id)
      if (done !== undefined) {
        toast.success(`${confirm.user.displayName} deactivated.`)
        setConfirm(null)
        list.reload()
      }
    } else {
      const result = await reset.run(confirm.user.id)
      if (result) {
        setResetResult(result.resetUrl)
        setConfirm(null)
      }
    }
  }

  async function activateUser(user: UserAccount) {
    const done = await activate.run(user.id)
    if (done !== undefined) {
      toast.success(`${user.displayName} activated.`)
      list.reload()
    }
  }

  function toggleRole(current: string[], key: string): string[] {
    return current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success("Link copied to the clipboard.")
    } catch {
      toast.error("Could not copy automatically. Select the link and copy it manually.")
    }
  }

  const columns: Column<UserAccount>[] = [
    {
      key: "account",
      header: "Account",
      render: (user) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.displayName}</p>
          <p className="muted truncate text-xs">{user.email}</p>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      render: (user) =>
        user.roles.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {user.roles.map((key) => (
              <Badge key={key} tone="gold">
                {humanize(key)}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="muted text-xs">No roles</span>
        ),
    },
    { key: "status", header: "Status", render: (user) => <StatusBadge status={user.status} /> },
    {
      key: "member",
      header: "Linked member",
      render: (user) =>
        user.member ? (
          <span className="text-xs">
            {user.member.fullName ?? user.member.memberNo ?? user.member.id}
            {user.member.memberNo ? <span className="muted"> · {user.member.memberNo}</span> : null}
          </span>
        ) : (
          <span className="muted text-xs">Not linked</span>
        ),
    },
    { key: "lastLogin", header: "Last sign-in", render: (user) => formatDate(user.lastLoginAt) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (user) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {canManageRoles ? (
            <Button size="sm" variant="ghost" icon={<ShieldCheck size={14} />} onClick={() => openRoles(user)}>
              Roles
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<KeyRound size={14} />}
                onClick={() => setConfirm({ kind: "reset", user })}
              >
                Reset
              </Button>
              {user.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<UserX size={14} />}
                  onClick={() => setConfirm({ kind: "deactivate", user })}
                >
                  Deactivate
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={<UserCheck size={14} />} onClick={() => activateUser(user)}>
                  Activate
                </Button>
              )}
            </>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Invite administrators and members, assign roles, and manage account access."
        actions={
          canManage ? (
            <Button
              variant="gold"
              icon={<UserPlus size={16} />}
              onClick={() => {
                resetInviteForm()
                setInviteOpen(true)
              }}
            >
              Invite account
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader title="Filters" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Search" htmlFor="account-search">
            <div className="relative">
              <Search size={16} className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                id="account-search"
                className="pl-9"
                placeholder="Name or email"
                value={search}
                onChange={(event) => updateFilter(setSearch)(event.target.value)}
              />
            </div>
          </Field>
          <Field label="Status" htmlFor="account-status">
            <Select id="account-status" value={status} onChange={(event) => updateFilter(setStatus)(event.target.value)}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" htmlFor="account-role">
            <Select id="account-role" value={role} onChange={(event) => updateFilter(setRole)(event.target.value)}>
              <option value="">All roles</option>
              {(rolesCatalogue.data?.roles ?? []).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Accounts" description={`${list.data?.total ?? 0} account${(list.data?.total ?? 0) === 1 ? "" : "s"}.`} />
        <CardBody className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(user) => user.id}
            loading={list.loading && !list.data}
            error={list.error?.message ?? null}
            emptyTitle="No accounts found"
            emptyDescription="Adjust the filters or invite a new account."
          />
          {list.data ? (
            <Pagination page={list.data.page} pageCount={list.data.pageCount} total={list.data.total} onChange={setPage} />
          ) : null}
        </CardBody>
      </Card>

      {/* Invite modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={inviteResult ? "Invitation created" : "Invite an account"}
        description={
          inviteResult
            ? "Share this link with the person directly."
            : "Create an account and assign at least one role. The person sets their own password."
        }
        size="lg"
      >
        {inviteResult ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
              <p className="font-medium">Share this invitation link manually</p>
              <p className="muted mt-0.5">
                Email delivery may not be configured on this server, so the platform cannot send the invitation for you.
                Copy the link below and deliver it by your own means.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input readOnly value={absoluteUrl(inviteResult)} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
              <Button variant="gold" icon={<Copy size={16} />} onClick={() => copy(absoluteUrl(inviteResult))}>
                Copy
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => resetInviteForm()}>
                Invite another
              </Button>
              <Button variant="ghost" onClick={() => setInviteOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submitInvite}>
            <Field label="Full name" htmlFor="invite-name" required error={inviteFields.displayName}>
              <Input id="invite-name" value={inviteName} onChange={(event) => setInviteName(event.target.value)} required />
            </Field>
            <Field label="Email address" htmlFor="invite-email" required error={inviteFields.email}>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                required
              />
            </Field>

            <Field label="Roles" required error={inviteFields.roles} hint="Choose every role this account should hold.">
              <div className="grid gap-2 sm:grid-cols-2">
                {(rolesCatalogue.data?.roles ?? []).map((item) => (
                  <label key={item.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={inviteRoles.includes(item.key)}
                      onChange={() => setInviteRoles((current) => toggleRole(current, item.key))}
                    />
                    <span>
                      <span className="font-medium">{item.name}</span>
                      <span className="muted block text-xs">{item.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            {canReadMembers ? (
              <Field label="Link to a member (optional)" htmlFor="invite-member" error={inviteFields.memberId}>
                <Input
                  id="invite-member"
                  placeholder="Type a member name to search…"
                  value={inviteMemberSearch}
                  onChange={(event) => {
                    setInviteMemberSearch(event.target.value)
                    setInviteMemberId("")
                  }}
                />
                {memberMatches.data && memberMatches.data.items.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1">
                    {memberMatches.data.items.map((member) => (
                      <button
                        type="button"
                        key={member.id}
                        className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-left text-sm ${
                          inviteMemberId === member.id ? "border-gold-400 bg-gold-400/10" : "hairline"
                        }`}
                        onClick={() => {
                          setInviteMemberId(member.id)
                          setInviteMemberSearch(member.full_name)
                        }}
                      >
                        <span>{member.full_name}</span>
                        <span className="muted text-xs">
                          {member.member_no}
                          {member.group_name ? ` · ${member.group_name}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {inviteMemberId ? <p className="muted mt-1 text-xs">Linked member selected. Clear the field to unlink.</p> : null}
              </Field>
            ) : null}

            {invite.error ? <p className="text-sm text-[#b4544a]">{invite.error.message}</p> : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="gold" loading={invite.saving} icon={<UserPlus size={16} />}>
                Create invitation
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Roles modal */}
      <Modal
        open={Boolean(rolesTarget)}
        onClose={() => setRolesTarget(null)}
        title={rolesTarget ? `Roles for ${rolesTarget.displayName}` : "Roles"}
        description="Assign the roles this account should hold. Changes take effect immediately."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRolesTarget(null)}>
              Cancel
            </Button>
            <Button variant="gold" loading={rolesMutation.saving} onClick={submitRoles}>
              Save roles
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {(rolesCatalogue.data?.roles ?? []).map((item) => (
            <label key={item.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selectedRoles.includes(item.key)}
                onChange={() => setSelectedRoles((current) => toggleRole(current, item.key))}
              />
              <span>
                <span className="font-medium">{item.name}</span>
                <span className="muted block text-xs">{item.description}</span>
              </span>
            </label>
          ))}
          {rolesMutation.error ? <p className="text-sm text-[#b4544a]">{rolesMutation.error.message}</p> : null}
        </div>
      </Modal>

      {/* Reset result modal */}
      <Modal
        open={Boolean(resetResult)}
        onClose={() => setResetResult(null)}
        title="Password reset link issued"
        description="Share this link with the account holder."
        footer={
          <Button variant="ghost" onClick={() => setResetResult(null)}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
            <p className="font-medium">Deliver this link securely</p>
            <p className="muted mt-0.5">
              Email delivery may not be configured, so the platform cannot send this reset link automatically. The link
              expires shortly, so share it promptly.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input readOnly value={absoluteUrl(resetResult ?? "")} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
            <Button variant="gold" icon={<Copy size={16} />} onClick={() => copy(absoluteUrl(resetResult ?? ""))}>
              Copy
            </Button>
          </div>
        </div>
      </Modal>

      {/* Lifecycle confirmations */}
      <ConfirmDialog
        open={confirm?.kind === "deactivate"}
        title="Deactivate this account?"
        message={
          confirm
            ? `${confirm.user.displayName} will be signed out immediately and cannot sign in until reactivated.`
            : ""
        }
        confirmLabel="Deactivate"
        tone="danger"
        loading={deactivate.saving}
        onConfirm={confirmLifecycle}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "reset"}
        title="Issue a password reset link?"
        message={
          confirm
            ? `A single-use password reset link will be generated for ${confirm.user.email}. You will need to share it manually.`
            : ""
        }
        confirmLabel="Issue reset link"
        loading={reset.saving}
        onConfirm={confirmLifecycle}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
