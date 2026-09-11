import type { RelayedSignedDelegate } from '@shared/near/delegate';

type RelayedNearAction = RelayedSignedDelegate['delegateAction']['actions'][number];
type RelayedNearPublicKey = RelayedSignedDelegate['delegateAction']['publicKey'];
type RelayedNearSignature = RelayedSignedDelegate['signature'];

export interface WalletRuntimeDelegatePolicy {
  readonly allowedReceivers?: string[];
  readonly allowedMethods?: string[];
  readonly maxTotalDepositYocto?: string;
}

export interface WalletRuntimeExecuteSignedDelegateRequest {
  readonly hash: string;
  readonly signedDelegate: RelayedSignedDelegate;
  readonly policy?: WalletRuntimeDelegatePolicy;
}

export type WalletRuntimeExecuteSignedDelegateResult =
  | {
      readonly ok: true;
      readonly transactionHash?: string;
      readonly outcome?: unknown;
    }
  | {
      readonly ok: false;
      readonly error?: string;
      readonly code?: string;
      readonly outcome?: unknown;
    };

function inspectRawObject(value: unknown): object | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readRawField(record: object, key: string): unknown {
  return Reflect.get(record, key);
}

function hasExactKeys(
  record: object,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const keys = Object.keys(record);
  return (
    requiredKeys.every((key) => keys.includes(key)) &&
    keys.every((key) => requiredKeys.includes(key) || optionalKeys.includes(key))
  );
}

function parseText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseNonEmptyText(value: unknown): string | null {
  const text = parseText(value);
  return text && text.trim() ? text.trim() : null;
}

function parseDecimalText(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}

function parseSafeUnsignedInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const decimal = parseDecimalText(value);
  if (decimal === null) return null;
  const parsed = Number(decimal);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseByteArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const bytes: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 255) {
      return null;
    }
    bytes.push(entry);
  }
  return bytes;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const entry of value) {
    const text = parseText(entry);
    if (text === null) return null;
    entries.push(text);
  }
  return entries;
}

function parsePublicKey(value: unknown): RelayedNearPublicKey | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['keyType', 'keyData'])) return null;
  const keyType = parseSafeUnsignedInteger(readRawField(record, 'keyType'));
  const keyData = parseByteArray(readRawField(record, 'keyData'));
  return keyType === null || keyData === null ? null : { keyType, keyData };
}

function parseSignature(value: unknown): RelayedNearSignature | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['keyType', 'signatureData'])) return null;
  const keyType = parseSafeUnsignedInteger(readRawField(record, 'keyType'));
  const signatureData = parseByteArray(readRawField(record, 'signatureData'));
  return keyType === null || signatureData === null ? null : { keyType, signatureData };
}

function parseCanonicalFunctionCall(record: object): RelayedNearAction | null {
  if (!hasExactKeys(record, ['type', 'methodName', 'args'], ['gas', 'deposit'])) return null;
  if (readRawField(record, 'type') !== 'FunctionCall') return null;
  const methodName = parseNonEmptyText(readRawField(record, 'methodName'));
  const args = inspectRawObject(readRawField(record, 'args'));
  const gasValue = Object.keys(record).includes('gas')
    ? readRawField(record, 'gas')
    : '30000000000000';
  const depositValue = Object.keys(record).includes('deposit')
    ? readRawField(record, 'deposit')
    : '0';
  const gas = parseSafeUnsignedInteger(gasValue);
  const deposit = parseDecimalText(depositValue);
  if (methodName === null || args === null || gas === null || deposit === null) return null;
  const encodedArgs = JSON.stringify(args);
  if (typeof encodedArgs !== 'string') return null;
  return {
    functionCall: {
      methodName,
      args: Array.from(new TextEncoder().encode(encodedArgs)),
      gas,
      deposit,
    },
  };
}

function parseCanonicalTransfer(record: object): RelayedNearAction | null {
  if (!hasExactKeys(record, ['type', 'amount'])) return null;
  if (readRawField(record, 'type') !== 'Transfer') return null;
  const amount = parseDecimalText(readRawField(record, 'amount'));
  return amount === null ? null : { transfer: { deposit: amount } };
}

function parseExternalAction(record: object): RelayedNearAction | null {
  const keys = Object.keys(record);
  if (keys.length !== 1) return null;
  if (keys[0] === 'functionCall') {
    const payload = inspectRawObject(readRawField(record, 'functionCall'));
    if (!payload || !hasExactKeys(payload, ['methodName', 'args', 'gas', 'deposit'])) return null;
    const methodName = parseNonEmptyText(readRawField(payload, 'methodName'));
    const args = parseByteArray(readRawField(payload, 'args'));
    const gas = parseSafeUnsignedInteger(readRawField(payload, 'gas'));
    const deposit = parseDecimalText(readRawField(payload, 'deposit'));
    if (methodName === null || args === null || gas === null || deposit === null) return null;
    return { functionCall: { methodName, args, gas, deposit } };
  }
  if (keys[0] === 'transfer') {
    const payload = inspectRawObject(readRawField(record, 'transfer'));
    if (!payload || !hasExactKeys(payload, ['deposit'])) return null;
    const deposit = parseDecimalText(readRawField(payload, 'deposit'));
    return deposit === null ? null : { transfer: { deposit } };
  }
  return null;
}

