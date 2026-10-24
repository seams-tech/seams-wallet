import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import {
  mlDsaInventoryChallenge,
  parseMlDsaInventoryActor,
  parseMlDsaInventoryPreparation,
  parseMlDsaSignerInventoryEntry,
  type MlDsaInventoryPreparation,
  type MlDsaInventoryPreparationOutcome,
  type MlDsaSignerInventoryOutcome,
} from '@shared/near/mlDsaInventory';
import { parseMlDsaSigningFailure } from '@shared/near/mlDsaSigning';
import type { WebAuthnAuthenticationCredential } from '@/core/types/webauthn';
import { redactCredentialExtensionOutputs } from '@/core/signingEngine/webauthnAuth/credentials/credentialExtensions';
import {
  WALLET_MANAGEMENT_PROTOCOL_HEADER,
  WALLET_MANAGEMENT_PROTOCOL_VERSION,
} from '@shared/utils/walletManagementProtocol';
import {
  buildRelayerJsonPostRequestInit,
  buildWalletSessionAuthorizationHeaders,
  normalizeRelayerBaseUrl,
} from './relayerHttp';

export async function prepareMlDsaSignerInventory(input: {
  readonly relayerUrl: string;
  readonly walletId: string;
  readonly rpId: string;
  readonly credentialIdB64u: string;
  readonly origin: string;
}): Promise<MlDsaInventoryPreparationOutcome> {
  const actor = parseMlDsaInventoryActor({
    walletId: input.walletId,
    rpId: input.rpId,
    credentialIdB64u: input.credentialIdB64u,
  });
  const response = await fetch(
    `${normalizeRelayerBaseUrl(input.relayerUrl)}/wallets/${encodeURIComponent(actor.walletId)}/ml-dsa/inventory/prepare`,
    buildRelayerJsonPostRequestInit({
      headers: { [WALLET_MANAGEMENT_PROTOCOL_HEADER]: WALLET_MANAGEMENT_PROTOCOL_VERSION },
      body: actor,
    }),
  );
  const raw = requireRecord(await response.json(), 'ML-DSA inventory preparation');
  if (raw.kind === 'refused') return parseMlDsaSigningFailure(raw);
  const r = exactRecord(
    raw,
    ['kind', 'preparation', 'challengeB64u'],
    'ML-DSA inventory preparation',
  );
  if (!response.ok || r.kind !== 'prepared')
    throw new Error('Invalid ML-DSA inventory preparation');
  const preparation = parseMlDsaInventoryPreparation(r.preparation);
  if (
    preparation.walletId !== actor.walletId ||
    preparation.rpId !== actor.rpId ||
    preparation.credentialIdB64u !== actor.credentialIdB64u ||
    r.challengeB64u !== (await mlDsaInventoryChallenge(preparation, input.origin))
  )
    throw new Error('The Gateway changed the ML-DSA inventory approval');
  return { kind: 'prepared', preparation, challengeB64u: r.challengeB64u };
}

/** Discovery restores public references. It neither installs shares nor authorizes a signature. */
export async function fetchMlDsaSignerInventory(input: {
  readonly relayerUrl: string;
  readonly preparation: MlDsaInventoryPreparation;
  readonly credential: WebAuthnAuthenticationCredential;
}): Promise<MlDsaSignerInventoryOutcome> {
  const response = await fetch(
    `${normalizeRelayerBaseUrl(input.relayerUrl)}/wallets/${encodeURIComponent(input.preparation.walletId)}/ml-dsa/inventory`,
    buildRelayerJsonPostRequestInit({
      headers: { [WALLET_MANAGEMENT_PROTOCOL_HEADER]: WALLET_MANAGEMENT_PROTOCOL_VERSION },
      body: {
        preparation: input.preparation,
        credential: redactCredentialExtensionOutputs(input.credential),
      },
    }),
  );
  return parseMlDsaInventoryResponse(
    await response.json(),
    response.ok,
    input.preparation.walletId,
  );
}

export function parseMlDsaInventoryResponse(
  value: unknown,
  ok: boolean,
  walletId: string,
): MlDsaSignerInventoryOutcome {
  const raw = requireRecord(value, 'ML-DSA signer inventory');
  if (raw.kind === 'refused') return parseMlDsaSigningFailure(raw);
  const r = exactRecord(raw, ['kind', 'entries'], 'ML-DSA signer inventory');
  if (!ok || r.kind !== 'inventory' || !Array.isArray(r.entries) || r.entries.length > 64)
    throw new Error('Invalid ML-DSA signer inventory response');
  const entries = r.entries.map(
    parseInventoryEntry.bind(undefined, requireParsed(parseWalletId(walletId), 'walletId')),
  );
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = entry.kind === 'published' ? entry.key.signingKeyId : entry.signingKeyId;
    if (seen.has(id)) throw new Error('Duplicate ML-DSA signer inventory identity');
    seen.add(id);
  }
  return { kind: 'inventory', entries };
}
function parseInventoryEntry(walletId: WalletId, raw: unknown) {
  return parseMlDsaSignerInventoryEntry(raw, walletId);
}

/** Read display metadata without a new passkey assertion or any signing allowance. */
export async function readMlDsaSignerMetadata(input: {
  readonly relayerUrl: string;
  readonly walletId: string;
  readonly credential: WalletSessionOperationCredentialV1;
}): Promise<MlDsaSignerInventoryOutcome> {
  const response = await fetch(
    `${normalizeRelayerBaseUrl(input.relayerUrl)}/wallets/${encodeURIComponent(input.walletId)}/ml-dsa/metadata`,
    buildRelayerJsonPostRequestInit({
      headers: {
        ...buildWalletSessionAuthorizationHeaders(input.credential),
        [WALLET_MANAGEMENT_PROTOCOL_HEADER]: WALLET_MANAGEMENT_PROTOCOL_VERSION,
      },
      body: { walletId: input.walletId },
    }),
  );
  return parseMlDsaInventoryResponse(await response.json(), response.ok, input.walletId);
}
