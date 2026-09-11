import type { DomainId, OrgId } from '../utils/domainIds';
import type {
  SigningRootId,
  SigningRootVersion,
} from '../threshold/ecdsaDerivationRoleLocalBootstrap';

const TENANT_ROOT_IDENTITY_DOMAIN_V1 = new TextEncoder().encode('seams/tenant-root-identity/v1');
const TENANT_ROOT_IDENTITY_MAX_IDENTIFIER_BYTES_V1 = 256;

export type TenantRootIdentityFieldV1 =
  | 'orgId'
  | 'projectId'
  | 'envId'
  | 'signingRootId'
  | 'signingRootVersion';

// OrgId and the signing-root brands already carry the same domain meaning.
// Project and environment identifiers have no existing shared brands.
export type TenantRootOrganizationIdV1 = OrgId;
export type TenantRootProjectIdV1 = DomainId<'TenantRootProjectIdV1'>;
export type TenantRootEnvironmentIdV1 = DomainId<'TenantRootEnvironmentIdV1'>;
export type TenantRootSigningRootIdV1 = SigningRootId;
export type TenantRootSigningRootVersionV1 = SigningRootVersion;

export type TenantRootIdentityFieldValueV1<F extends TenantRootIdentityFieldV1> =
  F extends 'orgId'
    ? TenantRootOrganizationIdV1
    : F extends 'projectId'
      ? TenantRootProjectIdV1
      : F extends 'envId'
        ? TenantRootEnvironmentIdV1
        : F extends 'signingRootId'
          ? TenantRootSigningRootIdV1
          : TenantRootSigningRootVersionV1;

export type TenantRootIdentityWireV1 = {
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly signingRootId: string;
  readonly signingRootVersion: string;
};

export type TenantRootIdentityDecodeErrorV1 =
  | { readonly kind: 'invalid_object' }
  | { readonly kind: 'missing_field'; readonly field: TenantRootIdentityFieldV1 }
  | { readonly kind: 'unexpected_field'; readonly field: string }
  | { readonly kind: 'invalid_field'; readonly field: TenantRootIdentityFieldV1 };

export type TenantRootIdentityDecodeResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TenantRootIdentityDecodeErrorV1 };

type TenantRootIdentityFieldsV1 = {
  readonly orgId: TenantRootOrganizationIdV1;
  readonly projectId: TenantRootProjectIdV1;
  readonly envId: TenantRootEnvironmentIdV1;
  readonly signingRootId: TenantRootSigningRootIdV1;
  readonly signingRootVersion: TenantRootSigningRootVersionV1;
};

/**
 * The identity proof is only emitted by the authenticated builder or exact
 * wire decoder. Its private method makes raw object literals structurally
 * incompatible with the trusted identity.
 */
class TenantRootIdentityProof {
  readonly orgId: TenantRootOrganizationIdV1;
  readonly projectId: TenantRootProjectIdV1;
  readonly envId: TenantRootEnvironmentIdV1;
  readonly signingRootId: TenantRootSigningRootIdV1;
  readonly signingRootVersion: TenantRootSigningRootVersionV1;

  private retainProof(): true {
    return true;
  }

  private constructor(fields: TenantRootIdentityFieldsV1) {
    void this.retainProof();
    this.orgId = fields.orgId;
    this.projectId = fields.projectId;
    this.envId = fields.envId;
    this.signingRootId = fields.signingRootId;
    this.signingRootVersion = fields.signingRootVersion;
    Object.freeze(this);
  }

  static create(fields: TenantRootIdentityFieldsV1): TenantRootIdentityProof {
    return new TenantRootIdentityProof(fields);
  }
}

/** Canonical server-resolved identity for one logical tenant derivation root. */
export type TenantRootIdentityV1 = TenantRootIdentityProof;

const TENANT_ROOT_IDENTITY_FIELDS_V1 = [
  'orgId',
  'projectId',
  'envId',
  'signingRootId',
  'signingRootVersion',
] as const satisfies readonly TenantRootIdentityFieldV1[];

