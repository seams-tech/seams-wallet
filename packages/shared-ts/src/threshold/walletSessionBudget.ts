// The Wallet Session budget: the app asks for one, the tenant sets the maximum,
// and the server grants min(request, maximum). This module is the one home of
// that rule; the server, the Console and the local Console stand-in use it.
import {
  DEFAULT_TENANT_WALLET_SESSION_MAX_REMAINING_USES,
  DEFAULT_TENANT_WALLET_SESSION_MAX_TTL_MS,
  DEFAULT_WALLET_SESSION_REMAINING_USES,
  DEFAULT_WALLET_SESSION_TTL_MS,
  LINKED_DEVICE_WALLET_SESSION_REMAINING_USES,
  LINKED_DEVICE_WALLET_SESSION_TTL_MS,
  MAX_WALLET_SESSION_REMAINING_USES,
  MAX_WALLET_SESSION_TTL_MS,
} from './sessionPolicy';
import { exactRecord } from '../utils/exactRecord';

/** A count of signatures and a lifetime, as the app asks for them or as the server grants them. */
export type WalletSessionBudget = {
  readonly ttlMs: number;
  readonly remainingUses: number;
};

/** The maximum budget of one project environment. */
export type WalletSessionLimits = {
  readonly maxTtlMs: number;
  readonly maxRemainingUses: number;
};

/**
 * Which budget applies. A linked device gets a short session with many
 * signatures; every other Wallet Session gets the app's budget or the default.
 */
export type WalletSessionBudgetProfile = 'default' | 'linked_device';

export const DEFAULT_TENANT_WALLET_SESSION_LIMITS: WalletSessionLimits = Object.freeze({
  maxTtlMs: DEFAULT_TENANT_WALLET_SESSION_MAX_TTL_MS,
  maxRemainingUses: DEFAULT_TENANT_WALLET_SESSION_MAX_REMAINING_USES,
});

/**
 * The maximum when the tenant's setting cannot be read. It never grants more
 * than the default budget, so it never passes a maximum that the server could not see.
 */
export const UNREADABLE_TENANT_WALLET_SESSION_LIMITS: WalletSessionLimits = Object.freeze({
  maxTtlMs: DEFAULT_WALLET_SESSION_TTL_MS,
  maxRemainingUses: DEFAULT_WALLET_SESSION_REMAINING_USES,
});

export function walletSessionProfileBudget(profile: WalletSessionBudgetProfile): WalletSessionBudget {
  switch (profile) {
    case 'default':
      return {
        ttlMs: DEFAULT_WALLET_SESSION_TTL_MS,
        remainingUses: DEFAULT_WALLET_SESSION_REMAINING_USES,
      };
    case 'linked_device':
      return {
        ttlMs: LINKED_DEVICE_WALLET_SESSION_TTL_MS,
        remainingUses: LINKED_DEVICE_WALLET_SESSION_REMAINING_USES,
      };
    default:
      return assertNeverWalletSessionBudgetProfile(profile);
  }
}

/**
 * The budget that the server grants: min(asked, maximum), field by field. The
 * app's request applies only to the default profile: a linked device keeps
 * its own budget, because its short session is a property of the device link.
 */
export function grantWalletSessionBudget(input: {
  readonly profile: WalletSessionBudgetProfile;
  readonly requested: WalletSessionBudget | null;
  readonly limits: WalletSessionLimits;
}): WalletSessionBudget {
  const asked =
    input.profile === 'default' && input.requested
      ? input.requested
      : walletSessionProfileBudget(input.profile);
  return {
    ttlMs: Math.min(asked.ttlMs, input.limits.maxTtlMs),
    remainingUses: Math.min(asked.remainingUses, input.limits.maxRemainingUses),
  };
}

/** Parses the app's budget on the wire: `{ ttlMs, remainingUses }`, both positive integers. */
export function parseWalletSessionBudget(value: unknown, label: string): WalletSessionBudget {
  const record = exactRecord(value, ['ttlMs', 'remainingUses'], label);
  return {
    ttlMs: requirePositiveInteger(record.ttlMs, `${label}.ttlMs`),
    remainingUses: requirePositiveInteger(record.remainingUses, `${label}.remainingUses`),
  };
}

/**
 * Parses one field of the app's budget in the SDK config: a non-negative
 * integer. 0 asks for no warm session after a passkey unlock.
 */
export function parseWalletSessionBudgetSetting(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

/** Parses an optional budget field: absent or null means that the app asks for none. */
export function parseOptionalWalletSessionBudget(
  value: unknown,
  label: string,
): WalletSessionBudget | null {
  return value === undefined || value === null ? null : parseWalletSessionBudget(value, label);
}

/**
 * Parses a tenant's maximum: `{ maxTtlMs, maxRemainingUses }`, both positive
 * integers at most the platform ceiling.
 */
export function parseWalletSessionLimits(value: unknown, label: string): WalletSessionLimits {
  const record = exactRecord(value, ['maxTtlMs', 'maxRemainingUses'], label);
  const maxTtlMs = requirePositiveInteger(record.maxTtlMs, `${label}.maxTtlMs`);
  const maxRemainingUses = requirePositiveInteger(
    record.maxRemainingUses,
    `${label}.maxRemainingUses`,
  );
  if (maxTtlMs > MAX_WALLET_SESSION_TTL_MS) {
    throw new Error(`${label}.maxTtlMs must be at most ${MAX_WALLET_SESSION_TTL_MS}`);
  }
  if (maxRemainingUses > MAX_WALLET_SESSION_REMAINING_USES) {
    throw new Error(
      `${label}.maxRemainingUses must be at most ${MAX_WALLET_SESSION_REMAINING_USES}`,
    );
  }
  return { maxTtlMs, maxRemainingUses };
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function assertNeverWalletSessionBudgetProfile(value: never): never {
  throw new Error(`Unsupported Wallet Session budget profile: ${String(value)}`);
}
