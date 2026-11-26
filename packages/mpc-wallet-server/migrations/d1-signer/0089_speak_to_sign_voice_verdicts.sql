-- Speak-to-Sign verdicts that the co-signer accepted. Each verdict approves one signing request,
-- and the voice-only amounts of a wallet count toward its 24-hour voice limit.
CREATE TABLE speak_to_sign_voice_verdicts (
 namespace TEXT NOT NULL, verdict_id TEXT NOT NULL,
 wallet_id TEXT NOT NULL, request_id TEXT NOT NULL,
 voice_hundredths INTEGER NOT NULL CHECK(voice_hundredths>=0),
 accepted_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace,verdict_id)
);
CREATE INDEX speak_to_sign_voice_verdicts_by_wallet
 ON speak_to_sign_voice_verdicts(namespace,wallet_id,accepted_at_ms);