const TENANT_ROOT_IDENTITY_FIELD_SET_V1: ReadonlySet<string> = new Set(
  TENANT_ROOT_IDENTITY_FIELDS_V1,
);

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function isRustWhitespace(codePoint: number): boolean {
  return (
    (codePoint >= 0x09 && codePoint <= 0x0d) ||
    codePoint === 0x20 ||
    codePoint === 0x85 ||
    codePoint === 0xa0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

function hasLeadingOrTrailingRustWhitespace(value: string): boolean {
  const codePoints = Array.from(value, (character) => character.codePointAt(0) ?? 0);
  return (
    codePoints.length > 0 &&
    (isRustWhitespace(codePoints[0]!) || isRustWhitespace(codePoints[codePoints.length - 1]!))
  );
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

function isCanonicalTenantRootIdentityField(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (hasLeadingOrTrailingRustWhitespace(value) || hasControlCharacters(value)) return false;
  if (hasUnpairedSurrogate(value)) return false;
  return new TextEncoder().encode(value).length <= TENANT_ROOT_IDENTITY_MAX_IDENTIFIER_BYTES_V1;
}

/** Checks one already-resolved field without normalizing it. */
export function isTenantRootIdentityFieldCanonicalV1(
  field: TenantRootIdentityFieldV1,
  value: unknown,
): value is string {
  void field;
  return isCanonicalTenantRootIdentityField(value);
}

function brandTenantRootIdentityField<F extends TenantRootIdentityFieldV1>(
  field: F,
  value: string,
): TenantRootIdentityFieldValueV1<F> {
  // This is the sole raw-to-branded conversion, after the exact boundary
  // validator above has accepted the value.
  switch (field) {
    case 'orgId':
      return value as TenantRootIdentityFieldValueV1<F>;
    case 'projectId':
      return value as TenantRootIdentityFieldValueV1<F>;
    case 'envId':
      return value as TenantRootIdentityFieldValueV1<F>;
    case 'signingRootId':
      return value as TenantRootIdentityFieldValueV1<F>;
    case 'signingRootVersion':
      return value as TenantRootIdentityFieldValueV1<F>;
  }
}

function invalidField(
  field: TenantRootIdentityFieldV1,
): TenantRootIdentityDecodeResultV1<never> {
  return { ok: false, error: { kind: 'invalid_field', field } };
}

function readIdentityFields(
  value: unknown,
): TenantRootIdentityDecodeResultV1<TenantRootIdentityFieldsV1> {
  if (value instanceof TenantRootIdentityProof) {
    return {
      ok: true,
      value: {
        orgId: value.orgId,
        projectId: value.projectId,
        envId: value.envId,
        signingRootId: value.signingRootId,
        signingRootVersion: value.signingRootVersion,
      },
    };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: { kind: 'invalid_object' } };
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, error: { kind: 'invalid_object' } };
  }
  const record = value as Readonly<Record<string, unknown>>;
  for (const field of TENANT_ROOT_IDENTITY_FIELDS_V1) {
    if (!Object.hasOwn(record, field)) {
      return { ok: false, error: { kind: 'missing_field', field } };
    }
  }
  for (const field of Object.keys(record)) {
    if (!TENANT_ROOT_IDENTITY_FIELD_SET_V1.has(field)) {
      return { ok: false, error: { kind: 'unexpected_field', field } };
    }
  }

  if (!isCanonicalTenantRootIdentityField(record.orgId)) return invalidField('orgId');
  if (!isCanonicalTenantRootIdentityField(record.projectId)) return invalidField('projectId');
  if (!isCanonicalTenantRootIdentityField(record.envId)) return invalidField('envId');
  if (!isCanonicalTenantRootIdentityField(record.signingRootId)) {
    return invalidField('signingRootId');
  }
  if (!isCanonicalTenantRootIdentityField(record.signingRootVersion)) {
    return invalidField('signingRootVersion');
  }
  return {
    ok: true,
    value: {
      orgId: brandTenantRootIdentityField('orgId', record.orgId),
      projectId: brandTenantRootIdentityField('projectId', record.projectId),
      envId: brandTenantRootIdentityField('envId', record.envId),
      signingRootId: brandTenantRootIdentityField('signingRootId', record.signingRootId),
      signingRootVersion: brandTenantRootIdentityField(
        'signingRootVersion',
        record.signingRootVersion,
      ),
    },
  };
}

/**
 * Builds the nominal identity after an authenticated deployment resolver has
 * supplied the complete, already-selected five-field scope.
 */
export function buildTenantRootIdentityFromAuthenticatedDeploymentV1(
  input: TenantRootIdentityWireV1,
): TenantRootIdentityDecodeResultV1<TenantRootIdentityV1> {
  const fields = readIdentityFields(input);
  if (!fields.ok) return fields;
  return { ok: true, value: TenantRootIdentityProof.create(fields.value) };
}

/** Decodes the exact private wire/persistence representation of the identity. */
export function decodeTenantRootIdentityWireV1(
  value: unknown,
): TenantRootIdentityDecodeResultV1<TenantRootIdentityV1> {
  const fields = readIdentityFields(value);
  if (!fields.ok) return fields;
  return { ok: true, value: TenantRootIdentityProof.create(fields.value) };
}

function lengthPrefixTenantRootIdentityField(value: Uint8Array): Uint8Array {
  const output = new Uint8Array(4 + value.length);
  new DataView(output.buffer).setUint32(0, value.length, false);
  output.set(value, 4);
  return output;
}

function tenantRootIdentityFieldBytes(value: string, label: string): Uint8Array {
  if (!isCanonicalTenantRootIdentityField(value)) {
    throw new Error(`${label} is invalid`);
  }
  return new TextEncoder().encode(value);
}

/** Encodes the exact Rust-compatible canonical identity bytes. */
export function encodeTenantRootIdentityV1(identity: TenantRootIdentityV1): Uint8Array {
  const encodedFields = [
    tenantRootIdentityFieldBytes(identity.orgId, 'identity.orgId'),
    tenantRootIdentityFieldBytes(identity.projectId, 'identity.projectId'),
    tenantRootIdentityFieldBytes(identity.envId, 'identity.envId'),
    tenantRootIdentityFieldBytes(identity.signingRootId, 'identity.signingRootId'),
    tenantRootIdentityFieldBytes(identity.signingRootVersion, 'identity.signingRootVersion'),
  ];
  const canonicalFields: Uint8Array[] = [];
  for (const field of encodedFields) {
    canonicalFields.push(lengthPrefixTenantRootIdentityField(field));
  }
  return concatenateBytes([TENANT_ROOT_IDENTITY_DOMAIN_V1, ...canonicalFields]);
}
