import { emitUnlockEvent, finalizeLoginSuccess, finalizeLoginError } from '../unlockCompletion';
import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import { UnlockEventPhase } from '@/core/types/sdkSentEvents';
import type { LoginAndCreateSessionResult, LoginResult } from '@/core/types/seams';
import type { LoginWebContext } from '@/SeamsWeb/signingSurface/types';
import { isUserCancellationError, toError } from '@shared/utils/errors';
import { isWalletCustodySeedBinding } from '@shared/passkey-custody/custodySecretBinding';
import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import { joinNormalizedUrl } from '@shared/utils/normalize';
import { isObject } from '@shared/utils/validation';
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import { IndexedDBManager } from '@/core/indexedDB';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import {
  verifyLinkedDevicePasskeyWalletSession,
  type LinkedDevicePasskeyWalletSessionUnlockInput,
} from '@/core/rpcClients/near/rpcCalls';
import type {
  WalletAuthorityLinkedSignerMaterialRecordV1,
  WalletAuthoritySignerMaterialRecordV1,
} from '@/core/indexedDB/passkeyClientDB.types';
import type { WebAuthnAllowCredential } from '@/core/signingEngine/webauthnAuth/credentials/collectAuthenticationCredentialForChallengeB64u';
import {
  unlockEmailOtpAuthorityWallet,
  type EmailOtpAuthorityWalletUnlockResult,
  type EmailOtpAuthorityUnlockEd25519Request,
} from '@/core/signingEngine/session/emailOtp/walletUnlock';
import { disposeWalletCustodyEd25519ActiveClientV1 } from '@/core/signingEngine/walletCustody/ed25519ActiveClient';
import {
  destroyUnlockedWalletEd25519ExportRootCapabilitiesV1,
  establishUnlockedWalletEd25519ExportRootCapabilityV1 as establishUnlockedExportRootCapabilityV1,
  walletCustodyCeremonyTransportFromWorkerContextV1,
} from '@/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { DEFAULT_UNLOCK_REMAINING_USES } from '@/core/signingEngine/threshold/sessionPolicy';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import { passkeyPrfFirstB64uFromCredential } from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import { destroyLinkedDeviceEcdsaHolderMaterialWasm } from '@/core/signingEngine/threshold/crypto/ecdsaDerivationClientWasm';
import {
  removeLinkedEcdsaHolderRuntimeV1,
  type LinkedEcdsaHolderRuntimeV1,
} from '@/core/signingEngine/session/material/linkedEcdsaHolderRuntime';
import type {
  LinkedDeviceEmailOtpAuthoritySelection,
  LinkedDeviceEmailOtpProviderIdentity,
  LinkedDevicePasskeyOpenedMaterial,
} from './authority';
import {
  walletAuthAuthorityRefForLinkedDeviceMethod,
  resolveLinkedDeviceEmailOtpAuthoritySelection,
  assertLinkedDeviceWalletSessionExact,
  openLinkedDeviceEmailOtpSignerMaterials,
  walletAuthAuthorityForLinkedDeviceMethod,
  resolveLinkedDevicePasskeyAuthoritySelection,
  openLinkedDevicePasskeySignerMaterials,
} from './authority';
import { assertNeverLoginState } from './identity';
import { resumeNearAfterSuccessfulUnlock } from './unlockLifecycle';
import {
  linkedDeviceEd25519Material,
  linkedDeviceEcdsaMaterial,
  linkedDeviceRuntimeRequiresCurve,
  activateLinkedDeviceEcdsaHolderRuntime,
  linkedDeviceEd25519SessionFromEmailOtpBootstrap,
  activateLinkedDeviceEd25519Runtime,
  linkedDeviceEd25519SessionFromPasskeyUnlock,
} from './linkedDeviceRuntimes';

