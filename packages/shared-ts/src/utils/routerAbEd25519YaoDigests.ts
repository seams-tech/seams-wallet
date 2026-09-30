// The Ed25519 Yao protocol's domain-separated digests, and the byte encoding and checks they
// share with the protocol's parsers.
import type { RouterAbEd25519YaoBytes32V1 } from './generated/routerAbEd25519YaoCore';
import type {
  RouterAbEd25519YaoApplicationBindingFactsV1,
  RouterAbEd25519YaoExportAuthorizationIdentityV1,
} from './routerAbEd25519Yao';
import type { ReadonlyExclusiveUnion } from './variant';

type RouterAbEd25519YaoExportAuthorityBindingV1 = ReadonlyExclusiveUnion<
  | { readonly kind: 'passkey'; readonly credentialIdB64u: string }
  | { readonly kind: 'email_otp'; readonly providerSubjectId: string }
>;

const APPLICATION_BINDING_DOMAIN = 'seams/router-ab/ed25519-yao/application-binding/v1';
const STABLE_KEY_CONTEXT_DOMAIN = 'seams/router-ab/ed25519-yao/stable-key-context/v1';
const STABLE_KEY_CONTEXT_BINDING_DOMAIN =
  'seams/router-ab/ed25519-yao/stable-key-context-binding/v1';
const EXPORT_CONFIRMATION_DOMAIN = 'seams/router-ab/ed25519-yao/export-confirmation/v1';
const EXPORT_AUTHORIZATION_DOMAIN = 'seams/router-ab/ed25519-yao/export-authorization/v1';
const RUNTIME_POLICY_BINDING_DOMAIN = 'seams/router-ab/runtime-policy-binding/v1';
const UTF8 = new TextEncoder();

export function requireVisibleIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty visible ASCII string`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) {
      throw new Error(`${label} must contain visible ASCII bytes`);
    }
  }
  return value;
}

function requireByte(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be a byte`);
  }
  return value;
}

