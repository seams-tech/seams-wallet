import { ActionType, TxExecutionStatus } from '@shared/near/actions';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireCanonicalString } from '@shared/utils/validation';
import {
  parseMlDsa65PublicKeyB64u,
  parseMlDsaMaterialEpoch,
} from '@shared/passkey-custody/primitives';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseMlDsaSigningKeyId } from '@shared/signing-lanes/recordParsers';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { NearSignerCapability } from '@/SeamsWeb/publicApi/types';
import type { AddedMlDsaSignerCapability } from '@/core/types/seams';
import {
  nearAccountRefFromAccountId,
  walletSessionRefFromSession,
  type NearAccountRef,
  type WalletSessionRef,
} from '../interfaces/ecdsaChainTarget';
import type { WalletId } from '@shared/utils/domainIds';
import { loadMlDsaCodec } from '@/core/rpcClients/relayer/mlDsaSigning';

type EnrollmentTarget = {
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef;
  readonly signer: AddedMlDsaSignerCapability;
  readonly publicKey: string;
  readonly accessKeyHandle: string;
};
export type MlDsaPublishedSignerReference = {
  readonly walletId: WalletId;
  readonly signer: AddedMlDsaSignerCapability;
};
type EnrollmentRequest = {
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef;
  readonly publication: MlDsaPublishedSignerReference;
};
export type PendingMlDsaNearEnrollment = {
  readonly kind: 'awaiting_chain';
  readonly request: EnrollmentRequest;
};
export type MlDsaNearEnrollmentOutcome = ReadonlyExclusiveUnion<
  | { readonly kind: 'enrolled'; readonly publicKey: string }
  | {
      readonly kind: 'pending';
      readonly reason: 'rpc_unavailable' | 'not_final';
      readonly continuation: PendingMlDsaNearEnrollment;
    }
  | {
      readonly kind: 'refused';
      readonly reason: 'restricted_key' | 'wrong_wallet' | 'unsupported_protocol';
    }
  | { readonly kind: 'unavailable'; readonly reason: 'rpc_unavailable' }
>;
type EnrollmentReader = Pick<NearClient, 'viewAccessKeyList'>;

async function enrollmentTarget(input: EnrollmentRequest): Promise<EnrollmentTarget> {
  const published = input.publication.signer;
  const signer: AddedMlDsaSignerCapability = {
    kind: 'near_ml_dsa_65',
    signingKeyId: parseMlDsaSigningKeyId(published.signingKeyId),
    publicKeyB64u: parseMlDsa65PublicKeyB64u(published.publicKeyB64u),
    keyManifestDigestB64u: parseDigestB64u(published.keyManifestDigestB64u),
    materialEpoch: parseMlDsaMaterialEpoch(published.materialEpoch),
  };
  const codec = await loadMlDsaCodec();
  const identifiers = exactRecord(
    JSON.parse(codec.ml_dsa65_near_key_identifiers(signer.publicKeyB64u)),
    ['publicKey', 'accessKeyHandle'],
    'ML-DSA NEAR key identifiers',
  );
  return {
    walletSession: walletSessionRefFromSession({
      walletId: input.walletSession.walletId,
      walletSessionUserId: input.walletSession.walletSessionUserId,
    }),
    nearAccount: nearAccountRefFromAccountId(input.nearAccount.accountId),
    signer,
    publicKey: requireCanonicalString(identifiers.publicKey, 'ML-DSA public key'),
    accessKeyHandle: requireCanonicalString(
      identifiers.accessKeyHandle,
      'ML-DSA access-key handle',
    ),
  };
}

async function observeEnrollment(
  reader: EnrollmentReader,
  target: EnrollmentTarget,
): Promise<'absent' | 'full_access' | 'restricted'> {
  const list = await reader.viewAccessKeyList(target.nearAccount.accountId, { finality: 'final' });
  for (const key of list.keys) {
    if (key.public_key === target.accessKeyHandle)
      return key.access_key.permission === 'FullAccess' ? 'full_access' : 'restricted';
  }
  return 'absent';
}