function fetchWithGlobalThis(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

type LinkedDevicePasskeyChallenge = Readonly<{
  readonly challengeId: string;
  readonly challengeB64u: string;
}>;

async function requestLinkedDevicePasskeyChallenge(args: {
  readonly relayUrl: string;
  readonly walletId: WalletId;
  readonly rpId: string;
}): Promise<LinkedDevicePasskeyChallenge> {
  const response = await fetchWithGlobalThis(
    joinNormalizedUrl(args.relayUrl, '/wallet/unlock/challenge'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unlockBackend: 'passkey',
        userId: String(args.walletId),
        rpId: args.rpId,
      }),
    },
  );
  const raw: unknown = await response.json().catch(() => ({}));
  const body = isObject(raw) ? raw : {};
  if (!response.ok || body.ok !== true) {
    throw new Error(
      typeof body.message === 'string'
        ? body.message
        : `wallet/unlock/challenge failed (HTTP ${response.status})`,
    );
  }
  const challengeId = String(body.challengeId || '').trim();
  const challengeB64u = String(body.challengeB64u || '').trim();
  if (!challengeId || !challengeB64u) {
    throw new Error('[login] linked passkey challenge is incomplete');
  }
  return { challengeId, challengeB64u };
}

function linkedDevicePasskeyAllowCredential(credentialIdB64u: string): WebAuthnAllowCredential {
  return {
    id: credentialIdB64u,
    type: 'public-key',
    transports: [],
  };
}

/**
 * Where an Email OTP unlock's signer material comes from.
 *
 * A linked device carries sealed material of its own and must have it. An Email
 * method added to an existing authority has none and must not be given any -
 * its access is the authority's, reached through the owner path. Both name an
 * exact authority and an exact method; only the material differs, so the two
 * are separate shapes rather than one shape with an optional field. Inferring
 * provenance from whether material happened to be present is what let an owner
 * sibling fall into the linked-device path and fail there.
 */
type EmailOtpUnlockSourceV1 =
  | {
      readonly kind: 'owner_authority';
      readonly selection: LinkedDeviceEmailOtpAuthoritySelection;
      readonly signerMaterials?: never;
    }
  | {
      readonly kind: 'linked_device';
      readonly selection: LinkedDeviceEmailOtpAuthoritySelection;
      readonly signerMaterials: readonly [
        WalletAuthoritySignerMaterialRecordV1,
        ...WalletAuthoritySignerMaterialRecordV1[],
      ];
    };

function emailOtpUnlockSource(
  selection: LinkedDeviceEmailOtpAuthoritySelection,
): EmailOtpUnlockSourceV1 {
  const [first, ...rest] = selection.signerMaterials;
  /* Provenance decides this, not the material: a device-linked authority always
     has material, so its absence there is corruption rather than an owner
     sibling. The selection resolver already refuses a device_link authority
     with no material. */
  if (selection.authority.provenance.kind === 'device_link') {
    if (!first) {
      throw new Error('[login] linked Email OTP authority has no signer material');
    }
    return { kind: 'linked_device', selection, signerMaterials: [first, ...rest] };
  }
  if (first) {
    throw new Error('[login] owner Email OTP authority must not carry linked signer material');
  }
  return { kind: 'owner_authority', selection };
}

/**
 * What this unlock should build, decided by the branch rather than by whichever
 * fields happened to be present.
 *
 * A linked device names the signer slot its own sealed material carries. An
 * owner authority has none, so the request is assembled from its exact
 * authority projection and the runtime is built inside the unlock.
 */
async function emailOtpAuthorityUnlockEd25519Request(input: {
  readonly context: LoginWebContext;
  readonly source: EmailOtpUnlockSourceV1;
  readonly providerIdentity: LinkedDeviceEmailOtpProviderIdentity;
}): Promise<EmailOtpAuthorityUnlockEd25519Request> {
  const { source } = input;
  if (source.kind === 'linked_device') {
    const ed25519Material = source.signerMaterials.find(
      (
        material,
      ): material is Extract<
        WalletAuthorityLinkedSignerMaterialRecordV1,
        { keyFamily: 'ed25519' }
      > =>
        material.kind === 'wallet_authority_linked_signer_material_v1' &&
        material.keyFamily === 'ed25519',
    );
    if (!ed25519Material) return { kind: 'no_ed25519' };
    return {
      kind: 'linked_device',
      signerSlot: ed25519Material.publicFacts.applicationBinding.key_creation_signer_slot,
      remainingUses: DEFAULT_UNLOCK_REMAINING_USES,
    };
  }
  if (
    !source.selection.authority.signerActivations.ed25519 ||
    (await hasPendingJoinedNearRegistration(source.selection))
  )
    return { kind: 'no_ed25519' };
  const request =
    await input.context.signingEngine.resolveOwnerAuthorityEd25519UnlockRequestInternal({
      walletSession: {
        walletId: source.selection.walletId,
        walletSessionUserId: String(source.selection.walletId),
      },
      providerSubjectId: input.providerIdentity.providerSubjectId,
      walletAuthMethodId: String(source.selection.authMethod.walletAuthMethodId),
      remainingUses: DEFAULT_UNLOCK_REMAINING_USES,
    });
  return request ?? { kind: 'no_ed25519' };
}

