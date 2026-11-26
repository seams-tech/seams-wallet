import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import { d1ChangedRows } from '../../../../storage/d1Sql';
import type {
  VoiceVerdictLedger,
  VoiceVerdictLedgerAdmission,
} from '../../../domains/speakToSign/voiceVerdictAdmission';

// The first request that brings a verdict gets its record. The table keeps the amount column
// of the earlier voice limit, which every record now sets to 0.
const ADMIT = `INSERT INTO speak_to_sign_voice_verdicts
  (namespace, verdict_id, wallet_id, request_id, voice_hundredths, accepted_at_ms, expires_at_ms)
  VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)
  ON CONFLICT (namespace, verdict_id) DO NOTHING`;
// The co-signer refuses an expired verdict before it reads the ledger, so the reuse check no
// longer needs the record. Each admission deletes the wallet's expired records.
const PRUNE = `DELETE FROM speak_to_sign_voice_verdicts
  WHERE namespace = ?1 AND wallet_id = ?2 AND expires_at_ms <= ?3`;
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
        input.database.prepare(PRUNE).bind(input.namespace, record.walletId, record.acceptedAtMs),
        input.database
          .prepare(ADMIT)
          .bind(
            input.namespace,
            record.verdictId,
            record.walletId,
            record.requestId,
            record.acceptedAtMs,
            record.expiresAtMs,
          ),
      ]);
      if (inserted && d1ChangedRows(inserted) === 1) return 'admitted';
      const existing = await input.database
        .prepare(READ)
        .bind(input.namespace, record.verdictId)
        .first<{ readonly wallet_id: unknown; readonly request_id: unknown }>();
      // No row after a conflict means that another admission deleted it meanwhile.
      return existing?.wallet_id === record.walletId && existing.request_id === record.requestId
        ? 'replayed'
        : 'reused';
    },
  };
}
