import { isPlainObject, requireCanonicalString } from '@shared/utils/validation';
import {
  parseWalletId,
  parseWalletAuthorityId,
  parseWalletAuthMethodId,
  type WalletId,
  type WalletAuthorityId,
  type WalletAuthMethodId,
} from '@shared/utils/domainIds';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { parseSessionOrigin, type SessionOrigin } from '../../../../authorization/domain';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { D1TenantScope } from '../../../../core/d1TenantStore';

const MAX_CHALLENGE_LIFETIME_MS = 300_000;

// This is a challenge binding, not evidence of owner approval.
export class WalletRelocationChallengeBinding {
  readonly #canonical: string;
  private constructor(
    readonly walletId: WalletId,
    readonly moveId: string,
    readonly requestDigestHex: string,
    readonly sourceGeneration: number,
    readonly destinationRegion: 'US' | 'WEUR' | 'APAC' | 'OC',
    readonly authorityId: WalletAuthorityId,
    readonly walletAuthMethodId: WalletAuthMethodId,
    readonly credentialDigestHex: string,
    readonly credentialExpiresAtMs: number,
    readonly origin: SessionOrigin,
  ) {
    this.#canonical = JSON.stringify([
      'seams/wallet-relocation-challenge/v1',
      walletId,
      moveId,
      requestDigestHex,
      sourceGeneration,
      destinationRegion,
      authorityId,
      walletAuthMethodId,
      credentialDigestHex,
      credentialExpiresAtMs,
      origin,
    ]);
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletRelocationChallengeBinding {
    if (!isPlainObject(raw) || Object.keys(raw).length !== 10) throw invalid();
    const wallet = parseWalletId(raw.walletId);
    const authority = parseWalletAuthorityId(raw.authorityId);
    const method = parseWalletAuthMethodId(raw.walletAuthMethodId);
    if (!wallet.ok || !authority.ok || !method.ok) throw invalid();
    return new WalletRelocationChallengeBinding(
      wallet.value,
      matching(raw.moveId, /^wmove_[A-Za-z0-9_-]{43}$/u),
      matching(raw.requestDigestHex, /^[a-f0-9]{64}$/u),
      timestamp(raw.sourceGeneration),
      region(raw.destinationRegion),
      authority.value,
      method.value,
      matching(raw.credentialDigestHex, /^[a-f0-9]{64}$/u),
      timestamp(raw.credentialExpiresAtMs),
      parseSessionOrigin(raw.origin),
    );
  }

  encoded(): string {
    return this.#canonical;
  }
}

type ChallengeFields = {
  readonly binding: WalletRelocationChallengeBinding;
  readonly challengeB64u: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
};

type IssuedChallenge = ChallengeFields & {
  readonly state: 'issued';
  readonly consumedAtMs?: never;
};

type StoredChallenge =
  | IssuedChallenge
  | (ChallengeFields & {
      readonly state: 'consumed';
      readonly consumedAtMs: number;
    });

export class D1WalletRelocationChallenges {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async issue(
    binding: WalletRelocationChallengeBinding,
    nowMs: number,
    factorExpiresAtMs: number,
  ): Promise<StoredChallenge> {
    timestamp(nowMs);
    const previous = await this.read(binding);
    if (previous) return previous;
    const expiresAtMs = Math.min(
      nowMs + MAX_CHALLENGE_LIFETIME_MS,
      timestamp(factorExpiresAtMs),
      binding.credentialExpiresAtMs,
    );
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) throw invalid();
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO wallet_relocation_challenges
      (namespace, org_id, project_id, env_id, wallet_id, move_id, binding_json,
       challenge_b64u, created_at_ms, expires_at_ms)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        ...this.key(binding),
        binding.encoded(),
        secureRandomBase64Url(32, 'relocation challenge'),
        nowMs,
        expiresAtMs,
      )
      .run();
    const created = await this.read(binding);
    if (!created) throw new Error('Relocation challenge was not recorded');
    return created;
  }

  async read(binding: WalletRelocationChallengeBinding): Promise<StoredChallenge | null> {
    const row = await this.database
      .prepare(
        `SELECT binding_json, challenge_b64u,
      created_at_ms, expires_at_ms, consumed_at_ms FROM wallet_relocation_challenges
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
        AND wallet_id = ?5 AND move_id = ?6`,
      )
      .bind(...this.key(binding))
      .first<Record<string, unknown>>();
    if (!row) return null;
    if (row.binding_json !== binding.encoded())
      throw new Error('Relocation challenge binding changed');
    const challengeB64u = matching(row.challenge_b64u, /^[A-Za-z0-9_-]{43}$/u);
    const createdAtMs = timestamp(row.created_at_ms);
    const expiresAtMs = timestamp(row.expires_at_ms);
    if (
      expiresAtMs <= createdAtMs ||
      expiresAtMs - createdAtMs > MAX_CHALLENGE_LIFETIME_MS ||
      expiresAtMs > binding.credentialExpiresAtMs
    )
      throw invalid();
    if (row.consumed_at_ms === null) {
      return { state: 'issued', binding, challengeB64u, createdAtMs, expiresAtMs };
    }
    const consumedAtMs = timestamp(row.consumed_at_ms);
    if (consumedAtMs < createdAtMs || consumedAtMs >= expiresAtMs) throw invalid();
    return { state: 'consumed', binding, challengeB64u, createdAtMs, expiresAtMs, consumedAtMs };
  }

  // The caller adds these statements to the owner guard, factor consumption, and approval batch.
  prepareConsume(challenge: IssuedChallenge, nowMs: number): readonly D1PreparedStatementLike[] {
    timestamp(nowMs);
    if (nowMs < challenge.createdAtMs || nowMs >= challenge.expiresAtMs) throw invalid();
    return [
      this.database
        .prepare(
          `UPDATE wallet_relocation_challenges SET consumed_at_ms = ?7
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND consumed_at_ms IS NULL
          AND binding_json = ?8 AND challenge_b64u = ?9
          AND created_at_ms = ?10 AND expires_at_ms = ?11
          AND created_at_ms <= ?7 AND expires_at_ms > ?7`,
        )
        .bind(
          ...this.key(challenge.binding),
          nowMs,
          challenge.binding.encoded(),
          challenge.challengeB64u,
          challenge.createdAtMs,
          challenge.expiresAtMs,
        ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ];
  }

  private key(binding: WalletRelocationChallengeBinding): readonly string[] {
    return [
      this.scope.namespace,
      this.scope.orgId,
      this.scope.projectId,
      this.scope.envId,
      binding.walletId,
      binding.moveId,
    ];
  }
}

function matching(raw: unknown, pattern: RegExp): string {
  const value = requireCanonicalString(raw, 'relocation challenge identity');
  if (!pattern.test(value)) throw invalid();
  return value;
}

function timestamp(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) throw invalid();
  return raw;
}

function invalid(): Error {
  return new Error('Relocation challenge is invalid or expired');
}

function region(raw: unknown): 'US' | 'WEUR' | 'APAC' | 'OC' {
  switch (raw) {
    case 'US':
    case 'WEUR':
    case 'APAC':
    case 'OC':
      return raw;
    default:
      throw invalid();
  }
}
