import type { WalletSessionHome } from '@shared/device-linking/contracts';
import { deriveSigningRootId } from '@shared/threshold/signingRootScope';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import type { Variant } from '@shared/utils/variant';
import {
  buildStoredWalletRegistrationEvmFamilyEcdsaPreparedBranch,
  findStoredWalletRegistrationEvmFamilyEcdsaBranch,
  type StoredWalletRegistrationCeremony,
  type StoredWalletRegistrationSignerBranch,
} from '../../../../core/RegistrationCeremonyStore';
import { registrationPreparationIdFromString } from '../../../../core/registrationContracts';
import type { WalletRegistrationSetupResponseV2 } from '../../../../core/threeRouteRegistrationContracts';
import {
  routerAbEcdsaStrictRegistrationFactsBindingJson,
  type RouterAbEcdsaStrictRegistrationPort,
} from '../../../domains/ecdsa/routerAbEcdsaStrictRegistration';
import { isTransientD1Error } from '../../../../storage/d1Retry';
import type { WalletRegistrationSetupInput } from '../../../domains/walletRegistration/walletRegistrationInputs';
import type {
  RegistrationWalletStarter,
  WalletRegistrationReservationAuthority,
  WalletRegistrationSetupReservationResult,
} from '../../../domains/walletRegistration/walletRegistrationReservation';
import { buildD1EvmFamilyEcdsaRegistrationPrepare } from './d1EvmFamilyEcdsaRegistrationBranch';
import {
  buildRegistrationIntent,
  inferRuntimePolicyScopeFromSigningRoot,
} from './d1RegistrationCeremonyRecords';
import { CloudflareD1RegistrationCeremonyIntentStore } from './d1RegistrationCeremonyStore';
import {
  errorMessage,
  registrationIntentSignerBranches,
  registrationPreparedContextEcdsaChainTargets,
  resolveRegistrationPreparedContextFromPlan,
} from './d1RegistrationSetupSupport';
import {
  buildWalletRegistrationSetupSignature,
  normalizeWalletRegistrationSetupRequest,
  walletRegistrationSetupError,
  walletRegistrationSetupExpiresAtMs,
  walletRegistrationSetupIntentDigest,
} from './d1WalletRegistrationSetup';

type WalletRegistrationSetupDependencies = {
  readonly home: WalletSessionHome;
  readonly reservation: Pick<WalletRegistrationReservationAuthority, 'reserve'> | null;
  readonly store: CloudflareD1RegistrationCeremonyIntentStore;
  readonly ecdsaStrictRegistration: RouterAbEcdsaStrictRegistrationPort;
  readonly startRegistrationWallets: RegistrationWalletStarter | null;
};

export async function executeD1WalletRegistrationSetup(
  input: WalletRegistrationSetupInput,
  dependencies: WalletRegistrationSetupDependencies,
): Promise<WalletRegistrationSetupResponseV2> {
  try {
    const normalized = normalizeWalletRegistrationSetupRequest(input.request);
    if (!normalized.ok) return walletRegistrationSetupError(normalized.code, normalized.message);

    if (!dependencies.reservation)
      return walletRegistrationSetupError(
        'registration_authority_unavailable',
        'Registration reservation authority is required',
      );
    const admitted = await dependencies.reservation.reserve(input);
    if (!admitted.ok) return admitted;
    const reservation = admitted.reservation;
    const wallet = { walletId: reservation.walletId };
    if (
      input.request.wallet?.kind === 'provided' &&
      input.request.wallet.walletId !== wallet.walletId
    ) {
      return walletRegistrationSetupError(
        'reservation_conflict',
        'Registration reservation changed the requested wallet',
      );
    }
    const expiresAtMs = walletRegistrationSetupExpiresAtMs(reservation.reservedAtMs);
    if (Date.now() >= expiresAtMs)
      return walletRegistrationSetupError('registration_expired', 'Registration setup has expired');
    // The reservation fixes the wallet and its home. Address initialization
    // can overlap the ceremony read and write; neither grants signing authority.
    const [startup, setup] = await Promise.allSettled([
      dependencies.startRegistrationWallets?.({
        walletId: wallet.walletId,
        ownershipGeneration: admitted.ownershipGeneration,
      }),
      completeReservedRegistrationSetup(input, dependencies, admitted, normalized, expiresAtMs),
    ]);
    if (setup.status === 'rejected') throw setup.reason;
    if (!setup.value.ok) return setup.value;
    if (startup.status === 'rejected') throw startup.reason;
    return setup.value;
  } catch (error: unknown) {
    // The route layer maps both codes to a 5xx status and withholds this message.
    return walletRegistrationSetupError(
      isTransientD1Error(error) ? 'storage_unavailable' : 'internal',
      errorMessage(error) || 'Failed to set up wallet registration',
    );
  }
}

