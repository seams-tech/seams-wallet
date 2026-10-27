import { parsePrincipalId, parseTenantId, type TenantId } from '@shared/authorization/capabilityKinds';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import {
  DEFAULT_WALLET_SESSION_REMAINING_USES,
  DEFAULT_WALLET_SESSION_TTL_MS,
  LINKED_DEVICE_WALLET_SESSION_REMAINING_USES,
  LINKED_DEVICE_WALLET_SESSION_TTL_MS,
} from '@shared/threshold/sessionPolicy';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import type { AuthorizationService } from '../../../../authorization/service';
import { verifyVoiceIdWalletSessionAssertion, type RegisteredVoiceIdDeviceKey } from '../../../../authorization/voiceIdDeviceProof';
import type { D1WalletAuthMethodStore } from '../../../../core/d1WalletAuthMethodStore';
import type { CloudflareD1PasskeyCustodyEnvelopeStore } from '../passkeyCustody/d1PasskeyCustodyEnvelopeStore';
import type { D1WalletAuthorityStore } from './d1WalletAuthorityStore';
import { isFullOwnerAuthorityV1 } from './d1WalletAuthMethodService';
import type {
  VoiceIdChallengeRequest,
  VoiceIdChallengeResult,
  VoiceIdVerifyRequest,
  VoiceIdVerifyResult,
} from '../../../domains/voiceId/voiceIdSessions';
import { D1VoiceIdWalletSessionChallenges } from './d1VoiceIdWalletSessionChallenges';
import { isVoiceIdSeedEnvelope, type VoiceIdSeedEnvelope } from '@shared/passkey-custody/custodyEnvelope';

type ActiveVoiceIdMethod = Readonly<{
  authMethod: ActiveVoiceIdWalletAuthMethodRecordV2;
  authority: ActiveWalletAuthorityV1;
  registered: RegisteredVoiceIdDeviceKey;
  custodyEnvelope: VoiceIdSeedEnvelope;
}>;

export class D1VoiceIdSessions {
  private readonly tenantId: TenantId;

  constructor(
    private readonly authMethods: D1WalletAuthMethodStore,
    private readonly authorities: D1WalletAuthorityStore,
    private readonly envelopes: CloudflareD1PasskeyCustodyEnvelopeStore,
    private readonly challenges: D1VoiceIdWalletSessionChallenges,
    private readonly authorization: Pick<AuthorizationService, 'issueDirectWalletSessionAuthorizationV2'>,
    orgId: string,
  ) {
    const tenantId = parseTenantId(orgId);
    if (!tenantId.ok) throw new Error(tenantId.error.message);
    this.tenantId = tenantId.value;
  }

  private async resolveActiveMethod(
    walletId: WalletId,
    walletAuthMethodId: WalletAuthMethodId,
  ): Promise<ActiveVoiceIdMethod | null> {
    const method = await this.authMethods.readByIdV2({ walletAuthMethodId });
    if (!method || method.kind !== 'voiceid' || method.status !== 'active' || method.walletId !== walletId) {
      return null;
    }
    const authority = await this.authorities.readById(method.walletAuthorityId);
    if (
      !authority ||
      authority.state !== 'active' ||
      authority.walletId !== walletId ||
      authority.authorityId !== method.walletAuthorityId ||
      !isFullOwnerAuthorityV1(authority)
    ) {
      return null;
    }
    const custody = await this.envelopes.lookupEnvelopeForWalletAuthMethod({
      walletId,
      walletAuthMethodId,
      factor: { kind: 'voiceid', deviceKeyId: method.deviceKeyId },
    });
    if (custody.kind !== 'active' || !isVoiceIdSeedEnvelope(custody.envelope)) {
      return null;
    }
    return {
      authMethod: method,
      authority,
      registered: {
        walletId,
        walletAuthMethodId,
        walletAuthorityId: method.walletAuthorityId,
        deviceKeyId: method.deviceKeyId,
        publicKeyB64u: method.devicePublicKeyB64u,
        status: 'active',
      },
      custodyEnvelope: custody.envelope,
    };
  }

  async issueChallenge(input: VoiceIdChallengeRequest): Promise<VoiceIdChallengeResult> {
    const active = await this.resolveActiveMethod(input.walletId, input.walletAuthMethodId);
    if (!active) return { kind: 'rejected', code: 'method_unavailable' };
    const challenge = await this.challenges.issue({
      registered: active.registered,
      requestOrigin: input.requestOrigin,
      audience: input.requestOrigin,
      nowMs: input.nowMs,
    });
    return { kind: 'issued', challenge };
  }

  async verifyAndIssue(input: VoiceIdVerifyRequest): Promise<VoiceIdVerifyResult> {
    const supplied = input.assertion.challenge;
    const expected = await this.challenges.read({
      challengeId: supplied.challengeId,
      requestOrigin: input.requestOrigin,
      audience: input.requestOrigin,
      nowMs: input.nowMs,
    });
    if (!expected) return { kind: 'rejected', code: 'challenge_unavailable' };
    const active = await this.resolveActiveMethod(expected.walletId, expected.walletAuthMethodId);
    if (!active) return { kind: 'rejected', code: 'method_unavailable' };
    let verified: Awaited<ReturnType<typeof verifyVoiceIdWalletSessionAssertion>>;
    try {
      verified = await verifyVoiceIdWalletSessionAssertion({
        registered: active.registered,
        expectedChallenge: expected,
        assertion: input.assertion,
        nowMs: input.nowMs,
        consumeChallenge: this.challenges.consume.bind(this.challenges),
      });
    } catch {
      return { kind: 'rejected', code: 'invalid_assertion' };
    }
    const principalId = parsePrincipalId(String(active.authority.walletId));
    if (!principalId.ok) return { kind: 'rejected', code: 'issuance_unavailable' };
    const deviceLinked = active.authority.provenance.kind === 'device_link';
    let issued: Awaited<ReturnType<AuthorizationService['issueDirectWalletSessionAuthorizationV2']>>;
    try {
      issued = await this.authorization.issueDirectWalletSessionAuthorizationV2({
        tenantId: this.tenantId,
        principalId: principalId.value,
        walletId: active.authority.walletId,
        authority: active.authority,
        walletAuthMethodId: active.authMethod.walletAuthMethodId,
        mintId: verified.challenge.challengeId,
        remainingUses: deviceLinked
          ? LINKED_DEVICE_WALLET_SESSION_REMAINING_USES
          : DEFAULT_WALLET_SESSION_REMAINING_USES,
        issuedAtMs: input.nowMs,
        expiresAtMs:
          input.nowMs +
          (deviceLinked ? LINKED_DEVICE_WALLET_SESSION_TTL_MS : DEFAULT_WALLET_SESSION_TTL_MS),
      });
    } catch {
      return { kind: 'rejected', code: 'issuance_unavailable' };
    }
    if (issued.kind !== 'issued') return { kind: 'rejected', code: 'issuance_unavailable' };
    return {
      kind: 'issued',
      authorization: { session: issued.session, quota: issued.quota },
      operationCredential: issued.operationCredential,
      custodyEnvelope: active.custodyEnvelope,
    };
  }
}
