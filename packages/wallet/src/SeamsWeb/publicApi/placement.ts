import { requireRecord } from '@shared/utils/validation';
import { parseNonNegativeSafeInteger } from '@shared/device-linking/wireFields';
import type { WalletId } from '@shared/utils/domainIds';
import type { ExclusiveUnion, Variant } from '@shared/utils/variant';

declare const moveIdBrand: unique symbol;
export type WalletMoveId = string & { readonly [moveIdBrand]: true };

export function parseWalletMoveId(raw: unknown): WalletMoveId {
  if (!isWalletMoveId(raw)) throw new Error('Wallet move identity is invalid');
  return raw;
}

function isWalletMoveId(raw: unknown): raw is WalletMoveId {
  return typeof raw === 'string' && /^wmove_[A-Za-z0-9_-]{43}$/u.test(raw);
}

export type WalletRegion = 'US' | 'WEUR' | 'APAC' | 'OC';
type RelocationFailure =
  | 'transport_unavailable'
  | 'authority_unavailable'
  | 'identity_conflict'
  | 'receipt_conflict'
  | 'content_conflict';
type Execution = ExclusiveUnion<
  | { readonly state: 'ready' | 'running' }
  | {
      readonly state: 'retry_wait';
      readonly code: 'transport_unavailable' | 'authority_unavailable';
      readonly retryAtMs: number;
    }
  | { readonly state: 'blocked'; readonly code: RelocationFailure }
>;
type Progress = ExclusiveUnion<
  | {
      readonly state: 'freezing' | 'copying' | 'verified' | 'activating';
      readonly availability: 'paused';
      readonly execution: Execution;
    }
  | { readonly state: 'cleanup'; readonly availability: 'active'; readonly execution: Execution }
>;
export type WalletPlacement = ExclusiveUnion<
  | {
      readonly state: 'settled';
      readonly region: WalletRegion;
      readonly generation: number;
      readonly nextMoveAtMs: number;
    }
  | {
      readonly state: 'moving';
      readonly move: {
        readonly moveId: WalletMoveId;
        readonly sourceRegion: WalletRegion;
        readonly destinationRegion: WalletRegion;
        readonly sourceGeneration: number;
        readonly destinationGeneration: number;
        readonly admittedAtMs: number;
        readonly nextMoveAtMs: number;
        readonly progress: Progress;
      };
    }
  | { readonly state: 'unavailable'; readonly code: 'not_found' | 'wallet_not_established' }
>;
export type WalletPlacementResult = ExclusiveUnion<
  | { readonly ok: true; readonly placement: WalletPlacement }
  | {
      readonly ok: false;
      readonly code:
        | 'wallet_unlock_required'
        | 'unauthorized'
        | 'transport_unavailable'
        | 'invalid_response';
    }
>;
export type WalletMoveStatus = ExclusiveUnion<
  | Variant<WalletPlacement, 'state', 'moving'>
  | {
      readonly state: 'completed';
      readonly moveId: WalletMoveId;
      readonly sourceRegion: WalletRegion;
      readonly destinationRegion: WalletRegion;
      readonly sourceGeneration: number;
      readonly destinationGeneration: number;
      readonly admittedAtMs: number;
      readonly completedAtMs: number;
    }
>;
export type WalletMoveStatusResult = ExclusiveUnion<
  | { readonly ok: true; readonly status: WalletMoveStatus }
  | Variant<WalletPlacementResult, 'ok', false>
>;

export interface WalletPlacementCapability {
  get(walletId: WalletId): Promise<WalletPlacementResult>;
  getMove(walletId: WalletId, moveId: WalletMoveId): Promise<WalletMoveStatusResult>;
}

export function parseWalletPlacement(raw: unknown): WalletPlacement {
  const value = requireRecord(raw, 'Wallet placement');
  switch (value.state) {
    case 'settled':
      if (Object.keys(value).length !== 4) break;
      return {
        state: 'settled',
        region: region(value.region),
        generation: positivePlacementValue(value.generation),
        nextMoveAtMs: parseNonNegativeSafeInteger(value.nextMoveAtMs, 'Next relocation time'),
      };
    case 'unavailable':
      if (Object.keys(value).length !== 2) break;
      if (value.code !== 'not_found' && value.code !== 'wallet_not_established') break;
      return { state: 'unavailable', code: value.code };
    case 'moving': {
      if (Object.keys(value).length !== 2) break;
      const move = requireRecord(value.move, 'Wallet relocation');
      if (Object.keys(move).length !== 8) break;
      const {
        moveId,
        sourceRegion,
        destinationRegion,
        sourceGeneration,
        destinationGeneration,
        admittedAtMs,
      } = relocationIdentity(move);
      const nextMoveAtMs = parseNonNegativeSafeInteger(move.nextMoveAtMs, 'Next relocation time');
      if (nextMoveAtMs < admittedAtMs) break;
      return {
        state: 'moving',
        move: {
          moveId,
          sourceRegion,
          destinationRegion,
          sourceGeneration,
          destinationGeneration,
          admittedAtMs,
          nextMoveAtMs,
          progress: progress(move.progress),
        },
      };
    }
  }
  throw new Error('Wallet placement response is invalid');
}

