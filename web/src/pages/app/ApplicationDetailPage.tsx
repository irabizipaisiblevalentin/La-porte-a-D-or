import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react"
import { Link, useParams } from "react-router-dom"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Info,
  UserPlus,
  X,
} from "lucide-react"
import { api } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  humanize,
  useToast,
} from "../../components/ui"

/** True when an answer is a single clickable URL (e.g. an uploaded photo link). */
function isLink(value: string | null): boolean {
  if (!value) return false
  const trimmed = value.trim()
  return /^https?:\/\/\S+$/i.test(trimmed) && !/\s/.test(trimmed)
}

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

interface ApplicationAnswer {
  id: string
  questionKey: string
  questionLabel: string
  answer: string | null
}

interface ApplicationReview {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  fromStatus: string | null
  toStatus: string | null
  fromGroupId: string | null
  toGroupId: string | null
  notes: string | null
  createdAt: string
}

interface UploadedFile {
  id: string
  bucket?: string
  path?: string
  url?: string
  originalName?: string | null
  mimeType?: string | null
  size?: number | null
  entityType?: string | null
  entityId?: string | null
  createdAt?: string
}

interface ApplicationDetail {
  id: string
  externalId: string | null
  source: string
  submittedAt: string
  fullName: string
  email: string | null
  phone: string | null
  requestedGroupId: string | null
  requestedGroupName: string | null
  assignedGroupId: string | null
  assignedGroupName: string | null
  status: string
  memberId: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  decisionNote: string | null
  createdAt: string
  updatedAt: string
  answers: ApplicationAnswer[]
  reviews: ApplicationReview[]
  documents?: UploadedFile[]
}

interface ApprovedMember {
  member: {
    id: string
    member_no: string
    full_name: string
    group_name?: string
  }
}

interface DecisionResponse {
  application?: ApplicationDetail
  member?: ApprovedMember | null
  invitation?: { url: string; expiresAt?: string } | null
  duplicate?: boolean
}

