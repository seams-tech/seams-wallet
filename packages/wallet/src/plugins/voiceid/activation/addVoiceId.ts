import type { VoiceCaptureObserver } from '../browser/microphone';
import {
  activateVoiceIdForUnlockedWallet,
  type VoiceIdActivationPlan,
  type VoiceIdSeedResealPort,
} from '../session/activation';
import { VoiceIdActivationStore } from '../session/activationStore';
import { VoiceIdHttpClient } from '../session/httpClient';
import { IndexedDBManager } from '@/core/indexedDB';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { fetchWithWalletHomeDiscovery } from '@/core/rpcClients/relayer/relayerHttp';
import type { SpokenPhrase } from '../browser/phrase';
import { enrollBrowserVoice } from '../browser/enrollment';
import { readBrowserVoiceDevice } from '../browser/deviceStore';
import { captureVoiceIdActivation } from '../capture/deviceBridge';
import type { PreparedVoiceCapture } from '../capture/surface';
import {
  readUnlockedWalletEd25519ExportRootCapabilityV1,
  walletCustodyCeremonyTransportFromWorkerContextV1,
} from '@/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
import type { WalletCustodyCeremonyTransportPort } from '@/core/signingEngine/walletCustody/ceremonyStepRunner';
import type {
  RegistrationCapability,
  RegistrationWebContext,
} from '@/SeamsWeb/signingSurface/types';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
import {
  allocateWalletAuthMethodId,
  parsePasskeyEnvelopeId,
  type WalletId,
  type WalletAuthMethodId,
} from '@shared/utils/domainIds';
import { secureRandomId } from '@shared/utils/secureRandomId';

type AddVoiceIdResult = Awaited<ReturnType<RegistrationCapability['activateAuthMethod']>>;

type PreparedVoiceIdActivation =
  | {
      readonly kind: 'enroll_existing';
      readonly walletId: WalletId;
      readonly walletAuthMethodId: WalletAuthMethodId;
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
    (selected.authMethod.kind !== 'passkey' && selected.authMethod.kind !== 'email_otp') ||
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
      return { kind: 'enroll_existing', walletId, walletAuthMethodId: method.walletAuthMethodId };
    }
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
  return { action: activatePreparedVoiceId.bind(null, prepared), expiresAtMs: null };
}

async function activatePreparedVoiceId(
  prepared: PreparedVoiceIdActivation,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
): Promise<AddVoiceIdResult> {
  if (prepared.kind === 'enroll_existing') {
    await enrollBrowserVoice(signal);
    signal.throwIfAborted();
    return { walletId: prepared.walletId, walletAuthMethodId: prepared.walletAuthMethodId };
  }
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
    walletId: outcome.authMethod.walletId,
    walletAuthMethodId: outcome.authMethod.walletAuthMethodId,
  };
}
