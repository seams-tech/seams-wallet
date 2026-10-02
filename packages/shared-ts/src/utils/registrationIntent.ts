import { alphabetizeStringify, sha256BytesUtf8 } from './digests';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWebAuthnRpId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
} from './domainIds';
import { base64UrlEncode } from './base64';
import {
  type AddAuthMethodInput,
  inspectRawObject,
  normalizeAddAuthMethodInput,
  type RegistrationAuthMethodInput,
  trimString,
} from './registrationAuthMethodInput';
import {
  type AddSignerSelection,
  normalizeAddSignerSelection,
  type RegistrationSignerSetSelection,
  type ThresholdEcdsaAddSignerChainTarget,
} from './registrationSignerPlan';

export type { WalletId, WebAuthnRpId } from './domainIds';
export type { ImplicitNearAccountId, NamedNearAccountId, NearAccountId } from './near';

export type RegistrationIntentGrant = string & {
  readonly __registrationIntentGrantBrand: unique symbol;
};

export type AddAuthMethodIntentGrant = string & {
  readonly __addAuthMethodIntentGrantBrand: unique symbol;
};

export type AddSignerIntentGrant = string & {
  readonly __addSignerIntentGrantBrand: unique symbol;
};

export type RuntimePolicyScopeLike = {
  orgId: string;
  projectId: string;
  envId: string;
  signingRootVersion?: string;
};

export type RegistrationIntentV1 = {
  version: 'registration_intent_v1';
  walletId: WalletId;
  authMethod: RegistrationAuthMethodInput;
  signerSelection: RegistrationSignerSetSelection;
  /**
   * The wallet's first auth method, allocated with the intent.
   *
   * It has to exist before the custody ceremony runs, because every envelope
   * the ceremony seals names the method that owns it inside its AAD. Allocated
   * at finalize — where the record is written — it would be a name the seal
   * could not have used, and the wallet would register with an envelope owned
   * by nobody.
   *
   * Server-allocated and part of the intent digest, so a client can neither
   * choose it nor swap it between the seal and the commit.
   */
  foundingWalletAuthMethodId: WalletAuthMethodId;
  runtimePolicyScope?: RuntimePolicyScopeLike;
  nonceB64u: string;
};

export type AddSignerIntentV1 = {
  version: 'add_signer_intent_v1';
  walletId: WalletId;
  signerSelection: AddSignerSelection;
  runtimePolicyScope?: RuntimePolicyScopeLike;
  nonceB64u: string;
};

/**
 * Who is starting the ceremony, and therefore what the source has to present.
 *
 * One endpoint serves two operations. A same-device addition requires a fresh
 * operation-specific source proof; a linked-device ceremony start deliberately
 * does not, because Device 1's owner Wallet Session is the authority and
 * Device 2 holds the factor. Without this discriminator the endpoint could not
 * tell them apart, so the weaker requirement applied to both and a same-device
 * addition could be authorized by a reusable bearer credential.
 *
 * The branch lives on the intent rather than the start request because the
 * intent is what the source proof signs: a caller cannot present a fresh proof
 * over a same-device intent and then start a linked-device ceremony with it.
 */
export type AddAuthMethodIntentSourceV1 = {
  readonly walletAuthorityId: WalletAuthorityId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly walletSessionId: string;
  readonly authorityDigestB64u: string;
  readonly revocationEpoch: number;
};

type AddAuthMethodIntentCommonV1 = {
  version: 'add_auth_method_intent_v1';
  walletId: WalletId;
  authMethod: AddAuthMethodInput;
  /**
   * Allocated by the server when the intent is minted, not when the ceremony
   * starts.
   *
   * A source proof has to name the method it is authorizing the creation of.
   * While this was allocated in `start` — after the source had already been
   * authenticated — no proof could bind it, and one authorization could have
   * been replayed against a different target.
   */
  targetWalletAuthMethodId: WalletAuthMethodId;
  runtimePolicyScope?: RuntimePolicyScopeLike;
  nonceB64u: string;
};

export type AddAuthMethodIntentV1 = AddAuthMethodIntentCommonV1 &
  (
    | {
        readonly caller: 'same_device_addition';
        readonly source: AddAuthMethodIntentSourceV1;
      }
    | {
        readonly caller: 'linked_device_ceremony';
        readonly source?: never;
      }
  );

export function registrationIntentGrantFromString(value: string): RegistrationIntentGrant {
  return String(value || '').trim() as RegistrationIntentGrant;
}

