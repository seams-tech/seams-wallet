import { isPlainObject } from '@shared/utils/validation';
import { MAX_WALLET_ICON_LENGTH, parseWalletDataIcon } from '@/core/ui/walletIcon';
import { hostedAuthMenuSessionIdFromBoundary, type HostedAuthMenuSessionId } from './messages';
import {
  walletIframeRequestIdFromBoundary,
  type WalletIframeRequestId,
} from '@/core/types/walletIframeIdentity';

export type WalletAlternativeDescriptor = Readonly<{
  id: string;
  label: string;
  description: string;
  icon: string | null;
}>;

export type WalletAlternatives = Readonly<{
  primary: readonly WalletAlternativeDescriptor[];
  secondary: readonly WalletAlternativeDescriptor[];
}>;

export type WalletConnectionRequest = Readonly<{
  authMenuSessionId: HostedAuthMenuSessionId;
  connectionRequestId: string;
  alternativeId: string;
}>;

export type WalletConnectionResult =
  | { readonly kind: 'connected'; readonly message?: never }
  | { readonly kind: 'cancelled'; readonly message?: never }
  | { readonly kind: 'failed'; readonly message: string };

export type WalletConnectionResolution = Readonly<{
  authMenuSessionId: HostedAuthMenuSessionId;
  connectionRequestId: string;
  requestId: WalletIframeRequestId;
  result: WalletConnectionResult;
}>;

export type WalletConnectionResolutionInput = Omit<WalletConnectionResolution, 'requestId'>;

export type WalletConnectionState =
  | { readonly kind: 'idle'; readonly request?: never; readonly message?: never }
  | {
      readonly kind: 'pending';
      readonly request: WalletConnectionRequest;
      readonly message?: never;
    }
  | { readonly kind: 'failed'; readonly message: string; readonly request?: never };

export function emptyWalletAlternatives(): WalletAlternatives {
  return { primary: [], secondary: [] };
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

type WalletIconResult =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly value?: never };

function parseWalletIcon(value: unknown): WalletIconResult {
  if (value === null) {
    return { ok: true, value: null };
  }
  const dataIcon = parseWalletDataIcon(value);
  if (dataIcon !== null) {
    return { ok: true, value: dataIcon };
  }
  if (typeof value !== 'string' || value.length > MAX_WALLET_ICON_LENGTH) {
    return { ok: false };
  }
  try {
    if (new URL(value).protocol === 'https:') {
      return { ok: true, value };
    }
  } catch {
    return { ok: false };
  }
  return { ok: false };
}

function parseWalletRows(value: unknown, ids: Set<string>): WalletAlternativeDescriptor[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const rows: WalletAlternativeDescriptor[] = [];
  for (const row of value) {
    if (
      !isPlainObject(row) ||
      !boundedText(row.id) ||
      !boundedText(row.label) ||
      typeof row.description !== 'string' ||
      row.description.length > 512 ||
      ids.has(row.id)
    ) {
      return null;
    }
    const icon = parseWalletIcon(row.icon);
    if (!icon.ok) {
      return null;
    }
    ids.add(row.id);
    rows.push({ id: row.id, label: row.label, description: row.description, icon: icon.value });
  }
  return rows;
}

export function parseWalletAlternatives(value: unknown): WalletAlternatives | null {
  if (!isPlainObject(value)) return null;
  const ids = new Set<string>();
  const primary = parseWalletRows(value.primary, ids);
  const secondary = parseWalletRows(value.secondary, ids);
  return primary && secondary ? { primary, secondary } : null;
}

export function parseWalletConnectionRequest(value: unknown): WalletConnectionRequest | null {
  if (!isPlainObject(value)) return null;
  const authMenuSessionId = hostedAuthMenuSessionIdFromBoundary(value.authMenuSessionId);
  if (
    !authMenuSessionId ||
    !boundedText(value.connectionRequestId) ||
    !boundedText(value.alternativeId)
  ) {
    return null;
  }
  return {
    authMenuSessionId,
    connectionRequestId: value.connectionRequestId,
    alternativeId: value.alternativeId,
  };
}

export function parseWalletConnectionResolution(value: unknown): WalletConnectionResolution | null {
  if (!isPlainObject(value) || !isPlainObject(value.result)) return null;
  const authMenuSessionId = hostedAuthMenuSessionIdFromBoundary(value.authMenuSessionId);
  let requestId: WalletIframeRequestId;
  try {
    requestId = walletIframeRequestIdFromBoundary(value.requestId);
  } catch {
    return null;
  }
  if (!authMenuSessionId || !boundedText(value.connectionRequestId)) return null;
  let result: WalletConnectionResult;
  switch (value.result.kind) {
    case 'connected':
    case 'cancelled':
      if (value.result.message !== undefined) return null;
      result = { kind: value.result.kind };
      break;
    case 'failed':
      if (!boundedText(value.result.message)) return null;
      result = { kind: 'failed', message: value.result.message };
      break;
    default:
      return null;
  }
  return { authMenuSessionId, requestId, connectionRequestId: value.connectionRequestId, result };
}
