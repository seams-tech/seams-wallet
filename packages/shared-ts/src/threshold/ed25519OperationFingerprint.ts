import { alphabetizeStringify, sha256BytesUtf8 } from '../utils/digests';
import { base64UrlEncode } from '../utils/base64';
import { coerceNonEmptyString, requireRecord } from '../utils/validation';

type ThresholdEd25519CanonicalScope = {
  nearAccountId: string;
  nearNetworkId: string;
  relayerKeyId: string;
  signerPublicKey: string;
};

type ThresholdEd25519NearTransaction = {
  nearAccountId: string;
  receiverId: string;
  actions: readonly ThresholdEd25519NearAction[];
};

type ThresholdEd25519NearPublicKey = {
  keyType: number;
  keyData: readonly number[];
};

type ThresholdEd25519NearSignature = {
  keyType: number;
  signatureData: readonly number[];
};

type ThresholdEd25519SignedDelegateAction = {
  senderId: string;
  receiverId: string;
  actions: readonly ThresholdEd25519NearAction[];
  nonce: string | number | bigint;
  maxBlockHeight: string | number | bigint;
  publicKey: ThresholdEd25519NearPublicKey;
};

export type ThresholdEd25519NearAction =
  | { action_type: 'CreateAccount' }
  | { action_type: 'DeployContract'; code: readonly number[] }
  | {
      action_type: 'FunctionCall';
      method_name: string;
      args: string;
      gas: string;
      deposit: string;
    }
  | { action_type: 'Transfer'; deposit: string }
  | { action_type: 'Stake'; stake: string; public_key: string }
  | { action_type: 'AddKey'; public_key: string; access_key: string }
  | { action_type: 'DeleteKey'; public_key: string }
  | { action_type: 'DeleteAccount'; beneficiary_id: string }
  | {
      action_type: 'SignedDelegate';
      delegate_action: ThresholdEd25519SignedDelegateAction;
      signature: ThresholdEd25519NearSignature;
    }
  | {
      action_type: 'DeployGlobalContract';
      code: readonly number[];
      deploy_mode: 'CodeHash' | 'AccountId';
    }
  | {
      action_type: 'UseGlobalContract';
      account_id: string;
      code_hash?: never;
    }
  | {
      action_type: 'UseGlobalContract';
      code_hash: string;
      account_id?: never;
    };

type ThresholdEd25519NearTransactionPlanningFingerprintInput = ThresholdEd25519CanonicalScope & {
  transactions: readonly ThresholdEd25519NearTransaction[];
};

type ThresholdEd25519NearTransactionFingerprintInput =
  ThresholdEd25519NearTransactionPlanningFingerprintInput & {
    unsignedTransactionBorshB64u: string;
    signingDigestB64u: string;
  };

type ThresholdEd25519Nep413FingerprintInput = ThresholdEd25519CanonicalScope & {
  message: string;
  recipient: string;
  nonce: string;
  state?: string | null;
};

type ThresholdEd25519DelegateActionFingerprintInput = ThresholdEd25519CanonicalScope & {
  delegate: {
    senderId: string;
    receiverId: string;
    actions: readonly ThresholdEd25519NearAction[];
    nonce: string;
    maxBlockHeight: string;
    publicKey: string;
  };
};

export async function thresholdEd25519NearTransactionPlanningOperationFingerprint(
  input: ThresholdEd25519NearTransactionPlanningFingerprintInput,
): Promise<string> {
  return thresholdEd25519OperationFingerprint({
    kind: 'near:transactions_with_actions:planning',
    payload: {
      purpose: 'near_transaction',
      ...canonicalScope(input),
      transactions: canonicalNearTransactions(input.transactions),
    },
  });
}

export async function thresholdEd25519NearTransactionOperationFingerprint(
  input: ThresholdEd25519NearTransactionFingerprintInput,
): Promise<string> {
  return thresholdEd25519OperationFingerprint({
    kind: 'near:transactions_with_actions',
    payload: {
      purpose: 'near_transaction',
      ...canonicalScope(input),
      transactions: canonicalNearTransactions(input.transactions),
      unsignedTransactionBorshB64u: coerceNonEmptyString(
        input.unsignedTransactionBorshB64u,
        'unsignedTransactionBorshB64u',
      ),
      signingDigestB64u: coerceNonEmptyString(input.signingDigestB64u, 'signingDigestB64u'),
    },
  });
}