async function completeReservedRegistrationSetup(
  input: WalletRegistrationSetupInput,
  dependencies: Pick<
    WalletRegistrationSetupDependencies,
    'home' | 'store' | 'ecdsaStrictRegistration'
  >,
  admitted: Variant<WalletRegistrationSetupReservationResult, 'ok', true>,
  normalized: Variant<ReturnType<typeof normalizeWalletRegistrationSetupRequest>, 'ok', true>,
  expiresAtMs: number,
): Promise<WalletRegistrationSetupResponseV2> {
  const reservation = admitted.reservation;
  const wallet = { walletId: reservation.walletId };
  const registrationCeremonyId = reservation.ceremonyId;
  const registrationPreparationId = reservation.preparationId;
  const runtimePolicyScope =
    input.runtimePolicyScope ||
    inferRuntimePolicyScopeFromSigningRoot({
      orgId: input.orgId,
      signingRootId: input.signingRootId,
      signingRootVersion: input.signingRootVersion,
    });
  const signingRootId =
    toOptionalTrimmedString(input.signingRootId) ||
    (runtimePolicyScope ? deriveSigningRootId(runtimePolicyScope) : '');
  const signingRootVersion =
    toOptionalTrimmedString(input.signingRootVersion) ||
    runtimePolicyScope?.signingRootVersion ||
    'default';
  if (!signingRootId) {
    return walletRegistrationSetupError('invalid_body', 'registration requires a signing root');
  }

  const registrationOperation = reservation;
  const intent = buildRegistrationIntent({
    nonceB64u: registrationCeremonyId.slice(4),
    walletId: wallet.walletId,
    authMethod: normalized.authMethod,
    signerSelection: normalized.signerSelection,
    foundingWalletAuthMethodId: registrationOperation.walletAuthMethodId,
    ...(runtimePolicyScope ? { runtimePolicyScope } : {}),
  });
  const digestB64u = await walletRegistrationSetupIntentDigest(intent);
  const branches = registrationIntentSignerBranches(intent);
  if (!branches.ok) return walletRegistrationSetupError(branches.code, branches.message);
  // NEAR setup is deterministic from the reservation. The insert/read batch
  // returns an exact retry without an earlier absent-record lookup. ECDSA
  // retains its lookup before starting external preparation.
  const existing =
    admitted.lifecycle === 'established' || branches.value.evmFamilyEcdsa
      ? await dependencies.store.getSetupCeremony(registrationCeremonyId)
      : null;
  if (existing) {
    if (
      existing.digestB64u !== digestB64u ||
      existing.expectedOrigin !== input.expectedOrigin ||
      existing.foundingWalletAuthorityId !== reservation.walletAuthorityId ||
      existing.foundingDeviceId !== reservation.deviceId ||
      existing.foundingWalletAuthMethodId !== reservation.walletAuthMethodId ||
      existing.expiresAtMs !== expiresAtMs
    )
      return walletRegistrationSetupError(
        'reservation_conflict',
        'Registration setup conflicts with its reservation',
      );
    if (admitted.lifecycle === 'reserved') {
      await dependencies.store.reserveSetupCeremony(existing, admitted.ownershipGeneration);
    }
    return await setupResponseFromCeremony(input, dependencies.home, existing);
  }
  if (admitted.lifecycle === 'established')
    return walletRegistrationSetupError(
      'registration_closed',
      'Completed registration setup snapshot is unavailable',
    );
  const ecdsaBranch = branches.value.evmFamilyEcdsa;
  const nearEd25519Branch = branches.value.nearEd25519;
  if (!ecdsaBranch && !nearEd25519Branch) {
    return walletRegistrationSetupError('invalid_body', 'registration signer branch is required');
  }
  /* A mixed plan is stored whole — the plan is what the ceremony agreed
       to — but only its ECDSA branch is prepared here. Respond adds the
       Ed25519 branch once the verified authority determines its scope. */
  const preparedContext = resolveRegistrationPreparedContextFromPlan({
    signerPlan: branches.value.plan,
    runtimePolicyScope,
    signingRootId,
    signingRootVersion,
  });
  if (!preparedContext.ok) {
    return walletRegistrationSetupError(preparedContext.code, preparedContext.message);
  }
  if (ecdsaBranch && !runtimePolicyScope) {
    return walletRegistrationSetupError(
      'invalid_body',
      'ECDSA registration requires an exact runtime policy scope',
    );
  }
  const chainTargets = ecdsaBranch
    ? registrationPreparedContextEcdsaChainTargets(preparedContext.preparedContext)
    : null;
  if (ecdsaBranch && !chainTargets) {
    return walletRegistrationSetupError('invalid_body', 'ECDSA chain targets are required');
  }

  /* ECDSA preparation only, and only when the plan has an ECDSA branch.
       An Ed25519-only plan has nothing to prepare before the proof: its Yao
       admission binds the authority scope, so respond derives it. */
  const ecdsaPrepared =
    ecdsaBranch && chainTargets && runtimePolicyScope
      ? await buildD1EvmFamilyEcdsaRegistrationPrepare({
          registrationPurpose: 'wallet_registration',
          registrationCeremonyId,
          registrationPreparationId: registrationPreparationIdFromString(registrationPreparationId),
          walletId: wallet.walletId,
          signingRootId,
          signingRootVersion,
          chainTargets,
          participantIds: [...ecdsaBranch.participantIds],
          strictRegistration: dependencies.ecdsaStrictRegistration,
          runtimePolicyScope,
        })
      : null;
  if (ecdsaPrepared && !ecdsaPrepared.ok) {
    return walletRegistrationSetupError(ecdsaPrepared.code, ecdsaPrepared.message);
  }

  const storedBranches: StoredWalletRegistrationSignerBranch[] = [];
  if (ecdsaPrepared?.ok && ecdsaBranch)
    storedBranches.push(
      buildStoredWalletRegistrationEvmFamilyEcdsaPreparedBranch({
        branchKey: ecdsaBranch.branchKey,
        ecdsa: {
          kind: ecdsaPrepared.ecdsa.kind,
          chainTargets: ecdsaPrepared.ecdsa.chainTargets,
          prepare: ecdsaPrepared.ecdsa.prepare,
          strictRegistration: ecdsaPrepared.ecdsa.strictRegistration,
          strictRegistrationBindingJson: routerAbEcdsaStrictRegistrationFactsBindingJson(
            ecdsaPrepared.ecdsa.strictRegistration,
          ),
        },
      }),
    );

  const ceremony: StoredWalletRegistrationCeremony = {
    registrationCeremonyId,
    foundingWalletAuthorityId: registrationOperation.walletAuthorityId,
    foundingDeviceId: registrationOperation.deviceId,
    foundingWalletAuthMethodId: registrationOperation.walletAuthMethodId,
    intent,
    digestB64u,
    signerPlan: branches.value.plan,
    preparedContext: preparedContext.preparedContext,
    orgId: toOptionalTrimmedString(input.orgId) || '',
    signingRootId,
    signingRootVersion,
    ...(input.expectedOrigin ? { expectedOrigin: input.expectedOrigin } : {}),
    expiresAtMs,
    /* The proof does not exist yet; respond binds it. */
    authorityState: { kind: 'awaiting_proof', authMethod: normalized.authMethod },
    signerState: { kind: 'signer_set_registration', branches: storedBranches },
  };
  const stored = await dependencies.store.reserveSetupCeremony(
    ceremony,
    admitted.ownershipGeneration,
  );
  return await setupResponseFromCeremony(input, dependencies.home, stored);
}

