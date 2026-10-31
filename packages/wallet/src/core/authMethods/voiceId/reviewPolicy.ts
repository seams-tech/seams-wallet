import type { WalletAuthMethodHostPlugin, AuthMethodReviewPolicy } from '../hostPlugin';
import type { Variant } from '@shared/utils/variant';
import { parseVoiceConfirmation, type VoiceConfirmation } from './confirmationCommand';
import type { WalletAuthMethodSigningRequest } from '@/SeamsWeb/walletIframe/shared/messages';
import {
  walletHostExecutionFingerprint,
  type ConfiguredWalletHost,
} from '@/SeamsWeb/walletIframe/shared/configuration';
import { resolveNearNetwork } from '@/core/config/chains';
import {
  parseTransactionReviewWire,
  TransactionReviewError,
} from '@/SeamsWeb/walletIframe/shared/transactionReview';
import { ActionType } from '@shared/near/actions';
import { isPlainObject } from '@shared/utils/validation';
import { walletForHostRequest } from '@/SeamsWeb/walletIframe/host/walletMutationGuard';

function freezeRequestValue(value: unknown): void {
  if (!isPlainObject(value) && !Array.isArray(value)) return;
  for (const child of Object.values(value)) freezeRequestValue(child);
  Object.freeze(value);
}

// The iframe receives a structured clone. Hash the complete request and execution
// configuration before runtime code can normalize or change either value.
export async function voiceIdPolicyForRequest(
  request: WalletAuthMethodSigningRequest,
  configuration: ConfiguredWalletHost,
  plugin: WalletAuthMethodHostPlugin,
): Promise<Variant<AuthMethodReviewPolicy, 'kind', 'required'>> {
  switch (request.type) {
    case 'PM_SIGN_TX_WITH_ACTIONS':
    case 'PM_SIGN_DELEGATE_ACTION':
    case 'PM_SIGN_NEP413':
      throw unsupportedVoiceOperation();
    case 'PM_SIGN_TEMPO': {
      const payload = request.payload;
      if (!payload) throw unsupportedVoiceOperation();
      switch (payload.operationKind) {
        case 'tempo_transaction':
        case 'tempo_fee_token_preference':
          throw unsupportedVoiceOperation();
        case 'evm_transaction':
          break;
        default:
          return assertNever(payload);
      }
      const { tx } = payload.request;
      const target = payload.chainTarget;
      const configured = configuration.config.network.chains.some(isConfiguredArcTestnet);
      if (
        !configured ||
        target.kind !== 'evm' ||
        target.namespace !== 'eip155' ||
        target.networkSlug !== 'arc-testnet' ||
        target.chainId !== 5_042_002 ||
        payload.request.chain !== 'evm' ||
        payload.request.kind !== 'eip1559' ||
        payload.request.senderSignatureAlgorithm !== 'secp256k1' ||
        tx.chainId !== target.chainId ||
        typeof tx.to !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(tx.to) ||
        (tx.data !== undefined && tx.data !== '0x') ||
        (tx.accessList !== undefined && tx.accessList.length !== 0) ||
        tx.abi !== undefined
      ) {
        throw unsupportedVoiceOperation();
      }
      return await reviewedVoiceIdPolicy(
        request,
        configuration,
        parseVoiceConfirmation(payload.options?.voiceId),
        plugin,
      );
    }
    case 'PM_SIGN_AND_SEND_TX': {
      if (resolveNearNetwork(configuration.config.network.chains) !== 'testnet') {
        throw new TransactionReviewError(
          'review_unsupported_mode',
          'This VoiceID prototype requires NEAR testnet.',
        );
      }
      const payload = request.payload;
      if (
        !payload ||
        payload.transaction.actions.length !== 1 ||
        payload.transaction.actions[0].type !== ActionType.Transfer ||
        !('transactionReview' in request)
      ) {
        throw unsupportedVoiceOperation();
      }
      return await reviewedVoiceIdPolicy(
        request,
        configuration,
        parseVoiceConfirmation(payload.options.voiceId),
        plugin,
      );
    }
    default:
      return assertNever(request);
  }
}

function isConfiguredArcTestnet(
  chain: ConfiguredWalletHost['config']['network']['chains'][number],
): boolean {
  return chain.network === 'arc-testnet' && chain.chainId === 5_042_002;
}

function encodeOperationValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { bigint: value.toString() } : value;
}

async function reviewedVoiceIdPolicy(
  request: Variant<WalletAuthMethodSigningRequest, 'type', 'PM_SIGN_AND_SEND_TX' | 'PM_SIGN_TEMPO'>,
  configuration: ConfiguredWalletHost,
  confirmation: VoiceConfirmation,
  plugin: WalletAuthMethodHostPlugin,
): Promise<Variant<AuthMethodReviewPolicy, 'kind', 'required'>> {
  const review = parseTransactionReviewWire(request.transactionReview);
  if (review.validity.kind !== 'expires_at') {
    throw new TransactionReviewError('review_invalid_input', 'VoiceID requires a review deadline.');
  }
  freezeRequestValue(request);
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      {
        domain: 'seams-voiceid-operation-v1',
        origin: location.origin,
        executionFingerprint: walletHostExecutionFingerprint(configuration.config),
        request,
      },
      encodeOperationValue,
    ),
  );
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  let operationHash = '';
  for (const byte of new Uint8Array(hash)) operationHash += byte.toString(16).padStart(2, '0');
  const walletId = walletForHostRequest(request, null);
  if (!walletId) throw new Error('VoiceID review requires a wallet identity.');
  return {
    kind: 'required',
    approval: await plugin.review({
      walletId,
      expiresAtMs: review.validity.atMs,
      operationHash,
      confirmation,
    }),
  };
}

function unsupportedVoiceOperation(): TransactionReviewError {
  return new TransactionReviewError(
    'review_unsupported_mode',
    'VoiceID requires a reviewed NEAR or Arc testnet transfer.',
  );
}

function assertNever(_request: never): never {
  throw unsupportedVoiceOperation();
}