async function hasPendingJoinedNearRegistration(
  selection: LinkedDeviceEmailOtpAuthoritySelection,
): Promise<boolean> {
  const activation = selection.authority.signerActivations.ed25519?.materialActivation;
  if (!activation) return false;
  const pendingRows = await IndexedDBManager.listPendingWalletRegistrationCommits();
  return pendingRows.some(
    pendingNearRegistrationMatchesAuthority.bind(undefined, selection, activation),
  );
}

function pendingNearRegistrationMatchesAuthority(
  selection: LinkedDeviceEmailOtpAuthoritySelection,
  activation: MpcMaterialActivationRef,
  pending: import('@/core/indexedDB').PendingWalletRegistrationCommitV1,
): boolean {
  return (
    pending.operation === 'near_provisioning' &&
    pending.phase === 'joined' &&
    pending.signerPlanKind === 'near_ed25519_and_evm_family_ecdsa' &&
    pending.walletId === selection.walletId &&
    pending.walletAuthMethodId === selection.authMethod.walletAuthMethodId &&
    mpcMaterialActivationRefsEqual(
      pending.localMaterial.ed25519.metadata.materialActivation,
      activation,
    )
  );
}

/**
 * Install the Ed25519 runtime an owner authority's unlock just built.
 *
 * Everything is checked against the authority and method that were selected,
 * before the handle is used: a session naming a different method, or a
 * capability naming a different activation, must not be able to activate a
 * runtime under this one.
 */
async function unlockOwnerAuthorityEmailOtpEd25519(input: {
  readonly context: LoginWebContext;
  readonly selection: LinkedDeviceEmailOtpAuthoritySelection;
  readonly unlocked: EmailOtpAuthorityWalletUnlockResult;
  readonly providerIdentity: LinkedDeviceEmailOtpProviderIdentity;
  readonly emailHashHex: string;
}): Promise<void> {
  const { selection, unlocked } = input;
  const session = unlocked.walletSession;
  if (
    session.walletId !== selection.walletId ||
    session.authorityId !== selection.authority.authorityId ||
    session.authMethodId !== selection.authMethod.walletAuthMethodId ||
    session.authorityDigestB64u !== selection.authority.authorityDigestB64u ||
    session.authorityRevocationEpoch !== selection.authority.revocationEpoch
  ) {
    throw new Error('[login] owner Email OTP Wallet Session does not match the selected authority');
  }
  const activation = selection.authority.signerActivations.ed25519?.materialActivation;
  if (!activation) return;
  if (unlocked.ed25519Activation.kind !== 'ed25519_activation_ready') {
    if (await hasPendingJoinedNearRegistration(selection)) return;
    throw new Error('[login] owner Email OTP unlock built no Ed25519 runtime to install');
  }
  const ready = unlocked.ed25519Activation;
  if (!mpcMaterialActivationRefsEqual(ready.bootstrap.capability.materialActivation, activation)) {
    throw new Error('[login] owner Email OTP Ed25519 capability names another activation');
  }
  if (!mpcMaterialActivationRefsEqual(ready.metadata.materialActivation, activation)) {
    throw new Error('[login] owner Email OTP Ed25519 runtime names another activation');
  }
  if (ready.bootstrap.session.walletSessionId !== unlocked.operationCredential.walletSessionId) {
    throw new Error('[login] owner Email OTP Ed25519 session credential mismatch');
  }
  const authority = await walletAuthAuthorityRefForLinkedDeviceMethod({
    selection,
    providerIdentity: input.providerIdentity,
  });
  await input.context.signingEngine.activateOwnerAuthorityEd25519RuntimeInternal({
    walletSession: {
      walletId: selection.walletId,
      walletSessionUserId: String(selection.walletId),
    },
    providerSubjectId: input.providerIdentity.providerSubjectId,
    walletAuthMethodId: String(selection.authMethod.walletAuthMethodId),
    emailHashHex: input.emailHashHex,
    /* From the selection this unlock already verified against the returned
       session, not from a lookup: activation is part of installing that
       session, so reading it back would be waiting on itself. */
    authority,
    activeClientHandle: ready.activeClientHandle,
    metadata: ready.metadata,
    bootstrap: ready.bootstrap,
  });
}

