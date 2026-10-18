-- Until now a password existed only as a one-way scrypt hash, so the credentials
-- generated at approval were displayed exactly once and could never be recovered
-- for the administrator who has to hand them over.
--
-- `password_hash` stays the verifier that login checks (nothing about hashing
-- changes). In addition, every password the application sets is kept in
-- `password_enc` as AES-256-GCM ciphertext under APP_SECRET, which is what the
-- member's own record shows and what the approval email contains.
ALTER TABLE users ADD COLUMN password_enc TEXT;