export function addAuthMethodIntentGrantFromString(value: string): AddAuthMethodIntentGrant {
  return String(value || '').trim() as AddAuthMethodIntentGrant;
}

export function addSignerIntentGrantFromString(value: string): AddSignerIntentGrant {
  return String(value || '').trim() as AddSignerIntentGrant;
}

export async function computeRegistrationIntentDigestB64u(
  intent: RegistrationIntentV1,
): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(alphabetizeStringify(intent)));
}

export async function computeAddSignerIntentDigestB64u(intent: AddSignerIntentV1): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(alphabetizeStringify(intent)));
}

export async function computeAddAuthMethodIntentDigestB64u(
  intent: AddAuthMethodIntentV1,
): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(alphabetizeStringify(intent)));
}

/**
 * Parses the caller branch once, at the boundary. Core code below this receives
 * a branch whose identities are branded and complete, never a partially filled
 * source it has to re-check.
 */
export type AddAuthMethodIntentCallerV1 =
  | { readonly caller: 'same_device_addition'; readonly source: AddAuthMethodIntentSourceV1 }
  | { readonly caller: 'linked_device_ceremony' };

export function normalizeAddAuthMethodIntentCaller(
  raw: unknown,
): AddAuthMethodIntentCallerV1 | null {
  const record = inspectRawObject(raw);
  if (!record || !('caller' in record)) return null;
  const caller = trimString(record.caller);
  if (caller === 'linked_device_ceremony') {
    if (Object.prototype.hasOwnProperty.call(record, 'source')) return null;
    return { caller: 'linked_device_ceremony' };
  }
  if (caller !== 'same_device_addition') return null;
  const source = inspectRawObject('source' in record ? record.source : undefined);
  if (!source) return null;
  const walletAuthorityId = parseWalletAuthorityId(
    'walletAuthorityId' in source ? source.walletAuthorityId : undefined,
  );
  const walletAuthMethodId = parseWalletAuthMethodId(
    'walletAuthMethodId' in source ? source.walletAuthMethodId : undefined,
  );
  const walletSessionId = trimString(
    'walletSessionId' in source ? source.walletSessionId : undefined,
  );
  const authorityDigestB64u = trimString(
    'authorityDigestB64u' in source ? source.authorityDigestB64u : undefined,
  );
  const revocationEpoch = 'revocationEpoch' in source ? source.revocationEpoch : undefined;
  if (
    !walletAuthorityId.ok ||
    !walletAuthMethodId.ok ||
    !walletSessionId ||
    !authorityDigestB64u ||
    typeof revocationEpoch !== 'number' ||
    !Number.isSafeInteger(revocationEpoch) ||
    revocationEpoch < 0
  ) {
    return null;
  }
  return {
    caller: 'same_device_addition',
    source: {
      walletAuthorityId: walletAuthorityId.value,
      walletAuthMethodId: walletAuthMethodId.value,
      walletSessionId,
      authorityDigestB64u,
      revocationEpoch,
    },
  };
}

/** True when the two source claims name the same session on the same authority. */
function sameAddAuthMethodIntentSourceV1(
  left: AddAuthMethodIntentSourceV1,
  right: AddAuthMethodIntentSourceV1,
): boolean {
  return (
    left.walletAuthorityId === right.walletAuthorityId &&
    left.walletAuthMethodId === right.walletAuthMethodId &&
    left.walletSessionId === right.walletSessionId &&
    left.authorityDigestB64u === right.authorityDigestB64u &&
    left.revocationEpoch === right.revocationEpoch
  );
}

function exactRegistrationIntentObject(
  raw: unknown,
  label: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): object {
  const record = inspectRawObject(raw);
  if (!record) throw new Error(label + ' must be an object');
  const allowedFields = new Set([...requiredFields, ...optionalFields]);
  const actualFields = Object.keys(record);
  if (actualFields.length < requiredFields.length || actualFields.length > allowedFields.size) {
    throw new Error(label + ' has invalid fields');
  }
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(label + '.' + field + ' is required');
    }
  }
  for (const field of actualFields) {
    if (!allowedFields.has(field)) throw new Error(label + ' has invalid fields');
  }
  return record;
}

function readRegistrationIntentField(record: object, field: string, label: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    throw new Error(label + '.' + field + ' is required');
  }
  return Reflect.get(record, field);
}

