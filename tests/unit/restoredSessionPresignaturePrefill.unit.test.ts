import { expect, test } from '@playwright/test';
import { parseWalletSessionId } from '../../packages/shared-ts/src/authorization/capabilityKinds';
import {
  scheduleRestoredSessionPresignaturePrefills,
  type RestoredSessionPresignaturePrefill,
} from '@/SeamsWeb/walletIframe/host/restoredSessionPresignaturePrefill';
import {
  parseWalletIframeExactSessionState,
  type WalletIframeExactSessionState,
} from '@/SeamsWeb/walletIframe/shared/exactSessionState';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { ThresholdEcdsaChainTarget } from '@/core/platform/types';

const tempoTarget: ThresholdEcdsaChainTarget = {
  kind: 'tempo',
  networkSlug: 'tempo-testnet',
  chainId: 42431,
};

const evmTarget: ThresholdEcdsaChainTarget = {
  kind: 'evm',
  networkSlug: 'base-sepolia',
  chainId: 84532,
};

function activeSessionState(): WalletIframeExactSessionState {
  return parseWalletIframeExactSessionState({
    kind: 'active_session',
    status: 'active',
    walletId: 'wallet-1',
    authorizationId: 'authorization-1',
    walletSessionId: 'wallet-session-1',
    authMethod: 'passkey',
    expiresAtMs: Date.now() + 60_000,
  });
}

function expiredSessionState(): WalletIframeExactSessionState {
  return parseWalletIframeExactSessionState({
    kind: 'expired_session',
    walletId: 'wallet-1',
    authorizationId: 'authorization-1',
    walletSessionId: 'wallet-session-1',
    authMethod: 'passkey',
    expiresAtMs: Date.now() - 1,
  });
}

const walletSessionId = parseWalletSessionId('wallet-session-1');
if (!walletSessionId.ok) throw new Error(walletSessionId.error.message);

const skippedPrefillResult = {
  status: 'skipped',
  reason: 'pool_disabled',
  walletSessionId: walletSessionId.value,
} as const;

test('restored active session schedules the existing presignature coordinator for every configured target', async () => {
  const calls: Parameters<RestoredSessionPresignaturePrefill>[0][] = [];
  const prefill: RestoredSessionPresignaturePrefill = async (args) => {
    calls.push(args);
    return skippedPrefillResult;
  };

  await scheduleRestoredSessionPresignaturePrefills({
    state: activeSessionState(),
    chainTargets: [tempoTarget, evmTarget],
    prefill,
  });

  expect(calls).toEqual([
    {
      walletSession: { walletId: toWalletId('wallet-1'), walletSessionUserId: 'wallet-1' },
      chainTarget: tempoTarget,
    },
    {
      walletSession: { walletId: toWalletId('wallet-1'), walletSessionUserId: 'wallet-1' },
      chainTarget: evmTarget,
    },
  ]);
});

test('restored non-active session states never schedule presignature work', async () => {
  const states: WalletIframeExactSessionState[] = [
    { kind: 'wallet_locked' },
    {
      kind: 'wallet_authenticated_identity_unresolvable',
      walletId: toWalletId('wallet-1'),
      reason: 'invalid',
    },
    {
      kind: 'wallet_unlocked_without_signing_session',
      walletId: toWalletId('wallet-1'),
      reason: 'absent',
    },
    expiredSessionState(),
  ];
  const calls: Parameters<RestoredSessionPresignaturePrefill>[0][] = [];
  const prefill: RestoredSessionPresignaturePrefill = async (args) => {
    calls.push(args);
    return skippedPrefillResult;
  };

  for (const state of states) {
    await scheduleRestoredSessionPresignaturePrefills({
      state,
      chainTargets: [tempoTarget],
      prefill,
    });
  }

  expect(calls).toEqual([]);
});

class PrefillRecorder {
  readonly calls: Parameters<RestoredSessionPresignaturePrefill>[0][] = [];
  async prefill(args: Parameters<RestoredSessionPresignaturePrefill>[0]) {
    this.calls.push(args);
    return skippedPrefillResult;
  }
}

test('restored exhausted sessions reconcile preprocessing eligibility without granting signing readiness', async () => {
  const recorder = new PrefillRecorder();
  await scheduleRestoredSessionPresignaturePrefills({
    state: parseWalletIframeExactSessionState({
      kind: 'wallet_unlocked_without_signing_session',
      walletId: 'wallet-1',
      reason: 'exhausted',
    }),
    chainTargets: [tempoTarget],
    prefill: recorder.prefill.bind(recorder),
  });
  expect(recorder.calls).toHaveLength(1);
});
