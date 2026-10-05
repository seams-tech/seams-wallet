import type { TenantId } from '@shared/authorization/capabilityKinds';
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
import type { AuthorizationService } from '../../../../authorization/service';
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
    );
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
