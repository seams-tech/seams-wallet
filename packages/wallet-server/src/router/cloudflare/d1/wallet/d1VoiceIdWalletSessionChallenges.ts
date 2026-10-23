import { parseWalletSessionMintId, type WalletSessionMintId } from '@shared/authorization/capabilityKinds';
import {
  buildVoiceIdWalletSessionChallenge,
  parseVoiceIdWalletSessionChallenge,
  type VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify } from '@shared/utils/digests';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import type { RegisteredVoiceIdDeviceKey } from '../../../../authorization/voiceIdDeviceProof';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import { d1ChangedRows, parseD1JsonColumn } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';

const CHALLENGE_LIFETIME_MS = 60_000;
const EXPIRY_CLEANUP_LIMIT = 64;

type ChallengeRow = { readonly challenge_json?: unknown };

export class D1VoiceIdWalletSessionChallenges {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async issue(input: {
    readonly registered: RegisteredVoiceIdDeviceKey;
    readonly requestOrigin: string;
    readonly audience: string;
    readonly nowMs: number;
  }): Promise<VoiceIdWalletSessionChallenge> {
    requireTime(input.nowMs);
    const expiresAtMs = input.nowMs + CHALLENGE_LIFETIME_MS;
    requireTime(expiresAtMs);
    const challengeId = parseWalletSessionMintId(
      `voiceid:${secureRandomBase64Url(32, 'VoiceID Wallet Session challenge')}`,
    );
    if (!challengeId.ok) throw new Error(challengeId.error.message);
    const challenge = buildVoiceIdWalletSessionChallenge({
      walletId: input.registered.walletId,
      walletAuthMethodId: input.registered.walletAuthMethodId,
      walletAuthorityId: input.registered.walletAuthorityId,
      deviceKeyId: input.registered.deviceKeyId,
      challengeId: challengeId.value,
      nonce: parseDigestB64u(secureRandomBase64Url(32, 'VoiceID Wallet Session nonce')),
      requestOrigin: input.requestOrigin,
      audience: input.audience,
      issuedAtMs: input.nowMs,
      expiresAtMs,
    });
    await this.pruneExpired(input.nowMs);
    const result = await this.database
      .prepare(
        `INSERT INTO voiceid_wallet_session_challenges (
          namespace, org_id, project_id, env_id, challenge_id, wallet_id,
          wallet_auth_method_id, challenge_json, issued_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ...this.scopeValues(),
        String(challenge.challengeId),
        String(challenge.walletId),
        String(challenge.walletAuthMethodId),
        alphabetizeStringify(challenge),
        challenge.issuedAtMs,
        challenge.expiresAtMs,
      )
      .run();
    if (d1ChangedRows(result) !== 1) throw new Error('VoiceID challenge was not stored');
    return challenge;
  }

  async read(input: {
    readonly challengeId: WalletSessionMintId;
    readonly requestOrigin: string;
    readonly audience: string;
    readonly nowMs: number;
  }): Promise<VoiceIdWalletSessionChallenge | null> {
    requireTime(input.nowMs);
    const row = await this.database
      .prepare(
        `SELECT challenge_json FROM voiceid_wallet_session_challenges
          WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
            AND challenge_id = ? AND consumed_at_ms IS NULL
            AND issued_at_ms <= ? AND expires_at_ms > ?
          LIMIT 1`,
      )
      .bind(...this.scopeValues(), String(input.challengeId), input.nowMs, input.nowMs)
      .first<ChallengeRow>();
    if (!row) return null;
    const challenge = parseVoiceIdWalletSessionChallenge(parseD1JsonColumn(row.challenge_json));
    if (challenge.challengeId !== input.challengeId) {
      throw new Error('Stored VoiceID challenge identity changed');
    }
    if (challenge.requestOrigin !== input.requestOrigin || challenge.audience !== input.audience) {
      return null;
    }
    return challenge;
  }

  async consume(challenge: VoiceIdWalletSessionChallenge, nowMs: number): Promise<boolean> {
    requireTime(nowMs);
    const parsed = parseVoiceIdWalletSessionChallenge(challenge);
    if (nowMs < parsed.issuedAtMs || nowMs >= parsed.expiresAtMs) return false;
    const result = await this.database
      .prepare(
        `UPDATE voiceid_wallet_session_challenges SET consumed_at_ms = ?
          WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
            AND challenge_id = ? AND wallet_id = ? AND wallet_auth_method_id = ?
            AND challenge_json = ? AND consumed_at_ms IS NULL
            AND issued_at_ms <= ? AND expires_at_ms > ?`,
      )
      .bind(
        nowMs,
        ...this.scopeValues(),
        String(parsed.challengeId),
        String(parsed.walletId),
        String(parsed.walletAuthMethodId),
        alphabetizeStringify(parsed),
        nowMs,
        nowMs,
      )
      .run();
    return d1ChangedRows(result) === 1;
  }

  private async pruneExpired(nowMs: number): Promise<void> {
    await this.database
      .prepare(
        `WITH expired AS (
          SELECT rowid FROM voiceid_wallet_session_challenges
            WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
              AND expires_at_ms <= ?
            ORDER BY expires_at_ms ASC, challenge_id ASC
            LIMIT ?
        ) DELETE FROM voiceid_wallet_session_challenges
          WHERE rowid IN (SELECT rowid FROM expired)`,
      )
      .bind(...this.scopeValues(), nowMs, EXPIRY_CLEANUP_LIMIT)
      .run();
  }

  private scopeValues(): readonly [string, string, string, string] {
    return [this.scope.namespace, this.scope.orgId, this.scope.projectId, this.scope.envId];
  }
}

function requireTime(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('VoiceID challenge time is invalid');
  }
}
