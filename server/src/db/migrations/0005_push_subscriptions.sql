-- Device notifications (Web Push).
--
-- An administrator has to hear about a new membership application within
-- minutes — not the next time the site happens to be open in a tab. Web Push
-- delivers a real operating-system notification to a phone or a laptop while the
-- app is closed: the browser's push service holds the message and wakes the
-- device, with no third-party account and no cost.
--
-- A subscription belongs to one *device*, not one account: the same person is
-- signed in on a phone and on a laptop, and each has its own endpoint. The
-- endpoint is the browser's own address for that device and is unique, so
-- subscribing again on the same device updates the row instead of piling up
-- duplicates. Rows go with the account, because an endpoint is only meaningful
-- while somebody is signed in on that device.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_reason  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- The VAPID identity this deployment signs its pushes with (a signing key pair,
-- no user data). Generated on first use when VAPID_PUBLIC_KEY /
-- VAPID_PRIVATE_KEY are not supplied, and kept here because the hosting disk is
-- ephemeral: the pair must outlive a deploy, or every phone that had already
-- subscribed would silently stop receiving anything.
CREATE TABLE IF NOT EXISTS push_vapid_keys (
  id          TEXT PRIMARY KEY,
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