function hasRegistrationIntentField(record: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function readRegistrationIntentString(record: object, field: string, label: string): string {
  const value = readRegistrationIntentField(record, field, label);
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(label + '.' + field + ' must be a non-empty canonical string');
  }
  return value;
}

function readRegistrationIntentSafeInteger(
  record: object,
  field: string,
  label: string,
  minimum: number,
): number {
  const value = readRegistrationIntentField(record, field, label);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(label + '.' + field + ' must be a safe integer');
  }
  return value;
}

function parseRegistrationIntentArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(label + ' must be an array');
  return value;
}

function readRegistrationIntentParticipantIds(
  record: object,
  field: string,
  label: string,
): number[] {
  const values = parseRegistrationIntentArray(
    readRegistrationIntentField(record, field, label),
    label + '.' + field,
  );
  if (values.length === 0) throw new Error(label + '.' + field + ' must not be empty');
  const participantIds: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(label + '.' + field + '[' + index + '] must be a positive safe integer');
    }
    participantIds.push(value);
  }
  return participantIds;
}

function readOptionalRegistrationIntentString(
  record: object,
  field: string,
  label: string,
): string | undefined {
  return hasRegistrationIntentField(record, field)
    ? readRegistrationIntentString(record, field, label)
    : undefined;
}

