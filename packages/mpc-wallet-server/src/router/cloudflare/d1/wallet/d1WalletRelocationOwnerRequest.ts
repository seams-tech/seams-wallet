import type { WalletSessionAuthorizationId, TenantId } from '@shared/authorization/capabilityKinds';
import type { WalletId, WalletAuthorityId, WalletAuthMethodId } from '@shared/utils/domainIds';
import { sha256HexUtf8 } from '@shared/utils/digests';
import {
  buildDelegatedWalletAuthorityV1,
  buildFullOwnerPermissionsV1,
  sameDelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';
import {
  parseSessionOrigin,
  buildWalletSessionCapabilitySubjectsV1,
  walletSessionCapabilitySubjectsV1Equal,
  type SessionOrigin,
} from '../../../../authorization/domain';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import { digestOpaqueValue, type AuthorizationService } from '../../../../authorization/service';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';
import { WalletRelocationChallengeBinding } from './d1WalletRelocationChallenges';

export class WalletRelocationOwnerRequest {
  readonly #credentialDigestHex: string;

  private constructor(
    readonly walletId: WalletId,
    readonly authorityId: WalletAuthorityId,
    readonly walletAuthMethodId: WalletAuthMethodId,
    readonly credentialExpiresAtMs: number,
    readonly origin: SessionOrigin,
    credentialDigestHex: string,
    private readonly scope: D1TenantScope,
    private readonly tenantId: TenantId,
    private readonly authorizationId: WalletSessionAuthorizationId,
    private readonly credentialHash: DigestB64u,
  ) {
    this.#credentialDigestHex = credentialDigestHex;
    Object.freeze(this);
  }

  static async authenticate(input: {
    readonly request: Request;
    readonly walletId: WalletId;
    readonly tenantId: TenantId;
    readonly scope: D1TenantScope;
    readonly allowedOrigins: readonly SessionOrigin[];
    readonly authorizationSessions: Pick<
      AuthorizationService,
      'readWalletSessionExactOperationContextByCredential'
    >;
    readonly nowMs: number;
  }): Promise<WalletRelocationOwnerRequest | null> {
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) return null;
    const token = extractBearerCredential(input.request.headers);
    if (!token) return null;
    let origin: SessionOrigin;
    try {
      origin = parseSessionOrigin(input.request.headers.get('origin'));
    } catch {
      return null;
    }
    if (!input.allowedOrigins.includes(origin)) return null;
    const context =
      await input.authorizationSessions.readWalletSessionExactOperationContextByCredential({
        tenantId: input.tenantId,
        token,
        nowMs: input.nowMs,
      });
    if (!context) return null;
    const { session, authority, ownerWalletScope } = context;
    if (
      session.walletId !== input.walletId ||
      session.tenantId !== input.tenantId ||
      ownerWalletScope.orgId !== input.scope.orgId ||
      ownerWalletScope.projectId !== input.scope.projectId ||
      ownerWalletScope.projectEnvironmentId !== input.scope.envId ||
      !sameDelegatedWalletAuthorityV1(
        buildDelegatedWalletAuthorityV1({ permissions: authority.permissions }),
        buildDelegatedWalletAuthorityV1({ permissions: buildFullOwnerPermissionsV1() }),
      ) ||
      !walletSessionCapabilitySubjectsV1Equal(
        session.capabilitySubjects,
        buildWalletSessionCapabilitySubjectsV1(authority),
      )
    )
      return null;
    return new WalletRelocationOwnerRequest(
      session.walletId,
      session.authorityId,
      session.walletAuthMethodId,
      session.expiresAtMs,
      origin,
      await sha256HexUtf8(token),
      Object.freeze({ ...input.scope }),
      session.tenantId,
      session.authorizationId,
      await digestOpaqueValue(token),
    );
  }

  prepareApprovalGuard(
    database: D1DatabaseLike,
    scope: D1TenantScope,
    binding: WalletRelocationChallengeBinding,
    nowMs: number,
  ): readonly D1PreparedStatementLike[] {
    if (
      scope.namespace !== this.scope.namespace ||
      scope.orgId !== this.scope.orgId ||
      scope.projectId !== this.scope.projectId ||
      scope.envId !== this.scope.envId ||
      this.bindMove(binding).encoded() !== binding.encoded()
    )
      throw new Error('Relocation approval owner binding changed');
    return [
      database
        .prepare(
          `UPDATE wallet_session_authorizations_v2
        SET retired_at_ms = retired_at_ms
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND tenant_id = ?5 AND authorization_id = ?6
          AND wallet_id = ?7 AND authority_id = ?8 AND wallet_auth_method_id = ?9
          AND operation_credential_hash = ?10 AND expires_at_ms = ?11
          AND retired_at_ms IS NULL AND expires_at_ms > ?12
          AND expires_at_ms > CAST(unixepoch('subsec') * 1000 AS INTEGER)`,
        )
        .bind(
          scope.namespace,
          scope.orgId,
          scope.projectId,
          scope.envId,
          this.tenantId,
          this.authorizationId,
          this.walletId,
          this.authorityId,
          this.walletAuthMethodId,
          this.credentialHash,
          this.credentialExpiresAtMs,
          nowMs,
        ),
      database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ];
  }

  bindMove(input: {
    readonly moveId: string;
    readonly requestDigestHex: string;
    readonly sourceGeneration: number;
    readonly destinationRegion: WalletRelocationChallengeBinding['destinationRegion'];
  }): WalletRelocationChallengeBinding {
    return WalletRelocationChallengeBinding.parse({
      walletId: this.walletId,
      moveId: input.moveId,
      requestDigestHex: input.requestDigestHex,
      sourceGeneration: input.sourceGeneration,
      destinationRegion: input.destinationRegion,
      authorityId: this.authorityId,
      walletAuthMethodId: this.walletAuthMethodId,
      credentialDigestHex: this.#credentialDigestHex,
      credentialExpiresAtMs: this.credentialExpiresAtMs,
      origin: this.origin,
    });
  }
}
