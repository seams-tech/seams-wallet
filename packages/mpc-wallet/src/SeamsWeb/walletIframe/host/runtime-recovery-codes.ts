import { resolveAppearanceTheme } from '@/core/config/configHelpers';
import { showWalletRecoveryCodesUi } from '@/SeamsWeb/operations/recovery/walletRecoveryCodeBackup';
import { pendingWalletRecoveryCodeBackupRepository } from '@/core/indexedDB/seamsWalletDB/pendingWalletRecoveryCodeBackup';
import type { WalletRecoveryCodeStatusResult } from '@/core/rpcClients/relayer/walletRecoveryRotate';
import {
  acknowledgeWalletRecoveryBackupWithPasskey,
  readWalletRecoveryCodeStatusWithPasskey,
} from '@/SeamsWeb/operations/recovery/walletRecoveryAdminProof';
import type { WalletRecoveryCodeBackupRequestV1 } from '@/core/types/sdkSentEvents';
import { walletIframeRequestIdFromBoundary } from '@/core/types/walletIframeIdentity';
import type { WalletIframeSurfaceMeasurement } from '../shared/messages';
import type { WalletHostRuntimeRequest } from './runtimeContext';
import { requireTrimmedString } from '@shared/utils/validation';
import { parseWalletRecoveryRequest } from '../shared/recoveryAuthorization';

function requireRelayerUrl(input: WalletHostRuntimeRequest): string {
  return requireTrimmedString(
    input.state.configuration.kind === 'configured'
      ? input.state.configuration.config.network.relayer.url
      : undefined,
    'Recovery-code relayer URL',
  );
}

function requireRpId(input: WalletHostRuntimeRequest): string {
  return requireTrimmedString(
    input.state.configuration.kind === 'configured'
      ? input.state.configuration.config.wallet.rpId
      : undefined,
    'Recovery-code RP ID',
  );
}

function postSurfaceMeasurement(
  input: WalletHostRuntimeRequest,
  measurement: WalletIframeSurfaceMeasurement,
): void {
  input.post({ type: 'SURFACE_MEASUREMENT', payload: measurement });
}

async function loadRecoveryCodeStatus(
  relayUrl: string,
  walletId: string,
  rpId: string,
): Promise<WalletRecoveryCodeStatusResult> {
  const [status, pendingLocalBackup] = await Promise.all([
    readWalletRecoveryCodeStatusWithPasskey({ relayUrl, walletId, rpId }),
    pendingWalletRecoveryCodeBackupRepository.has(walletId),
  ]);
  return status.kind === 'ready' ? { ...status, pendingLocalBackup } : status;
}

async function loadPendingRecoveryCodeBackup(
  walletId: string,
): Promise<WalletRecoveryCodeBackupRequestV1 | null> {
  const pending = await pendingWalletRecoveryCodeBackupRepository.read(walletId);
  if (!pending) return null;
  if (pending.kind !== 'ready') {
    throw new Error('Recovery codes are awaiting a verified server issuance. Retry registration.');
  }
  return {
    kind: 'wallet_recovery_code_backup_request_v1',
    walletId: pending.walletId,
    recoveryCodes: pending.recoveryCodes,
    continuation: 'pending_backup_must_finish',
    issuedAtMs: pending.issuedAtMs,
  };
}

export async function handleWalletHostRuntimeRequest(
  input: WalletHostRuntimeRequest,
): Promise<void> {
  if (input.req.type !== 'PM_ACKNOWLEDGE_WALLET_RECOVERY_CODE_BACKUP') {
    throw new Error(`Unsupported recovery-code request type: ${input.req.type}`);
  }
  const requestId = walletIframeRequestIdFromBoundary(input.req.requestId);
  if (input.respondIfCancelled(requestId)) return;

  const { walletId, authorization } = parseWalletRecoveryRequest(input.req.payload);
  if (authorization.kind !== 'passkey') {
    throw new Error('Email OTP recovery backup requires the wallet authentication runtime');
  }
  const relayUrl = requireRelayerUrl(input);
  const rpId = requireRpId(input);
  const acknowledgement = await showWalletRecoveryCodesUi(
    {
      walletId,
      loadStatus: loadRecoveryCodeStatus.bind(null, relayUrl, walletId, rpId),
      loadPendingBackup: loadPendingRecoveryCodeBackup.bind(null, walletId),
    },
    {
      kind: 'wallet_iframe',
      requestId,
      postMeasurement: postSurfaceMeasurement.bind(null, input),
    },
    {
      appearance: {
        locale:
          input.state.configuration.kind === 'configured'
            ? input.state.configuration.config.ui.appearance.locale
            : 'en',
        palette: 'default',
        theme: resolveAppearanceTheme({
          value:
            input.state.configuration.kind === 'configured'
              ? input.state.configuration.config.ui.appearance.theme
              : undefined,
          fallback: { id: 'default', mode: 'dark', colors: {} },
        }),
      },
      shouldCancel: () => input.isCancelled(requestId),
    },
  );
  if (acknowledgement.kind !== 'wallet_recovery_codes_backed_up_v1') {
    throw new Error('Pending wallet recovery-code backup was not completed');
  }

  const result = await acknowledgeWalletRecoveryBackupWithPasskey({
    relayUrl,
    walletId,
    rpId,
    expectedIssuedAtMs: acknowledgement.issuedAtMs,
  });
  if (result.kind === 'acknowledged') {
    await pendingWalletRecoveryCodeBackupRepository.deleteIssuedAtMs(
      walletId,
      acknowledgement.issuedAtMs,
    );
  }
  input.post({ type: 'PM_RESULT', requestId, payload: { ok: true, result } });
}
