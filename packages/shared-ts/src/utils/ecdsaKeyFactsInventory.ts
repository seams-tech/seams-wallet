import { base64UrlEncode } from './base64';
import { alphabetizeStringify, sha256BytesUtf8 } from './digests';
import {
  thresholdEcdsaChainTargetKey,
  type ThresholdEcdsaChainTargetWire,
} from './thresholdEcdsaChainTarget';

type WalletEcdsaKeyFactsInventoryChallengeInput = {
  walletId: string;
  rpId: string;
  keyTargets: readonly {
    keyHandle: string;
    chainTarget: ThresholdEcdsaChainTargetWire;
  }[];
  runtimePolicyScope?: unknown;
  serverNonceB64u: string;
};

function normalizeChainTarget(
  target: ThresholdEcdsaChainTargetWire,
): ThresholdEcdsaChainTargetWire {
  if (target.kind === 'evm') {
    return {
      kind: 'evm',
      namespace: 'eip155',
      chainId: target.chainId,
      ...(target.networkSlug ? { networkSlug: target.networkSlug } : {}),
    };
  }
  return {
    kind: 'tempo',
    chainId: target.chainId,
    ...(target.networkSlug ? { networkSlug: target.networkSlug } : {}),
  };
}

function canonicalizeWalletEcdsaKeyFactsInventoryChallenge(
  input: WalletEcdsaKeyFactsInventoryChallengeInput,
): string {
  const keyTargets = input.keyTargets
    .map((target) => ({
      keyHandle: target.keyHandle,
      chainTarget: normalizeChainTarget(target.chainTarget),
      targetKey: thresholdEcdsaChainTargetKey(target.chainTarget),
    }))
    .sort((left, right) => {
      const leftKey = `${left.keyHandle}:${left.targetKey}`;
      const rightKey = `${right.keyHandle}:${right.targetKey}`;
      return leftKey.localeCompare(rightKey);
    });

  return alphabetizeStringify({
    version: 'wallet-ecdsa-key-facts-inventory:v1',
    walletId: input.walletId,
    rpId: input.rpId,
    keyTargets,
    ...(input.runtimePolicyScope ? { runtimePolicyScope: input.runtimePolicyScope } : {}),
    serverNonceB64u: input.serverNonceB64u,
  });
}

export async function computeWalletEcdsaKeyFactsInventoryChallengeDigestB64u(
  input: WalletEcdsaKeyFactsInventoryChallengeInput,
): Promise<string> {
  return base64UrlEncode(
    await sha256BytesUtf8(canonicalizeWalletEcdsaKeyFactsInventoryChallenge(input)),
  );
}