async function setupResponseFromCeremony(
  input: WalletRegistrationSetupInput,
  home: WalletSessionHome,
  ceremony: StoredWalletRegistrationCeremony,
): Promise<WalletRegistrationSetupResponseV2> {
  const { signedSetup } = await buildWalletRegistrationSetupSignature({
    signer: input.signer,
    ceremony,
    expectedOrigin: input.expectedOrigin,
  });
  const branches = registrationIntentSignerBranches(ceremony.intent);
  if (!branches.ok) return branches;
  const success = {
    home,
    ok: true as const,
    registrationCeremonyId: ceremony.registrationCeremonyId,
    walletId: String(ceremony.intent.walletId),
    walletAuthMethodId: ceremony.foundingWalletAuthMethodId,
    registrationIntentDigestB64u: ceremony.digestB64u,
    intent: ceremony.intent,
    signedSetup,
  };
  if (!branches.value.evmFamilyEcdsa) return { ...success, kind: 'near_ed25519' };
  if (ceremony.signerState.kind !== 'signer_set_registration')
    return walletRegistrationSetupError(
      'invalid_state',
      'Registration setup signer state is invalid',
    );
  const ecdsa = findStoredWalletRegistrationEvmFamilyEcdsaBranch(ceremony.signerState);
  if (!ecdsa || ecdsa.kind !== 'evm_family_ecdsa_prepared')
    return walletRegistrationSetupError(
      'invalid_state',
      'Registration setup snapshot is not prepared',
    );
  return {
    ...success,
    kind: branches.value.nearEd25519 ? 'near_ed25519_and_evm_family_ecdsa' : 'evm_family_ecdsa',
    ecdsa: {
      kind: ecdsa.derivationKind,
      chainTargets: ecdsa.chainTargets,
      prepare: ecdsa.prepare,
      strictRegistration: ecdsa.strictRegistration,
    },
  };
}
