import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { IndexedDBManager, walletSessionAuthorizations } from '@/core/indexedDB';
import { assertCurrentWalletOwnershipGeneration } from '@/core/indexedDB/seamsWalletDB/walletOwnershipGeneration';
import type { ParentToChildEnvelope } from '../shared/messages';

export async function assertWalletHostMutationAllowed(
  request: ParentToChildEnvelope,
  currentWalletId: string | null,
): Promise<void> {
  const walletId = walletForHostRequest(request, currentWalletId);
  if (walletId === null) return;
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  // Missing credentials still follow the operation's normal authentication flow.
  if (selected.kind !== 'resolved') return;
  const session = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId,
    authorityId: selected.authority.authorityId,
    authMethodId: selected.authMethod.walletAuthMethodId,
  });
  if (session.kind !== 'found') return;
  await assertCurrentWalletOwnershipGeneration(
    walletId,
    session.operationCredential.ownershipGeneration,
  );
}

function requiredWallet(raw: unknown): WalletId {
  const parsed = parseWalletId(raw);
  if (!parsed.ok) throw new Error('Wallet mutation identity is invalid');
  return parsed.value;
}

export function walletForHostRequest(
  request: ParentToChildEnvelope,
  currentWalletId: string | null,
): WalletId | null {
  switch (request.type) {
    case 'PM_ADD_WALLET_SIGNER':
    case 'PM_ADD_PASSKEY':
    case 'PM_ACTIVATE_AUTH_METHOD':
    case 'PM_SET_AUTH_METHOD_ENABLED':
    case 'PM_ADD_EMAIL_OTP':
    case 'PM_REVOKE_AUTH_METHOD':
    case 'PM_ACKNOWLEDGE_WALLET_RECOVERY_CODE_BACKUP':
    case 'PM_ROTATE_WALLET_RECOVERY_CODES':
    case 'PM_REQUEST_WALLET_CUSTODY_EMAIL_OTP_CHALLENGE':
    case 'PM_SIGN_TX_WITH_ACTIONS':
    case 'PM_SIGN_AND_SEND_TX':
    case 'PM_SIGN_DELEGATE_ACTION':
    case 'PM_SIGN_NEP413':
    case 'PM_REVOKE_LINKED_DEVICE':
      return requiredWallet(request.payload?.walletId);
    case 'PM_SIGN_TEMPO':
    case 'PM_RESOLVE_EXACT_KEY_EXPORT_LANE':
    case 'PM_EXPORT_KEYPAIR_UI':
      return requiredWallet(request.payload?.walletSession.walletId);
    case 'PM_SYNC_ACCOUNT_FLOW': {
      const walletId = request.payload?.walletId ?? currentWalletId;
      return walletId === null ? null : requiredWallet(walletId);
    }
    case 'PM_SCAN_AND_LINK_DEVICE':
      return currentWalletId === null ? null : requiredWallet(currentWalletId);

    case 'PM_OWNER_NEAR_TRANSACTION':
      return request.payload.action === 'approve' ? requiredWallet(request.payload.authentication.walletId) : null;

    case 'PM_EXTERNAL_OWNER_AUTH': {
      const command = request.payload;
      return requiredWallet(command.action === 'associate' ? command.input.walletId : command.walletId);
    }

    // Reads, fresh authentication, cancellation and completion of admitted work remain available.
    case 'PM_SET_TRANSACTION_VIEW':
    case 'PM_TRANSACTION_BROADCAST_STARTED':
    case 'PING':
    case 'PM_GET_AUTH_METHOD_AVAILABILITY':
    case 'PM_PREPARE_WALLET_RUNTIME':
    case 'PM_SET_CONFIG':
    case 'PM_ACTIVATE_TRANSACTION_REVIEW':
    case 'PM_CANCEL':
    case 'PM_OPEN_AUTH_MENU':
    case 'PM_CANCEL_AUTH_MENU':
    case 'PM_RESOLVE_AUTH_MENU_EXTERNAL_AUTH':
    case 'PM_REDEEM_HOSTED_WALLET_SEAMS_SESSION':
    case 'PM_REGISTER_WALLET':
    case 'PM_UNLOCK':
    case 'PM_UNLOCK_AUTH_METHOD':
    case 'PM_EXTERNAL_AUTH':
    case 'PM_LOCK':
    case 'PM_LOCK_EXACT_WALLET_SESSION':
    case 'PM_GET_LAST_WALLET_MOVE_REQUEST':
    case 'PM_MOVE_WALLET':
    case 'PM_GET_WALLET_MOVE':
    case 'PM_GET_WALLET_PLACEMENT':
    case 'PM_GET_WALLET_SESSION':
    case 'PM_GET_EXACT_WALLET_SESSION_STATE':
    case 'PM_GET_NEAR_PROVISIONING_STATE':
    case 'PM_REQUEST_EMAIL_OTP_CHALLENGE':
    case 'PM_BEGIN_GOOGLE_EMAIL_OTP_WALLET_AUTH':
    case 'PM_GOOGLE_EMAIL_OTP_WALLET_AUTH_RESEND':
    case 'PM_GOOGLE_EMAIL_OTP_WALLET_AUTH_REROLL_WALLET_ID':
    case 'PM_GOOGLE_EMAIL_OTP_WALLET_AUTH_SUBMIT':
    case 'PM_GOOGLE_EMAIL_OTP_WALLET_AUTH_COMPLETE_REGISTRATION':
    case 'PM_GOOGLE_EMAIL_OTP_WALLET_AUTH_CANCEL':
    case 'PM_GET_WALLET_RECOVERY_CODE_STATUS':
    case 'PM_SEND_TRANSACTION':
    case 'PM_REPORT_TEMPO_BROADCAST_ACCEPTED':
    case 'PM_REPORT_TEMPO_BROADCAST_REJECTED':
    case 'PM_REPORT_TEMPO_FINALIZED':
    case 'PM_REPORT_TEMPO_DROPPED_OR_REPLACED':
    case 'PM_RECONCILE_TEMPO_NONCE_LANE':
    case 'PM_GET_RECENT_UNLOCKS':
    case 'PM_SET_CONFIRM_BEHAVIOR':
    case 'PM_SET_CONFIRMATION_CONFIG':
    case 'PM_GET_CONFIRMATION_CONFIG':
    case 'PM_HAS_PASSKEY':
    case 'PM_LIST_LINKED_DEVICES':
    case 'PM_START_DEVICE2_LINKING_FLOW':
    case 'PM_DEVICE_LINK_TARGET_FACTOR_ACTION':
    case 'PM_DEVICE_LINK_EMAIL_OTP_BASE_FACTOR_ACTION':
    case 'PM_CANCEL_DEVICE_LINKING':
      return null;
    default:
      request satisfies never;
      throw new Error('Unsupported wallet mutation request');
  }
}
