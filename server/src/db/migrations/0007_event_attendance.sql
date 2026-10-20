-- Roll-call for an event.
--
-- The choir already keeps attendance properly: `attendance_sessions` with one
-- `attendance_records` row per person, each marked present, late, absent or
-- excused. That is the system the group leaders use at every rehearsal, and it
-- already handles group scoping, notes and reporting. Events do not need a second,
-- parallel way of recording who turned up.
--
-- What was missing is a link: an event can *be* an attendance session. With
-- `attendance_sessions.event_id` set, the coordinator opens the event, marks the
-- roll-call, and the record lands in the same place as every other attendance
-- record — searchable, reportable and scoped by group like the rest.
--
-- The column is deliberately nullable. Most sessions are ordinary rehearsals with
-- no event behind them, and an event that only wanted an RSVP should not be forced
-- to carry a roll-call. An event gets a session the first time somebody marks one.
--
-- UNIQUE on `event_id` keeps it to one session per event: two would mean two
-- answers to the same question ("who came?").
--
-- ON DELETE SET NULL, not CASCADE: deleting an event must not delete the
-- attendance history of a rehearsal that happened. The people were there whether
-- or not the calendar entry survives.

ALTER TABLE attendance_sessions ADD COLUMN event_id TEXT REFERENCES events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_sessions_event
  ON attendance_sessions(event_id)
  WHERE event_id IS NOT NULL;
