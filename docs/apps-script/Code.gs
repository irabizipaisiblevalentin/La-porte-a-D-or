/**
 * Chorale La Porte d'Or - Google Form to membership application intake.
 *
 * Sends each form submission to the platform webhook. The platform files the
 * application under the group the applicant chose, notifies the Chairman and
 * that group's administrator, and waits for an approve/reject decision.
 *
 * SETUP
 *   1. Open the Google Form, then Extensions > Apps Script.
 *   2. Paste this whole file into Code.gs and Save (Ctrl+S).
 *   3. Fill in CONFIG.ENDPOINT and CONFIG.SECRET below.
 *   4. Select installTrigger in the function dropdown and click Run once,
 *      then approve the permissions. (You do NOT need the Triggers dialog.)
 *
 * Submitting the form never creates an account. It only creates an application
 * that an administrator must review and approve.
 *
 * See docs/apps-script/README.md for setup and troubleshooting.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

var CONFIG = {
  // Your platform's webhook endpoint, no trailing slash.
  ENDPOINT: 'https://la-porte-ador.onrender.com/api/applications/webhook',

  // Must equal Settings > Integrations > "Google webhook signing secret".
  SECRET: 'PASTE-YOUR-WEBHOOK-SECRET-HERE',

  // Optional: pin the exact question titles. Leave '' to auto-detect by keyword.
  NAME_QUESTION: '',   // e.g. 'Full name'
  EMAIL_QUESTION: '',  // e.g. 'Email address'
  PHONE_QUESTION: '',  // e.g. 'Phone number'
  GROUP_QUESTION: '',  // e.g. 'Which group are you applying for?'

  // Optional: spreadsheet id to record submissions that could not be delivered.
  LOG_SHEET_ID: '',    // e.g. '1AbC...'; leave '' to only use Logger
  LOG_SHEET_NAME: 'Webhook failures',

  MAX_ATTEMPTS: 4      // 1 try plus up to 3 retries on transient errors
};

// Canonical group ids used by the platform. Do not change these values.
var GROUP_IDS = { junior: 'grp_junior', senior: 'grp_senior', members: 'grp_members' };

// ---------------------------------------------------------------------------
// Trigger management
// ---------------------------------------------------------------------------

/**
 * Creates the form-submit trigger for onFormSubmit. Run this ONCE from the
 * editor. If the editor says "no target function", it means this file has not
 * been saved or is empty - save the file and run this again.
 */
function installTrigger() {
  var form = FormApp.getActiveForm();
  if (!form) {
    throw new Error('No active form. Open this script from the Form: Extensions > Apps Script.');
  }
  removeTriggers();
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Installed the onFormSubmit trigger for: ' + form.getTitle());
}

/** For a standalone script: install the trigger for a form id. */
function installTriggerById(formId) {
  if (!formId) throw new Error('Call installTriggerById("<form id>").');
  removeTriggers();
  ScriptApp.newTrigger('onFormSubmit').forForm(FormApp.openById(formId)).onFormSubmit().create();
  Logger.log('Installed the onFormSubmit trigger for form id: ' + formId);
}

/** Removes every onFormSubmit trigger owned by this project. */
function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function onFormSubmit(e) {
  try {
    var submission = extractSubmission_(e);
    if (!submission) {
      Logger.log('No submission data in the event; nothing sent.');
      return;
    }
    var payload = buildPayload_(submission);
    if (sendToPlatform_(payload)) {
      Logger.log('Sent application ' + payload.externalId + ' for ' + payload.fullName);
    }
  } catch (err) {
    Logger.log('onFormSubmit error: ' + err);
    recordFailure_(e, err);
  }
}

/** Optional smoke test: posts a clearly marked sample application. */
function sendTestApplication() {
  var sample = {
    externalId: 'apps-script-test-' + new Date().getTime(),
    submittedAt: new Date().toISOString(),
    fullName: 'Apps Script Test',
    email: 'test@example.com',
    phone: null,
    group: GROUP_IDS.junior,
    answers: [
      { question: 'Full name', answer: 'Apps Script Test' },
      { question: 'Which group are you applying for?', answer: 'Junior' }
    ]
  };
  Logger.log('Test send result: ' + sendToPlatform_(sample));
}

// ---------------------------------------------------------------------------
// Extraction. Form trigger -> e.response; Sheet trigger -> e.namedValues.
// ---------------------------------------------------------------------------

function extractSubmission_(e) {
  if (e && e.response) {
    var answers = e.response.getItemResponses().map(function (item) {
      return { question: item.getItem().getTitle(), answer: item.getResponse() };
    });
    return { id: e.response.getId(), submittedAt: e.response.getTimestamp(), answers: answers };
  }
  if (e && e.namedValues) {
    var rows = Object.keys(e.namedValues).map(function (q) {
      return { question: q, answer: e.namedValues[q].join(', ') };
    });
    var email = findAnswer_(rows, CONFIG.EMAIL_QUESTION, /e-?mail/i, null);
    var stamp = (e.namedValues['Timestamp'] && e.namedValues['Timestamp'][0]) || new Date().toISOString();
    return { id: 'sheet-' + stamp + '-' + (email || 'unknown'), submittedAt: stamp, answers: rows };
  }
  return null;
}

