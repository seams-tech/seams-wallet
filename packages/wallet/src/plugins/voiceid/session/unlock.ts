import type {
  AuthMethodSessionInstaller,
  AuthMethodUnlockSuccess,
  WalletAuthMethodHostPlugin,
} from '@/core/authMethods/hostPlugin';
import { IndexedDBManager } from '@/core/indexedDB';
import { fetchWithWalletHomeDiscovery } from '@/core/rpcClients/relayer/relayerHttp';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { VoiceIdWalletSessionChallenge } from '@shared/authorization/voiceIdDeviceAssertion';
import { captureVoiceIdUnlock } from '../capture/deviceBridge';
import { showVoiceIdCaptureSurface } from '../capture/surface';
import { VoiceIdHttpClient, type VoiceIdVerifiedSession } from './httpClient';
import { verifyVoiceIdChallengeWithDevice } from './unlockFromDevice';

type PreparedVoiceIdUnlock = Readonly<{
  authMethod: ActiveVoiceIdWalletAuthMethodRecordV2;
  challenge: VoiceIdWalletSessionChallenge;
  http: VoiceIdHttpClient;
  install: AuthMethodSessionInstaller;
}>;

export async function unlockWithVoiceId(
  input: Parameters<WalletAuthMethodHostPlugin['unlock']>[0],
): Promise<AuthMethodUnlockSuccess> {
  const authMethod = await IndexedDBManager.getWalletAuthMethodV2(input.walletAuthMethodId);
  if (
    !authMethod || authMethod.kind !== 'voiceid' || authMethod.status !== 'active' ||
    authMethod.walletId !== input.walletId || authMethod.walletAuthMethodId !== input.walletAuthMethodId
  ) {
    throw new Error('Activate VoiceID on this device before unlocking this wallet.');
  }
  const http = new VoiceIdHttpClient(input.relayerUrl, location.origin, fetchWithWalletHomeDiscovery);
  const challenge = await http.challenge({
    walletId: input.walletId,
    walletAuthMethodId: input.walletAuthMethodId,
    signal: AbortSignal.timeout(15_000),
  });
  const prepared: PreparedVoiceIdUnlock = { authMethod, challenge, http, install: input.install };
  return await showVoiceIdCaptureSurface({
    purpose: 'unlock',
    expiresAtMs: challenge.expiresAtMs,
    action: captureAndInstall.bind(null, prepared),
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
  });
}

async function captureAndInstall(
  prepared: PreparedVoiceIdUnlock,
  signal: AbortSignal,
  onListening: () => void,
): Promise<AuthMethodUnlockSuccess> {
  return await verifyVoiceIdChallengeWithDevice({
    authMethod: prepared.authMethod,
    challenge: prepared.challenge,
    http: prepared.http,
    capture: captureVoiceIdUnlock,
    install: installVerifiedSession.bind(null, prepared.install, signal),
    signal,
    onListening,
  });
}
