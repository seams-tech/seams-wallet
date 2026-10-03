ALTER TABLE email_otp_registration_attempts
  ADD COLUMN selection_digest TEXT CHECK (selection_digest IS NULL OR length(selection_digest) > 0);
