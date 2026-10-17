/**
 * Best-effort mapping from a stored membership application's answers to the
 * fields a member record can hold (gender, date of birth, voice section,
 * contacts, and the group-specific profile tables).
 *
 * Everything here is optional: a field is only returned when the applicant
 * actually answered a question that clearly asks for it. Nothing is guessed or
 * invented, so an unanswered value stays null and the original answers remain
 * the source of truth on the application record itself.
 *
 * The platform's official form asks (among others): full name, date of birth,
 * gender, phone, email, province/district/sector/additional address, singing
 * section, previous singing experience, occupation, skills/talents, current
 * class/trend (junior), and emergency contact details.
 */

export interface ProfileAnswer {
  questionKey: string
  questionLabel: string
  answer: string | null
}

export interface ApplicantProfile {
  gender: string | null
  dateOfBirth: string | null
  voiceSectionId: string | null
  address: string | null
  region: string | null
  city: string | null
  occupation: string | null
  singingExperience: string | null
  skills: string | null
  currentClass: string | null
  trend: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
}

/** Official voice-section ids seeded by the platform (Soprano/Alto/Tenor/Bass). */
const VOICE_SECTIONS: Array<{ id: string; pattern: RegExp }> = [
  { id: "vs_soprano", pattern: /\bsoprano\b/i },
  { id: "vs_alto", pattern: /\balto\b|contralto/i },
  { id: "vs_tenor", pattern: /\btenor\b/i },
  { id: "vs_bass", pattern: /\bbass\b|baritone/i },
]

function labelOf(answer: ProfileAnswer): string {
  return `${answer.questionKey} ${answer.questionLabel}`.replace(/[_.]+/g, " ").toLowerCase()
}

/**
 * Returns the first non-empty answer whose question matches `include` and not
 * `exclude`. Answers are read in order, so the earliest matching question wins.
 */
function findAnswer(answers: ProfileAnswer[], include: RegExp, exclude?: RegExp): string | null {
  for (const answer of answers) {
    const value = answer.answer?.trim()
    if (!value) continue
    const label = labelOf(answer)
    if (exclude && exclude.test(label)) continue
    if (include.test(label)) return value
  }
  return null
}

/** "Male"/"M"/"Man" -> "male"; unknown values are kept as short free text. */
function normalizeGender(value: string): string {
  const text = value.trim().toLowerCase()
  if (/^(m|male|man|boy)\b/.test(text)) return "male"
  if (/^(f|female|woman|girl)\b/.test(text)) return "female"
  if (/other|prefer not|prefer not to say|n\/a/.test(text)) return "other"
  return value.trim().slice(0, 40)
}

function normalizeDateOfBirth(value: string): string {
  const trimmed = value.trim().slice(0, 40)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return trimmed
}

function voiceSectionIdFromText(value: string | null): string | null {
  if (!value) return null
  for (const section of VOICE_SECTIONS) {
    if (section.pattern.test(value)) return section.id
  }
  return null
}

export function applicantProfileFromAnswers(answers: ProfileAnswer[]): ApplicantProfile {
  const genderRaw = findAnswer(answers, /\bgender\b|\bsex\b/)
  const dobRaw = findAnswer(answers, /date of birth|birth ?date|\bdob\b|\bborn\b/)
  const voiceRaw = findAnswer(answers, /singing section|voice section|singing part|voice part/)

  return {
    gender: genderRaw ? normalizeGender(genderRaw) : null,
    dateOfBirth: dobRaw ? normalizeDateOfBirth(dobRaw) : null,
    voiceSectionId: voiceSectionIdFromText(voiceRaw),
    region: findAnswer(answers, /province/),
    city: findAnswer(answers, /district/),
    address: findAnswer(answers, /sector|additional address|address\b|location information/, /e-?mail|phone|mobile|whatsapp/),
    occupation: findAnswer(answers, /occupation|main activity|profession|what do you do/),
    // The "describe your previous experience" question, not the yes/no one.
    singingExperience: findAnswer(answers, /describe.*experience|briefly describe.*(choir|experience)/),
    skills: findAnswer(answers, /skills|talents/),
    currentClass: findAnswer(answers, /class are you currently studying|current class|which class/),
    trend: findAnswer(answers, /trend|what you study|study in kass/),
    emergencyContactName: findAnswer(answers, /emergency contact.*name/),
    emergencyContactPhone: findAnswer(answers, /emergency contact.*(phone|number)/),
  }
}

/** True when the profile carries at least one value worth writing to the member. */
export function profileHasDetails(profile: ApplicantProfile): boolean {
  return Object.values(profile).some((value) => value !== null && value !== "")
}
