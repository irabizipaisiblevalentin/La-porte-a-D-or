import { useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react"
import { Link } from "react-router-dom"
import { Camera, Mail, Save, ShieldAlert, UserRound } from "lucide-react"
import { api, ApiError } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusBadge,
  Textarea,
  useToast,
} from "../../components/ui"

/* ------------------------------------------------------------------ *
 * Shapes mirror server/src/services/members.ts (getMemberDetail).
 * The API returns { member: FullMember | null }; a 404 means the
 * signed-in account has no linked member record.
 * ------------------------------------------------------------------ */

interface ProfileMember {
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
}

type Facet = Record<string, unknown> | null

interface FullMember {
  member: ProfileMember
  contact: Facet
  senior: Facet
  junior: Facet
  support: Facet
}

interface MeResponse {
  member: FullMember | null
}

interface FacetField {
  key: string
  label: string
  type?: "text" | "email" | "tel" | "textarea"
  hint?: string
}

const CONTACT_FIELDS: FacetField[] = [
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "country", label: "Country" },
]

const SENIOR_FIELDS: FacetField[] = [
  { key: "occupation", label: "Occupation" },
  { key: "workplace", label: "Workplace" },
  { key: "singing_experience", label: "Singing experience", type: "textarea" },
]

const JUNIOR_FIELDS: FacetField[] = [
  { key: "school", label: "School" },
  { key: "current_class", label: "Current class" },
  { key: "guardian_name", label: "Guardian name" },
  { key: "guardian_relationship", label: "Guardian relationship" },
  { key: "guardian_phone", label: "Guardian phone", type: "tel" },
  { key: "emergency_contact_name", label: "Emergency contact name" },
  { key: "emergency_contact_phone", label: "Emergency contact phone", type: "tel" },
]

/** Fields a member may edit on their own support profile (per PATCH /members/me). */
const SUPPORT_EDITABLE: FacetField[] = [
  { key: "skills", label: "Skills", type: "textarea" },
  { key: "availability", label: "Availability" },
]

/** Extra support fields that are managed by administrators, shown read-only. */
const SUPPORT_READONLY: FacetField[] = [
  { key: "department", label: "Department" },
  { key: "primary_responsibility", label: "Primary responsibility" },
  { key: "experience", label: "Experience" },
]

function has(obj: Facet, key: string): boolean {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key)
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value)
}

