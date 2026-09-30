-- R150: which route answered a recorded revocation.
--
-- A linked device's method is revoked through the device-management route,
-- whose answer names the device's authority and its revocation epoch; the
-- auth-method route answers with the method's kind. Both record the answer
-- here, keyed by the method and bound to the same operation fingerprint, so
-- each route reads back only an answer it recorded itself.
ALTER TABLE wallet_auth_method_revocation_replays
  ADD COLUMN answer_kind TEXT NOT NULL DEFAULT 'wallet_auth_method_revocation_v1';
