import { readAuthMethodEnabled } from '@/core/authMethods/availability';
import type { VoiceCaptureObserver } from '../browser/microphone';
import type { SpokenPhrase } from '../browser/phrase';
import type {
  AuthMethodSessionInstaller,
  AuthMethodUnlockSuccess,
  WalletAuthMethodHostPlugin,
} from '@/core/authMethods/hostPlugin';
import { IndexedDBManager } from '@/core/indexedDB';
import { fetchWithWalletHomeDiscovery } from '@/core/rpcClients/relayer/relayerHttp';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { VoiceIdWalletSessionChallenge } from '@shared/authorization/voiceIdDeviceAssertion';
import { prepareVoiceModelWithProgress } from '../browser/progress';
import { readVoiceEnrollment } from '../browser/enrollment';
import { captureVoiceIdUnlock } from '../capture/deviceBridge';
import type { PreparedVoiceCapture } from '../capture/surface';
import { VoiceIdHttpClient, type VoiceIdVerifiedSession } from './httpClient';
import { verifyVoiceIdChallengeWithDevice } from './unlockFromDevice';

type PreparedVoiceIdUnlock = Readonly<{
  authMethod: ActiveVoiceIdWalletAuthMethodRecordV2;
  challenge: VoiceIdWalletSessionChallenge;
  http: VoiceIdHttpClient;
  install: AuthMethodSessionInstaller;
}>;

export async function prepareUnlockSurface(
  input: Parameters<WalletAuthMethodHostPlugin['unlock']>[0],
  signal: AbortSignal,
  parent: HTMLElement,
): Promise<PreparedVoiceCapture<AuthMethodUnlockSuccess>> {
  if (!(await readAuthMethodEnabled(input.walletId, input.walletAuthMethodId)))
    throw new Error('VoiceID is turned off in this browser. Enable it in Authentication methods.');
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
  if (!(await readVoiceEnrollment())) {
    throw new Error(
      'Unlock with a passkey or Email OTP, then select Enroll voice again to use the current VoiceID model.',
    );
  }
  await prepareVoiceModelWithProgress(parent);
  signal.throwIfAborted();
  input.assertActive();
  const challenge = await http.challenge({
    walletId: input.walletId,
    walletAuthMethodId: input.walletAuthMethodId,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  input.assertActive();
  const prepared: PreparedVoiceIdUnlock = { authMethod, challenge, http, install };
  signal.throwIfAborted();
  return { expiresAtMs: challenge.expiresAtMs, action: captureAndInstall.bind(null, prepared) };
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

async function captureAndInstall(
  prepared: PreparedVoiceIdUnlock,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
): Promise<AuthMethodUnlockSuccess> {
  return await verifyVoiceIdChallengeWithDevice({
    authMethod: prepared.authMethod,
    challenge: prepared.challenge,
    http: prepared.http,
    capture: captureVoiceIdUnlock,
    install: installVerifiedSession.bind(null, prepared.install, signal),
    signal,
    onCapture,
    phrase,
  });
}
