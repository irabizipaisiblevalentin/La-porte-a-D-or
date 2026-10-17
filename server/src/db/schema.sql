-- Chorale La Porte d'Or — relational schema
-- SQLite dialect. Applied incrementally by src/db/migrate.ts.
-- Conventions:
--   ids        : TEXT (uuid v4)
--   timestamps : TEXT (ISO-8601 UTC, e.g. 2026-01-31T12:00:00.000Z)
--   booleans   : INTEGER 0/1
--   enums      : TEXT with CHECK constraints

-- ---------------------------------------------------------------------------
-- Identity, roles, permissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL,
  email_normalized     TEXT NOT NULL UNIQUE,
  password_hash        TEXT,                       -- NULL until a secure setup/invite completes
  display_name         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'invited'
                         CHECK (status IN ('invited','active','inactive','locked')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count   INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  avatar_path          TEXT,
  locale               TEXT NOT NULL DEFAULT 'en',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deactivated_at       TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  is_system   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- scope: 'global' | 'senior' | 'junior' | 'members' | 'own'
CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  scopes      TEXT NOT NULL DEFAULT 'global'
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL DEFAULT 'global',
  PRIMARY KEY (role_id, permission_id, scope)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,                -- opaque session token (hashed at rest)
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  last_seen_at    TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  revoked_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS account_invitations (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setup_tokens (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL,
  note          TEXT,
  expires_at    TEXT NOT NULL,
  used_at       TEXT,
  used_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  requested_ip TEXT,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- ---------------------------------------------------------------------------
-- Organisation groups
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE CHECK (key IN ('senior','junior','members')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  is_minor_group INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_sections (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS members (
  id              TEXT PRIMARY KEY,
  member_no       TEXT NOT NULL UNIQUE,            -- CHR-2026-0001
  group_id        TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  user_id         TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name       TEXT NOT NULL,
  gender          TEXT,
  date_of_birth   TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended','withdrawn')),
  joined_at       TEXT NOT NULL,
  photo_path      TEXT,
  voice_section_id TEXT REFERENCES voice_sections(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deactivated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(full_name);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS member_contacts (
  member_id  TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  city       TEXT,
  region     TEXT,
  country    TEXT,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_senior (
  member_id          TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  occupation         TEXT,
  workplace          TEXT,
  singing_experience TEXT,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_junior (          -- sensitive: minors
  member_id                TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  school                   TEXT,
  current_class            TEXT,
  guardian_name            TEXT,
  guardian_relationship    TEXT,
  guardian_phone           TEXT,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_support (
  member_id             TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  department            TEXT,
  primary_responsibility TEXT,
  skills                TEXT,
  experience            TEXT,
  availability          TEXT,
  updated_at            TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Applications (intake via official Google Form; no public registration)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS applications (
  id                 TEXT PRIMARY KEY,
  external_id        TEXT UNIQUE,                  -- Google response id / idempotency key
  source             TEXT NOT NULL DEFAULT 'google_form'
                       CHECK (source IN ('google_form','google_sheets','manual')),
  submitted_at       TEXT NOT NULL,
  full_name          TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  requested_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  assigned_group_id  TEXT REFERENCES groups(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','under_review','more_info_required','approved','rejected')),
  duplicate_of       TEXT REFERENCES applications(id) ON DELETE SET NULL,
  member_id          TEXT REFERENCES members(id) ON DELETE SET NULL,
  reviewed_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        TEXT,
  decision_note      TEXT,
  raw_payload        TEXT,                          -- verbatim provider payload (JSON text)
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_group ON applications(assigned_group_id);

CREATE TABLE IF NOT EXISTS application_answers (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question_key   TEXT NOT NULL,
  question_label TEXT NOT NULL,
  answer         TEXT,
  UNIQUE (application_id, question_key)
);

CREATE TABLE IF NOT EXISTS application_reviews (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  from_group_id  TEXT REFERENCES groups(id) ON DELETE SET NULL,
  to_group_id    TEXT REFERENCES groups(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_reviews_app ON application_reviews(application_id);

-- ---------------------------------------------------------------------------
-- Digital music library
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS song_categories (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS learning_stages (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS songs (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  composer         TEXT,
  arranger         TEXT,
  language         TEXT,
  genre            TEXT,
  musical_key      TEXT,
  bpm              INTEGER,
  time_signature   TEXT,
  difficulty       TEXT CHECK (difficulty IN ('beginner','intermediate','advanced') OR difficulty IS NULL),
  choir_section    TEXT,
  description      TEXT,
  category_id      TEXT REFERENCES song_categories(id) ON DELETE SET NULL,
  learning_stage_id TEXT REFERENCES learning_stages(id) ON DELETE SET NULL,
  youtube_channel_id TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  admin_notes      TEXT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_songs_normalized ON songs(normalized_title);
CREATE INDEX IF NOT EXISTS idx_songs_stage ON songs(learning_stage_id);

CREATE TABLE IF NOT EXISTS videos (
  id                 TEXT PRIMARY KEY,
  youtube_video_id   TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  thumbnail_url      TEXT,
  published_at       TEXT,
  channel_id         TEXT,
  channel_title      TEXT,
  discovery_category TEXT,
  status             TEXT NOT NULL DEFAULT 'discovered'
                       CHECK (status IN ('discovered','approved','rejected')),
  song_id            TEXT REFERENCES songs(id) ON DELETE SET NULL,
  is_primary         INTEGER NOT NULL DEFAULT 0,
  added_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_song ON videos(song_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

CREATE TABLE IF NOT EXISTS song_lyrics (
  id          TEXT PRIMARY KEY,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL CHECK (section_type IN ('verse','chorus','bridge','ending','intro','interlude')),
  section_order INTEGER NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,
  language    TEXT,
  rights_note TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_lyrics_song ON song_lyrics(song_id);

CREATE TABLE IF NOT EXISTS song_audio_resources (
  id          TEXT PRIMARY KEY,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  track_type  TEXT NOT NULL
                CHECK (track_type IN ('full','soprano','alto','tenor','bass','instrumental','practice','metronome','other')),
  file_path   TEXT NOT NULL,
  mime_type   TEXT,
  file_size   INTEGER,
  duration_seconds INTEGER,
  rights_note TEXT,
  is_authorized INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_audio_song ON song_audio_resources(song_id);

CREATE TABLE IF NOT EXISTS song_progress_history (
  id           TEXT PRIMARY KEY,
  song_id      TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  group_id     TEXT REFERENCES groups(id) ON DELETE SET NULL,
  from_stage_id TEXT REFERENCES learning_stages(id) ON DELETE SET NULL,
  to_stage_id  TEXT NOT NULL REFERENCES learning_stages(id) ON DELETE RESTRICT,
  progress_percent INTEGER CHECK (progress_percent IS NULL OR (progress_percent BETWEEN 0 AND 100)),
  notes        TEXT,
  recorded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_progress_song ON song_progress_history(song_id);

CREATE TABLE IF NOT EXISTS song_group_assignments (
  song_id   TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (song_id, group_id)
);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  activity_type  TEXT NOT NULL
                   CHECK (activity_type IN ('rehearsal','performance','church_service','meeting','training','concert','other')),
  date           TEXT NOT NULL,
  start_time     TEXT,
  end_time       TEXT,
  location       TEXT,
  location_id    TEXT REFERENCES locations(id) ON DELETE SET NULL,
  target_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  recorder_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions(date);

CREATE TABLE IF NOT EXISTS attendance_records (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('present','late','absent','excused')),
  notes       TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (session_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_records_member ON attendance_records(member_id);

-- ---------------------------------------------------------------------------
-- Discipline & positive recognition (restricted)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discipline_categories (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('negative','positive')),
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discipline_records (
  id              TEXT PRIMARY KEY,
  member_id       TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  category_id     TEXT NOT NULL REFERENCES discipline_categories(id) ON DELETE RESTRICT,
  description     TEXT NOT NULL,
  action_taken    TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','closed')),
  follow_up_notes TEXT,
  recorded_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discipline_member ON discipline_records(member_id);
CREATE INDEX IF NOT EXISTS idx_discipline_date ON discipline_records(date);

CREATE TABLE IF NOT EXISTS discipline_history (
  id             TEXT PRIMARY KEY,
  record_id      TEXT NOT NULL REFERENCES discipline_records(id) ON DELETE CASCADE,
  actor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  change_summary TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discipline_history_record ON discipline_history(record_id);

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS goals (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  target_value REAL NOT NULL,
  unit         TEXT NOT NULL,
  start_date   TEXT NOT NULL,
  deadline     TEXT,
  group_id     TEXT REFERENCES groups(id) ON DELETE SET NULL,  -- NULL = organisation-wide
  period       TEXT NOT NULL DEFAULT 'annual' CHECK (period IN ('annual','monthly','custom')),
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','completed','cancelled')),
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_progress (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  period_date  TEXT NOT NULL,
  value        REAL NOT NULL,
  notes        TEXT,
  recorded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (goal_id, period_date)
);
CREATE INDEX IF NOT EXISTS idx_goal_progress_goal ON goal_progress(goal_id);

-- ---------------------------------------------------------------------------
-- Events & training
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  event_type     TEXT NOT NULL
                   CHECK (event_type IN ('rehearsal','concert','church_service','retreat','training','meeting','competition','community','other')),
  date           TEXT NOT NULL,
  start_time     TEXT,
  end_time       TEXT,
  location       TEXT,
  location_id    TEXT REFERENCES locations(id) ON DELETE SET NULL,
  description    TEXT,
  target_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','completed','cancelled')),
  report         TEXT,
  is_public      INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role      TEXT,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, member_id)
);

CREATE TABLE IF NOT EXISTS event_songs (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  song_id   TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, song_id)
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,
  group_id    TEXT REFERENCES groups(id) ON DELETE SET NULL,
  trainer     TEXT,
  topics      TEXT,
  status      TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','in_progress','completed','cancelled')),
  notes       TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_participants (
  training_id  TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  attendance   TEXT NOT NULL DEFAULT 'pending'
                 CHECK (attendance IN ('pending','present','late','absent','excused')),
  completed    INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  PRIMARY KEY (training_id, member_id)
);

-- ---------------------------------------------------------------------------
-- Announcements & notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  audience      TEXT NOT NULL DEFAULT 'all'
                  CHECK (audience IN ('all','senior','junior','members','selected')),
  priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('normal','important','urgent')),
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','published','archived')),
  scheduled_at  TEXT,
  published_at  TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);

CREATE TABLE IF NOT EXISTS announcement_recipients (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at        TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- ---------------------------------------------------------------------------
-- Direct messages ("talk to the Chairman")
-- ---------------------------------------------------------------------------
-- Any signed-in member may send a private message to the Chairman. The Chairman
-- reads them in an inbox and can reply once. Kept separate from notifications so
-- the conversation (including the reply) is preserved for both parties.
CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  sender_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_name       TEXT NOT NULL,
  sender_email      TEXT,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  read_at           TEXT,
  reply_body        TEXT,
  reply_at          TEXT,
  replied_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_user_id, created_at);

-- ---------------------------------------------------------------------------
-- File storage registry
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS file_uploads (
  id          TEXT PRIMARY KEY,
  bucket      TEXT NOT NULL CHECK (bucket IN ('public','private')),
  path        TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type   TEXT,
  file_size   INTEGER,
  entity_type TEXT,
  entity_id   TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_uploads_entity ON file_uploads(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Integration settings (secrets stored encrypted, never in frontend)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS integration_settings (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  value_encrypted TEXT,                             -- AES-256-GCM ciphertext for secrets
  value_plain TEXT,                                 -- non-secret values (ids, flags)
  is_secret   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'not_configured'
                CHECK (status IN ('not_configured','configured','error')),
  error_message TEXT,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_runs (
  id           TEXT PRIMARY KEY,
  integration  TEXT NOT NULL,
  trigger      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running','success','error')),
  summary      TEXT,
  detail       TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);

-- ---------------------------------------------------------------------------
-- Application settings (choir-configurable policies)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Audit log (append-only; triggers below reject UPDATE/DELETE)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  summary       TEXT NOT NULL,
  change_detail TEXT,
  ip_address    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
