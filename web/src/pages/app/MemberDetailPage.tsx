import { useEffect, useState, type ChangeEvent, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Info,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
  User,
} from "lucide-react"
import { api } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import { groupScope } from "../../auth/groups"
import { SignInShare } from "../../components/SignInShare"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  useToast,
} from "../../components/ui"

interface Group {
  id: string
  key: string
  name: string
  description: string
  is_minor_group: number
}

interface VoiceSection {
  id: string
  key: string
  name: string
  sort_order: number
}

interface MembersMeta {
  groups: Group[]
  voiceSections: VoiceSection[]
}

interface MemberRow {
  id: string
  member_no: string
  group_id: string
  user_id: string | null
  full_name: string
  gender: string | null
  date_of_birth: string | null
  status: string
  joined_at: string
  photo_path: string | null
  voice_section_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deactivated_at: string | null
  group_key: string
  group_name: string
  voice_section_name: string | null
  email: string | null
  /** Sign-in name for accounts created without an email address. */
  username: string | null
  /**
   * Current sign-in password. Only present when the viewer may edit the member
   * (or it is their own record) — the server withholds it otherwise.
   */
  sign_in_password?: string | null
}

/** Shape of `delivery` in the approval and send-credentials responses. */
export interface CredentialDelivery {
  sent: boolean
  to: string | null
  reason: "sent" | "no_email" | "not_configured" | "send_failed"
  error?: string
}

interface MemberContact {
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  account_email?: string | null
}

interface MemberSenior {
  occupation?: string | null
  workplace?: string | null
  singing_experience?: string | null
}

interface MemberJunior {
  school?: string | null
  current_class?: string | null
  guardian_name?: string | null
  guardian_relationship?: string | null
  guardian_phone?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
}

interface MemberSupport {
  department?: string | null
  primary_responsibility?: string | null
  skills?: string | null
  experience?: string | null
  availability?: string | null
}

interface FullMember {
  member: MemberRow
  contact: MemberContact | null
  senior: MemberSenior | null
  junior: MemberJunior | null
  support: MemberSupport | null
}

interface EditForm {
  fullName: string
  gender: string
  dateOfBirth: string
  status: string
  voiceSectionId: string
  notes: string
  phone: string
  email: string
  address: string
  city: string
  region: string
  country: string
  occupation: string
  workplace: string
  singing_experience: string
  school: string
  current_class: string
  guardian_name: string
  guardian_relationship: string
  guardian_phone: string
  emergency_contact_name: string
  emergency_contact_phone: string
  department: string
  primary_responsibility: string
  skills: string
  experience: string
  availability: string
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
  { value: "withdrawn", label: "Withdrawn" },
]

const EMPTY_FORM: EditForm = {
  fullName: "",
  gender: "",
  dateOfBirth: "",
  status: "active",
  voiceSectionId: "",
  notes: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  region: "",
  country: "",
  occupation: "",
  workplace: "",
  singing_experience: "",
  school: "",
  current_class: "",
  guardian_name: "",
  guardian_relationship: "",
  guardian_phone: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  department: "",
  primary_responsibility: "",
  skills: "",
  experience: "",
  availability: "",
}

