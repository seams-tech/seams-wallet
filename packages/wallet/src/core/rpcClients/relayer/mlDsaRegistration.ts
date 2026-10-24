import {
  parseWalletAuthorityV1,
  walletAuthorityDigestsMatchV1,
  type ActiveWalletAuthorityV1,
} from '@shared/authorization/walletAuthority';
import {
  parseMlDsaCustodyCommit,
  parseMlDsaRegistrationFailure,
  type MlDsaCustodyCommit,
  type MlDsaEncryptedInputs,
  type MlDsaRegistrationFailure,
} from '@shared/passkey-custody/mlDsaCustody';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';
import {
  WALLET_MANAGEMENT_PROTOCOL_HEADER,
  WALLET_MANAGEMENT_PROTOCOL_VERSION,
} from '@shared/utils/walletManagementProtocol';
import { buildRelayerJsonPostRequestInit, normalizeRelayerBaseUrl } from './relayerHttp';

type RegistrationTarget = {
  readonly relayerUrl: string;
  readonly walletId: string;
  readonly addSignerCeremonyId: string;
};
export type MlDsaPublishedKey = {
  readonly authority: ActiveWalletAuthorityV1;
  readonly key: MlDsaCustodyCommit['key'];
  readonly publishedAtMs: number;
};

async function request(
  target: RegistrationTarget,
  action: 'execute' | 'publish',
  payload: unknown,
): Promise<unknown> {
  const response = await fetch(
    `${normalizeRelayerBaseUrl(target.relayerUrl)}/wallets/${encodeURIComponent(target.walletId)}/signers/ml-dsa/${action}`,
    buildRelayerJsonPostRequestInit({
      headers: { [WALLET_MANAGEMENT_PROTOCOL_HEADER]: WALLET_MANAGEMENT_PROTOCOL_VERSION },
      body: payload,
    }),
  );
  const value: unknown = await response.json();
  if (!response.ok && requireRecord(value, 'ML-DSA response').ok !== false)
    throw new Error('ML-DSA Gateway request failed');
  return value;
}

export async function executeWalletAddSignerMlDsa(
  target: RegistrationTarget,
  encryptedInputs: MlDsaEncryptedInputs,
): Promise<{ readonly ok: true; readonly protocolResultJson: string } | MlDsaRegistrationFailure> {
  const raw = await request(target, 'execute', {
    addSignerCeremonyId: target.addSignerCeremonyId,
    encryptedInputs,
  });
  const response = requireRecord(raw, 'ML-DSA execution response');
  if (response.ok === false) return parseMlDsaRegistrationFailure(response);
  const complete = exactRecord(response, ['ok', 'protocolResultJson'], 'ML-DSA execution response');
  if (complete.ok !== true) throw new Error('Invalid ML-DSA execution response');
  return {
    ok: true,
    protocolResultJson: requireCanonicalString(
      complete.protocolResultJson,
      'ML-DSA participant replies',
    ),
  };
}

export async function publishWalletAddSignerMlDsa(
  target: RegistrationTarget,
  custodyCommit: MlDsaCustodyCommit,
): Promise<({ readonly ok: true } & MlDsaPublishedKey) | MlDsaRegistrationFailure> {
  const raw = await request(target, 'publish', {
    addSignerCeremonyId: target.addSignerCeremonyId,
    custodyCommit,
  });
  const response = requireRecord(raw, 'ML-DSA publication response');
  if (response.ok === false) return parseMlDsaRegistrationFailure(response);
  const complete = exactRecord(
    response,
    ['ok', 'key', 'publishedAtMs', 'authority'],
    'ML-DSA publication response',
  );
  if (
    complete.ok !== true ||
    typeof complete.publishedAtMs !== 'number' ||
    !Number.isSafeInteger(complete.publishedAtMs) ||
    complete.publishedAtMs <= 0
  )
    throw new Error('Invalid ML-DSA publication response');
  const verified = parseMlDsaCustodyCommit({ custodyAction: 'joined', key: complete.key });
  if (JSON.stringify(verified.key) !== JSON.stringify(custodyCommit.key))
    throw new Error('ML-DSA publication changed the verified key');
  const authority = parseWalletAuthorityV1(complete.authority);
  if (
    !authority.ok ||
    authority.value.state !== 'active' ||
    authority.value.walletId !== verified.key.walletId ||
    !(await walletAuthorityDigestsMatchV1(authority.value))
  )
    throw new Error('Invalid ML-DSA publication authority');
  let activated = false;
  for (const entry of authority.value.signerActivations.mlDsa ?? []) {
    if (
      entry.signer.mlDsaSigningKeyId === verified.key.signingKeyId &&
      entry.signer.registeredPublicKeyB64u === verified.key.publicKeyB64u &&
      entry.signer.keyManifestDigestB64u === verified.key.keyManifestDigestB64u
    )
      activated = true;
  }
  if (!activated) throw new Error('ML-DSA publication authority omits its signer');
  return {
    ok: true,
    key: verified.key,
    publishedAtMs: complete.publishedAtMs,
    authority: authority.value,
  };
}