export async function thresholdEd25519Nep413OperationFingerprint(
  input: ThresholdEd25519Nep413FingerprintInput,
): Promise<string> {
  return thresholdEd25519OperationFingerprint({
    kind: 'near:nep413',
    payload: {
      purpose: 'nep413_message',
      ...canonicalScope(input),
      message: coerceNonEmptyString(input.message, 'message'),
      recipient: coerceNonEmptyString(input.recipient, 'recipient'),
      nonce: coerceNonEmptyString(input.nonce, 'nonce'),
      state: input.state ? String(input.state) : null,
    },
  });
}

export async function thresholdEd25519DelegateActionOperationFingerprint(
  input: ThresholdEd25519DelegateActionFingerprintInput,
): Promise<string> {
  return thresholdEd25519OperationFingerprint({
    kind: 'near:delegate_action',
    payload: {
      purpose: 'delegate_action',
      ...canonicalScope(input),
      delegate: canonicalDelegate(input.delegate),
    },
  });
}

async function thresholdEd25519OperationFingerprint(input: {
  kind: string;
  payload: unknown;
}): Promise<string> {
  const json = alphabetizeStringify({
    kind: coerceNonEmptyString(input.kind, 'kind'),
    payload: normalizeFingerprintValue(input.payload),
  });
  return `sha256:${base64UrlEncode(await sha256BytesUtf8(json))}`;
}

function canonicalScope(input: ThresholdEd25519CanonicalScope): ThresholdEd25519CanonicalScope {
  return {
    nearAccountId: coerceNonEmptyString(input.nearAccountId, 'nearAccountId'),
    nearNetworkId: coerceNonEmptyString(input.nearNetworkId, 'nearNetworkId'),
    relayerKeyId: coerceNonEmptyString(input.relayerKeyId, 'relayerKeyId'),
    signerPublicKey: coerceNonEmptyString(input.signerPublicKey, 'signerPublicKey'),
  };
}

function canonicalNearTransactions(
  transactions: readonly ThresholdEd25519NearTransaction[],
): readonly unknown[] {
  if (!Array.isArray(transactions) || transactions.length < 1) {
    throw new Error('transactions must be a non-empty array');
  }
  return transactions.map((transaction, index) =>
    parseThresholdEd25519NearTransaction(transaction, `transactions[${index}]`),
  );
}

function canonicalDelegate(
  delegate: ThresholdEd25519DelegateActionFingerprintInput['delegate'],
): unknown {
  return {
    senderId: coerceNonEmptyString(delegate.senderId, 'delegate.senderId'),
    receiverId: coerceNonEmptyString(delegate.receiverId, 'delegate.receiverId'),
    actions: canonicalActions(delegate.actions, 'delegate.actions'),
    nonce: coerceNonEmptyString(delegate.nonce, 'delegate.nonce'),
    maxBlockHeight: coerceNonEmptyString(delegate.maxBlockHeight, 'delegate.maxBlockHeight'),
    publicKey: coerceNonEmptyString(delegate.publicKey, 'delegate.publicKey'),
  };
}

export function parseThresholdEd25519NearTransaction(
  raw: unknown,
  label: string,
): ThresholdEd25519NearTransaction {
  const record = requireRecord(raw, label);
  return {
    nearAccountId: coerceNonEmptyString(record.nearAccountId, `${label}.nearAccountId`),
    receiverId: coerceNonEmptyString(record.receiverId, `${label}.receiverId`),
    actions: canonicalActions(record.actions as readonly unknown[], `${label}.actions`),
  };
}

function canonicalActions(
  actions: readonly unknown[],
  label: string,
): readonly ThresholdEd25519NearAction[] {
  if (!Array.isArray(actions)) throw new Error(`${label} must be an array`);
  return actions.map((action, index) =>
    parseThresholdEd25519NearAction(action, `${label}[${index}]`),
  );
}

