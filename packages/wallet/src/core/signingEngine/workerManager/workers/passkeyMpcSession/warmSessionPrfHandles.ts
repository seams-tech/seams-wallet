import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { normalizeOptionalTrimmedString } from '@shared/utils/normalize';

type WarmSessionMaterialEntry = {
  readonly prfFirstHandle: string;
  expiresAtMs: number;
  remainingUses: number;
};

export type WarmSessionRevision = {
  readonly epoch: number;
  readonly revision: number;
};

type PasskeyPrfFirstHandleEntry = {
  readonly prfFirstB64u: string;
  readonly expiresAtMs: number;
};

export type OkResult = { ok: true; remainingUses: number; expiresAtMs: number };
type OkDispenseResult = OkResult & { prfFirstB64u: string };
export type ErrResult = { ok: false; code: string; message: string };
type WarmSessionMaterialReadResult =
  | ({ ok: true; entry: WarmSessionMaterialEntry; secret: PasskeyPrfFirstHandleEntry } & OkResult)
  | ErrResult;

function notFound(message: string): ErrResult {
  return { ok: false, code: 'not_found', message };
}

function usesNeeded(uses: number): number {
  return Math.max(1, Math.floor(Number(uses) || 1));
}

function exhausted(): ErrResult {
  return {
    ok: false,
    code: 'exhausted',
    message: 'Warm-session material exhausted for threshold session',
  };
}

/**
 * Warm-session PRF material for the passkey MPC session worker. Entries are
 * keyed by threshold session ID and point at a PRF handle; the PRF secret is
 * keyed by that handle. Writes that follow an await name the entry they read,
 * so a session that was cleared or replaced meanwhile is left as it is.
 */
export class WarmSessionPrfHandles {
  readonly #entries = new Map<string, WarmSessionMaterialEntry>();
  readonly #secrets = new Map<string, PasskeyPrfFirstHandleEntry>();
  readonly #revisions = new Map<string, number>();
  #epoch = 0;

  revision(thresholdSessionId: string): WarmSessionRevision {
    return {
      epoch: this.#epoch,
      revision: this.#revisions.get(thresholdSessionId) ?? 0,
    };
  }

  store(args: {
    thresholdSessionId: string;
    prfFirstB64u: string;
    expiresAtMs: number;
    remainingUses: number;
  }): void {
    const thresholdSessionId = normalizeOptionalTrimmedString(args.thresholdSessionId);
    const prfFirstB64u = normalizeOptionalTrimmedString(args.prfFirstB64u);
    const remainingUses = Math.floor(Number(args.remainingUses) || 0);
    const expiresAtMs = Math.floor(Number(args.expiresAtMs) || 0);
    if (!thresholdSessionId || remainingUses <= 0 || expiresAtMs <= Date.now()) {
      throw new Error('Invalid warm-session PRF handle input');
    }
    if (!prfFirstB64u) throw new Error('Invalid passkey PRF material handle input');
    this.delete(thresholdSessionId);
    const prfFirstHandle = `passkey-prf-first:${secureRandomBase64Url(
      32,
      'passkey confirm worker session IDs',
    )}`;
    this.#secrets.set(prfFirstHandle, { prfFirstB64u, expiresAtMs });
    this.#entries.set(thresholdSessionId, { prfFirstHandle, expiresAtMs, remainingUses });
  }

