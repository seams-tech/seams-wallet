import {
  parseMlDsaSigningSessionPreparation,
  parseMlDsaSigningSessionRequest as parseMlDsaSessionRequest,
  type MlDsaSigningSessionRequest,
  type MlDsaSigningSessionPreparation,
  type MlDsaSigningAuthorization,
  type MlDsaSigningSessionCredential,
} from '@shared/near/mlDsaSigningSession';
import {
  parseMlDsaSignedTransaction,
  parseMlDsaSigningFailure,
  type MlDsaSigningFailure,
  type MlDsaSigningOutcome,
} from '@shared/near/mlDsaSigning';
import {
  parseDigestB64u,
  sha256Utf8DigestB64u,
  type DigestB64u,
} from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify } from '@shared/utils/digests';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { SessionOrigin } from '../../../../authorization/domain';
import type { WebAuthnAuthenticationCredential } from '../../../../core/types';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import type { CloudflareD1WebAuthnStore } from '../webauthn/d1WebAuthnStore';
import { verifyWebAuthnAuthenticationLiteWithStore } from '../../../../core/authService/webauthn';
import { normalizeLogger } from '../../../../core/logger';
import { D1MlDsaWebAuthnVerification } from './d1MlDsaWebAuthnVerification';
import { CloudflareD1VersionedJsonRecordStore } from '../versionedJson/d1VersionedJsonRecordStore';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import {
  encodeMlDsaSigningRecord,
  parseMlDsaSigningRecord,
  type MlDsaSigningRecord,
} from './mlDsaSigningRecord';
import { timingSafeEqual } from 'node:crypto';
import { base64UrlDecode } from '@shared/utils/base64';

type SessionAuthorization = Exclude<
  MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>,
  { kind: 'passkey' }
>;
type TerminalOutcome = Exclude<MlDsaSigningOutcome, { kind: 'retry' }>;
type Grant = {
  readonly request: MlDsaSigningSessionRequest;
  readonly preparation: MlDsaSigningSessionPreparation;
  readonly source: MlDsaSigningRecord;
  readonly phase: ReadonlyExclusiveUnion<
    | { readonly kind: 'awaiting_approval' }
    | { readonly kind: 'revoked' }
    | {
        readonly kind: 'active';
        readonly remainingOperations: number;
        readonly assertionDigest: DigestB64u;
      }
  >;
};
type SessionResult = { readonly sessionIdB64u: DigestB64u; readonly outcome: TerminalOutcome };

class ApprovedSessionOperation {
  private readonly verifiedSessionAdmission = true;
  constructor(
    readonly record: MlDsaSigningRecord,
    readonly sessionIdB64u: DigestB64u,
    readonly expiresAtMs: number,
  ) {
    void this.verifiedSessionAdmission;
  }
}
export type ApprovedMlDsaSessionOperation = ApprovedSessionOperation;

