import { useState } from "react"
import { CalendarCheck, Check, HelpCircle, QrCode, X } from "lucide-react"
import { api } from "../../api/client"
import { useMutation } from "../../api/hooks"
import { Button, Card, CardBody, CardHeader, Textarea, humanize, useToast } from "../../components/ui"
import { PassQr } from "./PassQr"
import type { ContributionRow, ContributionSummary, PassRow } from "./EventContributionPanel"

/**
 * A member's own answer to an event, and what it means for them.
 *
 * Three things belong together here, because they are one flow: saying whether
 * you are coming, seeing what you owe if the event asks for a contribution, and
 * finding your own entrance pass once it has been confirmed. Each is shown only to
 * the person it concerns — an administrator has no member record and so never
 * sees this panel at all.
 */

/** The member's own row in the participant list, where their answer is kept. */
export interface EventParticipantRow {
  member_id: string
  rsvp: string | null
  rsvp_at: string | null
  rsvp_note: string | null
}

function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return `${value.toLocaleString("en-US").replace(/,/g, " ")} FRW`
}

export function MyRsvp({
  eventId,
  isPast,
  contribution,
  mine,
  myAnswer,
  myPass,
  onChanged,
}: {
  eventId: string
  isPast: boolean
  contribution: ContributionSummary
  mine: ContributionRow[]
  myAnswer: EventParticipantRow | null
  myPass: PassRow | null
  onChanged: () => void
}) {
  const toast = useToast()
  const row = mine[0] ?? null
  const [note, setNote] = useState(myAnswer?.rsvp_note ?? "")
  const [showPass, setShowPass] = useState(false)

  const answer = useMutation((body: { rsvp: "yes" | "no" | "maybe"; note?: string | null }) =>
    api.put<{ participants: unknown[] }>(`/events/${eventId}/rsvp`, body),
  )

  async function reply(rsvp: "yes" | "no" | "maybe") {
    const result = await answer.run({ rsvp, note: note.trim() || null })
    if (!result) return
    toast.success(
      rsvp === "yes"
        ? "Thank you — you are marked as coming."
        : rsvp === "no"
          ? "Noted — you are marked as not coming."
          : "Noted — you are marked as maybe.",
    )
    onChanged()
  }

  const current = myAnswer?.rsvp ?? null

  return (
    <Card>
      <CardHeader
        title="Your answer"
        description={
          isPast
            ? "This event has passed. Your answer is kept for the record."
            : "Tell the organisers whether you are coming. You can change your answer at any time."
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "yes", label: "I am coming", icon: <Check size={16} /> },
              { key: "maybe", label: "Maybe", icon: <HelpCircle size={16} /> },
              { key: "no", label: "I cannot come", icon: <X size={16} /> },
            ] as const
          ).map((option) => (
            <Button
              key={option.key}
              variant={current === option.key ? "gold" : "outline"}
              icon={option.icon}
              loading={answer.saving}
              disabled={isPast}
              onClick={() => reply(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {current ? (
          <p className="muted text-xs">
            You answered <span className="font-medium">{humanize(current)}</span>
            {myAnswer?.rsvp_at ? ` on ${new Date(myAnswer.rsvp_at).toLocaleDateString()}` : ""}.
          </p>
        ) : null}

        {!isPast ? (
          <div>
            <Textarea
              aria-label="A note for the organisers"
              placeholder="Anything the organisers should know — arriving late, bringing a guest, transport."
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
            <p className="muted mt-1 text-xs">
              Your answer above saves this note with it.
            </p>
          </div>
        ) : null}

        {contribution.required ? (
          <div className="rounded-xl border hairline p-4">
            <p className="text-sm font-semibold">Contribution</p>
            {row ? (
              <p className="muted mt-1 text-sm">
                {row.status === "paid"
                  ? `Recorded as paid on ${row.confirmed_at ? new Date(row.confirmed_at).toLocaleDateString() : "record"} — ${formatAmount(row.amount)}.`
                  : row.status === "waived"
                    ? `Your contribution was waived (${formatAmount(row.amount)}).`
                    : `You owe ${formatAmount(row.amount)}${
                        contribution.dueDate
                          ? `, due ${new Date(`${contribution.dueDate}T00:00:00`).toLocaleDateString()}`
                          : ""
                      }. Pay the coordinator as the choir collects contributions; this page only records it.`}
              </p>
            ) : (
              <p className="muted mt-1 text-sm">
                This event asks for {formatAmount(contribution.amount)}
                {contribution.dueDate
                  ? ` by ${new Date(`${contribution.dueDate}T00:00:00`).toLocaleDateString()}`
                  : ""}
                . Answer that you are coming and the coordinator will add you to the list.
              </p>
            )}
          </div>
        ) : null}

        {myPass ? (
          <div className="rounded-xl border hairline p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CalendarCheck size={15} /> Your entrance pass
            </p>
            <p className="muted mt-1 text-sm">
              {myPass.status === "checked_in"
                ? "You have been admitted."
                : "Show the code at the door, or type the passcode if the camera will not read it."}
            </p>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              icon={<QrCode size={14} />}
              onClick={() => setShowPass((value) => !value)}
            >
              {showPass ? "Hide my pass" : "Show my pass"}
            </Button>
            {showPass ? (
              <div className="mt-4">
                <PassQr
                  token={myPass.token}
                  name={myPass.full_name ?? ""}
                  memberNo={myPass.member_no ?? ""}
                  group={myPass.group_name ?? ""}
                  passcode={myPass.passcode}
                  status={myPass.status}
                  size={200}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