function parseAction(value: unknown): RelayedNearAction | null {
  const record = inspectRawObject(value);
  if (!record) return null;
  const external = parseExternalAction(record);
  if (external !== null) return external;
  if (Object.keys(record).includes('type')) {
    if (readRawField(record, 'type') === 'FunctionCall') return parseCanonicalFunctionCall(record);
    if (readRawField(record, 'type') === 'Transfer') return parseCanonicalTransfer(record);
  }
  return null;
}

function parseDelegateAction(value: unknown): RelayedSignedDelegate['delegateAction'] | null {
  const record = inspectRawObject(value);
  if (
    !record ||
    !hasExactKeys(record, [
      'senderId',
      'receiverId',
      'actions',
      'nonce',
      'maxBlockHeight',
      'publicKey',
    ])
  ) {
    return null;
  }
  const senderId = parseNonEmptyText(readRawField(record, 'senderId'));
  const receiverId = parseNonEmptyText(readRawField(record, 'receiverId'));
  const nonce = parseSafeUnsignedInteger(readRawField(record, 'nonce'));
  const maxBlockHeight = parseSafeUnsignedInteger(readRawField(record, 'maxBlockHeight'));
  const publicKey = parsePublicKey(readRawField(record, 'publicKey'));
  if (
    senderId === null ||
    receiverId === null ||
    nonce === null ||
    maxBlockHeight === null ||
    publicKey === null
  ) {
    return null;
  }

  const rawActions = readRawField(record, 'actions');
  if (!Array.isArray(rawActions)) return null;
  const actions: RelayedNearAction[] = [];
  for (const rawAction of rawActions) {
    const action = parseAction(rawAction);
    if (action === null) return null;
    actions.push(action);
  }
  return { senderId, receiverId, actions, nonce, maxBlockHeight, publicKey };
}

function parseSignedDelegate(value: unknown): RelayedSignedDelegate | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['delegateAction', 'signature'])) return null;
  const delegateAction = parseDelegateAction(readRawField(record, 'delegateAction'));
  const signature = parseSignature(readRawField(record, 'signature'));
  return delegateAction === null || signature === null ? null : { delegateAction, signature };
}

function parseDelegatePolicy(value: unknown): WalletRuntimeDelegatePolicy | null {
  const record = inspectRawObject(value);
  if (
    !record ||
    !hasExactKeys(record, [], ['allowedReceivers', 'allowedMethods', 'maxTotalDepositYocto'])
  ) {
    return null;
  }
  const keys = Object.keys(record);
  const allowedReceivers = keys.includes('allowedReceivers')
    ? parseStringArray(readRawField(record, 'allowedReceivers'))
    : undefined;
  const allowedMethods = keys.includes('allowedMethods')
    ? parseStringArray(readRawField(record, 'allowedMethods'))
    : undefined;
  const maxTotalDepositYocto = keys.includes('maxTotalDepositYocto')
    ? parseDecimalText(readRawField(record, 'maxTotalDepositYocto'))
    : undefined;
  if (allowedReceivers === null || allowedMethods === null || maxTotalDepositYocto === null) {
    return null;
  }
  return {
    ...(allowedReceivers === undefined ? {} : { allowedReceivers }),
    ...(allowedMethods === undefined ? {} : { allowedMethods }),
    ...(maxTotalDepositYocto === undefined ? {} : { maxTotalDepositYocto }),
  };
}

export function parseWalletRuntimeExecuteSignedDelegateRequest(
  value: unknown,
): WalletRuntimeExecuteSignedDelegateRequest | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['hash', 'signedDelegate'], ['policy'])) return null;
  const hash = parseNonEmptyText(readRawField(record, 'hash'));
  const signedDelegate = parseSignedDelegate(readRawField(record, 'signedDelegate'));
  if (hash === null || signedDelegate === null) return null;
  if (!Object.keys(record).includes('policy')) return { hash, signedDelegate };
  const policy = parseDelegatePolicy(readRawField(record, 'policy'));
  return policy === null ? null : { hash, signedDelegate, policy };
}

export function parseWalletRuntimeExecuteSignedDelegateResult(
  value: unknown,
): WalletRuntimeExecuteSignedDelegateResult | null {
  const record = inspectRawObject(value);
  if (!record) return null;
  const keys = Object.keys(record);
  const ok = readRawField(record, 'ok');
  if (ok === true) {
    if (!hasExactKeys(record, ['ok'], ['transactionHash', 'outcome'])) return null;
    const transactionHash = keys.includes('transactionHash')
      ? parseNonEmptyText(readRawField(record, 'transactionHash'))
      : undefined;
    if (transactionHash === null) return null;
    return {
      ok: true,
      ...(transactionHash === undefined ? {} : { transactionHash }),
      ...(keys.includes('outcome') ? { outcome: readRawField(record, 'outcome') } : {}),
    };
  }
  if (ok === false) {
    if (!hasExactKeys(record, ['ok'], ['error', 'code'])) return null;
    const error = keys.includes('error') ? parseText(readRawField(record, 'error')) : undefined;
    const code = keys.includes('code') ? parseText(readRawField(record, 'code')) : undefined;
    if (error === null || code === null) return null;
    return {
      ok: false,
      ...(error === undefined ? {} : { error }),
      ...(code === undefined ? {} : { code }),
    };
  }
  return null;
}