export function parseThresholdEd25519NearAction(
  action: unknown,
  label: string,
): ThresholdEd25519NearAction {
  const record = requireRecord(action, label);
  const actionType = coerceNonEmptyString(record.action_type, `${label}.action_type`);
  switch (actionType) {
    case 'CreateAccount':
      return { action_type: actionType };
    case 'DeployContract':
      return { action_type: actionType, code: requiredNumberArray(record.code, `${label}.code`) };
    case 'FunctionCall':
      return {
        action_type: actionType,
        method_name: coerceNonEmptyString(record.method_name, `${label}.method_name`),
        args: coerceNonEmptyString(record.args, `${label}.args`),
        gas: coerceNonEmptyString(record.gas, `${label}.gas`),
        deposit: coerceNonEmptyString(record.deposit, `${label}.deposit`),
      };
    case 'Transfer':
      return {
        action_type: actionType,
        deposit: coerceNonEmptyString(record.deposit, `${label}.deposit`),
      };
    case 'Stake':
      return {
        action_type: actionType,
        stake: coerceNonEmptyString(record.stake, `${label}.stake`),
        public_key: coerceNonEmptyString(record.public_key, `${label}.public_key`),
      };
    case 'AddKey':
      return {
        action_type: actionType,
        public_key: coerceNonEmptyString(record.public_key, `${label}.public_key`),
        access_key: coerceNonEmptyString(record.access_key, `${label}.access_key`),
      };
    case 'DeleteKey':
      return {
        action_type: actionType,
        public_key: coerceNonEmptyString(record.public_key, `${label}.public_key`),
      };
    case 'DeleteAccount':
      return {
        action_type: actionType,
        beneficiary_id: coerceNonEmptyString(record.beneficiary_id, `${label}.beneficiary_id`),
      };
    case 'SignedDelegate':
      return {
        action_type: actionType,
        delegate_action: parseThresholdEd25519SignedDelegateAction(
          record.delegate_action,
          `${label}.delegate_action`,
        ),
        signature: parseThresholdEd25519NearSignature(record.signature, `${label}.signature`),
      };
    case 'DeployGlobalContract':
      return {
        action_type: actionType,
        code: requiredNumberArray(record.code, `${label}.code`),
        deploy_mode: requiredDeployMode(record.deploy_mode, `${label}.deploy_mode`),
      };
    case 'UseGlobalContract':
      return parseThresholdEd25519UseGlobalContractAction(record, label);
  }
  throw new Error(`${label}.action_type is unsupported`);
}

function parseThresholdEd25519SignedDelegateAction(
  raw: unknown,
  label: string,
): ThresholdEd25519SignedDelegateAction {
  const record = requireRecord(raw, label);
  return {
    senderId: coerceNonEmptyString(record.senderId, `${label}.senderId`),
    receiverId: coerceNonEmptyString(record.receiverId, `${label}.receiverId`),
    actions: canonicalActions(record.actions as readonly unknown[], `${label}.actions`),
    nonce: requiredIntegerLike(record.nonce, `${label}.nonce`),
    maxBlockHeight: requiredIntegerLike(record.maxBlockHeight, `${label}.maxBlockHeight`),
    publicKey: parseThresholdEd25519NearPublicKey(record.publicKey, `${label}.publicKey`),
  };
}

function parseThresholdEd25519NearPublicKey(
  raw: unknown,
  label: string,
): ThresholdEd25519NearPublicKey {
  const record = requireRecord(raw, label);
  return {
    keyType: requiredSafeInteger(record.keyType, `${label}.keyType`),
    keyData: requiredNumberArray(record.keyData, `${label}.keyData`),
  };
}

function parseThresholdEd25519NearSignature(
  raw: unknown,
  label: string,
): ThresholdEd25519NearSignature {
  const record = requireRecord(raw, label);
  return {
    keyType: requiredSafeInteger(record.keyType, `${label}.keyType`),
    signatureData: requiredNumberArray(record.signatureData, `${label}.signatureData`),
  };
}

function parseThresholdEd25519UseGlobalContractAction(
  record: Record<string, unknown>,
  label: string,
): Extract<ThresholdEd25519NearAction, { action_type: 'UseGlobalContract' }> {
  const accountId = optionalString(record.account_id);
  const codeHash = optionalString(record.code_hash);
  if (accountId && codeHash) {
    throw new Error(`${label} requires exactly one of account_id or code_hash`);
  }
  if (accountId) return { action_type: 'UseGlobalContract', account_id: accountId };
  if (codeHash) return { action_type: 'UseGlobalContract', code_hash: codeHash };
  throw new Error(`${label} requires exactly one of account_id or code_hash`);
}

function requiredNumberArray(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 255) {
      throw new Error(`${label}[${index}] must be a byte`);
    }
    return entry;
  });
}

function requiredSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return value;
}

function requiredIntegerLike(value: unknown, label: string): string | number | bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  return coerceNonEmptyString(value, label);
}

function requiredDeployMode(value: unknown, label: string): 'CodeHash' | 'AccountId' {
  const deployMode = coerceNonEmptyString(value, label);
  if (deployMode === 'CodeHash' || deployMode === 'AccountId') return deployMode;
  throw new Error(`${label} is invalid`);
}

function optionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeFingerprintValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (value instanceof Uint8Array) {
    return { __bytesB64u: base64UrlEncode(value) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      __bytesB64u: base64UrlEncode(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    };
  }
  if (value instanceof ArrayBuffer) {
    return { __bytesB64u: base64UrlEncode(new Uint8Array(value)) };
  }
  if (Array.isArray(value)) {
    return value.map(normalizeFingerprintValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = normalizeFingerprintValue((value as Record<string, unknown>)[key]);
    if (next !== undefined) out[key] = next;
  }
  return out;
}
