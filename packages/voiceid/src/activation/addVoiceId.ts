import type { VoiceCaptureObserver } from '../browser/microphone';
import {
  activateVoiceIdForUnlockedWallet,
  type VoiceIdActivationPlan,
  type VoiceIdSeedResealPort,
} from '../session/activation';
import { VoiceIdActivationStore } from '../session/activationStore';
import { VoiceIdHttpClient } from '../session/httpClient';
import { IndexedDBManager } from '@seams/wallet/voiceid-host';
import { walletSessionAuthorizations } from '@seams/wallet/voiceid-host';
import { fetchWithWalletHomeDiscovery } from '@seams/wallet/voiceid-host';
import type { SpokenPhrase } from '../browser/phrase';
import { manageVoiceEnrollment } from './manageEnrollment';
import { resolveVoiceEnrollmentScope } from '../browser/enrollmentStore';
import { readBrowserVoiceDevice } from '../browser/deviceStore';
import { captureVoiceIdActivation } from '../capture/deviceBridge';
import type { PreparedVoiceCapture } from '../capture/surface';
import {
  readUnlockedWalletEd25519ExportRootCapabilityV1,
  walletCustodyCeremonyTransportFromWorkerContextV1,
} from '@seams/wallet/voiceid-host';
import type { WalletCustodyCeremonyTransportPort } from '@seams/wallet/voiceid-host';
import type {
  RegistrationCapability,
  RegistrationWebContext,
} from '@seams/wallet/voiceid-host';
import type { WalletSessionOperationCredentialV1 } from '@seams/wallet/voiceid-host';
import {
  allocateWalletAuthMethodId,
  parsePasskeyEnvelopeId,
  type WalletId,
  type WalletAuthMethodId,
} from '@seams/wallet/voiceid-host';
import { secureRandomId } from '@seams/wallet/voiceid-host';
import type { Variant } from '@seams/wallet/voiceid-host';

type AddVoiceIdResult = Variant<
  Awaited<ReturnType<RegistrationCapability['activateAuthMethod']>>,
  'kind',
  'activated'
>;

type PreparedVoiceIdActivation =
  | {
      readonly kind: 'enroll_existing';
      readonly walletId: WalletId;
      readonly walletAuthMethodId: WalletAuthMethodId;
      readonly context: RegistrationWebContext;
    }
  | {
      readonly kind: 'activate';
      readonly ownerCredential: WalletSessionOperationCredentialV1;
      readonly plan: VoiceIdActivationPlan;
      readonly http: VoiceIdHttpClient;
      readonly store: VoiceIdActivationStore;
    };

async function resealFromWorker(
  worker: WalletCustodyCeremonyTransportPort,
  input: Parameters<VoiceIdSeedResealPort>[0],
): Promise<unknown> {
  return await worker.requestOperation({
    kind: 'walletCustodyCeremony',
    request: {
      type: 'resealWalletCustodyFromUnlockedCapability',
      payload: {
        capability: input.capability,
        replacementEnvelopeBindingJson: input.bindingJson,
        replacementFactorSecret: input.factorSecret,
      },
      transfer: [input.factorSecret],
    },
  });
}