function ownerAuthorityWalletCustodySeedEnvelope(
  unlocked: EmailOtpAuthorityWalletUnlockResult,
): PasskeyCustodyEnvelopeRecord {
  switch (unlocked.walletCustodySeed.kind) {
    case 'owner_authority_seed_envelope':
      return unlocked.walletCustodySeed.existingEnvelope;
    case 'linked_device_seed_unavailable':
      throw new Error('[login] owner Email OTP unlock returned linked-device custody state');
    default:
      return assertNeverLoginState(unlocked.walletCustodySeed);
  }
}

export async function unlockLinkedDeviceEmailOtpWallet(args: {
  readonly context: LoginWebContext;
  readonly walletIdInput: string;
  readonly emailHashHex: string;
  readonly walletAuthMethodId: string;
  readonly providerSubjectId: string;
  readonly challengeId: string;
  readonly otpCode: string;
  readonly relayUrl: string;
}): Promise<void> {
  const providerIdentity: LinkedDeviceEmailOtpProviderIdentity = {
    provider: args.providerSubjectId.startsWith('google:') ? 'google' : 'email',
    providerSubjectId: args.providerSubjectId,
  };
  const resolution = await resolveLinkedDeviceEmailOtpAuthoritySelection({
    walletIdInput: args.walletIdInput,
    emailHashHex: args.emailHashHex,
    provider: providerIdentity.provider,
    providerSubjectId: providerIdentity.providerSubjectId,
    walletAuthMethodId: args.walletAuthMethodId,
  });
  if (resolution.kind === 'none') {
    throw new Error('[login] linked Email OTP authority is unavailable');
  }
  if (resolution.kind === 'rejected') throw new Error(resolution.message);
  const selection = resolution.selection;
  if (String(selection.authMethod.walletAuthMethodId) !== String(args.walletAuthMethodId)) {
    throw new Error('[login] linked Email OTP selected auth method changed during unlock');
  }
  const relayUrl = String(args.relayUrl || '').trim();
  if (!relayUrl) throw new Error('[login] linked Email OTP unlock requires relayer.url');
  const source = emailOtpUnlockSource(selection);
  const ed25519Request = await emailOtpAuthorityUnlockEd25519Request({
    context: args.context,
    source,
    providerIdentity,
  });
  const unlocked: EmailOtpAuthorityWalletUnlockResult = await unlockEmailOtpAuthorityWallet({
    relayUrl,
    walletId: String(selection.walletId),
    walletAuthMethodId: String(selection.authMethod.walletAuthMethodId),
    challengeId: args.challengeId,
    otpCode: args.otpCode,
    ed25519: ed25519Request,
    workerCtx: args.context.signingEngine.getSignerWorkerContext(),
  });
  const factorSecret32: Uint8Array | null = unlocked.factorSecret32;
  /* The server derives this provider from the subject shape when it binds the
     exact Email method. An Ed25519 bootstrap may retain an older provider label,
     so it cannot redefine the factor authority used by ECDSA step-up. */
  const effectiveProviderIdentity = providerIdentity;
  let openedMaterials:
    | readonly [LinkedDevicePasskeyOpenedMaterial, ...LinkedDevicePasskeyOpenedMaterial[]]
    | null = null;
  let installedEcdsaRuntime: LinkedEcdsaHolderRuntimeV1 | null = null;
  /* A handle exists only on the owner branch, and only until the runtime it
     belongs to takes ownership. Until then every exit disposes it. */
  let ownedActiveClientHandle: string | null =
    unlocked.ed25519Activation.kind === 'ed25519_activation_ready'
      ? unlocked.ed25519Activation.activeClientHandle
      : null;
  try {
    if (source.kind === 'owner_authority') {
      /* The authorization is written first because activation resolves the
         active Wallet Session authority to bind against; activating before it
         exists looks to that lookup like no session at all. */
      await walletSessionAuthorizations.writeExactWithOperationCredential({
        record: unlocked.walletSession,
        operationCredential: unlocked.operationCredential,
      });
      await unlockOwnerAuthorityEmailOtpEd25519({
        context: args.context,
        selection,
        unlocked,
        providerIdentity: effectiveProviderIdentity,
        emailHashHex: args.emailHashHex,
      });
      ownedActiveClientHandle = null;
      if (!factorSecret32) {
        throw new Error('[login] owner Email OTP factor secret ownership was lost');
      }
      await establishUnlockedExportRootCapabilityV1(
        walletCustodyCeremonyTransportFromWorkerContextV1(
          args.context.signingEngine.getSignerWorkerContext(),
        ),
        {
          existingEnvelope: ownerAuthorityWalletCustodySeedEnvelope(unlocked),
          existingFactorSecret: factorSecret32,
          walletId: String(selection.walletId),
          walletAuthMethodId: String(selection.authMethod.walletAuthMethodId),
          walletSessionId: String(unlocked.operationCredential.walletSessionId),
          expiresAtMs: unlocked.walletSession.expiresAtMs,
        },
      );
      await args.context.signingEngine.markWalletSelectionUnlocked({
        walletId: selection.walletId,
        walletAuthMethodId: selection.authMethod.walletAuthMethodId,
      });
      args.context.signingEngine.setWalletAuthenticated({
        kind: 'authenticated',
        walletId: selection.walletId,
        authMethod: SIGNER_AUTH_METHODS.emailOtp,
      });
      void resumeNearAfterSuccessfulUnlock({
        context: args.context,
        sessionAuthority: {
          record: unlocked.walletSession,
          operationCredential: unlocked.operationCredential,
        },
        factor: {
          kind: 'email_otp',
          provider: providerIdentity.provider,
          providerSubject: providerIdentity.providerSubjectId,
          emailHashHex: args.emailHashHex,
        },
        ownedFactorSecret: factorSecret32.slice().buffer,
        custodyEnvelope: ownerAuthorityWalletCustodySeedEnvelope(unlocked),
      });
      return;
    }
    assertLinkedDeviceWalletSessionExact(selection, unlocked.walletSession);
    if (!factorSecret32) {
      throw new Error('[login] linked Email OTP factor secret ownership was lost');
    }
    openedMaterials = await openLinkedDeviceEmailOtpSignerMaterials({
      selection,
      factorSecret32,
    });
    const ed25519Material = linkedDeviceEd25519Material(openedMaterials);
    const ecdsaMaterial = linkedDeviceEcdsaMaterial(openedMaterials);
    if (linkedDeviceRuntimeRequiresCurve(unlocked.walletSession, 'ed25519')) {
      if (!ed25519Material || !unlocked.ed25519Activation.bootstrap) {
        throw new Error(
          '[login] linked Email OTP Ed25519 runtime material or capability is missing',
        );
      }
      if (
        !mpcMaterialActivationRefsEqual(
          unlocked.ed25519Activation.bootstrap!.capability.materialActivation,
          ed25519Material.materialActivation,
        )
      ) {
        throw new Error('[login] linked Email OTP Ed25519 capability activation is invalid');
      }
    }
    if (linkedDeviceRuntimeRequiresCurve(unlocked.walletSession, 'ecdsa')) {
      if (!ecdsaMaterial) {
        throw new Error('[login] linked Email OTP ECDSA runtime material is missing');
      }
      const activatedEcdsa = await activateLinkedDeviceEcdsaHolderRuntime({
        context: args.context,
        selection,
        factorAuthority: await walletAuthAuthorityForLinkedDeviceMethod({
          selection,
          providerIdentity: effectiveProviderIdentity,
        }),
        material: ecdsaMaterial,
      });
      if (activatedEcdsa.installed) installedEcdsaRuntime = activatedEcdsa.runtime;
    }
    let loginResult: Extract<LoginResult, { success: true }>;
    if (ed25519Material && unlocked.ed25519Activation.bootstrap) {
      const ed25519Session = linkedDeviceEd25519SessionFromEmailOtpBootstrap({
        session: unlocked.ed25519Activation.bootstrap.session,
        operationCredential: unlocked.operationCredential,
        providerIdentity: effectiveProviderIdentity,
      });
      if (ed25519Session.walletSessionId !== unlocked.operationCredential.walletSessionId) {
        throw new Error('[login] linked Email OTP Ed25519 session credential mismatch');
      }
      loginResult = await activateLinkedDeviceEd25519Runtime({
        context: args.context,
        selection,
        session: ed25519Session,
        material: ed25519Material,
        relayerUrl: relayUrl,
        providerIdentity: effectiveProviderIdentity,
      });
    } else if (ecdsaMaterial) {
      loginResult = {
        success: true,
        kind: 'ecdsa_wallet_unlocked',
        walletId: selection.walletId,
      };
    } else {
      throw new Error('[login] linked Email OTP has no unlockable signing runtime');
    }
    await walletSessionAuthorizations.writeExactWithOperationCredential({
      record: unlocked.walletSession,
      operationCredential: unlocked.operationCredential,
    });
    /* The unlocked export-root capability is derived from a wallet custody
       seed. A linked installation never receives that seed: its envelope
       carries the Ed25519 Yao Client root itself, which the ordinary export
       path opens directly from the persisted export root. */
    if (selection.exportRoot && isWalletCustodySeedBinding(selection.exportRoot.envelope.binding)) {
      await establishUnlockedExportRootCapabilityV1(
        walletCustodyCeremonyTransportFromWorkerContextV1(
          args.context.signingEngine.getSignerWorkerContext(),
        ),
        {
          existingEnvelope: selection.exportRoot.envelope,
          existingFactorSecret: factorSecret32,
          walletId: String(selection.walletId),
          walletAuthMethodId: String(selection.authMethod.walletAuthMethodId),
          walletSessionId: String(unlocked.operationCredential.walletSessionId),
          expiresAtMs: unlocked.walletSession.expiresAtMs,
        },
      );
    }
    await args.context.signingEngine.markWalletSelectionUnlocked({
      walletId: selection.walletId,
      walletAuthMethodId: selection.authMethod.walletAuthMethodId,
    });
    args.context.signingEngine.setWalletAuthenticated({
      kind: 'authenticated',
      walletId: loginResult.walletId,
      authMethod: SIGNER_AUTH_METHODS.emailOtp,
    });
  } catch (error: unknown) {
    if (installedEcdsaRuntime) {
      removeLinkedEcdsaHolderRuntimeV1({
        walletId: installedEcdsaRuntime.walletId,
        materialActivation: installedEcdsaRuntime.materialActivation,
        holderHandleId: installedEcdsaRuntime.holderHandleId,
      });
      await destroyLinkedDeviceEcdsaHolderMaterialWasm({
        holderHandleId: installedEcdsaRuntime.holderHandleId,
        workerCtx: args.context.signingEngine.getSignerWorkerContext(),
      }).catch(() => undefined);
    }
    const workerContext = args.context.signingEngine.getSignerWorkerContext();
    if (workerContext) {
      await destroyUnlockedWalletEd25519ExportRootCapabilitiesV1(
        walletCustodyCeremonyTransportFromWorkerContextV1(workerContext),
        {
          kind: 'wallet_session',
          walletSessionId: String(unlocked.operationCredential.walletSessionId),
        },
      );
    }
    await Promise.allSettled([
      args.context.signingEngine.clearVolatileWarmSigningMaterial(selection.walletId),
      walletSessionAuthorizations.clearWallet(selection.walletId),
    ]);
    throw error;
  } finally {
    /* A handle still owned here belongs to no runtime - either activation never
       ran or it threw - so it is disposed rather than left registered in the
       worker for the rest of the session. */
    if (ownedActiveClientHandle) {
      const workerContext = args.context.signingEngine.getSignerWorkerContext();
      if (workerContext) {
        await disposeWalletCustodyEd25519ActiveClientV1({
          workerContext,
          activeClientHandle: ownedActiveClientHandle,
        }).catch(() => undefined);
      }
      ownedActiveClientHandle = null;
    }
    for (const openedMaterial of openedMaterials || []) openedMaterial.material.fill(0);
    factorSecret32?.fill(0);
  }
}

