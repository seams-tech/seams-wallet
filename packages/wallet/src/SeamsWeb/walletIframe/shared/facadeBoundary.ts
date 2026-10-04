import type {
  EmailOtpUnlockPrewarmScope,
  EmailOtpUnlockPrewarmRequest,
} from '@/SeamsWeb/walletIframe/shared/emailOtpLifecycle';
import type { ThemeMode, AppearanceConfig, AppearanceConfigInput } from '@/core/types/seams';
import type {
  NearProvisioningStateChangedEvent,
  SdkLifecycleEvent,
} from '@/core/types/sdkSentEvents';
import { parseMpcMaterialActivationRef } from '@shared/utils/domainIds';
import { resolveAppearanceTheme, resolveThemePalette } from '@/core/config/configHelpers';
import type { KeyExportCapability } from '@/SeamsWeb/signingSurface/types';
import {
  thresholdEcdsaChainTargetsEqual,
  nearAccountRefFromAccountId,
  thresholdEcdsaChainTargetFromRequest,
  walletSessionRefFromSession,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { SigningEngineExportKeypairWithUIInput } from '@/core/signingEngine/flows/recovery/public';
import {
  parseExactEcdsaSigningLaneIdentity,
  parseExactEd25519ExportMaterialIdentity,
} from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import {
  nearAccountBindingFromRaw,
  type NearAccountBinding,
} from '@shared/utils/walletCapabilityBindings';
export function emailOtpUnlockPrewarmScopeFromBinding(
  nearAccountBinding: NearAccountBinding | undefined,
): EmailOtpUnlockPrewarmScope {
  if (!nearAccountBinding) return { kind: 'global' };
  return {
    kind: 'near_account_bound',
    walletId: String(nearAccountBinding.wallet.walletId),
    nearAccountId: String(nearAccountBinding.nearAccountId),
  };
}

export function emailOtpUnlockPrewarmRequestFromOptions(
  opts: SeamsWebPrewarmOptions | undefined,
): EmailOtpUnlockPrewarmRequest | null {
  if (opts?.iframe) return { kind: 'iframe_and_local_resources' };
  if (opts?.workers) return { kind: 'local_worker_resources' };
  return null;
}

export type SeamsWebPrewarmOptions =
  | {
      iframe?: boolean;
      workers?: boolean;
      walletId?: never;
      nearAccountId?: never;
    }
  | {
      iframe?: boolean;
      workers?: boolean;
      walletId: string;
      nearAccountId: string;
    };

function nearAccountBindingKindFromId(nearAccountId: string): NearAccountBinding['kind'] {
  return nearAccountId.length === 64 && /^[0-9a-f]+$/i.test(nearAccountId)
    ? 'implicit_near_account'
    : 'named_near_account';
}

function requireNearAccountBindingForOperation(args: {
  walletId: string;
  nearAccountId: string;
  operation: string;
}): NearAccountBinding {
  const walletId = String(args.walletId || '').trim();
  const nearAccountId = String(args.nearAccountId || '').trim();
  if (!walletId || !nearAccountId) {
    throw new Error(`[SeamsWeb] ${args.operation} requires walletId and nearAccountId`);
  }
  const parsed = nearAccountBindingFromRaw({
    kind: nearAccountBindingKindFromId(nearAccountId),
    wallet: { walletId },
    nearAccountId,
  });
  if (!parsed.ok) {
    throw new Error(`[SeamsWeb] ${args.operation} requires a valid NEAR account binding`);
  }
  return parsed.value;
}

export function resolvePrewarmNearAccountBinding(
  opts: SeamsWebPrewarmOptions | undefined,
): NearAccountBinding | undefined {
  const walletId = String(opts?.walletId || '').trim();
  const nearAccountId = String(opts?.nearAccountId || '').trim();
  if (!walletId && !nearAccountId) return undefined;
  return requireNearAccountBindingForOperation({
    walletId,
    nearAccountId,
    operation: 'prewarm',
  });
}

// The public options bag is normalized before it reaches this boundary.
type ExportKeypairWithUIBoundaryInput = SigningEngineExportKeypairWithUIInput;

type ResolveExactKeyExportLaneBoundaryInput = Parameters<
  KeyExportCapability['resolveExactKeyExportLane']
>[0];

type ResolveExactKeyExportLaneBoundaryResult = Awaited<
  ReturnType<KeyExportCapability['resolveExactKeyExportLane']>
>;

export function normalizeResolveExactKeyExportLaneInput(
  input: ResolveExactKeyExportLaneBoundaryInput,
): ResolveExactKeyExportLaneBoundaryInput {
  switch (input.kind) {
    case 'ecdsa':
      return {
        kind: 'ecdsa',
        walletSession: walletSessionRefFromSession(input.walletSession),
        chainTarget: thresholdEcdsaChainTargetFromRequest(input.chainTarget),
      };
    case 'ed25519':
      return {
        kind: 'ed25519',
        walletSession: walletSessionRefFromSession(input.walletSession),
        nearAccount: nearAccountRefFromAccountId(input.nearAccount.accountId),
      };
  }
}

export function normalizeResolveExactKeyExportLaneResult(
  result: ResolveExactKeyExportLaneBoundaryResult,
): ResolveExactKeyExportLaneBoundaryResult {
  switch (result.kind) {
    case 'relink_required':
      return {
        kind: 'relink_required',
        reason: result.reason,
      };
    case 'ecdsa':
      return {
        kind: 'ecdsa',
        laneIdentity: parseExactEcdsaSigningLaneIdentity(result.laneIdentity),
      };
    case 'ed25519': {
      const materialActivation = parseMpcMaterialActivationRef(result.materialActivation);
      if (!materialActivation.ok) throw new Error(materialActivation.error.message);
      return {
        kind: 'ed25519',
        laneIdentity: parseExactEd25519ExportMaterialIdentity(result.laneIdentity),
        materialActivation: materialActivation.value,
      };
    }
  }
}

export function normalizeExportKeypairWithUIInput(
  input: ExportKeypairWithUIBoundaryInput,
  theme: ThemeMode,
): ExportKeypairWithUIBoundaryInput {
  const resolvedOptions = {
    ...input.options,
    theme: input.options.theme ?? theme,
  };
  switch (input.kind) {
    case 'ecdsa': {
      const laneIdentity = parseExactEcdsaSigningLaneIdentity(input.laneIdentity);
      if (String(laneIdentity.signer.walletId) !== String(input.walletSession.walletId)) {
        throw new Error('[SeamsWeb] key export lane wallet does not match wallet session');
      }
      if (!thresholdEcdsaChainTargetsEqual(laneIdentity.signer.chainTarget, input.chainTarget)) {
        throw new Error('[SeamsWeb] key export lane chain target does not match request target');
      }
      return {
        kind: 'ecdsa',
        chainTarget: input.chainTarget,
        walletSession: input.walletSession,
        laneIdentity,
        options: resolvedOptions,
      };
    }
    case 'ed25519': {
      const laneIdentity = parseExactEd25519ExportMaterialIdentity(input.laneIdentity);
      const materialActivation = parseMpcMaterialActivationRef(input.materialActivation);
      if (!materialActivation.ok) throw new Error(materialActivation.error.message);
      if (
        String(laneIdentity.signer.account.wallet.walletId) !== String(input.walletSession.walletId)
      ) {
        throw new Error('[SeamsWeb] Ed25519 export lane wallet does not match wallet session');
      }
      if (
        String(laneIdentity.signer.account.nearAccountId) !== String(input.nearAccount.accountId)
      ) {
        throw new Error('[SeamsWeb] Ed25519 export lane does not match the NEAR account');
      }
      return {
        kind: 'ed25519',
        nearAccount: nearAccountRefFromAccountId(input.nearAccount.accountId),
        walletSession: input.walletSession,
        laneIdentity,
        materialActivation: materialActivation.value,
        options: resolvedOptions,
      };
    }
  }
}

export function resolveRuntimeAppearance(
  current: AppearanceConfig,
  input: AppearanceConfigInput,
): AppearanceConfig {
  const rawInput = input as Record<string, unknown>;
  return {
    theme: resolveAppearanceTheme({
      value: rawInput.theme,
      fallback: current.theme,
      legacyTokens: rawInput.tokens,
    }),
    palette: resolveThemePalette({
      value: rawInput.palette,
      fallback: current.palette,
    }),
  };
}

export function deliverNearProvisioningStateChanged(
  listener: (event: NearProvisioningStateChangedEvent) => void,
  event: SdkLifecycleEvent,
): void {
  if (event.event === 'registration.near_provisioning_changed') listener(event);
}
