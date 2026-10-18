import { useEffect, useRef, useState, type RefObject } from "react"
import { ImagePlus, Trash2, Upload } from "lucide-react"
import { api } from "../../api/client"
import { useMutation, useQuery } from "../../api/hooks"
import { useAuth } from "../../auth/AuthProvider"
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  useTabState,
  useToast,
} from "../../components/ui"

// --- Response shapes (mirroring server/src/routes/settings.ts, uploads.ts) --

interface SettingItem {
  key: string
  label: string
  description: string
  value: string
}

interface IntegrationItem {
  key: string
  label: string
  hint: string
  isSecret: boolean
  status: string
  valuePlain: string | null
  updatedAt: string
}

interface IntegrationRun {
  id: string
  integration: string
  trigger: string
  status: string
  summary: string | null
  detail: unknown
  startedAt: string
  finishedAt: string | null
}

interface SettingsResponse {
  settings: SettingItem[]
  integrations: IntegrationItem[]
  runs?: IntegrationRun[]
}

interface UploadFile {
  id: string
  bucket: string
  path: string
  url: string
  originalName: string
  mimeType: string | null
  size: number | null
  entityType: string | null
  entityId: string | null
  createdAt: string
}

interface FilesResponse {
  files: UploadFile[]
}

/** Settings that are constrained to a fixed set of values. */
const SETTING_OPTIONS: Record<string, string[]> = {
  "attendance.late_policy": ["counts_as_present", "counts_as_absent"],
  "attendance.excused_policy": ["excluded_from_denominator", "included"],
  "public.gallery_enabled": ["true", "false"],
}

const TABS = [
  { key: "general", label: "General" },
  { key: "integrations", label: "Integrations" },
  { key: "assets", label: "Brand & gallery" },
]

