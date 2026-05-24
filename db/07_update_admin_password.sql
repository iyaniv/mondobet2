-- =============================================================================
-- WC2026 Predictions — Rotate the seeded admin password
-- =============================================================================
-- Updates the admin user's password from the original default ("Admin") to
-- "U2k2much!". Bcrypt hash, rounds=12. Idempotent — re-running is a no-op.
--
-- Run in the Neon SQL Editor.
-- =============================================================================

UPDATE users
SET password_hash = '$2b$12$5nHOP8I/asFJZ1od8W7HHe/hV4.qfRMmNelKmwtiegToNi/tL5cVG'
WHERE email = 'admin';
