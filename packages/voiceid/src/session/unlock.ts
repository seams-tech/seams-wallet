import { readAuthMethodEnabled } from '@seams/wallet/voiceid-host';
import type { VoiceCaptureObserver } from '../browser/microphone';
import type { SpokenPhrase } from '../browser/phrase';
import type {
  AuthMethodSessionInstaller,
  AuthMethodUnlockSuccess,
  WalletAuthMethodHostPlugin,
} from '@seams/wallet/voiceid-host';
import { IndexedDBManager } from '@seams/wallet/voiceid-host';
import { fetchWithWalletHomeDiscovery } from '@seams/wallet/voiceid-host';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@seams/wallet/voiceid-host';
import type { VoiceIdWalletSessionChallenge } from '@seams/wallet/voiceid-host';
import { prepareVoiceModelWithProgress } from '../browser/progress';
import { readVoiceEnrollment, resolveVoiceEnrollmentScope } from '../browser/enrollmentStore';
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
  const scope = await resolveVoiceEnrollmentScope(input.walletId, input.walletAuthMethodId);
  if (!(await readVoiceEnrollment(scope))) {
    throw new Error(
      'Unlock with a passkey, then open Manage voice to import or record your enrollment.',
    );
  }
  await prepareVoiceModelWithProgress(parent, signal);
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
  return {
    kind: 'recording',
    expiresAtMs: challenge.expiresAtMs,
    action: captureAndInstall.bind(null, prepared),
  };
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
