import { THRESHOLD_SECP256K1_ECDSA_2P_PARTICIPANT_IDS_V1 } from '@shared/threshold/secp256k1';
import { THRESHOLD_ED25519_2P_PARTICIPANT_IDS } from '@shared/threshold/participants';
import { type WalletId } from '@shared/utils/registrationIntent';
import {
  implicitNearAccountProvisioning,
  sponsoredNamedNearAccountProvisioning,
  REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION,
  type RegistrationNearAccountProvisioning,
  type RegistrationSignerSetSelection,
  type RegistrationSignerRequest,
} from '@shared/utils/registrationSignerPlan';
import { type RegisterWalletInput } from '@shared/utils/registrationAuthMethodInput';
import { parseNamedNearAccountId } from '@shared/utils/near';
import type {
  SeamsConfigsReadonly,
  SeamsRegistrationNearAccountProvisioning,
} from '@/core/types/seams';
import type { RegistrationHooksOptions } from '@/core/types/sdkSentEvents';
import { listThresholdEcdsaProvisionTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import type { ThresholdEcdsaChainTarget } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { isNearChainNetwork } from '@/core/config/chains';

export function registrationSelectionIncludesNear(
  selection: RegistrationSignerSetSelection,
): boolean {
  for (const signer of selection.signers) {
    if (signer.kind === 'near_ed25519') return true;
  }
  return false;
}

export function buildNearWalletRegistrationSignerSetSelection(args: {
  configs: SeamsConfigsReadonly;
  accountProvisioning?: RegistrationNearAccountProvisioning;
  options: RegistrationHooksOptions;
  ecdsaChainTargets?: readonly ThresholdEcdsaChainTarget[];
}): RegistrationSignerSetSelection {
  const ecdsaChainTargets =
    args.ecdsaChainTargets ?? configuredEcdsaRegistrationTargets(args.configs, args.options);
  return buildRegistrationSignerSetSelection(
    args.accountProvisioning ?? implicitNearAccountProvisioning(),
    ecdsaChainTargets,
  );
}

export function buildConfiguredWalletRegistrationSignerSetSelection(args: {
  configs: SeamsConfigsReadonly;
  wallet: RegisterWalletInput;
  options: RegistrationHooksOptions;
}): RegistrationSignerSetSelection {
  let accountProvisioning: RegistrationNearAccountProvisioning | null = null;
  for (const chain of args.configs.network.chains) {
    if (isNearChainNetwork(chain.network)) {
      accountProvisioning = resolvePasskeyRegistrationAccountProvisioning(args);
      break;
    }
  }
  return buildRegistrationSignerSetSelection(
    accountProvisioning,
    configuredEcdsaRegistrationTargets(args.configs, args.options),
  );
}

function configuredEcdsaRegistrationTargets(
  configs: SeamsConfigsReadonly,
  options: RegistrationHooksOptions,
): ThresholdEcdsaChainTarget[] {
  const targets = listThresholdEcdsaProvisionTargets({
    signerOptions: options.signerOptions ?? configs.signing.thresholdEcdsa.provisioningDefaults,
    chains: configs.network.chains,
  });
  const chainTargets: ThresholdEcdsaChainTarget[] = [];
  for (const target of targets) chainTargets.push(target.chainTarget);
  return chainTargets;
}

function buildRegistrationSignerSetSelection(
  accountProvisioning: RegistrationNearAccountProvisioning | null,
  ecdsaChainTargets: readonly ThresholdEcdsaChainTarget[],
): RegistrationSignerSetSelection {
  const signers: RegistrationSignerRequest[] = [];
  if (accountProvisioning) {
    signers.push({
      kind: 'near_ed25519',
      accountProvisioning,
      signerSlot: 1,
      participantIds: [...THRESHOLD_ED25519_2P_PARTICIPANT_IDS],
      derivationVersion: REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION,
    });
  }
  if (ecdsaChainTargets.length) {
    signers.push({
      kind: 'evm_family_ecdsa',
      chainTargets: [...ecdsaChainTargets],
      participantIds: [...THRESHOLD_SECP256K1_ECDSA_2P_PARTICIPANT_IDS_V1],
    });
  }
  if (!signers.length) {
    throw new Error('Wallet registration requires at least one configured, enabled signer');
  }
  return { kind: 'signer_set', signers };
}

function sponsoredNamedRegistrationProvisioningFromAccountId(
  nearAccountId: string,
): RegistrationNearAccountProvisioning {
  const parsed = parseNamedNearAccountId(nearAccountId);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return sponsoredNamedNearAccountProvisioning(parsed.value);
}

function relayerNamedSubaccountProvisioningFromWalletId(args: {
  walletId: WalletId | string;
  relayerAccountId: string;
}): RegistrationNearAccountProvisioning {
  const walletId = String(args.walletId || '').trim();
  const relayerAccountId = String(args.relayerAccountId || '').trim();
  if (!walletId) throw new Error('Relayer named NEAR registration requires walletId');
  if (!relayerAccountId) {
    throw new Error('Relayer named NEAR registration requires relayer accountId');
  }
  return sponsoredNamedRegistrationProvisioningFromAccountId(`${walletId}.${relayerAccountId}`);
}

export function resolvePasskeyRegistrationAccountProvisioning(args: {
  configs: SeamsConfigsReadonly;
  wallet: RegisterWalletInput;
  preference?: SeamsRegistrationNearAccountProvisioning;
}): RegistrationNearAccountProvisioning {
  const preference = args.preference ?? args.configs.registration.nearAccountProvisioning;
  switch (preference.kind) {
    case 'implicit_account':
      return implicitNearAccountProvisioning();
    case 'relayer_named_subaccount':
      if (args.wallet.kind !== 'provided') {
        throw new Error('Relayer named NEAR registration requires a provided walletId');
      }
      return relayerNamedSubaccountProvisioningFromWalletId({
        walletId: args.wallet.walletId,
        relayerAccountId: args.configs.network.relayer.accountId,
      });
    default: {
      const exhaustive: never = preference;
      return exhaustive;
    }
  }
}
