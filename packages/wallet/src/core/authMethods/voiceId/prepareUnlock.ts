import { IndexedDBManager } from '@/core/indexedDB';
import { fetchWithWalletHomeDiscovery } from '@/core/rpcClients/relayer/relayerHttp';
import type { WalletId, WalletAuthMethodId } from '@shared/utils/domainIds';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { VoiceIdWalletSessionChallenge } from '@shared/authorization/voiceIdDeviceAssertion';
import { readAuthMethodEnabled } from '../availability';
import type { AuthMethodSessionInstaller, AuthMethodUnlockSuccess } from '../hostPlugin';
import type { VoiceIdUnlockPreparation, VoiceIdUnlockChallenge } from './boundary';
import type { VoiceIdUnlockCapture } from './contracts';
import { resolveVoiceEnrollmentScope } from './enrollmentStorage';
import { VoiceIdHttpClient, type VoiceIdVerifiedSession } from './httpClient';
import { verifyVoiceIdChallengeWithDevice } from './unlockFromDevice';

export async function prepareVoiceIdUnlock(
  input: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly relayerUrl: string;
    readonly prepareSession: (signal: AbortSignal) => Promise<AuthMethodSessionInstaller>;
    readonly assertActive: () => void;
  },
  signal: AbortSignal,
): Promise<VoiceIdUnlockPreparation> {
  if (!(await readAuthMethodEnabled(input.walletId, input.walletAuthMethodId))) {
    throw new Error('VoiceID is turned off in this browser. Enable it in Authentication methods.');
  }
  const install = await input.prepareSession(signal);
  const authMethod = await IndexedDBManager.getWalletAuthMethodV2(input.walletAuthMethodId);
  if (
    !authMethod ||
    authMethod.kind !== 'voiceid' ||
    authMethod.status !== 'active' ||
    authMethod.walletId !== input.walletId ||
    authMethod.walletAuthMethodId !== input.walletAuthMethodId
  ) {
    throw new Error('Activate VoiceID on this device before unlocking this wallet.');
  }
  const http = new VoiceIdHttpClient(
    input.relayerUrl,
    location.origin,
    fetchWithWalletHomeDiscovery,
  );
  const scope = await resolveVoiceEnrollmentScope(input.walletId, input.walletAuthMethodId);
  return {
    scope,
    challenge: issueChallenge.bind(null, authMethod, http, install, input.assertActive),
  };
}

async function issueChallenge(
  authMethod: ActiveVoiceIdWalletAuthMethodRecordV2,
  http: VoiceIdHttpClient,
  install: AuthMethodSessionInstaller,
  assertActive: () => void,
  signal: AbortSignal,
): Promise<VoiceIdUnlockChallenge> {
  signal.throwIfAborted();
  assertActive();
  const challenge = await http.challenge({
    walletId: authMethod.walletId,
    walletAuthMethodId: authMethod.walletAuthMethodId,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  assertActive();
  signal.throwIfAborted();
  return {
    expiresAtMs: challenge.expiresAtMs,
    complete: completeUnlock.bind(null, authMethod, challenge, http, install),
  };
}

function completeUnlock(
  authMethod: ActiveVoiceIdWalletAuthMethodRecordV2,
  challenge: VoiceIdWalletSessionChallenge,
  http: VoiceIdHttpClient,
  install: AuthMethodSessionInstaller,
  capture: VoiceIdUnlockCapture,
  signal: AbortSignal,
): Promise<AuthMethodUnlockSuccess> {
  return verifyVoiceIdChallengeWithDevice({
    authMethod,
    challenge,
    http,
    capture,
    signal,
    install: installVerifiedSession.bind(null, install, signal),
  });
}

function installVerifiedSession(
  install: AuthMethodSessionInstaller,
  signal: AbortSignal,
  verified: VoiceIdVerifiedSession,
  factorSecret32: Uint8Array,
): Promise<AuthMethodUnlockSuccess> {
  return install({
    walletSession: verified.walletSession,
    operationCredential: verified.operationCredential,
    custodyEnvelope: verified.custodyEnvelope,
    factorSecret32,
    signal,
    near: verified.near,
  });
}