function refusal(code: MlDsaSigningFailure['code'], message: string): MlDsaSigningFailure {
  return { kind: 'refused', code, message };
}
function keyForOperation(record: MlDsaSigningRecord): string {
  return JSON.stringify([
    record.preparation.request.walletId,
    record.preparation.request.operationIdB64u,
  ]);
}
function sameScope(left: MlDsaSigningRecord, right: MlDsaSigningRecord): boolean {
  return (
    alphabetizeStringify(left.target) === alphabetizeStringify(right.target) &&
    left.publicationVersion === right.publicationVersion &&
    left.origin === right.origin &&
    left.owner.authorityDigestB64u === right.owner.authorityDigestB64u &&
    left.owner.revocationEpoch === right.owner.revocationEpoch &&
    left.preparation.request.rpId === right.preparation.request.rpId &&
    left.preparation.request.credentialIdB64u === right.preparation.request.credentialIdB64u
  );
}
function encodeGrant(grant: Grant): VersionedJsonObject {
  return {
    request: {
      walletId: grant.request.walletId,
      operationIdB64u: grant.request.operationIdB64u,
      tokenDigestB64u: grant.request.tokenDigestB64u,
      maxOperations: grant.request.maxOperations,
      durationMs: grant.request.durationMs,
    },
    preparation: {
      sessionIdB64u: grant.preparation.sessionIdB64u,
      challengeB64u: grant.preparation.challengeB64u,
      expiresAtMs: grant.preparation.expiresAtMs,
      maxOperations: grant.preparation.maxOperations,
    },
    source: encodeMlDsaSigningRecord(grant.source),
    phase:
      grant.phase.kind !== 'active'
        ? { kind: grant.phase.kind }
        : {
            kind: 'active',
            remainingOperations: grant.phase.remainingOperations,
            assertionDigest: grant.phase.assertionDigest,
          },
  };
}
function parseGrant(raw: unknown): Grant | null {
  try {
    const r = exactRecord(
      raw,
      ['request', 'preparation', 'source', 'phase'],
      'ML-DSA session grant',
    );
    const request = requireRecord(r.request, 'ML-DSA session request');
    const source = parseMlDsaSigningRecord(r.source);
    if (!source || source.phase.kind !== 'awaiting_approval') return null;
    const preparation = parseMlDsaSigningSessionPreparation(r.preparation);
    const phase = requireRecord(r.phase, 'ML-DSA session phase');
    let parsedPhase: Grant['phase'];
    if (phase.kind === 'awaiting_approval' || phase.kind === 'revoked') {
      exactRecord(phase, ['kind'], 'ML-DSA pending session');
      parsedPhase = { kind: phase.kind };
    } else {
      exactRecord(
        phase,
        ['kind', 'remainingOperations', 'assertionDigest'],
        'ML-DSA active session',
      );
      if (
        phase.kind !== 'active' ||
        typeof phase.remainingOperations !== 'number' ||
        !Number.isSafeInteger(phase.remainingOperations) ||
        phase.remainingOperations < 0 ||
        phase.remainingOperations > preparation.maxOperations
      )
        return null;
      parsedPhase = {
        kind: 'active',
        remainingOperations: phase.remainingOperations,
        assertionDigest: parseDigestB64u(phase.assertionDigest),
      };
    }
    const policy = parseMlDsaSessionRequest(request);
    if (
      policy.walletId !== source.target.identity.walletId ||
      policy.operationIdB64u !== source.preparation.request.operationIdB64u ||
      policy.maxOperations !== preparation.maxOperations
    )
      return null;
    return { request: policy, preparation, source, phase: parsedPhase };
  } catch {
    return null;
  }
}

function encodeResult(result: SessionResult): VersionedJsonObject {
  return { sessionIdB64u: result.sessionIdB64u, outcomeJson: JSON.stringify(result.outcome) };
}
function parseResult(raw: unknown): SessionResult | null {
  try {
    const r = exactRecord(raw, ['sessionIdB64u', 'outcomeJson'], 'ML-DSA session operation result');
    const outcome = requireRecord(
      JSON.parse(requireCanonicalString(r.outcomeJson, 'outcomeJson')),
      'ML-DSA result',
    );
    return {
      sessionIdB64u: parseDigestB64u(r.sessionIdB64u),
      outcome:
        outcome.kind === 'signed'
          ? { kind: 'signed', transaction: parseMlDsaSignedTransaction(outcome.transaction) }
          : parseMlDsaSigningFailure(outcome),
    };
  } catch {
    return null;
  }
}
function approvedRecord(record: MlDsaSigningRecord, sessionIdB64u: DigestB64u): MlDsaSigningRecord {
  return {
    preparation: record.preparation,
    target: record.target,
    owner: record.owner,
    publicationVersion: record.publicationVersion,
    origin: record.origin,
    phase: { kind: 'session_approved', sessionIdB64u },
  };
}