function display(value: unknown): ReactNode {
  const value_ = text(value).trim()
  return value_ === "" ? <span className="muted">—</span> : value_
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function facetsForGroup(groupKey: string): { title: string; fields: FacetField[] } | null {
  if (groupKey === "senior") return { title: "Senior profile", fields: SENIOR_FIELDS }
  if (groupKey === "junior") return { title: "Junior profile", fields: JUNIOR_FIELDS }
  if (groupKey === "members") return { title: "Support profile", fields: [...SUPPORT_EDITABLE, ...SUPPORT_READONLY] }
  return null
}

export function ProfilePage() {
  const { data, loading, error, reload } = useQuery<MeResponse>("/members/me")

  const notLinked =
    !loading && (data?.member === null || (error instanceof ApiError && error.status === 404))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Profile"
        description="Your member record as it appears to the choir."
      />

      {loading ? <LoadingBlock label="Loading your member profile…" rows={4} /> : null}

      {!loading && error && !notLinked ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4">
            <ErrorState
              title="Could not load your profile"
              description={error.message || "Your member record could not be loaded. Please try again."}
            />
            <Button variant="gold" onClick={reload}>
              Try again
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {notLinked ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<UserRound size={22} />}
              title="No member profile linked"
              description="Your sign-in account is not connected to a member record. The Chairman can link your account to a member profile from the Members area. Once linked, your details will appear here."
              action={
                <Link to="/app/account" className="btn btn-outline btn-sm">
                  View my account
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {!loading && !error && data?.member ? (
        <ProfileView member={data.member} onReload={reload} />
      ) : null}
    </div>
  )
}

function ProfileView({ member, onReload }: { member: FullMember; onReload: () => void }) {
  const toast = useToast()
  const { can, refresh } = useAuth()
  const record = member.member
  const canEdit = can("member.write")
  const fileInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>(() => buildForm(member))

  const save = useMutation((payload: Record<string, unknown>) =>
    api.patch<MeResponse>("/members/me", payload),
  )

  const photo = useMutation(async (file: File) => {
    const body = new FormData()
    body.append("file", file)
    return api.upload<{ photoPath: string }>(`/members/${record.id}/photo`, body)
  })

  const groupFacet = facetsForGroup(record.group_key)

  function openEditor() {
    setForm(buildForm(member))
    save.reset()
    setEditing(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const payload = buildPayload(member, form)
    const result = await save.run(payload)
    if (result === undefined) return
    toast.success("Your profile has been updated.")
    setEditing(false)
    onReload()
  }

  async function onPhotoChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const result = await photo.run(file)
    if (result === undefined) {
      toast.error(photo.error?.message ?? "The photograph could not be uploaded.")
      return
    }
    toast.success("Your photograph has been updated.")
    onReload()
    await refresh()
  }

  const displayErrors = save.error?.fields ?? {}

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title="Photograph"
            description="Shown on your profile and in the member directory."
            actions={
              canEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Camera size={15} />}
                  loading={photo.saving}
                  onClick={() => fileInput.current?.click()}
                >
                  {record.photo_path ? "Replace" : "Upload"}
                </Button>
              ) : undefined
            }
          />
          <CardBody className="flex flex-col items-center gap-4">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPhotoChosen}
              aria-label="Choose a profile photograph"
            />
            {record.photo_path ? (
              <img
                src={record.photo_path}
                alt={`Photograph of ${record.full_name}`}
                className="h-32 w-32 rounded-2xl object-cover"
              />
            ) : (
              <div
                className="flex h-32 w-32 items-center justify-center rounded-2xl font-display text-3xl font-semibold"
                style={{
                  background: "color-mix(in srgb, var(--color-gold-400) 14%, transparent)",
                  color: "var(--color-gold-600)",
                }}
                aria-hidden
              >
                {initials(record.full_name) || "?"}
              </div>
            )}
            <div className="text-center">
              <p className="font-display text-lg font-semibold">{record.full_name}</p>
              <p className="muted text-sm">{record.member_no}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                <StatusBadge status={record.status} />
                <Badge tone="neutral">{record.group_name}</Badge>
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <Button variant="gold" icon={<Save size={15} />} onClick={openEditor} disabled={!canEdit}>
              Edit profile
            </Button>
          </CardFooter>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Member details" description="Held by the choir office." />
          <CardBody className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
            <DetailRow label="Member number" value={record.member_no} />
            <DetailRow label="Group" value={record.group_name} />
            <DetailRow label="Voice section" value={record.voice_section_name ?? "—"} />
            <DetailRow label="Status" value={<StatusBadge status={record.status} />} />
            <DetailRow label="Gender" value={display(record.gender)} />
            <DetailRow label="Date of birth" value={formatDate(record.date_of_birth)} />
            <DetailRow label="Joined" value={formatDate(record.joined_at)} />
            <DetailRow label="Account email" value={display(record.email)} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Contact details" description="Your phone, email and address." />
        <CardBody className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
          {CONTACT_FIELDS.map((field) => (
            <DetailRow key={field.key} label={field.label} value={display(member.contact?.[field.key])} />
          ))}
        </CardBody>
      </Card>

      {groupFacet ? (
        <Card>
          <CardHeader
            title={groupFacet.title}
            description={
              record.group_key === "members"
                ? "Skills and availability are editable by you; other fields are managed by administrators."
                : "Group-specific information for your membership."
            }
          />
          <CardBody className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
            {groupFacet.fields.map((field) => {
              const facet =
                record.group_key === "senior"
                  ? member.senior
                  : record.group_key === "junior"
                    ? member.junior
                    : member.support
              // Junior guardian/emergency fields are only rendered when the API returns them.
              if (record.group_key === "junior" && !has(facet, field.key)) return null
              return <DetailRow key={field.key} label={field.label} value={display(facet?.[field.key])} />
            })}
          </CardBody>
        </Card>
      ) : null}

      {record.notes ? (
        <Card>
          <CardHeader title="Notes" description="Office notes on your record." />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm">{record.notes}</p>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit my profile"
        description="Update the details you are permitted to change."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={save.saving}>
              Cancel
            </Button>
            <Button
              variant="gold"
              type="submit"
              form="profile-form"
              loading={save.saving}
              icon={<Save size={15} />}
            >
              Save changes
            </Button>
          </>
        }
      >
        <form id="profile-form" className="flex flex-col gap-6" onSubmit={submit}>
          {save.error && !displayErrors._form ? (
            <div className="rounded-xl border border-[#b4544a]/40 bg-[#b4544a]/10 px-3 py-2 text-sm text-[#b4544a]">
              {save.error.message}
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Mail size={15} /> Contact
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {CONTACT_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  htmlFor={`contact-${field.key}`}
                  error={displayErrors[`contact.${field.key}`]}
                >
                  <Input
                    id={`contact-${field.key}`}
                    type={field.type ?? "text"}
                    value={form[`contact.${field.key}`] ?? ""}
                    onChange={(event) => setFormValue(setForm, `contact.${field.key}`, event.target.value)}
                    invalid={Boolean(displayErrors[`contact.${field.key}`])}
                  />
                </Field>
              ))}
            </div>
          </fieldset>

          {record.group_key === "senior" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold">Senior profile</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {SENIOR_FIELDS.map((field) => (
                  <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
                    <Field
                      label={field.label}
                      htmlFor={`senior-${field.key}`}
                      error={displayErrors[`senior.${field.key}`]}
                    >
                      {field.type === "textarea" ? (
                        <Textarea
                          id={`senior-${field.key}`}
                          value={form[`senior.${field.key}`] ?? ""}
                          onChange={(event) => setFormValue(setForm, `senior.${field.key}`, event.target.value)}
                          invalid={Boolean(displayErrors[`senior.${field.key}`])}
                        />
                      ) : (
                        <Input
                          id={`senior-${field.key}`}
                          value={form[`senior.${field.key}`] ?? ""}
                          onChange={(event) => setFormValue(setForm, `senior.${field.key}`, event.target.value)}
                          invalid={Boolean(displayErrors[`senior.${field.key}`])}
                        />
                      )}
                    </Field>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}

          {record.group_key === "junior" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold">Junior profile</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {JUNIOR_FIELDS.filter((field) => has(member.junior, field.key)).map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    htmlFor={`junior-${field.key}`}
                    error={displayErrors[`junior.${field.key}`]}
                  >
                    <Input
                      id={`junior-${field.key}`}
                      type={field.type ?? "text"}
                      value={form[`junior.${field.key}`] ?? ""}
                      onChange={(event) => setFormValue(setForm, `junior.${field.key}`, event.target.value)}
                      invalid={Boolean(displayErrors[`junior.${field.key}`])}
                    />
                  </Field>
                ))}
              </div>
            </fieldset>
          ) : null}

          {record.group_key === "members" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold">Support profile</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {SUPPORT_EDITABLE.map((field) => (
                  <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
                    <Field
                      label={field.label}
                      htmlFor={`support-${field.key}`}
                      error={displayErrors[`support.${field.key}`]}
                    >
                      {field.type === "textarea" ? (
                        <Textarea
                          id={`support-${field.key}`}
                          value={form[`support.${field.key}`] ?? ""}
                          onChange={(event) => setFormValue(setForm, `support.${field.key}`, event.target.value)}
                          invalid={Boolean(displayErrors[`support.${field.key}`])}
                        />
                      ) : (
                        <Input
                          id={`support-${field.key}`}
                          value={form[`support.${field.key}`] ?? ""}
                          onChange={(event) => setFormValue(setForm, `support.${field.key}`, event.target.value)}
                          invalid={Boolean(displayErrors[`support.${field.key}`])}
                        />
                      )}
                    </Field>
                  </div>
                ))}
              </div>
              <p className="muted flex items-center gap-1.5 text-xs">
                <ShieldAlert size={13} /> Department, responsibility and experience are managed by
                administrators.
              </p>
            </fieldset>
          ) : null}
        </form>
      </Modal>
    </>
  )
}

