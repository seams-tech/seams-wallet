/**
 * The source claim a same-device addition puts in its intent.
 *
 * The intent digest is what the fresh source proof signs, so every identity the
 * proof is meant to bind has to be inside it. The server resolves the true
 * source from the presented credential and refuses the ceremony when the two
 * disagree, which is what makes this a claim rather than an authority: a client
 * that lies here fails closed at `start` instead of authorizing anything.
 *
 * The authority digest is read from the persisted `WalletAuthorityV1`, not from
 * the Wallet Session's `authorityDigest`. Those are different values under
 * different brands, and only the authority record's is what the server
 * revalidates against.
 */

import { IndexedDBManager } from '@/core/indexedDB';
import type { AddAuthMethodIntentSourceV1 } from '@shared/utils/registrationIntent';
import type {
  ActiveEmailOtpWalletAuthMethodRecordV2,
  ActivePasskeyWalletAuthMethodRecordV2,
  WalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import type { WalletId, WalletAuthorityId } from '@shared/utils/domainIds';

type AddAuthMethodSourceClaimResultV1 =
  | {
      readonly kind: 'resolved';
      readonly source: AddAuthMethodIntentSourceV1;
      /* Kept alongside the hashed claim so the proof uses the exact method
         named by that claim. */
      readonly sourceAuthMethod:
        ActivePasskeyWalletAuthMethodRecordV2 | ActiveEmailOtpWalletAuthMethodRecordV2;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

export async function resolveAddAuthMethodSourceClaimV1(
  walletId: WalletId,
): Promise<AddAuthMethodSourceClaimResultV1> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(String(walletId));
  if (selected.kind !== 'resolved') {
    return {
      kind: 'unavailable',
      reason: `selected wallet authority is ${selected.kind}`,
    };
  }
  if (selected.authMethod.status !== 'active') {
    return { kind: 'unavailable', reason: 'selected auth method is not active' };
  }
  if (selected.authority.state !== 'active') {
    return { kind: 'unavailable', reason: 'selected wallet authority is not active' };
  }
  if (
    selected.selection.lockState !== 'unlocked' ||
    selected.selection.walletId !== walletId ||
    selected.selection.walletAuthMethodId !== selected.authMethod.walletAuthMethodId ||
    selected.authMethod.walletId !== walletId ||
    selected.authMethod.walletAuthorityId !== selected.authority.authorityId ||
    selected.authority.walletId !== walletId
  ) {
    return { kind: 'unavailable', reason: 'selected wallet authority identity is invalid' };
  }

  let sourceAuthMethod:
    ActivePasskeyWalletAuthMethodRecordV2 | ActiveEmailOtpWalletAuthMethodRecordV2;
  if (selected.authMethod.kind === 'voiceid') {
    const methods = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(walletId);
    const confirmer = findAuthorityConfirmationMethod(
      walletId,
      selected.authority.authorityId,
      methods,
    );
    if (!confirmer) {
      return {
        kind: 'unavailable',
        reason:
          'this authority needs an active passkey or Email OTP method to confirm the addition',
      };
    }
    sourceAuthMethod = confirmer;
  } else {
    sourceAuthMethod = selected.authMethod;
  }
  return {
    kind: 'resolved',
    sourceAuthMethod,
    source: {
      walletAuthorityId: sourceAuthMethod.walletAuthorityId,
      walletAuthMethodId: sourceAuthMethod.walletAuthMethodId,
      authorityDigestB64u: String(selected.authority.authorityDigestB64u),
      revocationEpoch: selected.authority.revocationEpoch,
    },
  };
}

function findAuthorityConfirmationMethod(
  walletId: WalletId,
  authorityId: WalletAuthorityId,
  methods: readonly WalletAuthMethodRecordV2[],
): ActivePasskeyWalletAuthMethodRecordV2 | ActiveEmailOtpWalletAuthMethodRecordV2 | null {
  let emailMethod: ActiveEmailOtpWalletAuthMethodRecordV2 | null = null;
  for (const method of methods) {
    if (
      method.status !== 'active' ||
      method.walletId !== walletId ||
      method.walletAuthorityId !== authorityId
    )
      continue;
    switch (method.kind) {
      case 'passkey':
        return method;
      case 'email_otp':
        emailMethod = method;
        break;
      case 'voiceid':
        break;
      default:
        return assertNever(method);
    }
  }
  return emailMethod;
}

function assertNever(method: never): never {
  throw new Error(`Unsupported confirmation method: ${String(method)}`);
}
