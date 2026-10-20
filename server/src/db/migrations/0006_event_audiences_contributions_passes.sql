-- Event audiences, contributions and entrance passes.
--
-- Three things were missing from the events module:
--
--   1. WHO an event is for. `events.target_group_id` names a single group (or the
--      whole choir when NULL), which cannot express "Senior and Members but not
--      Junior". `event_audiences` records one row per group an event is addressed
--      to, so the coordinator can pick any combination. No rows means the whole
--      choir.
--
--   2. WHETHER an event costs money. Not every event does — a concert or a party
--      usually does, a rehearsal does not — so the coordinator decides per event
--      and sets the amount. `event_contributions` records, per person, what they
--      owe and whether it has been confirmed paid.
--
--   3. WHO may come in at the door. A paid event admits people by entrance pass:
--      a signed token (carried by a QR code) plus a short passcode that can be
--      typed when a phone cannot be scanned.
--
-- Money is never moved by this application: it records that a contribution was
-- received (cash, mobile money, however the choir collects it) and who confirmed
-- it. That keeps the whole feature free of payment providers and cards.

-- --- Who an event is for -----------------------------------------------------
CREATE TABLE IF NOT EXISTS event_audiences (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (event_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_event_audiences_group ON event_audiences(group_id);

ALTER TABLE events ADD COLUMN audience_public INTEGER NOT NULL DEFAULT 0;

-- --- Whether it costs money --------------------------------------------------
ALTER TABLE events ADD COLUMN requires_contribution INTEGER NOT NULL DEFAULT 0;
-- Whole francs only: the choir collects cash and mobile money, so there are no
-- minor units to track. NULL when the event is free.
ALTER TABLE events ADD COLUMN contribution_amount INTEGER;
ALTER TABLE events ADD COLUMN contribution_note TEXT;
-- Last date a contribution may be paid, so the coordinator's list can show who
-- is late rather than just who has not paid.
ALTER TABLE events ADD COLUMN contribution_due_date TEXT;

CREATE TABLE IF NOT EXISTS event_contributions (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount       INTEGER NOT NULL,
  -- 'due'      — recorded as owing, not yet confirmed
  -- 'paid'     — confirmed by someone with events.payment.approve
  -- 'waived'   — excused (a guest, a sponsor, a hardship case)
  status       TEXT NOT NULL DEFAULT 'due'
                 CHECK (status IN ('due','paid','waived')),
  reference    TEXT,
  note         TEXT,
  confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (event_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_event_contributions_status ON event_contributions(event_id, status);

-- --- Who may come in ---------------------------------------------------------
-- One pass per person per event. `token` is the secret a QR code carries; it is
-- random and unguessable, and is what the check-in page is opened with. `passcode`
-- is the short human-readable fallback (e.g. "K7QP-3M") for a door with no scanner.
CREATE TABLE IF NOT EXISTS event_passes (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  passcode     TEXT NOT NULL,
  -- 'issued'     — generated, not yet used
  -- 'checked_in' — admitted at the door
  -- 'revoked'    — cancelled (payment reversed, no longer attending)
  status       TEXT NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('issued','checked_in','revoked')),
  issued_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  issued_at    TEXT NOT NULL,
  checked_in_at TEXT,
  checked_in_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (event_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_event_passes_event ON event_passes(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_passes_passcode ON event_passes(event_id, passcode);

-- A door log, separate from the pass itself: a pass tells you the current state,
-- the log tells you what was tried. Repeat scans and refused entries are visible.
CREATE TABLE IF NOT EXISTS event_checkins (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id  TEXT REFERENCES members(id) ON DELETE SET NULL,
  pass_id    TEXT REFERENCES event_passes(id) ON DELETE SET NULL,
  outcome    TEXT NOT NULL
               CHECK (outcome IN ('admitted','repeat','refused','unknown')),
  detail     TEXT,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_checkins_event ON event_checkins(event_id, created_at);

-- --- Who is coming -----------------------------------------------------------
-- Participants could only be added by an administrator. Members now answer for
-- themselves, so their own reply is stored next to the list.
ALTER TABLE event_participants ADD COLUMN rsvp TEXT;
ALTER TABLE event_participants ADD COLUMN rsvp_at TEXT;
ALTER TABLE event_participants ADD COLUMN rsvp_note TEXT;
