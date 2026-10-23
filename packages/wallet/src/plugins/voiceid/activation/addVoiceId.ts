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
import { captureVoiceIdActivation } from '../capture/deviceBridge';
import { showVoiceIdCaptureSurface } from '../capture/surface';
import {
  readUnlockedWalletEd25519ExportRootCapabilityV1,
  walletCustodyCeremonyTransportFromWorkerContextV1,
} from '@/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
import type { WalletCustodyCeremonyTransportPort } from '@/core/signingEngine/walletCustody/ceremonyStepRunner';
import type { RegistrationCapability, RegistrationWebContext } from '@/SeamsWeb/signingSurface/types';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
import {
  allocateWalletAuthMethodId,
  parsePasskeyEnvelopeId,
  parseWalletId,
  type WalletId,
} from '@shared/utils/domainIds';
import { secureRandomId } from '@shared/utils/secureRandomId';

type AddVoiceIdResult = Awaited<ReturnType<RegistrationCapability['activateAuthMethod']>>;

type PreparedVoiceIdActivation = Readonly<{
  ownerCredential: WalletSessionOperationCredentialV1;
  plan: VoiceIdActivationPlan;
  http: VoiceIdHttpClient;
  store: VoiceIdActivationStore;
}>;

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

export async function addVoiceIdWalletAuthMethod(input: {
  context: RegistrationWebContext;
  walletId: WalletId | string;
}): Promise<AddVoiceIdResult> {
  const parsedWalletId = parseWalletId(input.walletId);
  if (!parsedWalletId.ok) throw new Error('VoiceID activation wallet ID is invalid.');
  const prepared = await prepareActivation(input.context, parsedWalletId.value);
  return await showVoiceIdCaptureSurface({
    action: activatePreparedVoiceId.bind(null, prepared),
    purpose: 'activation',
    expiresAtMs: null,
  });
}

async function activatePreparedVoiceId(
  prepared: PreparedVoiceIdActivation,
  signal: AbortSignal,
  onListening: () => void,
): Promise<AddVoiceIdResult> {
  const outcome = await activateVoiceIdForUnlockedWallet({
    plan: prepared.plan,
    ownerCredential: prepared.ownerCredential,
    http: prepared.http,
    signal,
    onListening,
    capture: captureVoiceIdActivation,
    persistPending: prepared.store.persistPending.bind(prepared.store),
    persistActive: prepared.store.persistActive.bind(prepared.store),
  });
  return {
    walletId: outcome.authMethod.walletId,
    walletAuthMethodId: outcome.authMethod.walletAuthMethodId,
  };
}
