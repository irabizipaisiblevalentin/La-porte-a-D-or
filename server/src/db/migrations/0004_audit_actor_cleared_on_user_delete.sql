-- `audit_logs.actor_id` is declared `ON DELETE SET NULL`, so deleting a sign-in
-- account is *meant* to clear the pointer from the rows that account wrote. The
-- append-only trigger forbade every UPDATE, which made that declared action
-- impossible: deleting any account that had ever performed an audited action
-- tripped the trigger and the whole removal failed (`SQLITE_CONSTRAINT_TRIGGER
-- audit_logs is append-only`).
--
-- The trigger now permits exactly that one change — the actor pointer going from
-- a value to NULL — and only when no other column moves. `actor_name` is stored
-- on every row, so the trail still reads correctly after the account is gone,
-- and recorded history still cannot be altered or deleted.

DROP TRIGGER IF EXISTS audit_logs_no_update;

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
WHEN NOT (
  NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
  AND NEW.id IS OLD.id
  AND NEW.actor_name IS OLD.actor_name
  AND NEW.action IS OLD.action
  AND NEW.entity_type IS OLD.entity_type
  AND NEW.entity_id IS OLD.entity_id
  AND NEW.summary IS OLD.summary
  AND NEW.change_detail IS OLD.change_detail
  AND NEW.ip_address IS OLD.ip_address
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