/** Resume checks chain state only. It never repeats an uncertain AddKey submission. */
export async function resumeMlDsaNearEnrollment(input: {
  readonly nearClient: EnrollmentReader;
  readonly continuation: PendingMlDsaNearEnrollment;
  readonly near?: never;
}): Promise<MlDsaNearEnrollmentOutcome> {
  const request = input.continuation.request;
  if (request.publication.walletId !== request.walletSession.walletId)
    return { kind: 'refused', reason: 'wrong_wallet' };
  const target = await enrollmentTarget(request);
  return confirmEnrollment(input.nearClient, target, input.continuation);
}
async function confirmEnrollment(
  reader: EnrollmentReader,
  target: EnrollmentTarget,
  continuation: PendingMlDsaNearEnrollment,
): Promise<MlDsaNearEnrollmentOutcome> {
  try {
    switch (await observeEnrollment(reader, target)) {
      case 'full_access':
        return { kind: 'enrolled', publicKey: target.publicKey };
      case 'restricted':
        return { kind: 'refused', reason: 'restricted_key' };
      case 'absent':
        return { kind: 'pending', reason: 'not_final', continuation };
    }
  } catch {
    return { kind: 'pending', reason: 'rpc_unavailable', continuation };
  }
}

/** Add the published signer to an existing account through its ordinary owner approval. */
export async function enrollMlDsaNearSigner(input: {
  readonly near: Pick<NearSignerCapability, 'signAndSendTransaction'>;
  readonly nearClient: Pick<NearClient, 'viewAccessKeyList' | 'viewProtocolConfig'>;
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef;
  readonly publication: MlDsaPublishedSignerReference;
  readonly options?: Parameters<NearSignerCapability['signAndSendTransaction']>[0]['options'];
}): Promise<MlDsaNearEnrollmentOutcome> {
  if (input.publication.walletId !== input.walletSession.walletId)
    return { kind: 'refused', reason: 'wrong_wallet' };
  const target = await enrollmentTarget(input);
  const continuation: PendingMlDsaNearEnrollment = {
    kind: 'awaiting_chain',
    request: {
      walletSession: target.walletSession,
      nearAccount: target.nearAccount,
      publication: { walletId: input.publication.walletId, signer: target.signer },
    },
  };
  let existing;
  try {
    existing = await observeEnrollment(input.nearClient, target);
  } catch {
    return { kind: 'unavailable', reason: 'rpc_unavailable' };
  }
  switch (existing) {
    case 'full_access':
      return { kind: 'enrolled', publicKey: target.publicKey };
    case 'restricted':
      return { kind: 'refused', reason: 'restricted_key' };
    case 'absent':
      break;
  }
  try {
    if (!(await supportsMlDsaNearNetwork(input.nearClient)))
      return { kind: 'refused', reason: 'unsupported_protocol' };
  } catch {
    return { kind: 'unavailable', reason: 'rpc_unavailable' };
  }
  try {
    await input.near.signAndSendTransaction({
      walletSession: target.walletSession,
      nearAccount: target.nearAccount,
      signer: { kind: 'ed25519' },
      receiverId: target.nearAccount.accountId,
      actions: [
        {
          type: ActionType.AddKey,
          publicKey: target.publicKey,
          accessKey: { nonce: 0, permission: 'FullAccess' },
        },
      ],
      options: { ...input.options, waitUntil: TxExecutionStatus.FINAL },
    });
  } catch {
    // An owner call can fail after dispatch. Finalized chain state decides the result.
  }
  return confirmEnrollment(input.nearClient, target, continuation);
}

/** NEP-645 activates PostQuantumSignatures at protocol version 85. */
export async function supportsMlDsaNearNetwork(
  reader: Pick<NearClient, 'viewProtocolConfig'>,
): Promise<boolean> {
  return (await reader.viewProtocolConfig()).protocolVersion >= 85;
}
