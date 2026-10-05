import { isPlainObject } from '@shared/utils/validation';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';

// This identity is supplied by admitted move orchestration after outstanding
// effects settle. Parsing it grants no owner or execution authority.
export class WalletRelocationSessionSource {
  readonly #validated = true;
  private constructor(
    readonly walletId: WalletId,
    readonly moveId: string,
    readonly requestDigestHex: string,
    readonly sourceGeneration: number,
  ) {
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletRelocationSessionSource {
    if (!isPlainObject(raw) || Object.keys(raw).length !== 4)
      throw new Error('Invalid session relocation identity');
    const wallet = parseWalletId(raw.walletId);
    if (
      !wallet.ok ||
      typeof raw.moveId !== 'string' ||
      !/^wmove_[A-Za-z0-9_-]{43}$/u.test(raw.moveId) ||
      typeof raw.requestDigestHex !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(raw.requestDigestHex) ||
      typeof raw.sourceGeneration !== 'number' ||
      !Number.isSafeInteger(raw.sourceGeneration) ||
      raw.sourceGeneration < 1 ||
      raw.sourceGeneration >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('Invalid session relocation identity');
    }
    return new WalletRelocationSessionSource(
      wallet.value,
      raw.moveId,
      raw.requestDigestHex,
      raw.sourceGeneration,
    );
  }

  matches(row: Record<string, unknown>): boolean {
    return (
      this.#validated &&
      row.wallet_id === this.walletId &&
      row.move_id === this.moveId &&
      row.request_digest_hex === this.requestDigestHex &&
      row.source_generation === this.sourceGeneration
    );
  }
}

export class D1WalletRelocationSessions {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async hasPendingOperations(walletId: WalletId): Promise<boolean> {
    const pending = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT 1 FROM wallet_session_pending_operations
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
         AND wallet_id = ?5 LIMIT 1`,
      [walletId],
    ).first();
    return pending !== null;
  }

  async retire(source: WalletRelocationSessionSource, nowMs: number): Promise<number> {
    parseUnixMs(nowMs, 'session relocation time');
    const existing = await this.read(source);
    if (existing !== null) return existing;
    const identity = [
      source.walletId,
      source.moveId,
      source.requestDigestHex,
      source.sourceGeneration,
    ];
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        INSERT INTO wallet_relocation_session_fences
          (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation, retired_at_ms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT (namespace, org_id, project_id, env_id, wallet_id) DO NOTHING`,
        [...identity, nowMs],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_relocation_session_fences SET retired_at_ms = retired_at_ms
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`,
        identity,
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE authorization_wallet_session_quotas AS quota SET remaining_uses = 0, lifecycle_kind = 'exhausted'
        WHERE quota.lifecycle_kind = 'active' AND EXISTS (
          SELECT 1 FROM wallet_session_authorizations_v2 AS session
          WHERE session.namespace = ?1 AND session.org_id = ?2 AND session.project_id = ?3 AND session.env_id = ?4
            AND session.wallet_id = ?5 AND session.retired_at_ms IS NULL
            AND session.namespace = quota.namespace AND session.tenant_id = quota.tenant_id
            AND session.quota_id = quota.quota_id AND session.wallet_session_id = quota.wallet_session_id
        )`,
        [source.walletId],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_session_hosted_credentials_v2 SET lifecycle_kind = 'retired',
          retired_at_ms = MAX(issued_at_ms, ?6)
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND lifecycle_kind = 'active' AND retired_at_ms IS NULL`,
        [source.walletId, nowMs],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `
        UPDATE wallet_session_authorizations_v2 SET retired_at_ms = MAX(issued_at_ms, ?6)
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND wallet_id = ?5 AND retired_at_ms IS NULL`,
        [source.walletId, nowMs],
      ),
    ]);
    const retiredAtMs = await this.read(source);
    if (retiredAtMs === null) throw new Error('Session relocation retirement disappeared');
    return retiredAtMs;
  }

  private async read(source: WalletRelocationSessionSource): Promise<number | null> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT wallet_id, move_id, request_digest_hex, source_generation, retired_at_ms
      FROM wallet_relocation_session_fences
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4 AND wallet_id = ?5`,
      [source.walletId],
    ).first<Record<string, unknown>>();
    if (!row) return null;
    if (!source.matches(row))
      throw new Error('Session relocation identity conflicts with its source fence');
    return parseUnixMs(row.retired_at_ms, 'stored session relocation time');
  }
}
