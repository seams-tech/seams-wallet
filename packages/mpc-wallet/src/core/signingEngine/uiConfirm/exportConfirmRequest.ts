import {
  UserConfirmationType,
  type ExportGuidance,
  type ExportPrivateKeyDisplayEntry,
  type ExportSummary,
  type LocalOnlyExportSubject,
  type WorkerExportConfirmRequest,
} from '../stepUpConfirmation/channel/confirmTypes';
import type { ConfirmationConfig } from '@/core/types/signer-worker';

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid export confirmation: ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid export confirmation: ${field} must be a string`);
  }
  return value;
}

function identity(value: unknown, field: string): string {
  const result = string(value, field);
  if (!result.trim() || result !== result.trim()) {
    throw new Error(`Invalid export confirmation: ${field} must be a nonempty identity`);
  }
  return result;
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : string(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new Error(`Invalid export confirmation: ${field} must be a boolean`);
}

function exportSubject(value: unknown): LocalOnlyExportSubject {
  const subject = object(value, 'subject');
  switch (subject.kind) {
    case 'near_wallet':
      if (subject.walletId !== undefined) throw new Error('Invalid NEAR export subject');
      return {
        kind: 'near_wallet',
        nearAccountId: identity(subject.nearAccountId, 'nearAccountId'),
      };
    case 'evm_wallet':
      if (subject.nearAccountId !== undefined) throw new Error('Invalid EVM export subject');
      return { kind: 'evm_wallet', walletId: identity(subject.walletId, 'walletId') };
    default:
      throw new Error('Invalid export confirmation: unsupported subject');
  }
}

function exportSummary(value: unknown): ExportSummary {
  const summary = object(value, 'summary');
  const operation = summary.operation;
  if (operation !== 'Export Private Key' && operation !== 'Export Recovery Key') {
    throw new Error('Invalid export confirmation: unsupported operation');
  }
  return {
    operation,
    accountId: identity(summary.accountId, 'summary.accountId'),
    publicKey: string(summary.publicKey, 'summary.publicKey'),
    warning: string(summary.warning, 'summary.warning'),
  };
}

function displayKey(value: unknown): ExportPrivateKeyDisplayEntry {
  const entry = object(value, 'key');
  const scheme = entry.scheme;
  if (scheme !== 'ed25519' && scheme !== 'secp256k1') {
    throw new Error('Invalid export confirmation: unsupported key scheme');
  }
  return {
    scheme,
    label: string(entry.label, 'key.label'),
    publicKey: string(entry.publicKey, 'key.publicKey'),
    privateKey: string(entry.privateKey, 'key.privateKey'),
    address: optionalString(entry.address, 'key.address'),
  };
}

function displayKeys(value: unknown): ExportPrivateKeyDisplayEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Invalid export confirmation: keys must be an array');
  return value.map(displayKey);
}

function guidanceStep(value: unknown): string {
  return string(value, 'guidance step');
}

function exportGuidance(value: unknown): ExportGuidance | undefined {
  if (value === undefined) return undefined;
  const guidance = object(value, 'guidance');
  if (guidance.steps !== undefined && !Array.isArray(guidance.steps)) {
    throw new Error('Invalid export confirmation: guidance steps must be an array');
  }
  return {
    title: string(guidance.title, 'guidance.title'),
    body: optionalString(guidance.body, 'guidance.body'),
    steps: guidance.steps?.map(guidanceStep),
  };
}

function confirmationConfig(value: unknown): Partial<ConfirmationConfig> | undefined {
  if (value === undefined) return undefined;
  const config = object(value, 'confirmationConfig');
  const { uiMode, behavior, autoProceedDelay } = config;
  if (uiMode !== undefined && uiMode !== 'none' && uiMode !== 'modal' && uiMode !== 'drawer') {
    throw new Error('Invalid export confirmation: unsupported UI mode');
  }
  if (behavior !== undefined && behavior !== 'skipClick' && behavior !== 'requireClick') {
    throw new Error('Invalid export confirmation: unsupported behavior');
  }
  if (
    autoProceedDelay !== undefined &&
    (typeof autoProceedDelay !== 'number' || !Number.isFinite(autoProceedDelay))
  ) {
    throw new Error('Invalid export confirmation: invalid autoProceedDelay');
  }
  return { uiMode, behavior, autoProceedDelay };
}

export function decodeExportConfirmRequest(value: unknown): WorkerExportConfirmRequest {
  const request = object(value, 'request');
  const payload = object(request.payload, 'payload');
  if (
    payload.prfOutput !== undefined ||
    payload.prf_output !== undefined ||
    payload.wrapKeySeed !== undefined ||
    payload.wrapKeySalt !== undefined ||
    payload.prfKey !== undefined
  ) {
    throw new Error('Invalid export confirmation: forbidden signing secret');
  }
  const requestId = identity(request.requestId, 'requestId');
  const summary = exportSummary(request.summary);
  const subject = exportSubject(payload.subject);
  const publicKey = string(payload.publicKey, 'publicKey');
  const intentDigest = optionalString(request.intentDigest, 'intentDigest');
  const config = confirmationConfig(request.confirmationConfig);
  if (payload.onLifecycle !== undefined) {
    throw new Error('Invalid export confirmation: callbacks belong to the host');
  }
  switch (request.type) {
    case UserConfirmationType.AUTHORIZE_KEY_EXPORT:
      return {
        type: UserConfirmationType.AUTHORIZE_KEY_EXPORT,
        requestId,
        summary,
        intentDigest,
        confirmationConfig: config,
        payload: {
          subject,
          publicKey,
          credentialIdB64u: identity(payload.credentialIdB64u, 'credentialIdB64u'),
          challengeB64u: optionalString(payload.challengeB64u, 'challengeB64u'),
        },
      };
    case UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI: {
      const { variant, theme } = payload;
      if (variant !== undefined && variant !== 'drawer' && variant !== 'modal') {
        throw new Error('Invalid export confirmation: unsupported variant');
      }
      if (theme !== undefined && theme !== 'dark' && theme !== 'light') {
        throw new Error('Invalid export confirmation: unsupported theme');
      }
      return {
        type: UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI,
        requestId,
        summary,
        intentDigest,
        confirmationConfig: config,
        payload: {
          subject,
          publicKey,
          viewerSessionId: optionalString(payload.viewerSessionId, 'viewerSessionId'),
          privateKey: optionalString(payload.privateKey, 'privateKey'),
          keys: displayKeys(payload.keys),
          guidance: exportGuidance(payload.guidance),
          variant,
          theme,
          loading: optionalBoolean(payload.loading, 'loading'),
          errorMessage: optionalString(payload.errorMessage, 'errorMessage'),
        },
      };
    }
    default:
      throw new Error('Invalid export confirmation: unsupported request type');
  }
}
