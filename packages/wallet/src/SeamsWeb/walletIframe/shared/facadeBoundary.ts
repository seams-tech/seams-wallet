import { normalizeWalletLocale } from '@/core/ui/locale';
import type { KeyExportDomainMethods } from '@/SeamsWeb/publicApi/keyExport';
import type { ThemeMode, AppearanceConfig, AppearanceConfigInput } from '@/core/types/seams';
import type {
  NearProvisioningStateChangedEvent,
  SdkLifecycleEvent,
} from '@/core/types/sdkSentEvents';
import { parseMpcMaterialActivationRef } from '@shared/utils/domainIds';
import { resolveAppearanceTheme, resolveThemePalette } from '@/core/config/configHelpers';
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
// The public options bag is normalized before it reaches this boundary.
type ExportKeypairWithUIBoundaryInput = SigningEngineExportKeypairWithUIInput;

type ResolveExactKeyExportLaneBoundaryInput = Parameters<
  KeyExportDomainMethods['resolveExactKeyExportLane']
>[0];

type ResolveExactKeyExportLaneBoundaryResult = Awaited<
  ReturnType<KeyExportDomainMethods['resolveExactKeyExportLane']>
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
    locale: normalizeWalletLocale(rawInput.locale ?? current.locale),
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