export function parseWalletPlacementResult(raw: unknown): WalletPlacementResult {
  const value = requireRecord(raw, 'Wallet placement result');
  if (Object.keys(value).length !== 2)
    throw new Error('Wallet placement result fields are invalid');
  if (value.ok === true) return { ok: true, placement: parseWalletPlacement(value.placement) };
  if (value.ok === false) {
    switch (value.code) {
      case 'wallet_unlock_required':
      case 'unauthorized':
      case 'transport_unavailable':
      case 'invalid_response':
        return { ok: false, code: value.code };
    }
  }
  throw new Error('Wallet placement result is invalid');
}

function region(raw: unknown): WalletRegion {
  switch (raw) {
    case 'US':
    case 'WEUR':
    case 'APAC':
    case 'OC':
      return raw;
    default:
      throw new Error('Wallet region is invalid');
  }
}

function positivePlacementValue(raw: unknown): number {
  const value = parseNonNegativeSafeInteger(raw, 'Wallet placement generation or time');
  if (value === 0) throw new Error('Wallet placement generation or time must be positive');
  return value;
}

function progress(raw: unknown): Progress {
  const value = requireRecord(raw, 'Wallet relocation progress');
  if (Object.keys(value).length !== 3)
    throw new Error('Wallet relocation progress fields are invalid');
  const current = execution(value.execution);
  switch (value.state) {
    case 'freezing':
    case 'copying':
    case 'verified':
    case 'activating':
      if (value.availability === 'paused')
        return { state: value.state, availability: 'paused', execution: current };
      break;
    case 'cleanup':
      if (value.availability === 'active')
        return { state: 'cleanup', availability: 'active', execution: current };
      break;
  }
  throw new Error('Wallet relocation availability is invalid');
}

function execution(raw: unknown): Execution {
  const value = requireRecord(raw, 'Wallet relocation execution');
  switch (value.state) {
    case 'ready':
    case 'running':
      if (Object.keys(value).length === 1) return { state: value.state };
      break;
    case 'retry_wait':
      if (Object.keys(value).length !== 3) break;
      if (value.code === 'transport_unavailable' || value.code === 'authority_unavailable')
        return {
          state: 'retry_wait',
          code: value.code,
          retryAtMs: positivePlacementValue(value.retryAtMs),
        };
      break;
    case 'blocked':
      if (Object.keys(value).length !== 2) break;
      switch (value.code) {
        case 'transport_unavailable':
        case 'authority_unavailable':
        case 'identity_conflict':
        case 'receipt_conflict':
        case 'content_conflict':
          return { state: 'blocked', code: value.code };
      }
  }
  throw new Error('Wallet relocation execution is invalid');
}

export function parseWalletMoveStatus(
  raw: unknown,
  expectedMoveId: WalletMoveId,
): WalletMoveStatus {
  const value = requireRecord(raw, 'Wallet move status');
  if (value.state === 'moving') {
    const placement = parseWalletPlacement(value);
    if (placement.state !== 'moving' || placement.move.moveId !== expectedMoveId)
      throw new Error('Wallet move identity changed');
    return placement;
  }
  if (value.state !== 'completed' || Object.keys(value).length !== 8)
    throw new Error('Wallet move status is invalid');
  const {
    moveId,
    sourceRegion,
    destinationRegion,
    sourceGeneration,
    destinationGeneration,
    admittedAtMs,
  } = relocationIdentity(value);
  const completedAtMs = positivePlacementValue(value.completedAtMs);
  if (moveId !== expectedMoveId || completedAtMs < admittedAtMs)
    throw new Error('Wallet move completion is invalid');
  return {
    state: 'completed',
    moveId,
    sourceRegion,
    destinationRegion,
    sourceGeneration,
    destinationGeneration,
    admittedAtMs,
    completedAtMs,
  };
}

export function parseWalletMoveStatusResult(
  raw: unknown,
  moveId: WalletMoveId,
): WalletMoveStatusResult {
  const value = requireRecord(raw, 'Wallet move result');
  if (value.ok === false) {
    const failure = parseWalletPlacementResult(value);
    if (!failure.ok) return failure;
  }
  if (value.ok !== true || Object.keys(value).length !== 2)
    throw new Error('Wallet move result is invalid');
  return { ok: true, status: parseWalletMoveStatus(value.status, moveId) };
}

function relocationIdentity(value: Record<string, unknown>) {
  const moveId = parseWalletMoveId(value.moveId);
  const sourceRegion = region(value.sourceRegion);
  const destinationRegion = region(value.destinationRegion);
  const sourceGeneration = positivePlacementValue(value.sourceGeneration);
  const destinationGeneration = positivePlacementValue(value.destinationGeneration);
  const admittedAtMs = positivePlacementValue(value.admittedAtMs);
  if (sourceRegion === destinationRegion || destinationGeneration !== sourceGeneration + 1)
    throw new Error('Wallet move generations or regions are invalid');
  return {
    moveId,
    sourceRegion,
    destinationRegion,
    sourceGeneration,
    destinationGeneration,
    admittedAtMs,
  };
}
