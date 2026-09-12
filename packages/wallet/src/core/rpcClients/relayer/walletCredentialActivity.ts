import {
  parsePasskeyCustodyEnvelopeLifecycle,
  parseWalletCustodyEnvelopeFactor,
  type PasskeyDeviceEnvelopeIndexRecord,
} from '@shared/passkey-custody';
import {
  parseWalletCredentialActivityRecordV1,
  type WalletCredentialActivityRecordV1,
} from '@shared/passkey-custody/credentialActivity';
import { parsePasskeyEnvelopeId, parseWalletId } from '@shared/utils/domainIds';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { normalizeRelayerBaseUrl } from './relayerHttp';
import type { WalletCustodyFactorProof } from './walletRecoveryRotate';

const CREDENTIALS_LIST_PATH = '/wallets/:walletId/custody/credentials';
const CREDENTIAL_LABEL_PATH = '/wallets/:walletId/custody/credentials/label';

export type WalletCredentialActivityProjection = {
  readonly index: PasskeyDeviceEnvelopeIndexRecord;
  readonly activity: WalletCredentialActivityRecordV1;
};

export type WalletCredentialActivityListResult =
  | { readonly kind: 'listed'; readonly credentials: readonly WalletCredentialActivityProjection[] }
  | { readonly kind: 'unauthorized'; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

export type WalletCredentialRenameResult =
  | { readonly kind: 'renamed'; readonly credential: WalletCredentialActivityProjection }
  | { readonly kind: 'missing'; readonly message: string }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'transport_failed'; readonly message: string };

type CredentialResponseFailureDto = {
  readonly kind: 'failure';
  readonly message: string | null;
};

type CredentialListResponseDto =
  | { readonly kind: 'success'; readonly credentials: readonly unknown[] }
  | CredentialResponseFailureDto
  | { readonly kind: 'invalid' };

type CredentialRenameResponseDto =
  | { readonly kind: 'success'; readonly credential: unknown }
  | CredentialResponseFailureDto
  | { readonly kind: 'invalid' };

type CredentialProjectionRaw = {
  readonly index: unknown;
  readonly activity: unknown;
};

type CredentialIndexRaw = {
  readonly kind: unknown;
  readonly walletId: unknown;
  readonly custodySecretKind: unknown;
  readonly factor: unknown;
  readonly envelopeId: unknown;
  readonly deviceLabel: unknown;
  readonly lifecycle: unknown;
  readonly walletKeyId: unknown;
  readonly laneId: unknown;
  readonly laneShareEpoch: unknown;
  readonly createdAtMs: unknown;
  readonly updatedAtMs: unknown;
};

const CREDENTIAL_PROJECTION_FIELDS = ['index', 'activity'] as const;
const CREDENTIAL_INDEX_REQUIRED_FIELDS = [
  'kind',
  'walletId',
  'custodySecretKind',
  'factor',
  'envelopeId',
  'lifecycle',
  'createdAtMs',
  'updatedAtMs',
] as const;
const CREDENTIAL_INDEX_OPTIONAL_FIELDS = [
  'deviceLabel',
  'walletKeyId',
  'laneId',
  'laneShareEpoch',
] as const;

function decodePlainObject(value: unknown): ReadonlyMap<string, unknown> | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return null;
  }
  return new Map<string, unknown>(Object.entries(value));
}

function hasExactFields(
  fields: ReadonlyMap<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set<string>([...required, ...optional]);
  return (
    fields.size >= required.length &&
    fields.size <= allowed.size &&
    required.every((field) => fields.has(field)) &&
    [...fields.keys()].every((field) => allowed.has(field))
  );
}

function decodeCredentialFailure(
  fields: ReadonlyMap<string, unknown> | null,
): CredentialResponseFailureDto | null {
  if (
    !fields ||
    !hasExactFields(fields, ['ok', 'code', 'message']) ||
    fields.size !== 3 ||
    fields.get('ok') !== false ||
    typeof fields.get('code') !== 'string' ||
    typeof fields.get('message') !== 'string'
  ) {
    return null;
  }
  const message = fields.get('message');
  return {
    kind: 'failure',
    message: typeof message === 'string' && message.trim() ? message.trim() : null,
  };
}

function decodeCredentialListResponse(value: unknown): CredentialListResponseDto {
  const fields = decodePlainObject(value);
  if (
    fields &&
    hasExactFields(fields, ['ok', 'credentials']) &&
    fields.size === 2 &&
    fields.get('ok') === true &&
    Array.isArray(fields.get('credentials'))
  ) {
    const credentials = fields.get('credentials');
    if (Array.isArray(credentials)) return { kind: 'success', credentials };
  }
  return decodeCredentialFailure(fields) ?? { kind: 'invalid' };
}

function decodeCredentialRenameResponse(value: unknown): CredentialRenameResponseDto {
  const fields = decodePlainObject(value);
  if (
    fields &&
    hasExactFields(fields, ['ok', 'credential']) &&
    fields.size === 2 &&
    fields.get('ok') === true
  ) {
    return { kind: 'success', credential: fields.get('credential') };
  }
  return decodeCredentialFailure(fields) ?? { kind: 'invalid' };
}

function decodeCredentialProjection(value: unknown): CredentialProjectionRaw {
  const fields = decodePlainObject(value);
  if (!fields || !hasExactFields(fields, CREDENTIAL_PROJECTION_FIELDS) || fields.size !== 2) {
    throw new Error('credential projection is invalid');
  }
  return { index: fields.get('index'), activity: fields.get('activity') };
}

