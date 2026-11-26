import { resolveVoiceEnrollmentScope } from './enrollmentStorage';
import { ConfirmedVoiceChange } from './ownerConfirmation';
import type { VoiceIdActivationPreparation } from './boundary';
import type { VoiceIdActivationCapture } from './contracts';
import {
  activateVoiceIdForUnlockedWallet,
  type VoiceIdActivationPlan,
  type VoiceIdSeedResealPort,
} from './activation';
import { VoiceIdActivationStore } from './activationStore';
import { VoiceIdHttpClient } from './httpClient';
import { IndexedDBManager } from '@/core/indexedDB';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { fetchWithWalletHomeDiscovery } from '@/core/rpcClients/relayer/relayerHttp';
import { readBrowserVoiceDevice } from './deviceStore';
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
} from '@shared/utils/domainIds';
import { secureRandomId } from '@shared/utils/secureRandomId';
import type { Variant } from '@shared/utils/variant';

type AddVoiceIdResult = Variant<
  Awaited<ReturnType<RegistrationCapability['activateAuthMethod']>>,
  'kind',
  'activated'
>;

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

export async function prepareVoiceIdActivation(
  context: RegistrationWebContext,
  walletId: WalletId,
): Promise<VoiceIdActivationPreparation> {
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
      const scope = await resolveVoiceEnrollmentScope(walletId, method.walletAuthMethodId);
      return {
        kind: 'enroll_existing',
        scope,
        confirmChange: ConfirmedVoiceChange.request.bind(null, context, scope),
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
  const prepared = {
    ownerCredential: exact.operationCredential,
    plan,
    http: new VoiceIdHttpClient(
      context.configs.network.relayer.url,
      location.origin,
      fetchWithWalletHomeDiscovery,
    ),
    store,
  };
  return {
    kind: 'activate',
    walletId,
    walletAuthMethodId:
      plan.kind === 'new' ? plan.walletAuthMethodId : plan.pending.walletAuthMethodId,
    activate: activatePreparedVoiceId.bind(null, prepared),
  };
}

async function activatePreparedVoiceId(
  prepared: {
    readonly plan: VoiceIdActivationPlan;
    readonly ownerCredential: WalletSessionOperationCredentialV1;
    readonly http: VoiceIdHttpClient;
    readonly store: VoiceIdActivationStore;
  },
  capture: VoiceIdActivationCapture,
  signal: AbortSignal,
): Promise<AddVoiceIdResult> {
  const outcome = await activateVoiceIdForUnlockedWallet({
    plan: prepared.plan,
    ownerCredential: prepared.ownerCredential,
    http: prepared.http,
    signal,
    capture,
    persistPending: prepared.store.persistPending.bind(prepared.store),
    persistActive: prepared.store.persistActive.bind(prepared.store),
  });
  return {
    kind: 'activated',
    walletId: outcome.authMethod.walletId,
    walletAuthMethodId: outcome.authMethod.walletAuthMethodId,
  };
}