function setFormValue(
  setForm: Dispatch<SetStateAction<Record<string, string>>>,
  key: string,
  value: string,
) {
  setForm((current) => ({ ...current, [key]: value }))
}

function buildForm(member: FullMember): Record<string, string> {
  const form: Record<string, string> = {}
  for (const field of CONTACT_FIELDS) {
    form[`contact.${field.key}`] = text(member.contact?.[field.key])
  }
  if (member.member.group_key === "senior") {
    for (const field of SENIOR_FIELDS) form[`senior.${field.key}`] = text(member.senior?.[field.key])
  }
  if (member.member.group_key === "junior") {
    for (const field of JUNIOR_FIELDS) {
      if (has(member.junior, field.key)) form[`junior.${field.key}`] = text(member.junior?.[field.key])
    }
  }
  if (member.member.group_key === "members") {
    for (const field of SUPPORT_EDITABLE) form[`support.${field.key}`] = text(member.support?.[field.key])
  }
  return form
}

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

function buildPayload(member: FullMember, form: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    contact: {
      phone: clean(form["contact.phone"]),
      email: clean(form["contact.email"]),
      address: clean(form["contact.address"]),
      city: clean(form["contact.city"]),
      region: clean(form["contact.region"]),
      country: clean(form["contact.country"]),
    },
  }
  if (member.member.group_key === "senior") {
    payload.senior = {
      occupation: clean(form["senior.occupation"]),
      workplace: clean(form["senior.workplace"]),
      singing_experience: clean(form["senior.singing_experience"]),
    }
  }
  if (member.member.group_key === "junior") {
    const junior: Record<string, string | null> = {}
    for (const field of JUNIOR_FIELDS) {
      if (has(member.junior, field.key)) junior[field.key] = clean(form[`junior.${field.key}`])
    }
    payload.junior = junior
  }
  if (member.member.group_key === "members") {
    payload.support = {
      skills: clean(form["support.skills"]),
      availability: clean(form["support.availability"]),
    }
  }
  return payload
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b hairline py-2.5">
      <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
