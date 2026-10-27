import type { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { WalletCustodyCeremonyTransportPort } from '@/core/signingEngine/walletCustody/ceremonyStepRunner';
import { establishUnlockedWalletEd25519ExportRootCapabilityV1 as establishUnlockedExportRootCapabilityWithWorkerV1 } from '@/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
import { nearEd25519YaoOperationMaterialFacts } from '@/core/signingEngine/session/warmCapabilities/routerAbEd25519WalletSessionState';
import { IndexedDBManager } from '@/core/indexedDB';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { nearEd25519SigningKeyIdFromString } from '@shared/utils/registrationIds';
import { base58Encode } from '@shared/utils/base58';
import { readAuthMethodEnabled } from './availability';
import { resolveAuthMethodSessionIdentity } from './sessionIdentity';
import { prepareAuthMethodNearSession } from './prepareNearSession';
import { installAuthMethodEcdsaMaterial } from './prepareEcdsaSession';
import type { AuthMethodSessionInstaller, AuthMethodUnlockSuccess } from './hostPlugin';

type InstallationPorts = {
  readonly engine: Pick<
    BrowserSigningSurface,
    | 'loadWalletCustodyEd25519Material'
    | 'withExactEd25519MaterialOwner'
    | 'clearVolatileWarmSigningMaterial'
    | 'activateVerifiedNearEd25519YaoMaterial'
    | 'upsertEd25519YaoPublicCapabilityLaneReference'
    | 'activateAuthenticatedWalletState'
    | 'setWalletAuthenticated'
    | 'clearWalletAuthentication'
    | 'destroyUnlockedWalletEd25519ExportRootCapabilitiesV1'
    | 'getSignerWorkerContext'
  >;
  readonly relayerUrl: string;
  readonly nearClient: NearClient;
  readonly transport: WalletCustodyCeremonyTransportPort;
  readonly rememberNearSession: (
    state: Awaited<ReturnType<typeof prepareAuthMethodNearSession>>['state'],
  ) => void;
};

export async function installAuthMethodSession(
  ports: InstallationPorts,
  expectedLockGeneration: number,
  unlocked: Parameters<AuthMethodSessionInstaller>[0],
): Promise<AuthMethodUnlockSuccess> {
  const identity = await resolveAuthMethodSessionIdentity(unlocked);
  const prepared =
    unlocked.near.kind === 'ready'
      ? await prepareAuthMethodNearSession({
          unlocked,
          identity,
          relayerUrl: ports.relayerUrl,
          loadMaterial: ports.engine.loadWalletCustodyEd25519Material.bind(ports.engine),
        })
      : null;
  try {
    const install = installPreparedAuthMethodSession.bind(
      null,
      ports,
      expectedLockGeneration,
      unlocked,
      prepared,
      identity,
    );
    if (!prepared) return await install();
    return await ports.engine.withExactEd25519MaterialOwner({
      materialActivation: prepared.capability.materialActivation,
      nearAccountId: prepared.capability.nearAccountId,
      task: install,
    });
  } catch (error) {
    prepared?.activeClient.dispose();
    throw error;
  }
}

async function installPreparedAuthMethodSession(
  ports: InstallationPorts,
  expectedLockGeneration: number,
  unlocked: Parameters<AuthMethodSessionInstaller>[0],
  prepared: Awaited<ReturnType<typeof prepareAuthMethodNearSession>> | null,
  identity: Awaited<ReturnType<typeof resolveAuthMethodSessionIdentity>>,
): Promise<AuthMethodUnlockSuccess> {
  const walletId = unlocked.walletSession.walletId;
  try {
    const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
    if (
      unlocked.signal.aborted ||
      selected.kind !== 'resolved' ||
      selected.selection.lockGeneration !== expectedLockGeneration
    )
      throw new Error('Wallet lock state changed during unlock.');
  } catch (error) {
    prepared?.activeClient.dispose();
    throw error;
  }
  const cap = prepared?.capability;
  try {
    await ports.engine.clearVolatileWarmSigningMaterial(walletId);
    if (unlocked.signal.aborted) throw new Error('Wallet unlock was cancelled.');
    await walletSessionAuthorizations.writeExactWithOperationCredential({
      record: unlocked.walletSession,
      operationCredential: unlocked.operationCredential,
    });
    if (prepared && cap) {
      await ports.engine.activateVerifiedNearEd25519YaoMaterial({
        activeClient: prepared.activeClient,
        facts: nearEd25519YaoOperationMaterialFacts(prepared.state),
      });
      await ports.engine.upsertEd25519YaoPublicCapabilityLaneReference({
        walletId,
        nearAccountId: cap.nearAccountId,
        nearEd25519SigningKeyId: nearEd25519SigningKeyIdFromString(
          cap.applicationBinding.near_ed25519_signing_key_id,
        ),
        signerSlot: cap.applicationBinding.key_creation_signer_slot,
        auth: {
          kind: 'voiceid',
          walletAuthMethodId: unlocked.walletSession.authMethodId,
          deviceKeyId: identity.method.deviceKeyId,
        },
        thresholdSessionId: cap.lifecycle.thresholdSessionId,
        runtimePolicyScope: cap.runtimePolicyScope,
        materialActivation: cap.materialActivation,
        expiresAtMs: unlocked.walletSession.expiresAtMs,
        remainingUses: prepared.state.remainingUses,
      });
    }
    await establishUnlockedExportRootCapabilityWithWorkerV1(ports.transport, {
      existingEnvelope: unlocked.custodyEnvelope,
      existingFactorSecret: unlocked.factorSecret32,
      walletId,
      walletAuthMethodId: unlocked.walletSession.authMethodId,
      walletSessionId: unlocked.operationCredential.walletSessionId,
      expiresAtMs: unlocked.walletSession.expiresAtMs,
    });
    await installAuthMethodEcdsaMaterial(unlocked, identity, ports.engine.getSignerWorkerContext());
    if (cap)
      await ports.engine.activateAuthenticatedWalletState({
        walletId,
        nearAccountId: cap.nearAccountId,
        signerSlot: cap.applicationBinding.key_creation_signer_slot,
        nearClient: ports.nearClient,
      });
    if (!(await readAuthMethodEnabled(walletId, unlocked.walletSession.authMethodId)))
      throw new Error('VoiceID is turned off in this browser.');
    if (unlocked.signal.aborted) throw new Error('Wallet unlock was cancelled.');
    await IndexedDBManager.markWalletSelectionUnlockedAtGeneration({
      walletId,
      walletAuthMethodId: unlocked.walletSession.authMethodId,
      unlockedAtMs: Date.now(),
      expectedLockGeneration,
    });
    if (unlocked.signal.aborted) throw new Error('Wallet unlock was cancelled.');
    if (prepared) ports.rememberNearSession(prepared.state);
    ports.engine.setWalletAuthenticated({ kind: 'authenticated', walletId, authMethod: 'voiceid' });
    if (!cap) return { success: true, kind: 'ecdsa_wallet_unlocked', walletId };
    return {
      success: true,
      kind: 'near_wallet_unlocked',
      walletId,
      loggedInNearAccountId: cap.nearAccountId,
      nearAccountId: cap.nearAccountId,
      operationalPublicKey: `ed25519:${base58Encode(Uint8Array.from(cap.registeredPublicKey))}`,
    };
  } catch (error) {
    prepared?.activeClient.dispose();
    await ports.engine.clearVolatileWarmSigningMaterial(walletId);
    await walletSessionAuthorizations.clearWallet(walletId);
    await ports.engine.destroyUnlockedWalletEd25519ExportRootCapabilitiesV1({
      kind: 'wallet_session',
      walletSessionId: unlocked.operationCredential.walletSessionId,
    });
    ports.engine.clearWalletAuthentication();
    throw error;
  }
}