async function prepareActivation(
  context: RegistrationWebContext,
  walletId: WalletId,
): Promise<PreparedVoiceIdActivation> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  if (
    selected.kind !== 'resolved' ||
    selected.selection.lockState !== 'unlocked' ||
    selected.selection.walletId !== walletId ||
    selected.authMethod.status !== 'active' ||
    selected.authMethod.walletId !== walletId ||
    selected.authMethod.walletAuthorityId !== selected.authority.authorityId ||
    selected.authority.state !== 'active' ||
    selected.authority.walletId !== walletId
  ) {
    throw new Error('Unlock this wallet with a passkey or Email OTP before activating VoiceID.');
  }
  const exact = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId,
    authorityId: selected.authority.authorityId,
    authMethodId: selected.authMethod.walletAuthMethodId,
  });
  if (
    exact.kind !== 'found' ||
    exact.record.walletId !== walletId ||
    exact.record.authMethodId !== selected.authMethod.walletAuthMethodId ||
    exact.record.authorityId !== selected.authority.authorityId ||
    exact.record.expiresAtMs <= Date.now()
  ) {
    throw new Error('VoiceID activation requires an active owner Wallet Session.');
  }
  const methods = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(walletId);
  for (const method of methods) {
    if (
      method.kind !== 'voiceid' ||
      method.status !== 'active' ||
      method.walletAuthorityId !== selected.authority.authorityId
    )
      continue;
    const device = await readBrowserVoiceDevice(walletId, method.walletAuthMethodId);
    if (device && device.deviceKeyId === method.deviceKeyId) {
      return {
        kind: 'enroll_existing',
        walletId,
        walletAuthMethodId: method.walletAuthMethodId,
        context,
      };
    }
  }
  if (selected.authMethod.kind === 'voiceid') {
    throw new Error('An existing local VoiceID enrollment is required for management.');
  }
  const store = new VoiceIdActivationStore(IndexedDBManager);
  const pending = await store.listPending(walletId);
  if (pending.length > 1) {
    throw new Error('More than one VoiceID activation is pending for this wallet.');
  }
  let plan: VoiceIdActivationPlan;
  if (pending.length === 1) {
    plan = { kind: 'resume', pending: pending[0] };
  } else {
    const capability = readUnlockedWalletEd25519ExportRootCapabilityV1(walletId);
    if (!capability || capability.walletSessionId !== exact.operationCredential.walletSessionId) {
      throw new Error('Unlock the wallet again to make its custody seed available for VoiceID.');
    }
    const envelopeId = parsePasskeyEnvelopeId(secureRandomId('wallet-custody-envelope', 24));
    if (!envelopeId.ok) {
      throw new Error('VoiceID envelope ID generation failed.');
    }
    const worker = walletCustodyCeremonyTransportFromWorkerContextV1(
      context.signingEngine.getSignerWorkerContext(),
    );
    plan = {
      kind: 'new',
      walletId,
      walletAuthMethodId: allocateWalletAuthMethodId(crypto.randomUUID()),
      envelopeId: envelopeId.value,
      capability,
      reseal: resealFromWorker.bind(null, worker),
    };
  }
  return {
    kind: 'activate',
    ownerCredential: exact.operationCredential,
    plan,
    http: new VoiceIdHttpClient(
      context.configs.network.relayer.url,
      location.origin,
      fetchWithWalletHomeDiscovery,
    ),
    store,
  };
}

export async function prepareActivationSurface(
  input: { readonly context: RegistrationWebContext; readonly walletId: WalletId },
  signal: AbortSignal,
): Promise<PreparedVoiceCapture<AddVoiceIdResult>> {
  signal.throwIfAborted();
  const { context, walletId } = input;
  const prepared = await prepareActivation(context, walletId);
  signal.throwIfAborted();
  if (prepared.kind === 'enroll_existing') {
    return { kind: 'management', action: managePreparedVoiceId.bind(null, prepared) };
  }
  return {
    kind: 'recording',
    action: activatePreparedVoiceId.bind(null, prepared),
    expiresAtMs: null,
  };
}

async function managePreparedVoiceId(
  prepared: Variant<PreparedVoiceIdActivation, 'kind', 'enroll_existing'>,
  signal: AbortSignal,
): Promise<AddVoiceIdResult> {
  const scope = await resolveVoiceEnrollmentScope(prepared.walletId, prepared.walletAuthMethodId);
  await manageVoiceEnrollment(prepared.context, scope, signal);
  signal.throwIfAborted();
  return {
    kind: 'activated',
    walletId: prepared.walletId,
    walletAuthMethodId: prepared.walletAuthMethodId,
  };
}

async function activatePreparedVoiceId(
  prepared: Variant<PreparedVoiceIdActivation, 'kind', 'activate'>,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
): Promise<AddVoiceIdResult> {
  const outcome = await activateVoiceIdForUnlockedWallet({
    plan: prepared.plan,
    ownerCredential: prepared.ownerCredential,
    http: prepared.http,
    signal,
    onCapture,
    phrase,
    capture: captureVoiceIdActivation,
    persistPending: prepared.store.persistPending.bind(prepared.store),
    persistActive: prepared.store.persistActive.bind(prepared.store),
  });
  return {
    kind: 'activated',
    walletId: outcome.authMethod.walletId,
    walletAuthMethodId: outcome.authMethod.walletAuthMethodId,
  };
}