export function parseWalletRuntimeExecuteSignedDelegateResponse(
  value: unknown,
): WalletRuntimeExecuteSignedDelegateResult | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['result'])) return null;
  return parseWalletRuntimeExecuteSignedDelegateResult(readRawField(record, 'result'));
}

export function parseWalletRuntimeRelayerAccount(
  value: unknown,
): { accountId: string; publicKey: string } | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['accountId', 'publicKey'])) return null;
  const accountId = parseNonEmptyText(readRawField(record, 'accountId'));
  const publicKey = parseNonEmptyText(readRawField(record, 'publicKey'));
  return accountId === null || publicKey === null ? null : { accountId, publicKey };
}

export interface WalletRuntimeWalletIdentityRequest {
  readonly orgId: string;
  readonly wallets: readonly {
    readonly walletId: string;
    readonly projectId: string;
  }[];
}

export interface WalletRuntimeWalletIdentity {
  readonly walletId: string;
  readonly nearAccountId: string;
  readonly evmAddress: `0x${string}`;
}

export interface WalletRuntimeWalletIdentitiesResult {
  readonly identities: readonly WalletRuntimeWalletIdentity[];
}

function parseEvmAddress(value: unknown): `0x${string}` | null {
  const address = parseNonEmptyText(value)?.toLowerCase();
  return address && /^0x[0-9a-f]{40}$/.test(address) ? (address as `0x${string}`) : null;
}

export function parseWalletRuntimeWalletIdentityRequest(
  value: unknown,
): WalletRuntimeWalletIdentityRequest | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['orgId', 'wallets'])) return null;
  const orgId = parseNonEmptyText(readRawField(record, 'orgId'));
  const rawWallets = readRawField(record, 'wallets');
  if (!orgId || !Array.isArray(rawWallets) || rawWallets.length === 0 || rawWallets.length > 10) {
    return null;
  }
  const wallets: Array<{ walletId: string; projectId: string }> = [];
  for (const rawWallet of rawWallets) {
    const wallet = inspectRawObject(rawWallet);
    if (!wallet || !hasExactKeys(wallet, ['walletId', 'projectId'])) return null;
    const walletId = parseNonEmptyText(readRawField(wallet, 'walletId'));
    const projectId = parseNonEmptyText(readRawField(wallet, 'projectId'));
    if (!walletId || !projectId) return null;
    wallets.push({ walletId, projectId });
  }
  return { orgId, wallets };
}

export function parseWalletRuntimeWalletIdentitiesResult(
  value: unknown,
): WalletRuntimeWalletIdentitiesResult | null {
  const record = inspectRawObject(value);
  if (!record || !hasExactKeys(record, ['identities'])) return null;
  const rawIdentities = readRawField(record, 'identities');
  if (!Array.isArray(rawIdentities)) return null;
  const identities: WalletRuntimeWalletIdentity[] = [];
  for (const rawIdentity of rawIdentities) {
    const identity = inspectRawObject(rawIdentity);
    if (!identity || !hasExactKeys(identity, ['walletId', 'nearAccountId', 'evmAddress'])) {
      return null;
    }
    const walletId = parseNonEmptyText(readRawField(identity, 'walletId'));
    const nearAccountId = parseNonEmptyText(readRawField(identity, 'nearAccountId'));
    const evmAddress = parseEvmAddress(readRawField(identity, 'evmAddress'));
    if (!walletId || !nearAccountId || !evmAddress) return null;
    identities.push({ walletId, nearAccountId, evmAddress });
  }
  return { identities };
}

export const WALLET_RUNTIME_SERVICE_ORIGIN_V1 = 'https://wallet-runtime.internal';
export const WALLET_RUNTIME_OPS_BASE_PATH_V1 = '/internal/wallet-runtime/v1';

export const WALLET_RUNTIME_OP_PATHS_V1 = {
  executeSignedDelegate: `${WALLET_RUNTIME_OPS_BASE_PATH_V1}/execute-signed-delegate`,
  relayerAccount: `${WALLET_RUNTIME_OPS_BASE_PATH_V1}/relayer-account`,
  walletIdentities: `${WALLET_RUNTIME_OPS_BASE_PATH_V1}/wallet-identities`,
} as const;

export interface WalletRuntimeOps {
  readonly executeSignedDelegate: (
    input: WalletRuntimeExecuteSignedDelegateRequest,
  ) => Promise<WalletRuntimeExecuteSignedDelegateResult>;
  readonly getRelayerAccount: () => Promise<{ accountId: string; publicKey: string }>;
  readonly getWalletIdentities: (
    input: WalletRuntimeWalletIdentityRequest,
  ) => Promise<WalletRuntimeWalletIdentitiesResult>;
}

export interface WalletRuntimeServiceBinding {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
