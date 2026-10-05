import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import type { WalletRelocationChallengeBinding } from './d1WalletRelocationChallenges';
import { verifyWalletRelocationPasskey } from './d1WalletRelocationPasskey';

type StoredApproval = {
  readonly binding: WalletRelocationChallengeBinding;
  readonly authorityDigestB64u: DigestB64u;
  readonly authorityRevocationEpoch: number;
  readonly approvedAtMs: number;
  readonly expiresAtMs: number;
};

type ApprovalResult =
  | { readonly kind: 'approved'; readonly approval: StoredApproval }
  | { readonly kind: 'denied'; readonly approval?: never };

// The authenticated owner boundary must bind the initiating credential before calling this store.
export class D1WalletRelocationApprovals {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async approvePasskey(input: {
    readonly binding: WalletRelocationChallengeBinding;
    readonly credential: unknown;
    readonly nowMs: number;
  }): Promise<ApprovalResult> {
    const previous = await this.read(input.binding);
    if (previous) return { kind: 'approved', approval: previous };
    const verified = await verifyWalletRelocationPasskey({
      database: this.database,
      scope: this.scope,
      binding: input.binding,
      credential: input.credential,
      nowMs: input.nowMs,
    });
    if (verified.kind === 'denied') {
      const concurrent = await this.read(input.binding);
      return concurrent ? { kind: 'approved', approval: concurrent } : { kind: 'denied' };
    }
    const statements = [
      ...verified.commitPrerequisites,
      this.database
        .prepare(
          `INSERT INTO wallet_relocation_approvals
        (namespace, org_id, project_id, env_id, wallet_id, move_id, binding_json,
         authority_digest_b64u, authority_revocation_epoch, approved_at_ms, expires_at_ms)
        SELECT namespace, org_id, project_id, env_id, wallet_id, move_id, binding_json,
          ?8, ?9, consumed_at_ms, expires_at_ms
        FROM wallet_relocation_challenges
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND binding_json = ?7
          AND consumed_at_ms = ?10 AND expires_at_ms > ?10
          AND expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)`,
        )
        .bind(
          ...this.key(input.binding),
          input.binding.encoded(),
          verified.authorityDigestB64u,
          verified.authorityRevocationEpoch,
          input.nowMs,
        ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ];
    try {
      const results = await this.database.batch<D1ResultLike>(statements);
      if (results.length !== statements.length || results.some(failedStatement)) {
        throw new Error('Relocation approval batch failed');
      }
    } catch (error) {
      const concurrent = await this.read(input.binding);
      if (concurrent) return { kind: 'approved', approval: concurrent };
      throw error;
    }
    const approval = await this.read(input.binding);
    if (!approval) throw new Error('Relocation approval was not recorded');
    return { kind: 'approved', approval };
  }

  // A stored outcome is historical evidence. Reads do not authorize new admission or status access.
  async read(binding: WalletRelocationChallengeBinding): Promise<StoredApproval | null> {
    const row = await this.database
      .prepare(
        `SELECT binding_json, authority_digest_b64u,
      authority_revocation_epoch, approved_at_ms, expires_at_ms FROM wallet_relocation_approvals
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
        AND wallet_id = ?5 AND move_id = ?6`,
      )
      .bind(...this.key(binding))
      .first<Record<string, unknown>>();
    if (!row) return null;
    if (row.binding_json !== binding.encoded())
      throw new Error('Relocation approval binding changed');
    const approvedAtMs = row.approved_at_ms;
    const expiresAtMs = row.expires_at_ms;
    const authorityRevocationEpoch = row.authority_revocation_epoch;
    if (
      typeof approvedAtMs !== 'number' ||
      !Number.isSafeInteger(approvedAtMs) ||
      approvedAtMs <= 0 ||
      typeof expiresAtMs !== 'number' ||
      !Number.isSafeInteger(expiresAtMs) ||
      expiresAtMs <= approvedAtMs ||
      expiresAtMs - approvedAtMs > 300_000 ||
      expiresAtMs > binding.credentialExpiresAtMs ||
      typeof authorityRevocationEpoch !== 'number' ||
      !Number.isSafeInteger(authorityRevocationEpoch) ||
      authorityRevocationEpoch < 0 ||
      typeof row.authority_digest_b64u !== 'string'
    )
      throw new Error('Stored relocation approval is invalid');
    return {
      binding,
      authorityDigestB64u: parseDigestB64u(row.authority_digest_b64u),
      authorityRevocationEpoch,
      approvedAtMs,
      expiresAtMs,
    };
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

function failedStatement(result: D1ResultLike): boolean {
  return result.success !== true;
}