function nullify(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function MemberDetailPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()

  const meta = useQuery<MembersMeta>("/members/meta")
  const { data, loading, error, reload } = useQuery<{ member: FullMember }>(`/members/${id}`)

  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [form, setForm] = useState<EditForm>(EMPTY_FORM)
  const [fields, setFields] = useState<Record<string, string>>({})

  const update = useMutation((body: Record<string, unknown>) => api.patch<{ member: FullMember }>(`/members/${id}`, body))
  const upload = useMutation((file: File) => {
    const formData = new FormData()
    formData.append("file", file)
    return api.upload<{ photoPath: string }>(`/members/${id}/photo`, formData)
  })
  const sendCredentials = useMutation(() =>
    api.post<{ delivery: CredentialDelivery }>(`/members/${id}/send-credentials`),
  )
  const remove = useMutation(() => api.del<{ ok: boolean; memberNo: string }>(`/members/${id}`))

  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!update.error) return
    setFields(update.error.fields ?? {})
    toast.error(update.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update.error])

  useEffect(() => {
    if (upload.error) toast.error(upload.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.error])

  useEffect(() => {
    if (sendCredentials.error) toast.error(sendCredentials.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendCredentials.error])

  useEffect(() => {
    if (remove.error) toast.error(remove.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remove.error])

  // A password is revealed per visit and never for the next member.
  useEffect(() => {
    setRevealed(false)
  }, [id])

  const detail = data?.member ?? null
  const member = detail?.member ?? null
  const voiceSections = meta.data?.voiceSections ?? []
  const scope = groupScope(member?.group_key)
  const canWrite = scope ? can("member.write", scope) : can("member.write")
  const canSensitive = can("member.sensitive.read", "junior")
  // Removing a record is deliberately rare: the Chairman only, and only once the
  // member has been withdrawn (the server enforces both as well).
  const canRemove = can("member.delete") && member?.status === "withdrawn"

  function startEdit() {
    if (!detail) return
    const row = detail.member
    setForm({
      ...EMPTY_FORM,
      fullName: row.full_name ?? "",
      gender: row.gender ?? "",
      dateOfBirth: row.date_of_birth ?? "",
      status: row.status ?? "active",
      voiceSectionId: row.voice_section_id ?? "",
      notes: row.notes ?? "",
      phone: detail.contact?.phone ?? "",
      email: detail.contact?.email ?? detail.contact?.account_email ?? row.email ?? "",
      address: detail.contact?.address ?? "",
      city: detail.contact?.city ?? "",
      region: detail.contact?.region ?? "",
      country: detail.contact?.country ?? "",
      occupation: detail.senior?.occupation ?? "",
      workplace: detail.senior?.workplace ?? "",
      singing_experience: detail.senior?.singing_experience ?? "",
      school: detail.junior?.school ?? "",
      current_class: detail.junior?.current_class ?? "",
      guardian_name: detail.junior?.guardian_name ?? "",
      guardian_relationship: detail.junior?.guardian_relationship ?? "",
      guardian_phone: detail.junior?.guardian_phone ?? "",
      emergency_contact_name: detail.junior?.emergency_contact_name ?? "",
      emergency_contact_phone: detail.junior?.emergency_contact_phone ?? "",
      department: detail.support?.department ?? "",
      primary_responsibility: detail.support?.primary_responsibility ?? "",
      skills: detail.support?.skills ?? "",
      experience: detail.support?.experience ?? "",
      availability: detail.support?.availability ?? "",
    })
    setFields({})
    update.reset()
    setEditing(true)
  }

  function buildPayload(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      fullName: form.fullName.trim(),
      gender: nullify(form.gender),
      dateOfBirth: nullify(form.dateOfBirth),
      status: form.status,
      voiceSectionId: form.voiceSectionId || null,
      notes: nullify(form.notes),
      contact: {
        phone: nullify(form.phone),
        email: nullify(form.email),
        address: nullify(form.address),
        city: nullify(form.city),
        region: nullify(form.region),
        country: nullify(form.country),
      },
    }
    if (member?.group_key === "senior") {
      body.senior = {
        occupation: nullify(form.occupation),
        workplace: nullify(form.workplace),
        singing_experience: nullify(form.singing_experience),
      }
    } else if (member?.group_key === "junior") {
      body.junior = {
        school: nullify(form.school),
        current_class: nullify(form.current_class),
        guardian_name: nullify(form.guardian_name),
        guardian_relationship: nullify(form.guardian_relationship),
        guardian_phone: nullify(form.guardian_phone),
        emergency_contact_name: nullify(form.emergency_contact_name),
        emergency_contact_phone: nullify(form.emergency_contact_phone),
      }
    } else if (member?.group_key === "members") {
      body.support = {
        department: nullify(form.department),
        primary_responsibility: nullify(form.primary_responsibility),
        skills: nullify(form.skills),
        experience: nullify(form.experience),
        availability: nullify(form.availability),
      }
    }
    return body
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFields({})
    const result = await update.run(buildPayload())
    if (!result) return
    toast.success("Member updated.")
    setEditing(false)
    reload()
  }

  async function onPhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const input = event.target
    const result = await upload.run(file)
    input.value = ""
    if (!result) return
    toast.success("Photograph updated.")
    reload()
  }

  /** Emails the member their sign-in details again (or for the first time). */
  async function onSendCredentials() {
    const result = await sendCredentials.run()
    if (!result) return
    const { delivery } = result
    if (delivery.sent) {
      toast.success(`Sign-in details sent to ${delivery.to}.`)
      return
    }
    if (delivery.reason === "not_configured") {
      toast.error("Email delivery is not configured. Add a mail channel in Settings → Integrations, then try again — or use WhatsApp/SMS below.")
    } else if (delivery.reason === "no_email") {
      toast.error("This member has no email address on file. Send the details with WhatsApp or SMS instead.")
    } else {
      toast.error(`The email could not be sent${delivery.error ? `: ${delivery.error}` : "."}`)
    }
  }

  /** Erases a withdrawn record (its account and photograph go with it). */
  async function onRemove() {
    setConfirmRemove(false)
    const result = await remove.run()
    if (!result) return
    toast.success(`${result.memberNo} was removed.`)
    navigate("/app/members")
  }

  const breadcrumbs = [
    { label: "Dashboard", to: "/app" },
    { label: "Members", to: "/app/members" },
    { label: member?.full_name ?? "Member" },
  ]

  if (loading && !member) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Member" breadcrumbs={breadcrumbs} />
        <LoadingBlock label="Loading member…" rows={4} />
      </div>
    )
  }

  if (error && !member) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Member" breadcrumbs={breadcrumbs} />
        <Card>
          <CardBody>
            <ErrorState title="Could not load this member" description={error.message} />
            <div className="flex justify-center pt-4">
              <Link to="/app/members" className="btn btn-outline">
                <ArrowLeft size={16} /> Back to members
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!detail || !member) return null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={member.full_name}
        description={`${member.member_no} · ${member.group_name}`}
        breadcrumbs={breadcrumbs}
        actions={
          <>
            <Link to="/app/members" className="btn btn-outline btn-sm">
              <ArrowLeft size={15} /> All members
            </Link>
            {canWrite && member.sign_in_password ? (
              <Button
                variant="outline"
                size="sm"
                icon={<Send size={15} />}
                loading={sendCredentials.saving}
                onClick={onSendCredentials}
              >
                Send sign-in details
              </Button>
            ) : null}
            {canWrite ? (
              <Button variant="gold" size="sm" icon={<Pencil size={15} />} onClick={startEdit}>
                Edit
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Photograph" />
          <CardBody className="flex flex-col items-center gap-4">
            <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl bg-black/5 dark:bg-charcoal-800">
              {member.photo_path ? (
                <img src={member.photo_path} alt={`${member.full_name}'s profile photograph`} className="h-full w-full object-cover" />
              ) : (
                <User size={48} className="opacity-40" aria-hidden />
              )}
            </div>
            {canWrite ? (
              <div className="flex w-full flex-col gap-2">
                <label className="muted text-xs font-medium" htmlFor="member-photo">
                  Update photograph
                </label>
                <input
                  id="member-photo"
                  type="file"
                  accept="image/*"
                  className="field"
                  onChange={onPhotoUpload}
                  disabled={upload.saving}
                />
                {upload.saving ? (
                  <span className="muted flex items-center gap-2 text-xs">
                    <Upload size={13} /> Uploading…
                  </span>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Profile" actions={<StatusBadge status={member.status} />} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Detail label="Member number" value={member.member_no} />
            <Detail label="Group" value={member.group_name} />
            <Detail label="Voice section" value={member.voice_section_name ?? "Not assigned"} />
            <Detail label="Status" value={member.status} />
            <Detail label="Gender" value={member.gender ?? "—"} />
            <Detail label="Date of birth" value={formatDateTime(member.date_of_birth)} />
            <Detail label="Joined" value={formatDateTime(member.joined_at)} />
            <Detail label="Last updated" value={formatDateTime(member.updated_at)} />
            <div className="sm:col-span-2">
              <p className="muted text-xs font-medium uppercase tracking-wide">Email</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm">
                <Mail size={14} className="opacity-70" aria-hidden />
                {member.email ?? "—"}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="muted text-xs font-medium uppercase tracking-wide">Sign-in name</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm">
                <User size={14} className="opacity-70" aria-hidden />
                {member.username ?? "—"}
              </p>
            </div>
            {member.sign_in_password ? (
              <div className="sm:col-span-2">
                <p className="muted text-xs font-medium uppercase tracking-wide">Sign-in password</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-black/5 px-2 py-1 font-mono text-sm tracking-wide dark:bg-white/10">
                    {revealed ? member.sign_in_password : "•".repeat(12)}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                    onClick={() => setRevealed((value) => !value)}
                    aria-label={revealed ? "Hide the password" : "Show the password"}
                  >
                    {revealed ? "Hide" : "Show"}
                  </Button>
                </div>
                <div className="mt-2">
                  <SignInShare
                    fullName={member.full_name}
                    username={member.username}
                    email={member.email}
                    password={member.sign_in_password}
                    phone={detail?.contact?.phone}
                  />
                </div>
                <p className="muted mt-2 text-xs">
                  Generated for this member. Emailing is automatic once a mail channel is configured; WhatsApp and SMS
                  open on your own phone and cost nothing.
                </p>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <p className="muted text-xs font-medium uppercase tracking-wide">Phone</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm">
                <Phone size={14} className="opacity-70" aria-hidden />
                {detail.contact?.phone ?? "—"}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {member.group_key === "senior" && detail.senior ? (
        <Card>
          <CardHeader title="Singer profile" description="Senior group details." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Detail label="Occupation" value={detail.senior.occupation ?? "—"} />
            <Detail label="Workplace" value={detail.senior.workplace ?? "—"} />
            <div className="sm:col-span-2">
              <Detail label="Singing experience" value={detail.senior.singing_experience ?? "—"} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {member.group_key === "junior" && detail.junior ? (
        <Card>
          <CardHeader
            title="Junior profile"
            description="Records for minors are sensitive and only visible to authorised administrators."
            actions={
              <Badge tone="warn">
                <ShieldAlert size={12} /> Sensitive
              </Badge>
            }
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Detail label="School" value={detail.junior.school ?? "—"} />
            <Detail label="Current class" value={detail.junior.current_class ?? "—"} />
            {detail.junior.guardian_name || detail.junior.guardian_relationship || detail.junior.guardian_phone ? (
              <>
                <div className="sm:col-span-2">
                  <p className="muted flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
                    <ShieldAlert size={12} /> Guardian (sensitive)
                  </p>
                </div>
                <Detail label="Name" value={detail.junior.guardian_name ?? "—"} />
                <Detail label="Relationship" value={detail.junior.guardian_relationship ?? "—"} />
                <Detail label="Phone" value={detail.junior.guardian_phone ?? "—"} />
              </>
            ) : null}
            {detail.junior.emergency_contact_name || detail.junior.emergency_contact_phone ? (
              <>
                <div className="sm:col-span-2">
                  <p className="muted flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
                    <ShieldAlert size={12} /> Emergency contact (sensitive)
                  </p>
                </div>
                <Detail label="Name" value={detail.junior.emergency_contact_name ?? "—"} />
                <Detail label="Phone" value={detail.junior.emergency_contact_phone ?? "—"} />
              </>
            ) : null}
            {!canSensitive && !detail.junior.guardian_name ? (
              <p className="muted flex items-center gap-2 text-xs sm:col-span-2">
                <Info size={13} /> Guardian and emergency contact details are withheld from your role.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {member.group_key === "members" && detail.support ? (
        <Card>
          <CardHeader title="Support member profile" description="How this member supports the choir." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Detail label="Department" value={detail.support.department ?? "—"} />
            <Detail label="Primary responsibility" value={detail.support.primary_responsibility ?? "—"} />
            <Detail label="Availability" value={detail.support.availability ?? "—"} />
            <div className="sm:col-span-2">
              <Detail label="Skills" value={detail.support.skills ?? "—"} />
            </div>
            <div className="sm:col-span-2">
              <Detail label="Experience" value={detail.support.experience ?? "—"} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {detail.contact && (detail.contact.address || detail.contact.city || detail.contact.region || detail.contact.country) ? (
        <Card>
          <CardHeader title="Address" />
          <CardBody>
            <p className="flex items-start gap-2 text-sm">
              <MapPin size={15} className="mt-0.5 opacity-70" aria-hidden />
              <span>
                {[detail.contact.address, detail.contact.city, detail.contact.region, detail.contact.country]
                  .filter((part) => part && part.trim() !== "")
                  .join(", ") || "—"}
              </span>
            </p>
          </CardBody>
        </Card>
      ) : null}

      {member.notes ? (
        <Card>
          <CardHeader title="Notes" />
          <CardBody>
            <p className="text-sm whitespace-pre-wrap">{member.notes}</p>
          </CardBody>
        </Card>
      ) : null}

      {canRemove ? (
        <Card>
          <CardHeader title="Remove this record" />
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm">
              {member.full_name} has been withdrawn. Removing the record erases the member, the sign-in account
              created when the application was approved and the photograph — the application itself and the audit
              trail are kept. This cannot be undone.
            </p>
            <div>
              <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setConfirmRemove(true)}>
                Remove record
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove ${member.full_name}?`}
        description={`${member.member_no} will be erased, together with the sign-in details created at approval. This cannot be undone.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={remove.saving}>
              Cancel
            </Button>
            <Button variant="danger" icon={<Trash2 size={15} />} loading={remove.saving} onClick={onRemove}>
              Remove permanently
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Removing a record is recorded in the audit trail. If {member.full_name} is really coming back, leave the
          record in place instead — a withdrawn record can be reactivated.
        </p>
      </Modal>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit member"
        description={`Update the profile for ${member.full_name}.`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={update.saving}>
              Cancel
            </Button>
            <Button variant="gold" type="submit" form="edit-member-form" loading={update.saving}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-member-form" className="flex flex-col gap-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="edit-name" required error={fields.fullName}>
              <Input
                id="edit-name"
                value={form.fullName}
                invalid={Boolean(fields.fullName)}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                required
              />
            </Field>
            <Field label="Status" htmlFor="edit-status" error={fields.status}>
              <Select id="edit-status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Gender" htmlFor="edit-gender" error={fields.gender}>
              <Input id="edit-gender" value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))} />
            </Field>
            <Field label="Date of birth" htmlFor="edit-dob" error={fields.dateOfBirth}>
              <Input
                id="edit-dob"
                type="date"
                value={form.dateOfBirth}
                onChange={(event) => setForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="Voice section" htmlFor="edit-voice" error={fields.voiceSectionId}>
            <Select
              id="edit-voice"
              value={form.voiceSectionId}
              onChange={(event) => setForm((current) => ({ ...current, voiceSectionId: event.target.value }))}
            >
              <option value="">Not assigned</option>
              {voiceSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="flex flex-col gap-4 border-t hairline pt-4">
            <legend className="text-sm font-semibold">Contact</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="edit-email" error={fields["contact.email"]}>
                <Input
                  id="edit-email"
                  type="email"
                  value={form.email}
                  invalid={Boolean(fields["contact.email"])}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                />
              </Field>
              <Field label="Phone" htmlFor="edit-phone" error={fields["contact.phone"]}>
                <Input id="edit-phone" type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
              </Field>
            </div>
            <Field label="Address" htmlFor="edit-address" error={fields["contact.address"]}>
              <Input id="edit-address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City" htmlFor="edit-city">
                <Input id="edit-city" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} />
              </Field>
              <Field label="Region" htmlFor="edit-region">
                <Input id="edit-region" value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} />
              </Field>
              <Field label="Country" htmlFor="edit-country">
                <Input id="edit-country" value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} />
              </Field>
            </div>
          </fieldset>

          {member.group_key === "senior" ? (
            <fieldset className="flex flex-col gap-4 border-t hairline pt-4">
              <legend className="text-sm font-semibold">Senior details</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Occupation" htmlFor="edit-occupation" error={fields["senior.occupation"]}>
                  <Input id="edit-occupation" value={form.occupation} onChange={(event) => setForm((current) => ({ ...current, occupation: event.target.value }))} />
                </Field>
                <Field label="Workplace" htmlFor="edit-workplace" error={fields["senior.workplace"]}>
                  <Input id="edit-workplace" value={form.workplace} onChange={(event) => setForm((current) => ({ ...current, workplace: event.target.value }))} />
                </Field>
              </div>
              <Field label="Singing experience" htmlFor="edit-experience" error={fields["senior.singing_experience"]}>
                <Textarea
                  id="edit-experience"
                  value={form.singing_experience}
                  onChange={(event) => setForm((current) => ({ ...current, singing_experience: event.target.value }))}
                />
              </Field>
            </fieldset>
          ) : null}

          {member.group_key === "junior" ? (
            <fieldset className="flex flex-col gap-4 border-t hairline pt-4">
              <legend className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldAlert size={14} /> Junior details (sensitive)
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="School" htmlFor="edit-school" error={fields["junior.school"]}>
                  <Input id="edit-school" value={form.school} onChange={(event) => setForm((current) => ({ ...current, school: event.target.value }))} />
                </Field>
                <Field label="Current class" htmlFor="edit-class" error={fields["junior.current_class"]}>
                  <Input id="edit-class" value={form.current_class} onChange={(event) => setForm((current) => ({ ...current, current_class: event.target.value }))} />
                </Field>
              </div>
              {canSensitive ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Guardian name" htmlFor="edit-guardian-name" error={fields["junior.guardian_name"]}>
                      <Input id="edit-guardian-name" value={form.guardian_name} onChange={(event) => setForm((current) => ({ ...current, guardian_name: event.target.value }))} />
                    </Field>
                    <Field label="Guardian relationship" htmlFor="edit-guardian-rel" error={fields["junior.guardian_relationship"]}>
                      <Input id="edit-guardian-rel" value={form.guardian_relationship} onChange={(event) => setForm((current) => ({ ...current, guardian_relationship: event.target.value }))} />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Guardian phone" htmlFor="edit-guardian-phone" error={fields["junior.guardian_phone"]}>
                      <Input id="edit-guardian-phone" type="tel" value={form.guardian_phone} onChange={(event) => setForm((current) => ({ ...current, guardian_phone: event.target.value }))} />
                    </Field>
                    <Field label="Emergency contact name" htmlFor="edit-emergency-name" error={fields["junior.emergency_contact_name"]}>
                      <Input id="edit-emergency-name" value={form.emergency_contact_name} onChange={(event) => setForm((current) => ({ ...current, emergency_contact_name: event.target.value }))} />
                    </Field>
                  </div>
                  <Field label="Emergency contact phone" htmlFor="edit-emergency-phone" error={fields["junior.emergency_contact_phone"]}>
                    <Input id="edit-emergency-phone" type="tel" value={form.emergency_contact_phone} onChange={(event) => setForm((current) => ({ ...current, emergency_contact_phone: event.target.value }))} />
                  </Field>
                </>
              ) : (
                <p className="muted flex items-center gap-2 text-xs">
                  <Info size={13} /> Guardian and emergency contact details require the sensitive access permission for juniors.
                </p>
              )}
            </fieldset>
          ) : null}

          {member.group_key === "members" ? (
            <fieldset className="flex flex-col gap-4 border-t hairline pt-4">
              <legend className="text-sm font-semibold">Support details</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Department" htmlFor="edit-department" error={fields["support.department"]}>
                  <Input id="edit-department" value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
                </Field>
                <Field label="Primary responsibility" htmlFor="edit-responsibility" error={fields["support.primary_responsibility"]}>
                  <Input id="edit-responsibility" value={form.primary_responsibility} onChange={(event) => setForm((current) => ({ ...current, primary_responsibility: event.target.value }))} />
                </Field>
              </div>
              <Field label="Skills" htmlFor="edit-skills" error={fields["support.skills"]}>
                <Textarea id="edit-skills" value={form.skills} onChange={(event) => setForm((current) => ({ ...current, skills: event.target.value }))} />
              </Field>
              <Field label="Experience" htmlFor="edit-support-experience" error={fields["support.experience"]}>
                <Textarea id="edit-support-experience" value={form.experience} onChange={(event) => setForm((current) => ({ ...current, experience: event.target.value }))} />
              </Field>
              <Field label="Availability" htmlFor="edit-availability" error={fields["support.availability"]}>
                <Input id="edit-availability" value={form.availability} onChange={(event) => setForm((current) => ({ ...current, availability: event.target.value }))} />
              </Field>
            </fieldset>
          ) : null}

          <Field label="Notes" htmlFor="edit-notes" error={fields.notes}>
            <Textarea id="edit-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </Field>
        </form>
      </Modal>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