/** Key-scoped approval grants. Each operation debits its budget exactly once. */
export class D1MlDsaSigningSessions {
  private readonly grants: CloudflareD1VersionedJsonRecordStore<Grant>;
  private readonly results: CloudflareD1VersionedJsonRecordStore<SessionResult>;
  constructor(
    private readonly options: {
      readonly database: D1DatabaseLike;
      readonly scope: D1TenantScope;
      readonly operations: CloudflareD1VersionedJsonRecordStore<MlDsaSigningRecord>;
      readonly webAuthnStore: CloudflareD1WebAuthnStore;
      readonly guard: (
        record: MlDsaSigningRecord,
        allowDraining: boolean,
      ) => D1PreparedStatementLike;
    },
  ) {
    this.grants = new CloudflareD1VersionedJsonRecordStore({
      database: options.database,
      scope: options.scope,
      keyPrefix: 'ml-dsa-session',
      encode: encodeGrant,
      parse: parseGrant,
    });
    this.results = new CloudflareD1VersionedJsonRecordStore({
      database: options.database,
      scope: options.scope,
      keyPrefix: 'ml-dsa-session-result',
      encode: encodeResult,
      parse: parseResult,
    });
  }
  async prepare(request: MlDsaSigningSessionRequest, source: MlDsaSigningRecord) {
    if (source.phase.kind !== 'awaiting_approval')
      return refusal('conflict', 'The operation already has an approval');
    const sessionIdB64u = await sha256Utf8DigestB64u(
      `seams/ml-dsa/session/v1|${keyForOperation(source)}`,
    );
    const existing = await this.grants.read(sessionIdB64u);
    if (existing.kind === 'present') {
      if (
        alphabetizeStringify(existing.value.request) !== alphabetizeStringify(request) ||
        !sameScope(existing.value.source, source)
      )
        return refusal('idempotency_conflict', 'The ML-DSA session request changed');
      if (existing.value.preparation.expiresAtMs <= Date.now())
        return refusal('expired', 'The ML-DSA session expired');
      if (existing.value.phase.kind === 'revoked')
        return refusal('unauthorized', 'The ML-DSA session was revoked');
      return { kind: 'prepared' as const, preparation: existing.value.preparation };
    }
    const expiresAtMs = Date.now() + request.durationMs;
    const challengeB64u = await sha256Utf8DigestB64u(
      `seams/ml-dsa/session-approval/v1|${alphabetizeStringify({ request, sessionIdB64u, expiresAtMs, transactionChallenge: source.preparation.challengeB64u, origin: source.origin, publicationVersion: source.publicationVersion })}`,
    );
    const grant: Grant = {
      request,
      preparation: {
        sessionIdB64u,
        challengeB64u,
        expiresAtMs,
        maxOperations: request.maxOperations,
      },
      source,
      phase: { kind: 'awaiting_approval' },
    };
    const stored = await this.grants.putManyWithAdditionalStatements(
      [{ key: sessionIdB64u, value: grant, expectedVersion: null }],
      [this.options.guard(source, false)],
    );
    if (stored.kind !== 'stored')
      return refusal('conflict', 'The ML-DSA session preparation changed');
    return { kind: 'prepared' as const, preparation: grant.preparation };
  }
  async admit(input: {
    readonly authorization: SessionAuthorization;
    readonly record: MlDsaSigningRecord;
    readonly recordVersion: string;
    readonly origin: SessionOrigin;
  }): Promise<
    | { readonly kind: 'approved'; readonly admission: ApprovedMlDsaSessionOperation }
    | MlDsaSigningFailure
  > {
    const { authorization, record } = input;
    const read = await this.grants.read(authorization.sessionIdB64u);
    if (read.kind !== 'present')
      return refusal('unauthorized', 'The ML-DSA signing session is absent');
    const grant = read.value;
    const tokenMatches = timingSafeEqual(
      base64UrlDecode(
        await sha256Utf8DigestB64u(`seams/ml-dsa/session-token/v1|${authorization.tokenB64u}`),
      ),
      base64UrlDecode(grant.request.tokenDigestB64u),
    );
    if (
      grant.preparation.sessionIdB64u !== authorization.sessionIdB64u ||
      input.origin !== record.origin ||
      !sameScope(grant.source, record) ||
      !tokenMatches ||
      grant.phase.kind === 'revoked'
    )
      return refusal(
        'unauthorized',
        'The ML-DSA signing session belongs to a different key or owner',
      );
    if (Date.now() >= grant.preparation.expiresAtMs)
      return refusal('expired', 'The ML-DSA signing session expired');
    if (record.phase.kind === 'approved')
      return refusal('idempotency_conflict', 'The operation already has passkey approval');
    if (record.phase.kind === 'session_approved') {
      if (
        record.phase.sessionIdB64u !== authorization.sessionIdB64u ||
        grant.phase.kind !== 'active'
      )
        return refusal('idempotency_conflict', 'The signing session changed');
      return {
        kind: 'approved',
        admission: new ApprovedSessionOperation(
          record,
          authorization.sessionIdB64u,
          Math.min(grant.preparation.expiresAtMs, record.preparation.expiresAtMs),
        ),
      };
    }
    let counter: D1MlDsaWebAuthnVerification | null = null;
    let assertionDigest: DigestB64u;
    let remainingOperations: number;
    if (grant.phase.kind === 'awaiting_approval') {
      if (
        authorization.kind !== 'session_start' ||
        keyForOperation(grant.source) !== keyForOperation(record) ||
        Date.now() >= grant.source.preparation.expiresAtMs
      )
        return refusal('unauthorized', 'The ML-DSA session requires its initial owner approval');
      const credential = authorization.credential;
      if (
        credential.id !== record.preparation.request.credentialIdB64u ||
        credential.rawId !== credential.id
      )
        return refusal('unauthorized', 'The ML-DSA session credential differs');
      counter = new D1MlDsaWebAuthnVerification(this.options.webAuthnStore);
      const verified = await verifyWebAuthnAuthenticationLiteWithStore({
        userId: record.target.identity.walletId,
        rpId: record.preparation.request.rpId,
        expectedOrigin: input.origin,
        expectedChallenge: grant.preparation.challengeB64u,
        webauthnAuthentication: credential,
        authenticatorStore: counter,
        logger: normalizeLogger(),
      });
      if (!verified.success || !verified.verified)
        return refusal('unauthorized', 'The ML-DSA session approval failed');
      assertionDigest = await sha256Utf8DigestB64u(alphabetizeStringify(credential));
      remainingOperations = grant.request.maxOperations - 1;
    } else {
      if (authorization.kind !== 'session' || grant.phase.remainingOperations === 0)
        return refusal('unauthorized', 'The ML-DSA session budget is exhausted');
      assertionDigest = grant.phase.assertionDigest;
      remainingOperations = grant.phase.remainingOperations - 1;
    }
    const next: Grant = {
      request: grant.request,
      preparation: grant.preparation,
      source: grant.source,
      phase: { kind: 'active', assertionDigest, remainingOperations },
    };
    const approved = approvedRecord(record, authorization.sessionIdB64u);
    const statements = [
      this.options.guard(record, false),
      ...this.options.operations.prepareMutationStatements([
        { key: keyForOperation(record), value: approved, expectedVersion: input.recordVersion },
      ]),
      ...(counter === null ? [] : counter.statements(this.options.database, this.options.scope)),
    ];
    const stored = await this.grants.putManyWithAdditionalStatements(
      [{ key: authorization.sessionIdB64u, value: next, expectedVersion: read.version }],
      statements,
    );
    if (stored.kind !== 'stored')
      return refusal('conflict', 'ML-DSA session admission changed; retry the same operation');
    return {
      kind: 'approved',
      admission: new ApprovedSessionOperation(
        approved,
        authorization.sessionIdB64u,
        Math.min(grant.preparation.expiresAtMs, record.preparation.expiresAtMs),
      ),
    };
  }
  async result(admission: ApprovedMlDsaSessionOperation): Promise<TerminalOutcome | null> {
    const read = await this.results.read(keyForOperation(admission.record));
    if (read.kind !== 'present') return null;
    if (read.value.sessionIdB64u !== admission.sessionIdB64u)
      throw new Error('The ML-DSA session result scope differs');
    return read.value.outcome;
  }
  async active(admission: ApprovedMlDsaSessionOperation): Promise<boolean> {
    const read = await this.grants.read(admission.sessionIdB64u);
    return (
      read.kind === 'present' &&
      read.value.phase.kind === 'active' &&
      read.value.preparation.expiresAtMs > Date.now() &&
      sameScope(read.value.source, admission.record)
    );
  }
  async revoke(request: MlDsaSigningSessionCredential, origin: SessionOrigin) {
    const read = await this.grants.read(request.sessionIdB64u);
    if (read.kind !== 'present') return refusal('not_found', 'The ML-DSA session is absent');
    const grant = read.value;
    if (
      grant.source.origin !== origin ||
      grant.request.walletId !== request.walletId ||
      !timingSafeEqual(
        base64UrlDecode(
          await sha256Utf8DigestB64u(`seams/ml-dsa/session-token/v1|${request.tokenB64u}`),
        ),
        base64UrlDecode(grant.request.tokenDigestB64u),
      )
    )
      return refusal('unauthorized', 'The ML-DSA session credential differs');
    if (grant.phase.kind === 'revoked') return { kind: 'revoked' as const };
    const next: Grant = {
      request: grant.request,
      preparation: grant.preparation,
      source: grant.source,
      phase: { kind: 'revoked' },
    };
    const stored = await this.grants.put(request.sessionIdB64u, next, read.version);
    if (stored.kind !== 'stored')
      return refusal('conflict', 'The ML-DSA session changed; retry revocation');
    return { kind: 'revoked' as const };
  }
  async complete(
    admission: ApprovedMlDsaSessionOperation,
    outcome: TerminalOutcome,
  ): Promise<TerminalOutcome> {
    await this.results.put(
      keyForOperation(admission.record),
      { sessionIdB64u: admission.sessionIdB64u, outcome },
      null,
    );
    const saved = await this.result(admission);
    if (saved === null) throw new Error('The ML-DSA session result was not retained');
    return saved;
  }
}