function decodeCredentialIndex(value: unknown): CredentialIndexRaw {
  const fields = decodePlainObject(value);
  if (
    !fields ||
    !hasExactFields(fields, CREDENTIAL_INDEX_REQUIRED_FIELDS, CREDENTIAL_INDEX_OPTIONAL_FIELDS)
  ) {
    throw new Error('credential projection index is invalid');
  }
  return {
    kind: fields.get('kind'),
    walletId: fields.get('walletId'),
    custodySecretKind: fields.get('custodySecretKind'),
    factor: fields.get('factor'),
    envelopeId: fields.get('envelopeId'),
    deviceLabel: fields.get('deviceLabel'),
    lifecycle: fields.get('lifecycle'),
    walletKeyId: fields.get('walletKeyId'),
    laneId: fields.get('laneId'),
    laneShareEpoch: fields.get('laneShareEpoch'),
    createdAtMs: fields.get('createdAtMs'),
    updatedAtMs: fields.get('updatedAtMs'),
  };
}

export async function listWalletCredentialActivity(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly factorProof: WalletCustodyFactorProof;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletCredentialActivityListResult> {
  const url = `${normalizeRelayerBaseUrl(args.relayUrl)}${CREDENTIALS_LIST_PATH.replace(
    ':walletId',
    encodeURIComponent(args.walletId),
  )}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const doFetch = args.fetchImpl || fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ factorProof: args.factorProof }),
    });
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'credential list request failed',
    };
  }
  const body = decodeCredentialListResponse(await response.json().catch(() => null));
  if (response.status === 401 || response.status === 403) {
    return {
      kind: 'unauthorized',
      message:
        body.kind === 'failure' && body.message ? body.message : 'credential list is unauthorized',
    };
  }
  if (!response.ok) {
    return {
      kind: 'transport_failed',
      message:
        body.kind === 'failure' && body.message
          ? body.message
          : `credential list failed (HTTP ${response.status})`,
    };
  }
  try {
    if (body.kind !== 'success') throw new Error('credential list response is invalid');
    return { kind: 'listed', credentials: body.credentials.map(parseProjection) };
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'credential list response is invalid',
    };
  }
}

export async function renameWalletCredential(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly envelopeId: string;
  readonly label?: string;
  readonly factorProof: WalletCustodyFactorProof;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletCredentialRenameResult> {
  const url = `${normalizeRelayerBaseUrl(args.relayUrl)}${CREDENTIAL_LABEL_PATH.replace(
    ':walletId',
    encodeURIComponent(args.walletId),
  )}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const doFetch = args.fetchImpl || fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        envelopeId: args.envelopeId,
        factorProof: args.factorProof,
        ...(args.label === undefined ? {} : { label: args.label }),
      }),
    });
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'credential rename request failed',
    };
  }
  const body = decodeCredentialRenameResponse(await response.json().catch(() => null));
  const message =
    body.kind === 'failure' && body.message
      ? body.message
      : `credential rename failed (HTTP ${response.status})`;
  if (response.status === 401 || response.status === 403) {
    return { kind: 'rejected', message };
  }
  if (response.status === 404) return { kind: 'missing', message };
  if (response.status === 409) return { kind: 'conflict', message };
  if (response.status !== 200) return { kind: 'rejected', message };
  try {
    if (body.kind !== 'success') throw new Error('credential rename response is invalid');
    return { kind: 'renamed', credential: parseProjection(body.credential) };
  } catch (error: unknown) {
    return {
      kind: 'transport_failed',
      message: error instanceof Error ? error.message : 'credential rename response is invalid',
    };
  }
}

function parseProjection(raw: unknown): WalletCredentialActivityProjection {
  const projection = decodeCredentialProjection(raw);
  const index = decodeCredentialIndex(projection.index);
  const walletId = parseWalletId(index.walletId);
  if (!walletId.ok) throw new Error('credential projection wallet id is invalid');
  const envelopeId = parsePasskeyEnvelopeId(index.envelopeId);
  if (!envelopeId.ok) throw new Error('credential projection envelope id is invalid');
  if (
    index.kind !== 'wallet_custody_envelope_index_v2' ||
    (index.custodySecretKind !== 'wallet_custody_seed_v1' &&
      index.custodySecretKind !== 'ed25519_yao_client_root_v1' &&
      index.custodySecretKind !== 'ed25519_lane_holder_share_v1' &&
      index.custodySecretKind !== 'ecdsa_lane_holder_share_v1')
  ) {
    throw new Error('credential projection index is invalid');
  }
  const factor = parseWalletCustodyEnvelopeFactor(index.factor);
  if (factor.kind !== 'passkey') throw new Error('credential projection factor is invalid');
  const lifecycle = parsePasskeyCustodyEnvelopeLifecycle(index.lifecycle);
  const createdAtMs = parseUnixMs(index.createdAtMs, 'credential projection.createdAtMs');
  const updatedAtMs = parseUnixMs(index.updatedAtMs, 'credential projection.updatedAtMs');
  const label = index.deviceLabel;
  if (label !== undefined && typeof label !== 'string') {
    throw new Error('credential projection deviceLabel is invalid');
  }
  const activityResult = parseWalletCredentialActivityRecordV1(projection.activity, {
    expectedWalletId: String(walletId.value),
  });
  if (!activityResult.ok) throw new Error(activityResult.reason);
  return {
    index: {
      kind: 'wallet_custody_envelope_index_v2',
      walletId: walletId.value,
      custodySecretKind: index.custodySecretKind,
      factor,
      envelopeId: envelopeId.value,
      ...(label === undefined ? {} : { deviceLabel: label }),
      lifecycle,
      createdAtMs,
      updatedAtMs,
    },
    activity: activityResult.record,
  };
}
