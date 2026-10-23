import type { VoiceIdDevicePublicKeyB64u } from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlDecode } from '@shared/utils/base64';
import { alphabetizeStringify } from '@shared/utils/digests';
import { sha256DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletAuthMethodId, WalletAuthorityId, WalletId } from '@shared/utils/domainIds';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { D1WalletAuthMethodStore } from '../../../../core/d1WalletAuthMethodStore';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { CloudflareD1PasskeyCustodyEnvelopeStore } from '../passkeyCustody/d1PasskeyCustodyEnvelopeStore';
import { isFullOwnerAuthorityV1 } from './d1WalletAuthMethodService';
import type {
  VoiceIdActivationCommand,
  VoiceIdActivationEnvelope,
  VoiceIdActivationOwnerSession,
  VoiceIdActivationResult,
} from '../../../domains/voiceId/voiceIdActivation';

function ownerSessionIsCurrent(source: VoiceIdActivationOwnerSession, nowMs: number): boolean {
  const session = source.authorization.session;
  const quota = source.authorization.quota;
  return (
    source.authority.state === 'active' &&
    source.authMethod.status === 'active' &&
    source.authority.walletId === session.walletId &&
    source.authority.authorityId === session.authorityId &&
    source.authority.authorityDigestB64u === session.authorityDigestB64u &&
    source.authority.revocationEpoch === session.authorityRevocationEpoch &&
    source.authMethod.walletId === session.walletId &&
    source.authMethod.walletAuthorityId === session.authorityId &&
    source.authMethod.walletAuthMethodId === session.walletAuthMethodId &&
    quota.walletSessionId === session.walletSessionId &&
    quota.quotaId === session.quotaId &&
    quota.tenantId === session.tenantId &&
    quota.principalId === session.principalId &&
    quota.remainingUses > 0 &&
    session.createdAtMs <= nowMs &&
    session.expiresAtMs > nowMs &&
    quota.expiresAtMs > nowMs &&
    isFullOwnerAuthorityV1(source.authority)
  );
}

/** Aborts the D1 batch if the source Wallet Session lost its live quota or expired. */
function prepareOwnerSessionGuard(input: {
  readonly database: D1DatabaseLike;
  readonly scope: D1TenantScope;
  readonly source: VoiceIdActivationOwnerSession;
  readonly nowMs: number;
}): D1PreparedStatementLike {
  const session = input.source.authorization.session;
  return input.database.prepare(`
    INSERT INTO wallet_authority_cas_guard (guard_id)
    SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM wallet_session_authorizations_v2 AS source_session
      JOIN authorization_wallet_session_quotas AS quota
        ON quota.namespace = source_session.namespace
       AND quota.tenant_id = source_session.tenant_id
       AND quota.quota_id = source_session.quota_id
       AND quota.wallet_session_id = source_session.wallet_session_id
      WHERE source_session.namespace = ? AND source_session.org_id = ?
        AND source_session.project_id = ? AND source_session.env_id = ?
        AND source_session.tenant_id = ? AND source_session.authorization_id = ?
        AND source_session.wallet_id = ? AND source_session.authority_id = ?
        AND source_session.wallet_auth_method_id = ?
        AND source_session.authority_digest_b64u = ?
        AND source_session.authority_revocation_epoch = ?
        AND source_session.wallet_session_id = ? AND source_session.quota_id = ?
        AND source_session.retired_at_ms IS NULL
        AND source_session.issued_at_ms <= ? AND source_session.expires_at_ms > ?
        AND quota.lifecycle_kind = 'active' AND quota.remaining_uses > 0
        AND quota.expires_at_ms > ?
    )
  `).bind(
    input.scope.namespace,
    input.scope.orgId,
    input.scope.projectId,
    input.scope.envId,
    String(session.tenantId),
    String(session.authorizationId),
    String(session.walletId),
    String(session.authorityId),
    String(session.walletAuthMethodId),
    String(session.authorityDigestB64u),
    session.authorityRevocationEpoch,
    String(session.walletSessionId),
    String(session.quotaId),
    input.nowMs,
    input.nowMs,
    input.nowMs,
  );
}

function buildActiveVoiceIdMethod(input: {
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly walletId: WalletId;
  readonly walletAuthorityId: WalletAuthorityId;
  readonly deviceKeyId: DigestB64u;
  readonly devicePublicKeyB64u: VoiceIdDevicePublicKeyB64u;
  readonly nowMs: number;
}): ActiveVoiceIdWalletAuthMethodRecordV2 {
  return {
    version: 'wallet_auth_method_v2',
    walletAuthMethodId: input.walletAuthMethodId,
    walletId: input.walletId,
    walletAuthorityId: input.walletAuthorityId,
    kind: 'voiceid',
    status: 'active',
    deviceKeyId: input.deviceKeyId,
    devicePublicKeyB64u: input.devicePublicKeyB64u,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    activatedAtMs: input.nowMs,
  };
}

