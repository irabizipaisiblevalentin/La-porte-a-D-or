import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applicantProfileFromAnswers,
  profileHasDetails,
  type ProfileAnswer,
} from "../../src/services/application-profile.js"

function answers(pairs: Array<[string, string]>): ProfileAnswer[] {
  return pairs.map(([question, answer], index) => ({
    questionKey: `q${index}`,
    questionLabel: question,
    answer,
  }))
}

test("profile: maps a senior application (the official form's Senior section)", () => {
  const profile = applicantProfileFromAnswers(answers([
    ["What is your full name?", "Aline Uwase"],
    ["What is your date of birth?", "2001-05-14"],
    ["What is your gender?", "Female"],
    ["Phone Number", "0788123456"],
    ["Email Address", "aline@example.com"],
    ["Province", "Kigali"],
    ["District", "Gasabo"],
    ["Sector", "Remera"],
    ["Which singing section do you belong to or would you like to join?", "Alto"],
    ["Do you have previous choir or singing experience?", "Yes"],
    ["Please briefly describe your previous choir or singing experience.", "Sang in the school choir for three years."],
    ["What is your current occupation or main activity?", "Teacher"],
    ["Emergency Contact Full Name", "John Uwase"],
    ["Relationship to You", "Parent"],
    ["Emergency Contact Phone Number", "0788999999"],
  ]))

  assert.equal(profile.gender, "female")
  assert.equal(profile.dateOfBirth, "2001-05-14")
  assert.equal(profile.voiceSectionId, "vs_alto")
  assert.equal(profile.region, "Kigali")
  assert.equal(profile.city, "Gasabo")
  assert.equal(profile.address, "Remera")
  assert.equal(profile.occupation, "Teacher")
  assert.equal(profile.singingExperience, "Sang in the school choir for three years.")
  assert.equal(profile.emergencyContactName, "John Uwase")
  assert.equal(profile.emergencyContactPhone, "0788999999")
})

test("profile: maps a junior application's class and emergency contact", () => {
  const profile = applicantProfileFromAnswers(answers([
    ["What is your full name?", "Eric Nkusi"],
    ["What is your date of birth?", "2010-01-09"],
    ["What is your gender?", "Male"],
    ["Which class are you currently studying in?", "S2"],
    ["Trend/section", "MPC"],
    ["Which singing section do you belong to or would you like to join?", "Tenor"],
    ["Emergency Contact Full Name", "Grace Nkusi"],
    ["Emergency Contact Phone Number", "0788111111"],
  ]))

  assert.equal(profile.gender, "male")
  assert.equal(profile.dateOfBirth, "2010-01-09")
  assert.equal(profile.currentClass, "S2")
  assert.equal(profile.trend, "MPC")
  assert.equal(profile.voiceSectionId, "vs_tenor")
  assert.equal(profile.emergencyContactName, "Grace Nkusi")
  assert.equal(profile.emergencyContactPhone, "0788111111")
})

test("profile: maps a support-member application's skills", () => {
  const profile = applicantProfileFromAnswers(answers([
    ["What is your full name?", "Pascal Habimana"],
    ["Do you have any additional skills or talents that could contribute to the choir?", "Sound engineering and live mixing"],
    ["Why would you like to join our choir as a member?", "To help with the technical team."],
  ]))

  assert.equal(profile.skills, "Sound engineering and live mixing")
  assert.equal(profile.voiceSectionId, null)
})

test("profile: never invents values for unanswered questions", () => {
  const profile = applicantProfileFromAnswers(answers([
    ["What is your full name?", "Unknown Applicant"],
  ]))

  assert.equal(profileHasDetails(profile), false)
  assert.deepEqual(profile, {
    gender: null,
    dateOfBirth: null,
    voiceSectionId: null,
    address: null,
    region: null,
    city: null,
    occupation: null,
    singingExperience: null,
    skills: null,
    currentClass: null,
    trend: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
  })
})

test("profile: normalises free-text gender", () => {
  const answer = (value: string) => applicantProfileFromAnswers(answers([["What is your gender?", value]])).gender
  assert.equal(answer("M"), "male")
  assert.equal(answer("Man"), "male")
  assert.equal(answer("Female"), "female")
  assert.equal(answer("Prefer not to say"), "other")
  assert.equal(answer("Nonbinary"), "Nonbinary")
})
