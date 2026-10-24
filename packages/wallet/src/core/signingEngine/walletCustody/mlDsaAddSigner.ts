import { IndexedDBManager } from '@/core/indexedDB';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireBytes32 } from '@shared/utils/routerAbEd25519YaoDigests';
import {
  parseMlDsaEncryptedInputs,
  type MlDsaRegistrationFailure,
} from '@shared/passkey-custody/mlDsaCustody';
import type { Variant } from '@shared/utils/variant';
import type { WalletAddSignerStartResponse } from '@/core/rpcClients/relayer/walletRegistration';
import {
  executeWalletAddSignerMlDsa,
  publishWalletAddSignerMlDsa,
} from '@/core/rpcClients/relayer/mlDsaRegistration';
import type { WalletCustodyCeremonySurface } from '@/SeamsWeb/signingSurface/ports';
import type { RegistrationResult } from '@/core/types/seams';
import { joinCustodyWireFromEnvelopeRecord } from './joinCustodyWire';
import { retainMlDsaPublication, clearMlDsaPublication } from './pendingMlDsaPublication';

type Started = Variant<WalletAddSignerStartResponse, 'kind', 'near_ml_dsa_65'>;
type Round = { readonly relayerUrl: string; readonly started: Started };

class MlDsaAddSignerRejected extends Error {
  constructor(readonly failure: MlDsaRegistrationFailure) {
    super(failure.message);
  }
}

function scheduleDelay(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}
function delay(milliseconds: number): Promise<void> {
  return new Promise<void>(scheduleDelay.bind(undefined, milliseconds));
}

async function waitForRetry(round: Round, failure: MlDsaRegistrationFailure): Promise<void> {
  const now = Date.now();
  let at: number;
  switch (failure.code) {
    case 'pool_unavailable':
      at = Math.max(now + 100, failure.retryAtMs);
      break;
    case 'pending':
    case 'conflict':
    case 'ml_dsa_transport':
    case 'ml_dsa_refused':
      at = now + 500;
      break;
    default:
      throw new MlDsaAddSignerRejected(failure);
  }
  if (at >= round.started.mlDsa.expiresAtMs) throw new MlDsaAddSignerRejected(failure);
  await delay(at - now);
}

async function runRound(round: Round, roleInputsJson: string): Promise<string> {
  const dispatch = exactRecord(
    JSON.parse(roleInputsJson),
    ['binding', 'roleA', 'roleB'],
    'ML-DSA role dispatch',
  );
  const binding = exactRecord(
    dispatch.binding,
    ['wallet_id', 'signing_key_id', 'operation_id', 'material_epoch'],
    'ML-DSA role binding',
  );
  const expected = round.started.mlDsa.protocolInputs;
  if (
    binding.wallet_id !== expected.walletId ||
    binding.signing_key_id !== expected.signingKeyId ||
    binding.material_epoch !== expected.materialEpoch ||
    base64UrlEncode(
      new Uint8Array(requireBytes32(binding.operation_id, 'ML-DSA operation', true)),
    ) !== expected.operationIdB64u
  )
    throw new Error('ML-DSA worker changed its ceremony binding');
  const inputs = parseMlDsaEncryptedInputs({ a: dispatch.roleA, b: dispatch.roleB });
  const target = {
    relayerUrl: round.relayerUrl,
    walletId: round.started.intent.walletId,
    addSignerCeremonyId: round.started.addSignerCeremonyId,
  };
  while (Date.now() < round.started.mlDsa.expiresAtMs) {
    try {
      const response = await executeWalletAddSignerMlDsa(target, inputs);
      if (response.ok) return response.protocolResultJson;
      await waitForRetry(round, response);
    } catch (error: unknown) {
      if (!(error instanceof TypeError)) throw error;
      await waitForRetry(round, {
        ok: false,
        code: 'ml_dsa_transport',
        message: 'ML-DSA transport was interrupted',
      });
    }
  }
  throw new Error('ML-DSA registration expired');
}

export async function addPasskeyMlDsaWalletSigner(input: {
  readonly signingEngine: Pick<WalletCustodyCeremonySurface, 'joinWalletCustodyMlDsaKeySet'>;
  readonly started: Started;
  readonly relayerUrl: string;
  readonly passkeyPrfFirstB64u: string;
}): Promise<RegistrationResult> {
  const custody = joinCustodyWireFromEnvelopeRecord(input.started.mlDsa.custodyEnvelope);
  if (!custody.ok) throw new Error(custody.reason);
  const factor = Uint8Array.from(base64UrlDecode(input.passkeyPrfFirstB64u));
  const round: Round = { relayerUrl: input.relayerUrl, started: input.started };
  try {
    const commit = await input.signingEngine.joinWalletCustodyMlDsaKeySet({
      ceremonyId: input.started.addSignerCeremonyId,
      protocolInputs: input.started.mlDsa.protocolInputs,
      custodyJson: custody.custodyJson,
      factorSecret: factor.buffer,
      runRouterRound: runRound.bind(undefined, round),
    });
    if (commit.custodyAction !== 'joined')
      throw new Error('Adding an ML-DSA signer must preserve existing custody');
    const selection = input.started.intent.signerSelection;
    if (selection.mode !== 'ml_dsa_65') throw new Error('Wrong ML-DSA signer selection');
    const purpose = selection.mlDsa.purpose;
    if (
      purpose.kind === 'restore' &&
      (commit.key.publicKeyB64u !== purpose.publicKeyB64u ||
        commit.key.keyManifestDigestB64u !== purpose.keyManifestDigestB64u ||
        commit.key.materialEpoch <= purpose.materialEpoch)
    )
      throw new Error('ML-DSA restoration changed the recorded signer');
    const target = {
      relayerUrl: input.relayerUrl,
      walletId: input.started.intent.walletId,
      addSignerCeremonyId: input.started.addSignerCeremonyId,
    };
    await retainMlDsaPublication({
      relayerUrl: input.relayerUrl,
      addSignerCeremonyId: target.addSignerCeremonyId,
      commit,
    });
    while (Date.now() < input.started.mlDsa.expiresAtMs) {
      try {
        const published = await publishWalletAddSignerMlDsa(target, commit);
        if (!published.ok) {
          await waitForRetry(round, published);
          continue;
        }
        await IndexedDBManager.adoptAddedMlDsaSignerAuthority(published.authority);
        await clearMlDsaPublication({ relayerUrl: input.relayerUrl, commit });
        return {
          success: true,
          kind: 'wallet_signer_added',
          walletId: input.started.intent.walletId,
          capabilities: [
            {
              kind: 'near_ml_dsa_65',
              signingKeyId: published.key.signingKeyId,
              publicKeyB64u: published.key.publicKeyB64u,
              keyManifestDigestB64u: published.key.keyManifestDigestB64u,
              materialEpoch: published.key.materialEpoch,
            },
          ],
        };
      } catch (error: unknown) {
        if (!(error instanceof TypeError)) throw error;
        await waitForRetry(round, {
          ok: false,
          code: 'ml_dsa_transport',
          message: 'ML-DSA publication reply was lost',
        });
      }
    }
    throw new Error('ML-DSA publication expired');
  } finally {
    factor.fill(0);
  }
}