async function readCommittedActivation(input: {
  readonly authMethods: D1WalletAuthMethodStore;
  readonly envelopes: CloudflareD1PasskeyCustodyEnvelopeStore;
  readonly command: VoiceIdActivationCommand;
  readonly deviceKeyId: DigestB64u;
  readonly expectedEnvelope: VoiceIdActivationEnvelope;
}): Promise<ActiveVoiceIdWalletAuthMethodRecordV2 | null> {
  const storedMethod = await input.authMethods.readByIdV2({
    walletAuthMethodId: input.command.targetWalletAuthMethodId,
  });
  const session = input.command.source.authorization.session;
  if (
    !storedMethod ||
    storedMethod.kind !== 'voiceid' ||
    storedMethod.status !== 'active' ||
    storedMethod.walletId !== session.walletId ||
    storedMethod.walletAuthorityId !== session.authorityId ||
    storedMethod.deviceKeyId !== input.deviceKeyId ||
    storedMethod.devicePublicKeyB64u !== input.command.devicePublicKeyB64u
  ) {
    return null;
  }
  const storedEnvelope = await input.envelopes.lookupEnvelopeForWalletAuthMethod({
    walletId: session.walletId,
    walletAuthMethodId: input.command.targetWalletAuthMethodId,
    factor: { kind: 'voiceid', deviceKeyId: input.deviceKeyId },
  });
  if (
    storedEnvelope.kind !== 'active' ||
    alphabetizeStringify(storedEnvelope.envelope) !== alphabetizeStringify(input.expectedEnvelope)
  ) {
    return null;
  }
  return storedMethod;
}

export class D1VoiceIdActivation {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
    private readonly authMethods: D1WalletAuthMethodStore,
    private readonly envelopes: CloudflareD1PasskeyCustodyEnvelopeStore,
  ) {}

  async activate(input: VoiceIdActivationCommand): Promise<VoiceIdActivationResult> {
    if (!Number.isSafeInteger(input.nowMs) || !ownerSessionIsCurrent(input.source, input.nowMs)) {
      return { kind: 'rejected', code: 'invalid_source' };
    }
    const session = input.source.authorization.session;
    const deviceKeyId = await sha256DigestB64u(base64UrlDecode(input.devicePublicKeyB64u));
    const ciphertextDigest = await sha256DigestB64u(
      base64UrlDecode(input.envelope.sealedCustodySecretB64u),
    );
    if (
      !String(input.targetWalletAuthMethodId).startsWith('wallet-auth-method:') ||
      input.targetWalletAuthMethodId === input.source.authMethod.walletAuthMethodId ||
      input.envelope.walletId !== session.walletId ||
      input.envelope.ownership.walletAuthMethodId !== input.targetWalletAuthMethodId ||
      input.envelope.factor.deviceKeyId !== deviceKeyId ||
      input.envelope.createdAtMs > input.nowMs ||
      input.envelope.lifecycle.activatedAtMs > input.nowMs ||
      ciphertextDigest !== input.envelope.ciphertextDigestB64u
    ) {
      return { kind: 'rejected', code: 'invalid_target' };
    }
    const authMethod = buildActiveVoiceIdMethod({
      walletAuthMethodId: input.targetWalletAuthMethodId,
      walletId: session.walletId,
      walletAuthorityId: session.authorityId,
      deviceKeyId,
      devicePublicKeyB64u: input.devicePublicKeyB64u,
      nowMs: input.nowMs,
    });
    const linked = await this.envelopes.linkWalletCustodyFactorAtomically({
      envelope: input.envelope,
      additionalStatements: [
        prepareOwnerSessionGuard({
          database: this.database,
          scope: this.scope,
          source: input.source,
          nowMs: input.nowMs,
        }),
        ...this.authMethods.prepareActiveV2SourceGuardStatements({
          walletId: session.walletId,
          walletAuthMethodId: input.source.authMethod.walletAuthMethodId,
          walletAuthorityId: session.authorityId,
          authorityDigestB64u: session.authorityDigestB64u,
          authorityRevocationEpoch: session.authorityRevocationEpoch,
        }),
        ...this.authMethods.prepareV2InsertStatements(authMethod),
      ],
    });
    if (linked.kind !== 'stored') {
      const committed = await readCommittedActivation({
        authMethods: this.authMethods,
        envelopes: this.envelopes,
        command: input,
        deviceKeyId,
        expectedEnvelope: input.envelope,
      });
      if (committed) return { kind: 'activated', authMethod: committed };
      return { kind: 'rejected', code: 'conflict' };
    }
    return { kind: 'activated', authMethod };
  }
}
