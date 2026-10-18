-- Applicants who leave the Google Form's "Email Address" question blank still
-- need a system account. Such an account has no usable email, so it signs in with
-- a username derived from the applicant's full name ("Irabizi Valentin").
-- Accounts that do have an email keep working exactly as before; a username is
-- set for them too, so either identifier signs them in.
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN username_normalized TEXT;

-- Case/format-insensitive uniqueness. Partial index: administrators and pre-existing
-- accounts keep a NULL username and are never affected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized
  ON users(username_normalized) WHERE username_normalized IS NOT NULL;
