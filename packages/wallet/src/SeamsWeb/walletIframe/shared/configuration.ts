import type { Variant } from '@shared/utils/variant';
import { parseWebAuthnRpId, type WebAuthnRpId } from '@shared/utils/domainIds';
import type { AppearanceConfig, SeamsClientConfig, SeamsConfigsReadonly } from '@/core/types/seams';
import { THRESHOLD_ECDSA_PRESIGN_POOL_LIMITS } from '@/core/config/configBuilder';
import { isNearChainNetwork, isSeamsChainNetwork } from '@/core/config/chains';
import { isPlainObject, isString, isFiniteNumber, requireRecord } from '@shared/utils/validation';
import {
  SIGNING_SESSION_SEAL_ALG,
  SIGNING_SESSION_SEAL_GROUP_ID,
} from '@shared/utils/signingSessionSeal';

export type WalletHostConfig = Omit<SeamsConfigsReadonly, 'wallet'> & {
  readonly wallet: Variant<SeamsConfigsReadonly['wallet'], 'mode', 'direct'>;
};

function resolveWalletRpId(config: SeamsClientConfig): WebAuthnRpId {
  const iframe = config.wallet.iframe;
  const configured = iframe.rpIdOverride?.trim();
  const parsed = parseWebAuthnRpId(configured || new URL(iframe.origin).hostname);
  if (!parsed.ok) throw new Error(`Invalid wallet RP ID: ${parsed.error.message}`);
  return parsed.value;
}

export function createWalletHostConfig(config: SeamsClientConfig): WalletHostConfig {
  return {
    network: config.network,
    registration: config.registration,
    signing: config.signing,
    webauthn: config.webauthn,
    wallet: {
      mode: 'direct',
      rpId: resolveWalletRpId(config),
    },
    ui: config.ui,
  };
}

function isStringMap(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every(isString);
}

function isAppearance(value: unknown): value is AppearanceConfig {
  if (!isPlainObject(value) || value.palette !== 'default' || !isPlainObject(value.theme))
    return false;
  const theme = value.theme;
  return (
    isString(theme.id) &&
    theme.id.trim().length > 0 &&
    (theme.mode === 'dark' || theme.mode === 'light') &&
    isStringMap(theme.colors) &&
    (theme.shape === undefined || isStringMap(theme.shape))
  );
}

function isChain(value: unknown): boolean {
  if (!isPlainObject(value) || !isSeamsChainNetwork(value.network)) return false;
  return (
    isString(value.rpcUrl) &&
    value.rpcUrl.trim().length > 0 &&
    isString(value.explorerUrl) &&
    (isNearChainNetwork(value.network) ||
      (isFiniteNumber(value.chainId) && Number.isSafeInteger(value.chainId) && value.chainId > 0))
  );
}

function isNetwork(value: unknown): boolean {
  if (!isPlainObject(value) || !Array.isArray(value.chains) || !value.chains.every(isChain))
    return false;
  const relayer = value.relayer;
  return (
    isPlainObject(relayer) &&
    isString(relayer.accountId) &&
    isString(relayer.url) &&
    relayer.url.trim().length > 0 &&
    isPlainObject(relayer.routes) &&
    isString(relayer.routes.delegateAction)
  );
}

function isRegistration(value: unknown): boolean {
  if (!isPlainObject(value) || value.mode !== 'managed') return false;
  const provisioning = value.nearAccountProvisioning;
  return (
    isString(value.publishableKey) &&
    isString(value.projectEnvironmentId) &&
    (value.paymentMode === 'disabled' ||
      value.paymentMode === 'quota_then_x402' ||
      value.paymentMode === 'always_x402') &&
    isPlainObject(provisioning) &&
    (provisioning.kind === 'implicit_account' || provisioning.kind === 'relayer_named_subaccount')
  );
}

function isSessionDefaults(value: unknown): boolean {
  return isPlainObject(value) && isFiniteNumber(value.ttlMs) && isFiniteNumber(value.remainingUses);
}

