import type { WalletAuthenticationState } from '@/core/types/seams';
import {
  WalletSessionAuthorizationUpgradeRequiredError,
  type ActiveWalletSessionV1,
  type WalletSessionAuthorizationExactOperationCredentialReadResult,
  type WalletSessionOperationCredentialV1,
} from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletAuthMethodId, WalletAuthorityId } from '@shared/utils/domainIds';
import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { ExactWalletSessionReadPorts } from './exactWalletSessionCredential';

export type ExactWalletSessionAuthenticationReadResult =
  | {
      readonly kind: 'authenticated';
      readonly state: Extract<WalletAuthenticationState, { readonly kind: 'authenticated' }>;
      /** The exact method that opened the session; the public state only
          carries the method kind. */
      readonly walletAuthMethodId: WalletAuthMethodId;
    }
  | {
      readonly kind: 'missing';
      readonly state?: never;
      readonly walletAuthMethodId?: never;
    }
  | {
      readonly kind: 'upgrade_required';
      readonly state?: never;
      readonly walletAuthMethodId?: never;
    };

type ExactWalletSessionAuthorityScope = {
  readonly walletId: WalletId;
  readonly authorityId: WalletAuthorityId;
  readonly authMethodId: WalletAuthMethodId;
  readonly authorityDigestB64u: DigestB64u;
  readonly authorityRevocationEpoch: number;
};

function exactWalletSessionMatchesAuthorityScope(args: {
  readonly record: ActiveWalletSessionV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly scope: ExactWalletSessionAuthorityScope;
}): boolean {
  const { record, operationCredential, scope } = args;
  return (
    record.walletId === scope.walletId &&
    record.authorityId === scope.authorityId &&
    record.authMethodId === scope.authMethodId &&
    record.authorityDigestB64u === scope.authorityDigestB64u &&
    record.authorityRevocationEpoch === scope.authorityRevocationEpoch &&
    operationCredential.kind === 'opaque_wallet_session_operation_credential_v1' &&
    operationCredential.token.trim().length > 0
  );
}

export async function readExactWalletSessionAuthentication(args: {
  readonly walletId: WalletId;
  readonly ports: ExactWalletSessionReadPorts;
}): Promise<ExactWalletSessionAuthenticationReadResult> {
  const { walletId, ports } = args;
  const selected = await ports.resolveSelectedWalletAuthority(String(walletId));
  if (selected.kind !== 'resolved') return { kind: 'missing' };
  const { selection, authMethod, authority } = selected;
  if (
    selection.walletId !== walletId ||
    selection.walletAuthMethodId !== authMethod.walletAuthMethodId ||
    selection.lockState !== 'unlocked' ||
    authMethod.walletId !== walletId ||
    authMethod.walletAuthorityId !== authority.authorityId ||
    authMethod.status !== 'active' ||
    authority.walletId !== walletId ||
    authority.state !== 'active'
  ) {
    return { kind: 'missing' };
  }
  const exact = await ports.readExactWithOperationCredential({
    walletId,
    authorityId: authority.authorityId,
    authMethodId: authMethod.walletAuthMethodId,
  });
  switch (exact.kind) {
    case 'found':
      break;
    case 'missing':
      return { kind: 'missing' };
    case 'upgrade_required':
      return { kind: 'upgrade_required' };
  }
  if (
    !exactWalletSessionMatchesAuthorityScope({
      record: exact.record,
      operationCredential: exact.operationCredential,
      scope: {
        walletId,
        authorityId: authority.authorityId,
        authMethodId: authMethod.walletAuthMethodId,
        authorityDigestB64u: authority.authorityDigestB64u,
        authorityRevocationEpoch: authority.revocationEpoch,
      },
    }) ||
    exact.record.expiresAtMs <= Date.now()
  ) {
    return { kind: 'missing' };
  }
  return {
    kind: 'authenticated',
    state: {
      kind: 'authenticated',
      walletId,
      authMethod: authMethod.kind,
    },
    walletAuthMethodId: authMethod.walletAuthMethodId,
  };
}

export function exactWalletSessionWithOperationCredentialOrThrow(
  result: WalletSessionAuthorizationExactOperationCredentialReadResult,
  message: string,
): Extract<WalletSessionAuthorizationExactOperationCredentialReadResult, { kind: 'found' }> | null {
  switch (result.kind) {
    case 'found':
      return result;
    case 'missing':
      return null;
    case 'upgrade_required':
      throw new WalletSessionAuthorizationUpgradeRequiredError(message);
  }
}