  /**
   * Stores rehydrated material only if the session was not cleared or replaced
   * since `expected` was taken.
   */
  rehydrate(args: {
    thresholdSessionId: string;
    expected: WarmSessionRevision;
    prfFirstB64u: string;
    expiresAtMs: number;
    remainingUses: number;
  }): OkResult | ErrResult {
    const thresholdSessionId = normalizeOptionalTrimmedString(args.thresholdSessionId);
    if (
      !thresholdSessionId ||
      this.#epoch !== args.expected.epoch ||
      (this.#revisions.get(thresholdSessionId) ?? 0) !== args.expected.revision
    ) {
      return notFound('Warm-session material changed while rehydration was in flight');
    }
    this.store(args);
    return {
      ok: true,
      remainingUses: Math.floor(Number(args.remainingUses) || 0),
      expiresAtMs: Math.floor(Number(args.expiresAtMs) || 0),
    };
  }

  read(thresholdSessionId: string): WarmSessionMaterialReadResult {
    if (!thresholdSessionId) {
      return { ok: false, code: 'invalid_args', message: 'Missing threshold sessionId' };
    }
    const entry = this.#entries.get(thresholdSessionId);
    if (!entry) return notFound('Warm-session material is not available for threshold session');
    if (Date.now() >= entry.expiresAtMs) {
      this.delete(thresholdSessionId);
      return {
        ok: false,
        code: 'expired',
        message: 'Warm-session material expired for threshold session',
      };
    }
    if (entry.remainingUses <= 0) {
      this.delete(thresholdSessionId);
      return exhausted();
    }
    const secret = this.#secrets.get(entry.prfFirstHandle);
    if (!secret || Date.now() >= secret.expiresAtMs) {
      this.delete(thresholdSessionId);
      return notFound('Warm-session material handle is not available for threshold session');
    }
    return {
      ok: true,
      entry,
      secret,
      remainingUses: entry.remainingUses,
      expiresAtMs: entry.expiresAtMs,
    };
  }

  readClaim(thresholdSessionId: string): OkResult | ErrResult {
    const active = this.read(thresholdSessionId);
    if (!active.ok) return active;
    return { ok: true, remainingUses: active.remainingUses, expiresAtMs: active.expiresAtMs };
  }

  /** Returns the PRF secret, and spends `uses` when `consume` is set. */
  claim(thresholdSessionId: string, uses: number, consume: boolean): OkDispenseResult | ErrResult {
    const active = this.read(thresholdSessionId);
    if (!active.ok) return active;
    const spent = consume
      ? this.#spend(thresholdSessionId, active.entry, uses)
      : this.#check(active.entry, uses);
    if (!spent.ok) return spent;
    return { ...spent, prfFirstB64u: active.secret.prfFirstB64u };
  }

  consume(thresholdSessionId: string, uses: number): OkResult | ErrResult {
    const active = this.read(thresholdSessionId);
    if (!active.ok) return active;
    return this.#spend(thresholdSessionId, active.entry, uses);
  }

  /**
   * Applies a server seal policy to `entry`, only if `entry` is still the
   * session's current entry and its PRF secret is still held.
   */
  applyPolicy(
    thresholdSessionId: string,
    entry: WarmSessionMaterialEntry,
    policy: OkResult,
  ): OkResult | ErrResult {
    const secret = this.#secrets.get(entry.prfFirstHandle);
    if (!this.#isCurrent(thresholdSessionId, entry) || !secret) {
      return notFound('Warm-session material changed while the seal was in flight');
    }
    this.#secrets.set(entry.prfFirstHandle, {
      prfFirstB64u: secret.prfFirstB64u,
      expiresAtMs: policy.expiresAtMs,
    });
    entry.remainingUses = policy.remainingUses;
    entry.expiresAtMs = policy.expiresAtMs;
    return policy;
  }

  /** Deletes the session only if `entry` is still its current entry. */
  deleteEntry(thresholdSessionId: string, entry: WarmSessionMaterialEntry): void {
    if (this.#isCurrent(thresholdSessionId, entry)) this.delete(thresholdSessionId);
  }

  delete(thresholdSessionId: string): void {
    this.#revisions.set(thresholdSessionId, (this.#revisions.get(thresholdSessionId) ?? 0) + 1);
    const entry = this.#entries.get(thresholdSessionId);
    if (entry) this.#secrets.delete(entry.prfFirstHandle);
    this.#entries.delete(thresholdSessionId);
  }

  clear(): void {
    this.#epoch += 1;
    this.#revisions.clear();
    this.#entries.clear();
    this.#secrets.clear();
  }

  #isCurrent(thresholdSessionId: string, entry: WarmSessionMaterialEntry): boolean {
    return this.#entries.get(thresholdSessionId) === entry;
  }

  #check(entry: WarmSessionMaterialEntry, uses: number): OkResult | ErrResult {
    if (entry.remainingUses < usesNeeded(uses)) return exhausted();
    return { ok: true, remainingUses: entry.remainingUses, expiresAtMs: entry.expiresAtMs };
  }

  #spend(
    thresholdSessionId: string,
    entry: WarmSessionMaterialEntry,
    uses: number,
  ): OkResult | ErrResult {
    const checked = this.#check(entry, uses);
    if (!checked.ok) return checked;
    entry.remainingUses -= usesNeeded(uses);
    if (entry.remainingUses <= 0) this.delete(thresholdSessionId);
    return { ok: true, remainingUses: entry.remainingUses, expiresAtMs: entry.expiresAtMs };
  }
}