function isProvisioningPolicy(value: unknown): boolean {
  if (
    !isPlainObject(value) ||
    typeof value.enabled !== 'boolean' ||
    !isSessionDefaults(value.signingSession)
  )
    return false;
  const session = requireRecord(value.signingSession, 'signingSession');
  return session.kind === 'jwt' || session.kind === 'cookie';
}

function isNormalSigning(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.mode === 'disabled') return value.signingWorkerId === undefined;
  return (
    value.mode === 'enabled' &&
    isString(value.signingWorkerId) &&
    value.signingWorkerId.trim().length > 0
  );
}

function isPresignaturePool(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.enabled === 'boolean' &&
    isFiniteNumber(value.targetDepth) &&
    Number.isInteger(value.targetDepth) &&
    value.targetDepth >= THRESHOLD_ECDSA_PRESIGN_POOL_LIMITS.targetDepth.min &&
    value.targetDepth <= THRESHOLD_ECDSA_PRESIGN_POOL_LIMITS.targetDepth.max &&
    isFiniteNumber(value.lowWatermark) &&
    Number.isInteger(value.lowWatermark) &&
    value.lowWatermark >= 0 &&
    value.lowWatermark <= value.targetDepth &&
    isFiniteNumber(value.maxRefillInFlight) &&
    Number.isInteger(value.maxRefillInFlight) &&
    value.maxRefillInFlight >= THRESHOLD_ECDSA_PRESIGN_POOL_LIMITS.maxRefillInFlight.min &&
    value.maxRefillInFlight <= THRESHOLD_ECDSA_PRESIGN_POOL_LIMITS.maxRefillInFlight.max &&
    isFiniteNumber(value.refillAttemptTimeoutMs) &&
    Number.isInteger(value.refillAttemptTimeoutMs) &&
    value.refillAttemptTimeoutMs >=
      THRESHOLD_ECDSA_PRESIGN_POOL_LIMITS.refillAttemptTimeoutMs.min &&
    value.refillAttemptTimeoutMs <= THRESHOLD_ECDSA_PRESIGN_POOL_LIMITS.refillAttemptTimeoutMs.max
  );
}

function isSigning(value: unknown): boolean {
  if (!isPlainObject(value) || !isSessionDefaults(value.sessionDefaults)) return false;
  if (
    !isPlainObject(value.emailOtp) ||
    (value.emailOtp.authPolicy !== 'session' && value.emailOtp.authPolicy !== 'per_operation')
  )
    return false;
  if (!isPlainObject(value.routerAb) || !isNormalSigning(value.routerAb.normalSigning))
    return false;
  if (
    !isPlainObject(value.routerAbEcdsaDerivation) ||
    !isPresignaturePool(value.routerAbEcdsaDerivation.presignaturePool)
  )
    return false;
  if (
    !isPlainObject(value.thresholdEcdsa) ||
    !isPlainObject(value.thresholdEcdsa.provisioningDefaults)
  )
    return false;
  const provisioning = value.thresholdEcdsa.provisioningDefaults;
  if (!isProvisioningPolicy(provisioning.tempo) || !isProvisioningPolicy(provisioning.evm))
    return false;
  const seal = value.sessionSeal;
  if (!isPlainObject(seal)) return false;
  if (value.sessionPersistenceMode === 'none')
    return seal.mode === 'none' && seal.protocol === undefined;
  return (
    value.sessionPersistenceMode === 'sealed_refresh_v1' &&
    seal.mode === 'sealed_refresh_v1' &&
    isPlainObject(seal.protocol) &&
    seal.protocol.algorithm === SIGNING_SESSION_SEAL_ALG &&
    seal.protocol.groupId === SIGNING_SESSION_SEAL_GROUP_ID
  );
}