const REVIEW_STATUS_OPTIONS = [
  { value: "under_review", label: "Under review" },
  { value: "more_info_required", label: "More information required" },
  { value: "pending", label: "Pending" },
]

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatFileSize(size: number | null | undefined): string {
  if (typeof size !== "number" || size <= 0) return ""
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function documentUrl(file: UploadedFile): string {
  if (file.url) return file.url
  return `/api/files/${file.id}`
}

export function ApplicationDetailPage() {
  const { id = "" } = useParams()
  const toast = useToast()
  const { can } = useAuth()

  const meta = useQuery<MembersMeta>("/members/meta")
  const { data, loading, error, reload } = useQuery<{ application: ApplicationDetail }>(`/applications/${id}`)

  const [reviewStatus, setReviewStatus] = useState("")
  const [reviewGroupId, setReviewGroupId] = useState("")
  const [reviewNote, setReviewNote] = useState("")
  const [decisionNote, setDecisionNote] = useState("")
  const [decisionGroupId, setDecisionGroupId] = useState("")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [sessionFiles, setSessionFiles] = useState<UploadedFile[]>([])
  const [decisionResult, setDecisionResult] = useState<DecisionResponse | null>(null)
  const [copied, setCopied] = useState(false)

  const review = useMutation((body: { status?: string; assignedGroupId?: string; note?: string }) =>
    api.patch<{ application: ApplicationDetail }>(`/applications/${id}`, body),
  )
  const decision = useMutation((body: { decision: "approve" | "reject"; note?: string; assignedGroupId?: string }) =>
    api.post<DecisionResponse>(`/applications/${id}/decision`, body),
  )
  const upload = useMutation((file: File) => {
    const form = new FormData()
    form.append("file", file)
    return api.upload<{ file: UploadedFile }>(`/applications/${id}/documents`, form)
  })

  useEffect(() => {
    if (!review.error) return
    setFields(review.error.fields ?? {})
    toast.error(review.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.error])

  useEffect(() => {
    if (!decision.error) return
    setFields(decision.error.fields ?? {})
    toast.error(decision.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision.error])

  useEffect(() => {
    if (upload.error) toast.error(upload.error.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.error])

  const application = data?.application ?? null
  const groups = meta.data?.groups ?? []

  const documents = useMemo<UploadedFile[]>(() => {
    const combined = [...(application?.documents ?? []), ...sessionFiles]
    const seen = new Set<string>()
    return combined.filter((file) => {
      if (seen.has(file.id)) return false
      seen.add(file.id)
      return true
    })
  }, [application?.documents, sessionFiles])

  async function submitReview(event: FormEvent) {
    event.preventDefault()
    if (!application) return
    setFields({})
    const body: { status?: string; assignedGroupId?: string; note?: string } = {}
    if (reviewStatus) body.status = reviewStatus
    if (reviewGroupId && reviewGroupId !== application.assignedGroupId) body.assignedGroupId = reviewGroupId
    if (reviewNote.trim()) body.note = reviewNote.trim()
    if (!body.status && !body.assignedGroupId && !body.note) {
      toast.info("Choose a status, assign a group, or add a note to record a review.")
      return
    }
    const result = await review.run(body)
    if (!result) return
    toast.success("Review recorded.")
    setReviewStatus("")
    setReviewGroupId("")
    setReviewNote("")
    reload()
  }

  async function submitDecision(kind: "approve" | "reject") {
    setFields({})
    const body: { decision: "approve" | "reject"; note?: string; assignedGroupId?: string } = { decision: kind }
    if (decisionNote.trim()) body.note = decisionNote.trim()
    if (kind === "approve" && decisionGroupId) body.assignedGroupId = decisionGroupId
    const result = await decision.run(body)
    if (!result) return
    setDecisionResult(result)
    toast.success(kind === "approve" ? "Application approved." : "Application rejected.")
    reload()
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const input = event.target
    const result = await upload.run(file)
    input.value = ""
    if (!result) return
    setSessionFiles((current) => [...current, result.file])
    toast.success("Document uploaded.")
  }

  async function copyInvitation(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Invitation link copied.")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy automatically. Select the link and copy it manually.")
    }
  }

  const breadcrumbs = [
    { label: "Dashboard", to: "/app" },
    { label: "Applications", to: "/app/applications" },
    { label: application?.fullName ?? "Application" },
  ]

  if (loading && !application) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Application" breadcrumbs={breadcrumbs} />
        <LoadingBlock label="Loading application…" rows={4} />
      </div>
    )
  }

  if (error && !application) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Application" breadcrumbs={breadcrumbs} />
        <Card>
          <CardBody>
            <ErrorState
              title="Could not load this application"
              description={error.message}
            />
            <div className="flex justify-center pt-4">
              <Link to="/app/applications" className="btn btn-outline">
                <ArrowLeft size={16} /> Back to applications
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!application) return null

  const canReview = can("application.review")
  const canDecide = can("application.decide")
  const decided = application.status === "approved" || application.status === "rejected"
  const invitation = decisionResult?.invitation ?? null
  const invitationUrl = invitation ? `${window.location.origin}${invitation.url}` : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={application.fullName}
        description="Application details, review history and decision."
        breadcrumbs={breadcrumbs}
        actions={
          <Link to="/app/applications" className="btn btn-outline btn-sm">
            <ArrowLeft size={15} /> All applications
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Applicant"
            actions={<StatusBadge status={application.status} />}
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Detail label="Full name" value={application.fullName} />
            <Detail label="Email" value={application.email ?? "—"} />
            <Detail label="Phone" value={application.phone ?? "—"} />
            <Detail label="Source" value={humanize(application.source)} />
            <Detail label="Requested group" value={application.requestedGroupName ?? "—"} />
            <Detail label="Assigned group" value={application.assignedGroupName ?? "Not assigned"} />
            <Detail label="Submitted" value={formatDateTime(application.submittedAt)} />
            <Detail label="Last updated" value={formatDateTime(application.updatedAt)} />
            {application.memberId ? (
              <div className="flex flex-col gap-1">
                <span className="muted text-xs font-medium uppercase tracking-wide">Member record</span>
                <Link to={`/app/members/${application.memberId}`} className="link inline-flex items-center gap-1 text-sm">
                  View member <ExternalLink size={13} />
                </Link>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Answers" description="Responses supplied with the application." />
          <CardBody className="flex flex-col gap-3">
            {application.answers.length > 0 ? (
              application.answers.map((answer) => (
                <div key={answer.id} className="flex flex-col gap-0.5 border-b hairline pb-3 last:border-0 last:pb-0">
                  <span className="muted text-xs font-medium uppercase tracking-wide">{answer.questionLabel}</span>
                  {isLink(answer.answer) ? (
                    <a
                      href={answer.answer ?? undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm break-all underline underline-offset-2"
                    >
                      {answer.answer}
                    </a>
                  ) : (
                    <span className="text-sm whitespace-pre-wrap">{answer.answer ?? "—"}</span>
                  )}
                </div>
              ))
            ) : (
              <p className="muted text-sm">No answers were recorded for this application.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {decisionResult?.member ? (
        <Card>
          <CardHeader
            title="Approval result"
            description="Approving created exactly one member record and one account invitation."
          />
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="positive">Member created</Badge>
              <span>{decisionResult.member.member.full_name}</span>
              <span className="muted">· {decisionResult.member.member.member_no}</span>
            </div>
            <Link to={`/app/members/${decisionResult.member.member.id}`} className="link inline-flex items-center gap-1 text-sm">
              Open member record <ExternalLink size={13} />
            </Link>

            {invitationUrl ? (
              <div className="flex flex-col gap-3 rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Info size={16} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
                  <p className="text-sm">
                    An account invitation was created.{" "}
                    <strong className="font-semibold">
                      No email was sent automatically
                    </strong>{" "}
                    — email delivery may not be configured. Share this link with the applicant directly so they can set a password.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input readOnly value={invitationUrl} aria-label="Invitation link" onFocus={(event) => event.target.select()} />
                  <Button
                    variant="outline"
                    icon={copied ? <Check size={16} /> : <Copy size={16} />}
                    onClick={() => copyInvitation(invitationUrl)}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>
                {invitation?.expiresAt ? (
                  <p className="muted text-xs">This link expires {formatDateTime(invitation.expiresAt)}.</p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm">
                <Info size={16} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
                <span>
                  This application was already approved, so no new invitation was created. Ask an administrator to
                  send a password reset if the applicant needs access.
                </span>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Documents" description="Private attachments are streamed after an access check." />
        <CardBody className="flex flex-col gap-4">
          {documents.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {documents.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 border-b hairline pb-2 last:border-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText size={16} className="shrink-0 opacity-70" aria-hidden />
                    <span className="truncate text-sm">{file.originalName ?? "Document"}</span>
                    {file.size ? <span className="muted text-xs">{formatFileSize(file.size)}</span> : null}
                  </span>
                  <a href={documentUrl(file)} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                    <Download size={14} /> Download
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">No documents have been attached to this application.</p>
          )}

          {canReview ? (
            <div className="flex flex-col gap-2 border-t hairline pt-4">
              <label className="text-sm font-medium" htmlFor="application-document">
                Attach a document
              </label>
              <input
                id="application-document"
                type="file"
                className="field"
                onChange={onUpload}
                disabled={upload.saving}
              />
              {upload.saving ? <p className="muted text-xs">Uploading…</p> : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {canReview ? (
        <Card>
          <CardHeader
            title="Review"
            description="Move the application through review states, assign a group, or leave a note."
          />
          <CardBody>
            <form className="flex flex-col gap-4" onSubmit={submitReview}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status" htmlFor="review-status">
                  <Select id="review-status" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
                    <option value="">No change</option>
                    {REVIEW_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Assigned group" htmlFor="review-group" error={fields.assignedGroupId}>
                  <Select
                    id="review-group"
                    value={reviewGroupId}
                    invalid={Boolean(fields.assignedGroupId)}
                    onChange={(event) => setReviewGroupId(event.target.value)}
                  >
                    <option value="">No change</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Note" htmlFor="review-note" hint="Notes are recorded in the review history.">
                <Textarea
                  id="review-note"
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="outline" loading={review.saving} icon={<ClipboardCheck size={16} />}>
                  Record review
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canDecide ? (
        <Card>
          <CardHeader
            title="Decision"
            description="Approving creates one member and an invitation. Rejecting preserves the application."
          />
          <CardBody className="flex flex-col gap-4">
            {decided ? (
              <div className="flex items-start gap-2 rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm">
                <Info size={16} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
                <span>This application has already been {application.status}. No further decision is required.</span>
              </div>
            ) : null}
            <Field
              label="Group for approval"
              htmlFor="decision-group"
              hint="Defaults to the requested or already-assigned group."
              error={fields.assignedGroupId}
            >
              <Select
                id="decision-group"
                value={decisionGroupId}
                invalid={Boolean(fields.assignedGroupId)}
                onChange={(event) => setDecisionGroupId(event.target.value)}
              >
                <option value="">Use current group</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Decision note" htmlFor="decision-note" error={fields.note}>
              <Textarea
                id="decision-note"
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
              />
            </Field>
            {fields.email ? (
              <p className="flex items-center gap-2 text-sm text-[#b4544a]">
                <AlertTriangle size={15} /> {fields.email}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="danger"
                loading={decision.saving}
                icon={<X size={16} />}
                onClick={() => submitDecision("reject")}
                disabled={application.status === "rejected"}
              >
                Reject
              </Button>
              <Button
                variant="gold"
                loading={decision.saving}
                icon={<UserPlus size={16} />}
                onClick={() => submitDecision("approve")}
                disabled={application.status === "approved"}
              >
                Approve
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Review history" description="Every change recorded against this application." />
        <CardBody className="flex flex-col gap-3">
          {application.reviews.length > 0 ? (
            application.reviews.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-1 border-b hairline pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{humanize(entry.action)}</Badge>
                  {entry.fromStatus ? <StatusBadge status={entry.fromStatus} /> : null}
                  {entry.toStatus ? <StatusBadge status={entry.toStatus} /> : null}
                  <span className="muted text-xs">{formatDateTime(entry.createdAt)}</span>
                </div>
                <span className="text-sm">
                  {entry.actorName ?? "System"}
                  {entry.notes ? <span className="muted"> — {entry.notes}</span> : null}
                </span>
              </div>
            ))
          ) : (
            <p className="muted text-sm">No reviews have been recorded yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
