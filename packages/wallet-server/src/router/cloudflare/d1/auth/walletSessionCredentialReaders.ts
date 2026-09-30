import type { AuthorizationService } from '../../../../authorization/service';
import type { WalletSessionAdmissionSnapshotV2Variant } from '../../../../authorization/domain';
import type {
  RouterApiWalletSessionAuthorizationV2AdmissionContext,
  RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext,
  RouterApiWalletSessionSigningCandidate,
} from '../../../framework/authServicePort';

type CredentialInput = Parameters<
  AuthorizationService['readWalletSessionAdmissionSnapshotByOperationCredential']
>[0];

type AdmissionSnapshotReader = Pick<AuthorizationService,
  'readWalletSessionAdmissionSnapshotByOperationCredential'
>;

function activeContext(
  snapshot: WalletSessionAdmissionSnapshotV2Variant<'active'>,
): RouterApiWalletSessionAuthorizationV2AdmissionContext | null {
  const { authorization, authority, authMethod } = snapshot;
  if (!authority || authority.state !== 'active' || !authMethod || authMethod.status !== 'active') {
    return null;
  }
  return { authorization, authority, authMethod, retiredAtMs: null };
}

function exhaustedContext(
  snapshot: WalletSessionAdmissionSnapshotV2Variant<'exhausted'>,
): RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext | null {
  const { session, quota, authority, authMethod } = snapshot;
  if (
    !authority ||
    authority.state !== 'active' ||
    !authMethod ||
    authMethod.status !== 'active' ||
    authority.walletId !== session.walletId ||
    authority.authorityDigestB64u !== session.authorityDigestB64u ||
    authority.revocationEpoch !== session.authorityRevocationEpoch ||
    authMethod.walletId !== session.walletId ||
    authMethod.walletAuthorityId !== session.authorityId ||
    authMethod.walletAuthMethodId !== session.walletAuthMethodId
  ) {
    return null;
  }
  return {
    status: { kind: 'exhausted', session, quota },
    authority,
    authMethod,
    retiredAtMs: null,
  };
}

export async function readActiveWalletSessionCredential(
  service: AdmissionSnapshotReader,
  input: CredentialInput,
): Promise<RouterApiWalletSessionAuthorizationV2AdmissionContext | null> {
  const snapshot = await service.readWalletSessionAdmissionSnapshotByOperationCredential(input);
  if (!snapshot) return null;
  if (snapshot.kind === 'exhausted') {
    throw new Error('Stored V2 Wallet Session quota is no longer active');
  }
  return activeContext(snapshot);
}

export async function readWalletSessionSigningCandidate(
  service: Pick<AuthorizationService, 'readEcdsaWalletSessionAdmissionSnapshotByOperationCredential'>,
  input: Parameters<AuthorizationService['readEcdsaWalletSessionAdmissionSnapshotByOperationCredential']>[0],
): Promise<RouterApiWalletSessionSigningCandidate | null> {
  const read = await service.readEcdsaWalletSessionAdmissionSnapshotByOperationCredential(input);
  if (!read) return null;
  const { snapshot, materialRead } = read;
  switch (snapshot.kind) {
    case 'active': {
      const context = activeContext(snapshot);
      return context ? { kind: 'active', context, materialRead } : null;
    }
    case 'exhausted': {
      const candidate = exhaustedContext(snapshot);
      if (!candidate) throw new Error('Exhausted Wallet Session authority is unavailable');
      return { kind: 'exhausted', candidate, materialRead };
    }
    default: {
      const unexpected: never = snapshot;
      throw new Error(`Unsupported Wallet Session snapshot: ${unexpected}`);
    }
  }
}

export async function readExhaustedWalletSessionCredential(
  service: Pick<AuthorizationService, 'readExactWalletSessionStatusSnapshotByOperationCredential'>,
  input: CredentialInput,
): Promise<RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext | null> {
  const { status, authority, authMethod } =
    await service.readExactWalletSessionStatusSnapshotByOperationCredential(input);
  if (status.kind !== 'exhausted') return null;
  return exhaustedContext({
    kind: 'exhausted',
    session: status.session,
    quota: status.quota,
    authority,
    authMethod,
  });
}