function buildPayload_(submission) {
  var answers = submission.answers;
  var fullName = findAnswer_(answers, CONFIG.NAME_QUESTION, /name/i, /nick ?name|user ?name|username|choir name|stage name|emergency|guardian|parent|next of kin|contact/i);
  var email = findAnswer_(answers, CONFIG.EMAIL_QUESTION, /e-?mail/i, null);
  var phone = findAnswer_(answers, CONFIG.PHONE_QUESTION, /phone|contact|mobile|whatsapp|tel/i, /emergency|guardian|parent/i);

  // Prefer the explicit group question ("Which choir group are you applying
  // for?"); only fall back to a section/apply question if that is missing.
  var groupAnswer = findAnswer_(answers, CONFIG.GROUP_QUESTION, /group|category|member type|choir part|joining as|register as/i, null);
  if (!groupAnswer) {
    groupAnswer = findAnswer_(answers, CONFIG.GROUP_QUESTION, /section|apply|application/i, null);
  }

  // Map the group answer; otherwise the first answer that names a group.
  var group = mapGroup_(groupAnswer);
  if (!group) {
    for (var i = 0; i < answers.length; i++) {
      group = mapGroup_(answers[i].answer);
      if (group) break;
    }
  }

  return {
    externalId: submission.id,
    submittedAt: new Date(submission.submittedAt).toISOString(),
    fullName: fullName || 'Unknown applicant',
    email: email || null,
    phone: phone || null,
    group: group || null,
    answers: answers
  };
}

function findAnswer_(answers, exactQuestion, includePattern, excludePattern) {
  var i, a;
  if (exactQuestion) {
    for (i = 0; i < answers.length; i++) {
      if (answers[i].question === exactQuestion && answers[i].answer) {
        return String(answers[i].answer).trim();
      }
    }
  }
  for (i = 0; i < answers.length; i++) {
    a = answers[i];
    if (!a.answer) continue;
    if (excludePattern && excludePattern.test(a.question)) continue;
    if (includePattern.test(a.question)) return String(a.answer).trim();
  }
  return null;
}

function mapGroup_(value) {
  if (!value) return null;
  var text = String(value).toLowerCase();
  if (/\bjunior\b|\byouth\b|\bkid/.test(text)) return GROUP_IDS.junior;
  if (/\bsenior\b|\badult\b|\bgrown/.test(text)) return GROUP_IDS.senior;
  if (/support|associate|non-?sing|non-?singing|volunteer/.test(text)) return GROUP_IDS.members;
  if (/\bmember(?:s)?\b/.test(text)) return GROUP_IDS.members;
  return null;
}

// ---------------------------------------------------------------------------
// Sending (HMAC-SHA256 signed, with exponential backoff)
// ---------------------------------------------------------------------------

function sendToPlatform_(payload) {
  var json = JSON.stringify(payload);
  var signature = hmacHex_(CONFIG.SECRET, json);   // over the exact bytes we POST
  var attempt = 0;

  while (attempt < CONFIG.MAX_ATTEMPTS) {
    attempt++;
    var response;
    try {
      response = UrlFetchApp.fetch(CONFIG.ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        payload: json,
        headers: { 'x-chorale-signature': signature },
        muteHttpExceptions: true
      });
    } catch (networkError) {
      Logger.log('Attempt ' + attempt + ' network error: ' + networkError);
      Utilities.sleep(Math.pow(2, attempt) * 500);
      continue;
    }

    var code = response.getResponseCode();
    if (code >= 200 && code < 300) return true;
    if (code >= 400 && code < 500 && code !== 429) {   // bad request / bad signature - do not retry
      Logger.log('Rejected (' + code + '): ' + response.getContentText());
      recordFailure_(payload, 'HTTP ' + code + ': ' + response.getContentText());
      return false;
    }
    Logger.log('Attempt ' + attempt + ' got HTTP ' + code + '; retrying...');
    Utilities.sleep(Math.pow(2, attempt) * 500);
  }

  recordFailure_(payload, 'Exhausted ' + CONFIG.MAX_ATTEMPTS + ' attempts');
  return false;
}

/** Lowercase hex HMAC-SHA256 of body under secret (matches the server exactly). */
function hmacHex_(secret, body) {
  var bytes = Utilities.computeHmacSha256Signature(body, secret);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    out += v.length === 1 ? '0' + v : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Failure logging
// ---------------------------------------------------------------------------

function recordFailure_(payloadOrEvent, error) {
  var detail = '';
  try {
    detail = payloadOrEvent ? JSON.stringify(payloadOrEvent) : '';
  } catch (ignore) {
    detail = '';
  }
  Logger.log('FAILED: ' + error + (detail ? ' - ' + detail : ''));
  if (!CONFIG.LOG_SHEET_ID) return;
  try {
    var ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME) || ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    sheet.appendRow([new Date(), String(error), detail]);
  } catch (logError) {
    Logger.log('Could not write to the failure log: ' + logError);
  }
}