export function requireBytes(
  value: unknown,
  label: string,
  minimumLength: number,
  maximumLength: number,
): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a byte array`);
  if (value.length < minimumLength || value.length > maximumLength) {
    throw new Error(`${label} has an invalid length`);
  }
  const parsed: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    parsed.push(requireByte(value[index], `${label}[${index}]`));
  }
  return parsed;
}

export function requireBytes32(value: unknown, label: string, nonzero: boolean): number[] {
  const parsed = requireBytes(value, label, 32, 32);
  if (nonzero && isZeroBytes(parsed)) throw new Error(`${label} must be nonzero`);
  return parsed;
}

function isZeroBytes(value: readonly number[]): boolean {
  for (const byte of value) {
    if (byte !== 0) return false;
  }
  return true;
}

export function equalBytes(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function u32BigEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u16BigEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, false);
  return bytes;
}

function u64BigEndian(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('u64 value must be a positive safe integer');
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function lengthDelimited(value: Uint8Array): Uint8Array {
  return concatenateBytes([u32BigEndian(value.length), value]);
}

function labeledField(label: string, value: Uint8Array): Uint8Array {
  return concatenateBytes([lengthDelimited(UTF8.encode(label)), lengthDelimited(value)]);
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value);
  return new Uint8Array(digest);
}

export async function deriveRouterAbEd25519YaoApplicationBindingDigestV1(
  facts: RouterAbEd25519YaoApplicationBindingFactsV1,
): Promise<number[]> {
  const encoded = concatenateBytes([
    lengthDelimited(UTF8.encode(APPLICATION_BINDING_DOMAIN)),
    labeledField('walletId', UTF8.encode(facts.wallet_id)),
    labeledField('nearEd25519SigningKeyId', UTF8.encode(facts.near_ed25519_signing_key_id)),
    labeledField('signingRootId', UTF8.encode(facts.signing_root_id)),
    labeledField('keyCreationSignerSlot', u32BigEndian(facts.key_creation_signer_slot)),
  ]);
  return Array.from(await sha256(encoded));
}

export async function deriveRouterAbEd25519YaoStableContextBindingV1(
  applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1,
  participantIds: readonly [number, number],
): Promise<number[]> {
  const applicationDigest =
    await deriveRouterAbEd25519YaoApplicationBindingDigestV1(applicationBinding);
  const context = concatenateBytes([
    UTF8.encode(STABLE_KEY_CONTEXT_DOMAIN),
    Uint8Array.from(applicationDigest),
    u16BigEndian(participantIds[0]),
    u16BigEndian(participantIds[1]),
  ]);
  return Array.from(
    await sha256(concatenateBytes([UTF8.encode(STABLE_KEY_CONTEXT_BINDING_DOMAIN), context])),
  );
}

export async function deriveRouterAbEd25519YaoRuntimePolicyBindingV1(input: {
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly signingRootVersion: string;
}): Promise<number[]> {
  const encoded = concatenateBytes([
    lengthDelimited(UTF8.encode(RUNTIME_POLICY_BINDING_DOMAIN)),
    labeledField('orgId', UTF8.encode(requireVisibleIdentifier(input.orgId, 'orgId'))),
    labeledField('projectId', UTF8.encode(requireVisibleIdentifier(input.projectId, 'projectId'))),
    labeledField('envId', UTF8.encode(requireVisibleIdentifier(input.envId, 'envId'))),
    labeledField(
      'signingRootVersion',
      UTF8.encode(requireVisibleIdentifier(input.signingRootVersion, 'signingRootVersion')),
    ),
  ]);
  return Array.from(await sha256(encoded));
}

function exportIdentityFields(
  identity: RouterAbEd25519YaoExportAuthorizationIdentityV1,
): Uint8Array[] {
  const scope = identity.scope;
  const application = identity.application_binding;
  return [
    labeledField('lifecycleId', UTF8.encode(scope.lifecycle_id)),
    labeledField('rootShareEpoch', UTF8.encode(scope.root_share_epoch)),
    labeledField('accountId', UTF8.encode(scope.account_id)),
    labeledField('thresholdSessionId', UTF8.encode(scope.threshold_session_id)),
    labeledField('signerSetId', UTF8.encode(scope.signer_set_id)),
    labeledField('signingWorkerId', UTF8.encode(scope.signing_worker_id)),
    labeledField('walletId', UTF8.encode(application.wallet_id)),
    labeledField('nearEd25519SigningKeyId', UTF8.encode(application.near_ed25519_signing_key_id)),
    labeledField('signingRootId', UTF8.encode(application.signing_root_id)),
    labeledField('keyCreationSignerSlot', u32BigEndian(application.key_creation_signer_slot)),
    labeledField('participantA', u16BigEndian(identity.participant_ids[0])),
    labeledField('participantB', u16BigEndian(identity.participant_ids[1])),
    labeledField('registeredPublicKey', Uint8Array.from(identity.registered_public_key)),
    labeledField('stateEpoch', u64BigEndian(identity.state_epoch)),
    labeledField('runtimePolicyBinding', Uint8Array.from(identity.runtime_policy_binding)),
  ];
}

export async function deriveRouterAbEd25519YaoExportConfirmationDigestV1(input: {
  readonly identity: RouterAbEd25519YaoExportAuthorizationIdentityV1;
  readonly nonce: RouterAbEd25519YaoBytes32V1;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}): Promise<number[]> {
  const nonce = requireBytes32(input.nonce, 'export authorization nonce', true);
  if (input.expiresAtMs <= input.issuedAtMs) {
    throw new Error('export authorization expiry must follow issue time');
  }
  const encoded = concatenateBytes([
    lengthDelimited(UTF8.encode(EXPORT_CONFIRMATION_DOMAIN)),
    ...exportIdentityFields(input.identity),
    labeledField('nonce', Uint8Array.from(nonce)),
    labeledField('issuedAtMs', u64BigEndian(input.issuedAtMs)),
    labeledField('expiresAtMs', u64BigEndian(input.expiresAtMs)),
  ]);
  return Array.from(await sha256(encoded));
}

export async function deriveRouterAbEd25519YaoExportAuthorizationDigestV1(input: {
  readonly identity: RouterAbEd25519YaoExportAuthorizationIdentityV1;
  readonly confirmationDigest: RouterAbEd25519YaoBytes32V1;
  readonly nonce: RouterAbEd25519YaoBytes32V1;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly authority: RouterAbEd25519YaoExportAuthorityBindingV1;
}): Promise<number[]> {
  const confirmationDigest = requireBytes32(
    input.confirmationDigest,
    'export confirmation digest',
    true,
  );
  const nonce = requireBytes32(input.nonce, 'export authorization nonce', true);
  const encoded = concatenateBytes([
    lengthDelimited(UTF8.encode(EXPORT_AUTHORIZATION_DOMAIN)),
    ...exportIdentityFields(input.identity),
    labeledField('confirmationDigest', Uint8Array.from(confirmationDigest)),
    labeledField('nonce', Uint8Array.from(nonce)),
    labeledField('issuedAtMs', u64BigEndian(input.issuedAtMs)),
    labeledField('expiresAtMs', u64BigEndian(input.expiresAtMs)),
    labeledField('authorityKind', UTF8.encode(input.authority.kind)),
    labeledField(
      'authoritySubject',
      UTF8.encode(
        input.authority.kind === 'passkey'
          ? requireVisibleIdentifier(input.authority.credentialIdB64u, 'credentialIdB64u')
          : requireVisibleIdentifier(input.authority.providerSubjectId, 'providerSubjectId'),
      ),
    ),
  ]);
  return Array.from(await sha256(encoded));
}
