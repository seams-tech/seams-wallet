import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireBytes, requireBytes32 } from '@shared/utils/routerAbEd25519YaoDigests';
import { parseDigestB64u, sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseMlDsa65PublicKeyB64u } from '@shared/passkey-custody/primitives';
import type { MlDsaAddSignerPreparation } from '../../../domains/walletRegistration/mlDsaAddSigner';
import type { MlDsaEncryptedInputs } from '@shared/passkey-custody/mlDsaCustody';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { RouterAbNormalSigningRouterProxy } from '../../../framework/routerApi';
import {
  normalizeRouterAbInternalServiceAuthSecret,
  ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
} from '../../../../core/ThresholdService/routerAb/internalServiceHttp';

type RecipientKey = {
  readonly publicKeyB64u: string;
  readonly keyVersion: string;
};

type RecipientDiscovery = ReadonlyExclusiveUnion<
  | { readonly kind: 'ready'; readonly a: RecipientKey; readonly b: RecipientKey }
  | { readonly kind: 'unavailable'; readonly reason: 'transport' | 'refused' | 'invalid_response' }
>;

function recipientKey(value: unknown, expectedRole: 'a' | 'b'): RecipientKey {
  const record = exactRecord(value, ['role', 'key_version', 'public_key'], 'ML-DSA recipient');
  if (record.role !== expectedRole) throw new Error('ML-DSA recipient role mismatch');
  const bytes = requireBytes32(record.public_key, 'ML-DSA recipient public key', true);
  return {
    publicKeyB64u: base64UrlEncode(new Uint8Array(bytes)),
    keyVersion: requireCanonicalString(record.key_version, 'ML-DSA recipient key version'),
  };
}

/** Private Gateway transport. Discovery grants no wallet or registration authority. */
export async function discoverMlDsaRecipientKeys(
  proxy: RouterAbNormalSigningRouterProxy,
): Promise<RecipientDiscovery> {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(
    ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
    normalizeRouterAbInternalServiceAuthSecret(proxy.internalServiceAuthSecret),
  );
  let response: Response;
  try {
    response = await proxy.fetch(
      new Request('https://router-ab.internal/router-ab/ml-dsa/registration/recipient-keys', {
        method: 'POST',
        headers,
        body: '{}',
      }),
    );
  } catch {
    return { kind: 'unavailable', reason: 'transport' };
  }
  if (response.status !== 200) return { kind: 'unavailable', reason: 'refused' };
  try {
    const record = exactRecord(await response.json(), ['a', 'b'], 'ML-DSA recipients');
    const a = recipientKey(record.a, 'a');
    const b = recipientKey(record.b, 'b');
    if (a.publicKeyB64u === b.publicKeyB64u) {
      return { kind: 'unavailable', reason: 'invalid_response' };
    }
    return { kind: 'ready', a, b };
  } catch {
    return { kind: 'unavailable', reason: 'invalid_response' };
  }
}

type SealedRoleValue = {
  readonly encapsulated_key: readonly number[];
  readonly ciphertext: readonly number[];
};
export type MlDsaInstalledRegistration = {
  readonly publicKeyB64u: ReturnType<typeof parseMlDsa65PublicKeyB64u>;
  readonly manifestDigestB64u: ReturnType<typeof parseDigestB64u>;
  readonly scheduleDigestB64u: ReturnType<typeof parseDigestB64u>;
  readonly replies: { readonly roleA: SealedRoleValue; readonly roleB: SealedRoleValue };
};

function sealedRoleValue(raw: unknown, bytes: number): SealedRoleValue {
  const record = exactRecord(raw, ['encapsulated_key', 'ciphertext'], 'ML-DSA sealed role value');
  return {
    encapsulated_key: requireBytes32(record.encapsulated_key, 'ML-DSA encapsulated key', true),
    ciphertext: requireBytes(record.ciphertext, 'ML-DSA ciphertext', bytes, bytes),
  };
}

export function parseMlDsaInstalledRegistration(raw: unknown): MlDsaInstalledRegistration {
  const record = exactRecord(
    raw,
    ['publicKeyB64u', 'manifestDigestB64u', 'scheduleDigestB64u', 'replies'],
    'ML-DSA installed registration',
  );
  const replies = exactRecord(record.replies, ['roleA', 'roleB'], 'ML-DSA holder replies');
  return {
    publicKeyB64u: parseMlDsa65PublicKeyB64u(record.publicKeyB64u),
    manifestDigestB64u: parseDigestB64u(record.manifestDigestB64u),
    scheduleDigestB64u: parseDigestB64u(record.scheduleDigestB64u),
    replies: {
      roleA: sealedRoleValue(replies.roleA, 1968),
      roleB: sealedRoleValue(replies.roleB, 1968),
    },
  };
}

function digestBytes(raw: unknown): ReturnType<typeof parseDigestB64u> {
  return parseDigestB64u(
    base64UrlEncode(new Uint8Array(requireBytes32(raw, 'ML-DSA digest', true))),
  );
}