export async function unlockLinkedDevicePasskey(
  context: LoginWebContext,
  walletIdInput: string,
  options: LoginHooksOptions | undefined,
): Promise<LoginAndCreateSessionResult> {
  const unlockSubjectId = String(walletIdInput).trim() || 'linked-passkey';
  const { onEvent, onError, afterCall } = options || {};
  emitUnlockEvent(onEvent, unlockSubjectId, {
    phase: UnlockEventPhase.STEP_01_STARTED,
    status: 'started',
    authMethod: 'passkey',
  });
  try {
    const selection = await resolveLinkedDevicePasskeyAuthoritySelection(walletIdInput);
    if (!selection) throw new Error('[login] linked passkey authority is unavailable');
    const relayUrl = String(context.configs.network.relayer?.url || '').trim();
    if (!relayUrl) throw new Error('[login] linked passkey unlock requires relayer.url');
    emitUnlockEvent(onEvent, unlockSubjectId, {
      phase: UnlockEventPhase.STEP_03_PASSKEY_CHALLENGE_STARTED,
      status: 'running',
      authMethod: 'passkey',
    });
    const challenge = await requestLinkedDevicePasskeyChallenge({
      relayUrl,
      walletId: selection.walletId,
      rpId: selection.authMethod.rpId,
    });
    emitUnlockEvent(onEvent, unlockSubjectId, {
      phase: UnlockEventPhase.STEP_03_PASSKEY_PROMPT_STARTED,
      status: 'running',
      authMethod: 'passkey',
      interaction: { kind: 'passkey_assert', overlay: 'show' },
    });
    const credential = await context.signingEngine.getAuthenticationCredentialsSerialized({
      subjectId: String(selection.walletId),
      challengeB64u: challenge.challengeB64u,
      allowCredentials: [linkedDevicePasskeyAllowCredential(selection.authMethod.credentialIdB64u)],
      includeSecondPrfOutput: true,
    });
    emitUnlockEvent(onEvent, unlockSubjectId, {
      phase: UnlockEventPhase.STEP_03_PASSKEY_PROMPT_SUCCEEDED,
      status: 'succeeded',
      authMethod: 'passkey',
      interaction: { kind: 'passkey_assert', overlay: 'hide' },
    });
    const expectedOrigin = String(
      typeof window !== 'undefined' ? window.location.origin : '',
    ).trim();
    const unlockInput: LinkedDevicePasskeyWalletSessionUnlockInput = {
      challengeId: challenge.challengeId,
      webauthn_authentication: credential,
      ed25519SessionRequest: selection.signerMaterials.some(
        (material) => material.keyFamily === 'ed25519',
      )
        ? { kind: 'requested', remainingUses: DEFAULT_UNLOCK_REMAINING_USES }
        : { kind: 'not_requested' },
      ...(expectedOrigin ? { expected_origin: expectedOrigin } : {}),
    };
    emitUnlockEvent(onEvent, unlockSubjectId, {
      phase: UnlockEventPhase.STEP_04_WALLET_UNLOCK_EXCHANGE_STARTED,
      status: 'running',
      authMethod: 'passkey',
    });
    const verified = await verifyLinkedDevicePasskeyWalletSession(relayUrl, unlockInput);
    if (!verified.success) throw new Error(verified.error);
    assertLinkedDeviceWalletSessionExact(selection, verified.walletSession);
    const openedMaterials = await openLinkedDevicePasskeySignerMaterials({
      selection,
      credential,
    });
    let loginResult: Extract<LoginResult, { success: true }>;
    try {
      const ed25519Material = linkedDeviceEd25519Material(openedMaterials);
      const ecdsaMaterial = linkedDeviceEcdsaMaterial(openedMaterials);
      if (linkedDeviceRuntimeRequiresCurve(verified.walletSession, 'ed25519')) {
        if (!ed25519Material || !verified.ed25519Session) {
          throw new Error('[login] linked Ed25519 runtime material or Wallet Session is missing');
        }
      }
      if (linkedDeviceRuntimeRequiresCurve(verified.walletSession, 'ecdsa')) {
        if (!ecdsaMaterial) {
          throw new Error('[login] linked ECDSA runtime material is missing');
        }
        await activateLinkedDeviceEcdsaHolderRuntime({
          context,
          selection,
          factorAuthority: await walletAuthAuthorityForLinkedDeviceMethod({ selection }),
          material: ecdsaMaterial,
        });
      }
      if (ed25519Material && verified.ed25519Session) {
        loginResult = await activateLinkedDeviceEd25519Runtime({
          context,
          selection,
          session: linkedDeviceEd25519SessionFromPasskeyUnlock({
            session: verified.ed25519Session,
            operationCredential: verified.operationCredential,
          }),
          material: ed25519Material,
          relayerUrl: relayUrl,
        });
      } else if (ecdsaMaterial) {
        loginResult = {
          success: true,
          kind: 'ecdsa_wallet_unlocked',
          walletId: selection.walletId,
        };
      } else {
        throw new Error('[login] linked passkey has no unlockable signing runtime');
      }
      await walletSessionAuthorizations.writeExactWithOperationCredential({
        record: verified.walletSession,
        operationCredential: verified.operationCredential,
      });
      if (selection.exportRoot) {
        const passkeyPrfFirstB64u = passkeyPrfFirstB64uFromCredential(credential);
        if (!passkeyPrfFirstB64u) {
          throw new Error('[login] linked export-root unlock requires WebAuthn PRF.first output');
        }
        await context.signingEngine.establishUnlockedWalletEd25519ExportRootCapabilityV1({
          existingEnvelope: selection.exportRoot.envelope,
          passkeyPrfFirstB64u,
          walletId: String(selection.walletId),
          walletAuthMethodId: String(selection.authMethod.walletAuthMethodId),
          walletSessionId: String(verified.operationCredential.walletSessionId),
          expiresAtMs: verified.walletSession.expiresAtMs,
        });
      }
      await context.signingEngine.markWalletSelectionUnlocked({
        walletId: selection.walletId,
        walletAuthMethodId: selection.authMethod.walletAuthMethodId,
      });
    } catch (error: unknown) {
      await Promise.allSettled([
        context.signingEngine.clearVolatileWarmSigningMaterial(selection.walletId),
        walletSessionAuthorizations.clearWallet(selection.walletId),
      ]);
      throw error;
    } finally {
      for (const openedMaterial of openedMaterials) openedMaterial.material.fill(0);
    }
    emitUnlockEvent(onEvent, unlockSubjectId, {
      phase: UnlockEventPhase.STEP_04_WALLET_UNLOCK_EXCHANGE_SUCCEEDED,
      status: 'succeeded',
      authMethod: 'passkey',
    });
    return await finalizeLoginSuccess({
      context,
      authMethod: SIGNER_AUTH_METHODS.passkey,
      unlockSubjectId,
      loginResult,
      onEvent,
      afterCall,
    });
  } catch (error: unknown) {
    const normalized = toError(error);
    return await finalizeLoginError({
      unlockSubjectId,
      message: normalized.message,
      error: normalized,
      onEvent,
      onError,
      afterCall,
      cancelled: isUserCancellationError(normalized),
    });
  }
}
