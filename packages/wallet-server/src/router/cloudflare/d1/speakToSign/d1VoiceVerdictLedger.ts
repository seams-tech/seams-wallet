import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import { d1ChangedRows } from '../../../../storage/d1Sql';
import type {
  VoiceVerdictLedger,
  VoiceVerdictLedgerAdmission,
} from '../../../domains/speakToSign/voiceVerdictAdmission';

// One statement inserts the verdict only when the wallet's voice-only sum stays within the limit.
// D1 runs one write at a time, so two requests cannot both pass the limit.
const ADMIT = `INSERT INTO speak_to_sign_voice_verdicts
  (namespace, verdict_id, wallet_id, request_id, voice_hundredths, accepted_at_ms, expires_at_ms)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
  WHERE ?5 = 0 OR ?5 + (SELECT COALESCE(SUM(voice_hundredths), 0) FROM speak_to_sign_voice_verdicts
    WHERE namespace = ?1 AND wallet_id = ?3 AND accepted_at_ms > ?8) <= ?9
  ON CONFLICT (namespace, verdict_id) DO NOTHING`;
// A record outside the 24-hour window counts toward no limit, and its verdict expired long ago,
// so the reuse check no longer needs it. Each admission deletes the wallet's old records.
const PRUNE = `DELETE FROM speak_to_sign_voice_verdicts
  WHERE namespace = ?1 AND wallet_id = ?2 AND accepted_at_ms <= ?3`;
const READ = `SELECT wallet_id, request_id FROM speak_to_sign_voice_verdicts
  WHERE namespace = ?1 AND verdict_id = ?2`;

/** The co-signer's record of accepted Speak-to-Sign verdicts, in the signer database. */
export function createD1VoiceVerdictLedger(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
}): VoiceVerdictLedger {
  return {
    async admit(record): Promise<VoiceVerdictLedgerAdmission> {
      const [, inserted] = await input.database.batch<D1ResultLike>([
        input.database.prepare(PRUNE).bind(input.namespace, record.walletId, record.windowStartMs),
        input.database
          .prepare(ADMIT)
          .bind(
            input.namespace,
            record.verdictId,
            record.walletId,
            record.requestId,
            record.voiceHundredths,
            record.acceptedAtMs,
            record.expiresAtMs,
            record.windowStartMs,
            record.limitHundredths,
          ),
      ]);
      if (inserted && d1ChangedRows(inserted) === 1) return 'admitted';
      const existing = await input.database
        .prepare(READ)
        .bind(input.namespace, record.verdictId)
        .first<{ readonly wallet_id: unknown; readonly request_id: unknown }>();
      if (existing === null) return 'over_daily_limit';
      return existing.wallet_id === record.walletId && existing.request_id === record.requestId
        ? 'replayed'
        : 'reused';
    },
  };
}