async function completedRole(raw: unknown, expected: MlDsaAddSignerPreparation) {
  const result = exactRecord(raw, ['public_key', 'activation', 'reply'], 'ML-DSA role completion');
  const activation = exactRecord(
    result.activation,
    ['key', 'ceremony_id', 'manifest_digest'],
    'ML-DSA activation',
  );
  const key = exactRecord(
    activation.key,
    ['wallet', 'key_id', 'epoch', 'public_key_digest', 'schedule_digest'],
    'ML-DSA key',
  );
  const wallet = exactRecord(
    key.wallet,
    ['org', 'project', 'environment', 'wallet'],
    'ML-DSA wallet',
  );
  const context = expected.protocolInputs;
  if (
    wallet.org !== expected.identity.orgId ||
    wallet.project !== expected.identity.projectId ||
    wallet.environment !== expected.identity.envId ||
    wallet.wallet !== context.walletId ||
    key.key_id !== context.signingKeyId ||
    key.epoch !== context.materialEpoch ||
    digestBytes(activation.ceremony_id) !== context.operationIdB64u
  ) {
    throw new Error('ML-DSA completion changed its admitted identity');
  }
  const publicKey = new Uint8Array(
    requireBytes(result.public_key, 'ML-DSA public key', 1952, 1952),
  );
  if ((await sha256DigestB64u(publicKey)) !== digestBytes(key.public_key_digest)) {
    throw new Error('ML-DSA completion public key digest differs');
  }
  return {
    publicKeyB64u: parseMlDsa65PublicKeyB64u(base64UrlEncode(publicKey)),
    manifestDigestB64u: digestBytes(activation.manifest_digest),
    scheduleDigestB64u: digestBytes(key.schedule_digest),
    reply: sealedRoleValue(result.reply, 1968),
  };
}

type RegistrationExecution = ReadonlyExclusiveUnion<
  | { readonly kind: 'installed'; readonly result: MlDsaInstalledRegistration }
  | { readonly kind: 'pending' }
  | { readonly kind: 'unavailable'; readonly retryAtMs: number }
  | {
      readonly kind: 'failed';
      readonly reason: 'transport' | 'refused' | 'invalid_response' | 'terminal';
    }
>;

/** Called only after the Gateway durably binds the exact encrypted inputs. */
export async function executeMlDsaRegistration(
  proxy: RouterAbNormalSigningRouterProxy,
  preparation: MlDsaAddSignerPreparation,
  inputs: MlDsaEncryptedInputs,
): Promise<RegistrationExecution> {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(
    ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
    normalizeRouterAbInternalServiceAuthSecret(proxy.internalServiceAuthSecret),
  );
  const context = preparation.protocolInputs;
  let response: Response;
  try {
    response = await proxy.fetch(
      new Request('https://router-ab.internal/router-ab/ml-dsa/register', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          wallet: {
            org: preparation.identity.orgId,
            project: preparation.identity.projectId,
            environment: preparation.identity.envId,
            wallet: context.walletId,
          },
          key_id: context.signingKeyId,
          epoch: context.materialEpoch,
          operation: Array.from(base64UrlDecode(context.operationIdB64u)),
          continuity: { kind: 'create' },
          input_a: inputs.a,
          input_b: inputs.b,
        }),
      }),
    );
  } catch {
    return { kind: 'failed', reason: 'transport' };
  }
  if (response.status !== 200) return { kind: 'failed', reason: 'refused' };
  try {
    const raw: unknown = await response.json();
    const status = requireRecord(raw, 'ML-DSA registration decision');
    if (status.status === 'unavailable') {
      const unavailable = exactRecord(status, ['status', 'retry_at_ms'], 'ML-DSA unavailable');
      if (
        typeof unavailable.retry_at_ms !== 'number' ||
        !Number.isSafeInteger(unavailable.retry_at_ms) ||
        unavailable.retry_at_ms < 0
      )
        throw new Error('Invalid retry time');
      return { kind: 'unavailable', retryAtMs: unavailable.retry_at_ms };
    }
    const existing = exactRecord(status, ['status', 'operation'], 'ML-DSA registration decision');
    if (existing.status !== 'existing') throw new Error('Invalid registration decision');
    const operation = requireRecord(existing.operation, 'ML-DSA operation');
    if (operation.state === 'running') return { kind: 'pending' };
    if (operation.state === 'failed') return { kind: 'failed', reason: 'terminal' };
    if (operation.state !== 'complete') throw new Error('Invalid registration state');
    const complete = exactRecord(operation, ['state', 'result'], 'ML-DSA completed operation');
    const result = exactRecord(complete.result, ['a', 'b'], 'ML-DSA complete roles');
    const a = await completedRole(result.a, preparation);
    const b = await completedRole(result.b, preparation);
    if (
      a.publicKeyB64u !== b.publicKeyB64u ||
      a.manifestDigestB64u !== b.manifestDigestB64u ||
      a.scheduleDigestB64u !== b.scheduleDigestB64u
    ) {
      throw new Error('ML-DSA participants disagree');
    }
    return {
      kind: 'installed',
      result: {
        publicKeyB64u: a.publicKeyB64u,
        manifestDigestB64u: a.manifestDigestB64u,
        scheduleDigestB64u: a.scheduleDigestB64u,
        replies: { roleA: a.reply, roleB: b.reply },
      },
    };
  } catch {
    return { kind: 'failed', reason: 'invalid_response' };
  }
}