function parseAddSignerIntentChainTargetV1(
  raw: unknown,
  label = 'addSignerIntent.signerSelection.ecdsa.chainTarget',
): ThresholdEcdsaAddSignerChainTarget | null {
  try {
    const target = exactRegistrationIntentObject(
      raw,
      label,
      ['kind'],
      ['namespace', 'chainId', 'networkSlug'],
    );
    const kind = readRegistrationIntentString(target, 'kind', label);
    switch (kind) {
      case 'evm': {
        const evm = exactRegistrationIntentObject(
          target,
          label,
          ['kind', 'namespace', 'chainId'],
          ['networkSlug'],
        );
        if (readRegistrationIntentString(evm, 'namespace', label) !== 'eip155') return null;
        const chainId = readRegistrationIntentSafeInteger(evm, 'chainId', label, 1);
        const networkSlug = readOptionalRegistrationIntentString(evm, 'networkSlug', label);
        return networkSlug === undefined
          ? { kind: 'evm', namespace: 'eip155', chainId }
          : { kind: 'evm', namespace: 'eip155', chainId, networkSlug };
      }
      case 'tempo': {
        const tempo = exactRegistrationIntentObject(
          target,
          label,
          ['kind', 'chainId'],
          ['networkSlug'],
        );
        const chainId = readRegistrationIntentSafeInteger(tempo, 'chainId', label, 1);
        const networkSlug = readOptionalRegistrationIntentString(tempo, 'networkSlug', label);
        return networkSlug === undefined
          ? { kind: 'tempo', chainId }
          : { kind: 'tempo', chainId, networkSlug };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function parseAddSignerIntentSelectionV1(raw: unknown): AddSignerSelection {
  const label = 'addSignerIntent.signerSelection';
  const selection = exactRegistrationIntentObject(raw, label, ['mode'], ['ed25519', 'ecdsa']);
  const mode = readRegistrationIntentString(selection, 'mode', label);
  switch (mode) {
    case 'ed25519': {
      const branch = exactRegistrationIntentObject(selection, label, ['mode', 'ed25519']);
      const ed25519 = exactRegistrationIntentObject(
        readRegistrationIntentField(branch, 'ed25519', label),
        label + '.ed25519',
        ['mode', 'signerSlot', 'participantIds', 'keyPurpose', 'keyVersion', 'derivationVersion'],
      );
      if (
        readRegistrationIntentString(ed25519, 'mode', label + '.ed25519') !==
        'create_implicit_near_account'
      ) {
        throw new Error(label + '.ed25519.mode is unsupported');
      }
      readRegistrationIntentSafeInteger(ed25519, 'signerSlot', label + '.ed25519', 1);
      readRegistrationIntentParticipantIds(ed25519, 'participantIds', label + '.ed25519');
      readRegistrationIntentString(ed25519, 'keyPurpose', label + '.ed25519');
      readRegistrationIntentString(ed25519, 'keyVersion', label + '.ed25519');
      readRegistrationIntentSafeInteger(ed25519, 'derivationVersion', label + '.ed25519', 1);
      break;
    }
    case 'ecdsa': {
      const branch = exactRegistrationIntentObject(selection, label, ['mode', 'ecdsa']);
      const ecdsa = exactRegistrationIntentObject(
        readRegistrationIntentField(branch, 'ecdsa', label),
        label + '.ecdsa',
        ['chainTargets', 'participantIds'],
      );
      const chainTargets = parseRegistrationIntentArray(
        readRegistrationIntentField(ecdsa, 'chainTargets', label + '.ecdsa'),
        label + '.ecdsa.chainTargets',
      );
      if (chainTargets.length === 0) {
        throw new Error(label + '.ecdsa.chainTargets must not be empty');
      }
      for (const chainTarget of chainTargets) {
        if (!parseAddSignerIntentChainTargetV1(chainTarget)) {
          throw new Error(label + '.ecdsa.chainTargets contains an invalid target');
        }
      }
      readRegistrationIntentParticipantIds(ecdsa, 'participantIds', label + '.ecdsa');
      break;
    }
    default:
      throw new Error(label + '.mode is unsupported');
  }
  const normalized = normalizeAddSignerSelection(raw, {
    normalizeEcdsaChainTarget: parseAddSignerIntentChainTargetV1,
  });
  if (!normalized.ok) throw new Error(normalized.message);
  return normalized.value;
}

function parseAddAuthMethodInputV1(raw: unknown): AddAuthMethodInput {
  const label = 'addAuthMethodIntent.authMethod';
  const authMethod = exactRegistrationIntentObject(raw, label, ['kind'], ['rpId', 'email']);
  const kind = readRegistrationIntentString(authMethod, 'kind', label);
  switch (kind) {
    case 'passkey': {
      const passkey = exactRegistrationIntentObject(authMethod, label, ['kind', 'rpId']);
      const rpId = parseWebAuthnRpId(readRegistrationIntentString(passkey, 'rpId', label));
      if (!rpId.ok) throw new Error(rpId.error.message);
      break;
    }
    case 'email_otp': {
      const emailOtp = exactRegistrationIntentObject(authMethod, label, ['kind', 'email']);
      readRegistrationIntentString(emailOtp, 'email', label);
      break;
    }
    default:
      throw new Error(label + '.kind is unsupported');
  }
  const normalized = normalizeAddAuthMethodInput(raw);
  if (!normalized) throw new Error(label + ' is invalid');
  return normalized;
}

function validateAddAuthMethodIntentSourceV1(raw: unknown): void {
  const label = 'addAuthMethodIntent.source';
  const source = exactRegistrationIntentObject(raw, label, [
    'walletAuthorityId',
    'walletAuthMethodId',
    'walletSessionId',
    'authorityDigestB64u',
    'revocationEpoch',
  ]);
  const walletAuthorityId = parseWalletAuthorityId(
    readRegistrationIntentString(source, 'walletAuthorityId', label),
  );
  const walletAuthMethodId = parseWalletAuthMethodId(
    readRegistrationIntentString(source, 'walletAuthMethodId', label),
  );
  if (!walletAuthorityId.ok || !walletAuthMethodId.ok) {
    throw new Error(label + ' has invalid identity');
  }
  readRegistrationIntentString(source, 'walletSessionId', label);
  readRegistrationIntentString(source, 'authorityDigestB64u', label);
  readRegistrationIntentSafeInteger(source, 'revocationEpoch', label, 0);
}

function parseRegistrationIntentRuntimePolicyScopeV1(
  record: object,
  label: string,
): RuntimePolicyScopeLike | undefined {
  if (!hasRegistrationIntentField(record, 'runtimePolicyScope')) return undefined;
  const scopeLabel = label + '.runtimePolicyScope';
  const scope = exactRegistrationIntentObject(
    readRegistrationIntentField(record, 'runtimePolicyScope', label),
    scopeLabel,
    ['orgId', 'projectId', 'envId'],
    ['signingRootVersion'],
  );
  const orgId = readRegistrationIntentString(scope, 'orgId', scopeLabel);
  const projectId = readRegistrationIntentString(scope, 'projectId', scopeLabel);
  const envId = readRegistrationIntentString(scope, 'envId', scopeLabel);
  const signingRootVersion = readOptionalRegistrationIntentString(
    scope,
    'signingRootVersion',
    scopeLabel,
  );
  return signingRootVersion === undefined
    ? { orgId, projectId, envId }
    : { orgId, projectId, envId, signingRootVersion };
}

function readRegistrationIntentWalletId(record: object, label: string): WalletId {
  const result = parseWalletId(readRegistrationIntentString(record, 'walletId', label));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function readRegistrationIntentAuthMethodId(
  record: object,
  field: string,
  label: string,
): WalletAuthMethodId {
  const result = parseWalletAuthMethodId(readRegistrationIntentString(record, field, label));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function parseAddSignerIntentV1(raw: unknown): AddSignerIntentV1 {
  const label = 'addSignerIntent';
  const intent = exactRegistrationIntentObject(
    raw,
    label,
    ['version', 'walletId', 'signerSelection', 'nonceB64u'],
    ['runtimePolicyScope'],
  );
  if (readRegistrationIntentString(intent, 'version', label) !== 'add_signer_intent_v1') {
    throw new Error(label + '.version is unsupported');
  }
  const walletId = readRegistrationIntentWalletId(intent, label);
  const runtimePolicyScope = parseRegistrationIntentRuntimePolicyScopeV1(intent, label);
  const nonceB64u = readRegistrationIntentString(intent, 'nonceB64u', label);
  const signerSelection = parseAddSignerIntentSelectionV1(
    readRegistrationIntentField(intent, 'signerSelection', label),
  );
  return runtimePolicyScope === undefined
    ? { version: 'add_signer_intent_v1', walletId, signerSelection, nonceB64u }
    : {
        version: 'add_signer_intent_v1',
        walletId,
        signerSelection,
        runtimePolicyScope,
        nonceB64u,
      };
}

export function parseAddAuthMethodIntentV1(raw: unknown): AddAuthMethodIntentV1 {
  const label = 'addAuthMethodIntent';
  const intent = exactRegistrationIntentObject(
    raw,
    label,
    ['version', 'walletId', 'authMethod', 'targetWalletAuthMethodId', 'caller', 'nonceB64u'],
    ['runtimePolicyScope', 'source'],
  );
  if (readRegistrationIntentString(intent, 'version', label) !== 'add_auth_method_intent_v1') {
    throw new Error(label + '.version is unsupported');
  }
  const walletId = readRegistrationIntentWalletId(intent, label);
  const targetWalletAuthMethodId = readRegistrationIntentAuthMethodId(
    intent,
    'targetWalletAuthMethodId',
    label,
  );
  const authMethod = parseAddAuthMethodInputV1(
    readRegistrationIntentField(intent, 'authMethod', label),
  );
  const runtimePolicyScope = parseRegistrationIntentRuntimePolicyScopeV1(intent, label);
  const nonceB64u = readRegistrationIntentString(intent, 'nonceB64u', label);
  const caller = readRegistrationIntentString(intent, 'caller', label);
  switch (caller) {
    case 'same_device_addition':
      validateAddAuthMethodIntentSourceV1(readRegistrationIntentField(intent, 'source', label));
      break;
    case 'linked_device_ceremony':
      if (hasRegistrationIntentField(intent, 'source')) {
        throw new Error(label + '.source is not valid for linked_device_ceremony');
      }
      break;
    default:
      throw new Error(label + '.caller is unsupported');
  }
  const parsedCaller = normalizeAddAuthMethodIntentCaller(intent);
  if (!parsedCaller) throw new Error(label + '.caller is invalid');
  const common =
    runtimePolicyScope === undefined
      ? {
          version: 'add_auth_method_intent_v1' as const,
          walletId,
          authMethod,
          targetWalletAuthMethodId,
          nonceB64u,
        }
      : {
          version: 'add_auth_method_intent_v1' as const,
          walletId,
          authMethod,
          targetWalletAuthMethodId,
          runtimePolicyScope,
          nonceB64u,
        };
  switch (parsedCaller.caller) {
    case 'same_device_addition':
      return { ...common, caller: parsedCaller.caller, source: parsedCaller.source };
    case 'linked_device_ceremony':
      return { ...common, caller: parsedCaller.caller };
    default:
      return assertNeverAddAuthMethodIntentCaller(parsedCaller);
  }
}

function assertNeverAddAuthMethodIntentCaller(value: never): never {
  throw new Error(`Unsupported add-auth-method intent caller: ${String(value)}`);
}

function sameRegistrationIntentNumberArray(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isSafeInteger(left[index]) || left[index] !== right[index]) return false;
  }
  return true;
}

function sameAddSignerIntentChainTargetV1(
  left: ThresholdEcdsaAddSignerChainTarget,
  right: ThresholdEcdsaAddSignerChainTarget,
): boolean {
  switch (left.kind) {
    case 'evm':
      return (
        right.kind === 'evm' &&
        left.namespace === right.namespace &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    case 'tempo':
      return (
        right.kind === 'tempo' &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    default:
      return assertNeverThresholdEcdsaAddSignerChainTarget(left);
  }
}

function assertNeverThresholdEcdsaAddSignerChainTarget(
  value: never,
): never {
  throw new Error(`Unsupported add-signer chain target: ${String(value)}`);
}

function sameAddSignerSelectionV1(left: AddSignerSelection, right: AddSignerSelection): boolean {
  if (left.mode !== right.mode) return false;
  switch (left.mode) {
    case 'ed25519':
      return (
        right.mode === 'ed25519' &&
        left.ed25519.mode === right.ed25519.mode &&
        left.ed25519.signerSlot === right.ed25519.signerSlot &&
        sameRegistrationIntentNumberArray(
          left.ed25519.participantIds,
          right.ed25519.participantIds,
        ) &&
        left.ed25519.keyPurpose === right.ed25519.keyPurpose &&
        left.ed25519.keyVersion === right.ed25519.keyVersion &&
        left.ed25519.derivationVersion === right.ed25519.derivationVersion
      );
    case 'ecdsa': {
      if (
        right.mode !== 'ecdsa' ||
        left.ecdsa.chainTargets.length !== right.ecdsa.chainTargets.length
      ) {
        return false;
      }
      for (let index = 0; index < left.ecdsa.chainTargets.length; index += 1) {
        if (
          !sameAddSignerIntentChainTargetV1(
            left.ecdsa.chainTargets[index],
            right.ecdsa.chainTargets[index],
          )
        ) {
          return false;
        }
      }
      return sameRegistrationIntentNumberArray(
        left.ecdsa.participantIds,
        right.ecdsa.participantIds,
      );
    }
    default:
      return assertNeverAddSignerSelection(left);
  }
}

function assertNeverAddSignerSelection(value: never): never {
  throw new Error(`Unsupported add-signer selection: ${String(value)}`);
}

function sameRegistrationIntentRuntimePolicyScope(
  left: RuntimePolicyScopeLike | undefined,
  right: RuntimePolicyScopeLike | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.orgId === right.orgId &&
    left.projectId === right.projectId &&
    left.envId === right.envId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

export function sameAddSignerIntentV1(left: AddSignerIntentV1, right: AddSignerIntentV1): boolean {
  return (
    left.version === right.version &&
    left.walletId === right.walletId &&
    sameAddSignerSelectionV1(left.signerSelection, right.signerSelection) &&
    sameRegistrationIntentRuntimePolicyScope(left.runtimePolicyScope, right.runtimePolicyScope) &&
    left.nonceB64u === right.nonceB64u
  );
}

function sameAddAuthMethodInputV1(left: AddAuthMethodInput, right: AddAuthMethodInput): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'passkey':
      return right.kind === 'passkey' && left.rpId === right.rpId;
    case 'email_otp':
      return right.kind === 'email_otp' && left.email === right.email;
    default:
      return assertNeverAddAuthMethodInput(left);
  }
}

function assertNeverAddAuthMethodInput(value: never): never {
  throw new Error(`Unsupported add-auth-method input: ${String(value)}`);
}

export function sameAddAuthMethodIntentV1(
  left: AddAuthMethodIntentV1,
  right: AddAuthMethodIntentV1,
): boolean {
  if (
    left.version !== right.version ||
    left.walletId !== right.walletId ||
    !sameAddAuthMethodInputV1(left.authMethod, right.authMethod) ||
    left.targetWalletAuthMethodId !== right.targetWalletAuthMethodId ||
    !sameRegistrationIntentRuntimePolicyScope(left.runtimePolicyScope, right.runtimePolicyScope) ||
    left.nonceB64u !== right.nonceB64u
  ) {
    return false;
  }
  switch (left.caller) {
    case 'same_device_addition':
      return (
        right.caller === 'same_device_addition' &&
        sameAddAuthMethodIntentSourceV1(left.source, right.source)
      );
    case 'linked_device_ceremony':
      return right.caller === 'linked_device_ceremony';
    default:
      return assertNeverAddAuthMethodIntent(left);
  }
}

function assertNeverAddAuthMethodIntent(value: never): never {
  throw new Error(`Unsupported add-auth-method intent: ${String(value)}`);
}