function isAuthenticator(value: unknown): boolean {
  if (!isPlainObject(value) || !isPlainObject(value.authenticatorOptions)) return false;
  const options = value.authenticatorOptions;
  if (
    options.userVerification !== 'required' &&
    options.userVerification !== 'preferred' &&
    options.userVerification !== 'discouraged'
  )
    return false;
  const policy = options.originPolicy;
  return (
    isPlainObject(policy) &&
    (policy.single === undefined || typeof policy.single === 'boolean') &&
    (policy.all_subdomains === undefined || typeof policy.all_subdomains === 'boolean') &&
    (policy.multiple === undefined ||
      (Array.isArray(policy.multiple) && policy.multiple.every(isString)))
  );
}

function isHostWallet(value: unknown): boolean {
  if (!isPlainObject(value) || value.mode !== 'direct' || value.iframe !== undefined) return false;
  const parsed = parseWebAuthnRpId(value.rpId);
  return parsed.ok && parsed.value === value.rpId;
}

function isWalletHostConfig(value: unknown): value is WalletHostConfig {
  return (
    isPlainObject(value) &&
    isNetwork(value.network) &&
    isRegistration(value.registration) &&
    isSigning(value.signing) &&
    isAuthenticator(value.webauthn) &&
    isHostWallet(value.wallet) &&
    isPlainObject(value.ui) &&
    isAppearance(value.ui.appearance)
  );
}

function parseWalletHostConfig(value: unknown): WalletHostConfig {
  if (!isWalletHostConfig(value)) throw new Error('Invalid resolved wallet host configuration');
  return value;
}

export function replaceWalletHostAppearance(
  config: WalletHostConfig,
  appearance: AppearanceConfig,
): WalletHostConfig {
  return {
    network: config.network,
    registration: config.registration,
    signing: config.signing,
    webauthn: config.webauthn,
    wallet: config.wallet,
    ui: { appearance },
  };
}

export type WalletConfigurationUpdate =
  | { kind: 'configure'; config: WalletHostConfig; assetsBaseUrl: string; appearance?: never }
  | { kind: 'appearance'; appearance: AppearanceConfig; config?: never; assetsBaseUrl?: never };

export type ConfiguredWalletHost = {
  kind: 'configured';
  config: WalletHostConfig;
  assetsBaseUrl: string;
};

export type WalletHostConfigurationState = { kind: 'unconfigured' } | ConfiguredWalletHost;

export function parseWalletConfigurationUpdate(value: unknown): WalletConfigurationUpdate {
  const update = requireRecord(value, 'wallet configuration update');
  if (
    update.kind === 'configure' &&
    isString(update.assetsBaseUrl) &&
    update.assetsBaseUrl.length > 0 &&
    update.appearance === undefined
  ) {
    return {
      kind: 'configure',
      config: parseWalletHostConfig(update.config),
      assetsBaseUrl: update.assetsBaseUrl,
    };
  }
  if (
    update.kind === 'appearance' &&
    isAppearance(update.appearance) &&
    update.config === undefined &&
    update.assetsBaseUrl === undefined
  ) {
    return { kind: 'appearance', appearance: update.appearance };
  }
  throw new Error('Invalid wallet configuration update');
}

export function applyWalletConfigurationUpdate(
  state: WalletHostConfigurationState,
  update: WalletConfigurationUpdate,
): ConfiguredWalletHost {
  switch (update.kind) {
    case 'configure':
      return { kind: 'configured', config: update.config, assetsBaseUrl: update.assetsBaseUrl };
    case 'appearance':
      if (state.kind !== 'configured')
        throw new Error('Wallet configuration is required before appearance updates');
      return {
        kind: 'configured',
        config: replaceWalletHostAppearance(state.config, update.appearance),
        assetsBaseUrl: state.assetsBaseUrl,
      };
  }
}

function normalizeForStableSerialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableSerialize);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeForStableSerialize(record[key]);
    }
    return normalized;
  }
  return value;
}

export function walletHostExecutionFingerprint(config: WalletHostConfig | null): string {
  return JSON.stringify(
    normalizeForStableSerialize({
      network: config?.network,
      registration: config?.registration,
      signing: config?.signing,
      webauthn: config?.webauthn,
      rpId: config?.wallet.rpId,
    }),
  );
}
