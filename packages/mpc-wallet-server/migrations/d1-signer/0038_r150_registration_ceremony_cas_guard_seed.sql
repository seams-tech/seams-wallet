-- R150: seed the registration ceremony CAS guard.
--
-- Guarded D1 batches abort by colliding with this immutable singleton when a
-- preceding compare-and-swap statement changes no row. 0001 created the table
-- but not its row, so the first guard to fire on each database inserted the
-- row and let its batch commit instead of aborting. Registration ceremony
-- records and the Email OTP registration receipt use this guard.
INSERT OR IGNORE INTO registration_ceremony_cas_guard (guard_id) VALUES (1);