export function SettingsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const canWrite = can("settings.write")
  const { active, setActive } = useTabState("general")

  const settings = useQuery<SettingsResponse>("/settings")
  const uploads = useQuery<FilesResponse>("/uploads")

  const [generalValues, setGeneralValues] = useState<Record<string, string>>({})
  const [integrationInputs, setIntegrationInputs] = useState<Record<string, string>>({})
  const [generalReady, setGeneralReady] = useState(false)
  const [integrationsReady, setIntegrationsReady] = useState(false)

  useEffect(() => {
    if (settings.data && !generalReady) {
      const map: Record<string, string> = {}
      for (const item of settings.data.settings) map[item.key] = item.value
      setGeneralValues(map)
      setGeneralReady(true)
    }
  }, [settings.data, generalReady])

  useEffect(() => {
    if (settings.data && !integrationsReady) {
      const map: Record<string, string> = {}
      for (const item of settings.data.integrations) {
        if (!item.isSecret) map[item.key] = item.valuePlain ?? ""
      }
      setIntegrationInputs(map)
      setIntegrationsReady(true)
    }
  }, [settings.data, integrationsReady])

  const saveGeneral = useMutation((values: Record<string, string>) =>
    api.patch<{ settings: SettingItem[] }>("/settings", { settings: values }),
  )
  const saveIntegrations = useMutation((values: Record<string, string | null>) =>
    api.patch<{ integrations: IntegrationItem[] }>("/settings/integrations", { values }),
  )

  const logoUpload = useMutation((form: FormData) => api.upload<{ file: UploadFile }>("/uploads/brand/logo", form))
  const galleryUpload = useMutation((form: FormData) => api.upload<{ file: UploadFile }>("/uploads/gallery", form))
  const deleteUpload = useMutation((id: string) => api.del<{ ok: boolean }>(`/uploads/${id}`))

  const logoInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [deleteTarget, setDeleteTarget] = useState<UploadFile | null>(null)

  async function submitGeneral() {
    const result = await saveGeneral.run(generalValues)
    if (result) {
      toast.success("Application settings saved.")
      settings.reload()
    }
  }

  function buildIntegrationPayload(): Record<string, string | null> {
    const payload: Record<string, string | null> = {}
    for (const item of settings.data?.integrations ?? []) {
      const typed = integrationInputs[item.key] ?? ""
      if (item.isSecret) {
        if (typed.trim()) payload[item.key] = typed
      } else {
        payload[item.key] = typed.trim() ? typed : null
      }
    }
    return payload
  }

  async function submitIntegrations() {
    const payload = buildIntegrationPayload()
    if (Object.keys(payload).length === 0) {
      toast.info("No integration changes to save.")
      return
    }
    const result = await saveIntegrations.run(payload)
    if (result) {
      toast.success("Integration settings saved.")
      settings.reload()
    }
  }

  async function clearSecret(key: string) {
    const result = await saveIntegrations.run({ [key]: null })
    if (result) {
      toast.success("Stored value cleared.")
      settings.reload()
    }
  }

  async function uploadFile(input: HTMLInputElement | null, kind: "logo" | "gallery") {
    const file = input?.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append("file", file)
    const mutation = kind === "logo" ? logoUpload : galleryUpload
    const result = await mutation.run(form)
    if (input) input.value = ""
    if (result) {
      toast.success(kind === "logo" ? "Logo uploaded." : "Gallery image uploaded.")
      uploads.reload()
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const result = await deleteUpload.run(deleteTarget.id)
    if (result) {
      toast.success("File removed.")
      setDeleteTarget(null)
      uploads.reload()
    }
  }

  const files = uploads.data?.files ?? []
  const logos = files.filter((file) => file.entityType === "brand")
  const gallery = files.filter((file) => file.entityType === "gallery")

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Application configuration, integrations and public brand assets."
      />

      <Tabs tabs={TABS} active={active} onChange={setActive} />

      {active === "general" ? (
        <GeneralTab
          settings={settings}
          values={generalValues}
          onChange={(key, value) => setGeneralValues((current) => ({ ...current, [key]: value }))}
          canWrite={canWrite}
          saving={saveGeneral.saving}
          error={saveGeneral.error?.message ?? null}
          onSave={submitGeneral}
        />
      ) : null}

      {active === "integrations" ? (
        <IntegrationsTab
          settings={settings}
          inputs={integrationInputs}
          onChange={(key, value) => setIntegrationInputs((current) => ({ ...current, [key]: value }))}
          canWrite={canWrite}
          saving={saveIntegrations.saving}
          error={saveIntegrations.error?.message ?? null}
          onSave={submitIntegrations}
          onClearSecret={clearSecret}
        />
      ) : null}

      {active === "assets" ? (
        <AssetsTab
          loading={uploads.loading && !uploads.data}
          error={uploads.error?.message ?? null}
          logos={logos}
          gallery={gallery}
          canWrite={canWrite}
          uploading={logoUpload.saving || galleryUpload.saving}
          logoInputRef={logoInputRef}
          galleryInputRef={galleryInputRef}
          onPickLogo={() => logoInputRef.current?.click()}
          onPickGallery={() => galleryInputRef.current?.click()}
          onLogoChange={() => uploadFile(logoInputRef.current, "logo")}
          onGalleryChange={() => uploadFile(galleryInputRef.current, "gallery")}
          onDelete={setDeleteTarget}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this image?"
        message={deleteTarget ? `“${deleteTarget.originalName}” will be permanently deleted.` : ""}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteUpload.saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// --- General tab ------------------------------------------------------------

function GeneralTab({
  settings,
  values,
  onChange,
  canWrite,
  saving,
  error,
  onSave,
}: {
  settings: ReturnType<typeof useQuery<SettingsResponse>>
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  canWrite: boolean
  saving: boolean
  error: string | null
  onSave: () => void
}) {
  if (settings.loading && !settings.data) return <LoadingBlock label="Loading settings…" rows={4} />
  if (settings.error) {
    return (
      <Card>
        <CardBody>
          <p className="muted text-sm">Could not load settings: {settings.error.message}</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Application settings"
        description="These values alter how the platform behaves for everyone."
      />
      <CardBody className="flex flex-col gap-5">
        {(settings.data?.settings ?? []).map((item) => {
          const options = SETTING_OPTIONS[item.key]
          const value = values[item.key] ?? ""
          return (
            <Field key={item.key} label={item.label} hint={item.description} htmlFor={`setting-${item.key}`}>
              {options ? (
                <Select
                  id={`setting-${item.key}`}
                  value={value}
                  disabled={!canWrite}
                  onChange={(event) => onChange(item.key, event.target.value)}
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              ) : item.key === "public.about" || item.key === "chairman.founders" ? (
                <Textarea
                  id={`setting-${item.key}`}
                  value={value}
                  disabled={!canWrite}
                  onChange={(event) => onChange(item.key, event.target.value)}
                />
              ) : (
                <Input
                  id={`setting-${item.key}`}
                  value={value}
                  disabled={!canWrite}
                  onChange={(event) => onChange(item.key, event.target.value)}
                />
              )}
            </Field>
          )
        })}

        {error ? <p className="text-sm text-[#b4544a]">{error}</p> : null}

        <div className="flex justify-end">
          <Button variant="gold" onClick={onSave} loading={saving} disabled={!canWrite} icon={<Upload size={16} />}>
            Save settings
          </Button>
        </div>
        {!canWrite ? <p className="muted text-xs">You have read-only access to settings.</p> : null}
      </CardBody>
    </Card>
  )
}

// --- Integrations tab -------------------------------------------------------

function IntegrationsTab({
  settings,
  inputs,
  onChange,
  canWrite,
  saving,
  error,
  onSave,
  onClearSecret,
}: {
  settings: ReturnType<typeof useQuery<SettingsResponse>>
  inputs: Record<string, string>
  onChange: (key: string, value: string) => void
  canWrite: boolean
  saving: boolean
  error: string | null
  onSave: () => void
  onClearSecret: (key: string) => void
}) {
  if (settings.loading && !settings.data) return <LoadingBlock label="Loading integrations…" rows={4} />
  if (settings.error) {
    return (
      <Card>
        <CardBody>
          <p className="muted text-sm">Could not load integrations: {settings.error.message}</p>
        </CardBody>
      </Card>
    )
  }

  const runs = settings.data?.runs ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm">
        <p className="font-medium">Integrations are awaiting setup until configured</p>
        <p className="muted mt-0.5">
          Each integration reports its true status below. Secrets are stored encrypted on the server and are never sent
          back to the browser. Email delivery stays off until an SMTP host is configured; until then notifications appear
          in-app only.
        </p>
      </div>

      <Card>
        <CardHeader title="Integration credentials" description="Update a value to replace what is stored. Blank secrets are left unchanged." />
        <CardBody className="flex flex-col gap-5">
          {(settings.data?.integrations ?? []).map((item) => {
            const isSet = item.status !== "not_configured"
            return (
              <div key={item.key} className="flex flex-col gap-2 border-b hairline pb-5 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{item.label}</span>
                  <StatusBadge status={item.status} />
                  {item.isSecret ? (
                    <Badge tone={isSet ? "positive" : "neutral"}>{isSet ? "Set" : "Not set"}</Badge>
                  ) : null}
                </div>
                {item.hint ? <p className="muted text-xs">{item.hint}</p> : null}

                <Field
                  label={item.isSecret ? "Replace value" : "Value"}
                  htmlFor={`integration-${item.key}`}
                  hint={item.isSecret ? "Enter a new value to replace the stored secret. The current secret is never shown." : undefined}
                >
                  <Input
                    id={`integration-${item.key}`}
                    type={item.isSecret ? "password" : "text"}
                    autoComplete="off"
                    placeholder={item.isSecret ? (isSet ? "•••••••• (stored)" : "Not set") : ""}
                    value={inputs[item.key] ?? ""}
                    disabled={!canWrite}
                    onChange={(event) => onChange(item.key, event.target.value)}
                  />
                </Field>

                {item.isSecret && isSet && canWrite ? (
                  <div>
                    <Button size="sm" variant="danger" onClick={() => onClearSecret(item.key)}>
                      Clear stored value
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}

          {error ? <p className="text-sm text-[#b4544a]">{error}</p> : null}

          <div className="flex justify-end">
            <Button variant="gold" onClick={onSave} loading={saving} disabled={!canWrite}>
              Save integrations
            </Button>
          </div>
          {!canWrite ? <p className="muted text-xs">You have read-only access to settings.</p> : null}
        </CardBody>
      </Card>

      {runs.length > 0 ? (
        <Card>
          <CardHeader title="Recent integration runs" description="The last 20 recorded attempts." />
          <CardBody className="flex flex-col gap-2">
            {runs.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-b hairline py-2 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{run.integration}</p>
                  {run.summary ? <p className="muted truncate text-xs">{run.summary}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{run.trigger}</Badge>
                  <StatusBadge status={run.status} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

// --- Brand & gallery tab ----------------------------------------------------

function AssetsTab({
  loading,
  error,
  logos,
  gallery,
  canWrite,
  uploading,
  logoInputRef,
  galleryInputRef,
  onPickLogo,
  onPickGallery,
  onLogoChange,
  onGalleryChange,
  onDelete,
}: {
  loading: boolean
  error: string | null
  logos: UploadFile[]
  gallery: UploadFile[]
  canWrite: boolean
  uploading: boolean
  logoInputRef: RefObject<HTMLInputElement | null>
  galleryInputRef: RefObject<HTMLInputElement | null>
  onPickLogo: () => void
  onPickGallery: () => void
  onLogoChange: () => void
  onGalleryChange: () => void
  onDelete: (file: UploadFile) => void
}) {
  if (loading) return <LoadingBlock label="Loading uploads…" rows={3} />
  if (error) {
    return (
      <Card>
        <CardBody>
          <p className="muted text-sm">Could not load uploads: {error}</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={onLogoChange} />
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onGalleryChange} />

      <Card>
        <CardHeader
          title="Choir logo"
          description="Shown in the header and on the public landing page."
          actions={
            canWrite ? (
              <Button variant="gold" icon={<ImagePlus size={16} />} onClick={onPickLogo} loading={uploading}>
                Upload logo
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {logos.length === 0 ? (
            <p className="muted text-sm">No logo has been uploaded yet.</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {logos.map((file) => (
                <figure key={file.id} className="flex flex-col items-center gap-2">
                  <img src={file.url} alt={file.originalName} className="h-24 w-24 rounded-xl border hairline object-cover" />
                  {canWrite ? (
                    <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => onDelete(file)}>
                      Remove
                    </Button>
                  ) : null}
                </figure>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Gallery"
          description="Photographs shown on the public landing page when the gallery is enabled."
          actions={
            canWrite ? (
              <Button variant="outline" icon={<ImagePlus size={16} />} onClick={onPickGallery} loading={uploading}>
                Upload image
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {gallery.length === 0 ? (
            <p className="muted text-sm">No gallery images have been uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {gallery.map((file) => (
                <figure key={file.id} className="flex flex-col gap-2">
                  <img src={file.url} alt={file.originalName} className="h-32 w-full rounded-xl border hairline object-cover" />
                  <figcaption className="muted truncate text-xs">{file.originalName}</figcaption>
                  {canWrite ? (
                    <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => onDelete(file)}>
                      Remove
                    </Button>
                  ) : null}
                </figure>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
