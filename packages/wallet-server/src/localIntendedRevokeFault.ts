import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from './storage/tenantRoute';

export const LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1 = 'x-seams-intended-revoke-fault-v1';
export const LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-revoke-fault-token-v1';
const LOCAL_INTENDED_REVOKE_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-revoke-fault-proof-v1';
export const WALLET_REVOKE_AUTH_METHOD_PATH_PATTERN_V1 =
  /^\/wallets\/[^/]+\/auth-methods\/[^/]+\/revoke$/;
/** A linked device's method, revoked through device management. */
export const LINKED_DEVICE_REVOKE_PATH_PATTERN_V1 =
  /^\/wallet\/device-linking\/v1\/devices\/[^/]+\/revoke$/;

/**
 * `refuse_revocation_batch_once` refuses the batch that would revoke an auth
 * method, directly or as a linked device's, and record its answer, as a
 * commit that failed: nothing in it is written. The proof says whether that batch carried the spend of the
 * request's Email OTP code, and whether anything spent a code outside it. A
 * code spent before its revocation commits is lost with a failed commit, and
 * the request could not be sent again.
 */
type LocalIntendedRevokeFaultModeV1 = 'refuse_revocation_batch_once';

type LocalIntendedRevokeFaultProofV1 =
  'refused_revocation_with_its_code' | 'refused_revocation_without_code';

type LocalIntendedRevokeFaultViolationV1 =
  'revocation_batch_not_observed' | 'code_spent_outside_revocation' | 'additional_revocation_batch';

type LocalIntendedRevokeFaultStateV1 =
  | { readonly kind: 'armed' }
  | { readonly kind: 'proved'; readonly proof: LocalIntendedRevokeFaultProofV1 }
  | { readonly kind: 'violated'; readonly violation: LocalIntendedRevokeFaultViolationV1 };

const RECORD_ANSWER_PATTERN = /^\s*INSERT OR IGNORE INTO wallet_auth_method_revocation_replays\b/;
/* A spend names its challenge. The sweep of expired challenges does not. */
const SPEND_CODE_PATTERN = /^\s*DELETE FROM email_otp_challenges\b[\s\S]*\bchallenge_id = \?/;

export function parseLocalIntendedRevokeFaultModeV1(
  value: string | null,
): LocalIntendedRevokeFaultModeV1 | null {
  return value === 'refuse_revocation_batch_once' ? value : null;
}

export function parseLocalIntendedRevokeFaultTokenV1(value: string | null): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

/** The signer database, refusing one auth-method revocation's batch. */
export class LocalIntendedRevokeFaultDatabaseV1 implements D1DatabaseLike {
  private state: LocalIntendedRevokeFaultStateV1 = { kind: 'armed' };

  constructor(private readonly base: D1DatabaseLike) {}

  prepare(query: string): D1PreparedStatementLike {
    return new LocalIntendedRevokeFaultStatementV1(
      this,
      RECORD_ANSWER_PATTERN.test(query),
      SPEND_CODE_PATTERN.test(query),
      this.base.prepare(query),
    );
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const faulted = statements.filter(
      (statement): statement is LocalIntendedRevokeFaultStatementV1 =>
        statement instanceof LocalIntendedRevokeFaultStatementV1,
    );
    if (!faulted.some((statement) => statement.recordsAnswer)) {
      return await this.base.batch<T>(statements.map(unwrapStatement));
    }
    if (this.state.kind === 'armed') {
      this.state = {
        kind: 'proved',
        proof: faulted.some((statement) => statement.spendsCode)
          ? 'refused_revocation_with_its_code'
          : 'refused_revocation_without_code',
      };
    } else if (this.state.kind === 'proved') {
      this.state = { kind: 'violated', violation: 'additional_revocation_batch' };
    }
    throw new Error('Local intended fault: the auth-method revocation batch did not commit');
  }

  async exec(query: string): Promise<unknown> {
    return await this.base.exec(query);
  }

  spentCodeOutsideRevocation(): void {
    this.state = { kind: 'violated', violation: 'code_spent_outside_revocation' };
  }

  outcome():
    | { readonly kind: 'proved'; readonly proof: LocalIntendedRevokeFaultProofV1 }
    | { readonly kind: 'violated'; readonly violation: LocalIntendedRevokeFaultViolationV1 } {
    switch (this.state.kind) {
      case 'proved':
      case 'violated':
        return this.state;
      case 'armed':
        return { kind: 'violated', violation: 'revocation_batch_not_observed' };
    }
  }
}

class LocalIntendedRevokeFaultStatementV1 implements D1PreparedStatementLike {
  constructor(
    private readonly database: LocalIntendedRevokeFaultDatabaseV1,
    readonly recordsAnswer: boolean,
    readonly spendsCode: boolean,
    readonly inner: D1PreparedStatementLike,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new LocalIntendedRevokeFaultStatementV1(
      this.database,
      this.recordsAnswer,
      this.spendsCode,
      this.inner.bind(...values),
    );
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    this.observeOwnRun();
    return await this.inner.first<T>(columnName);
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    this.observeOwnRun();
    return await this.inner.all<T>();
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    this.observeOwnRun();
    return await this.inner.run<T>();
  }

  private observeOwnRun(): void {
    if (this.spendsCode) this.database.spentCodeOutsideRevocation();
  }
}

function unwrapStatement(statement: D1PreparedStatementLike): D1PreparedStatementLike {
  return statement instanceof LocalIntendedRevokeFaultStatementV1 ? statement.inner : statement;
}

export function requestWithoutLocalIntendedRevokeFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedRevokeFaultOutcomeV1(
  response: Response,
  outcome: ReturnType<LocalIntendedRevokeFaultDatabaseV1['outcome']>,
  token: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(
    LOCAL_INTENDED_REVOKE_FAULT_PROOF_HEADER_V1,
    outcome.kind === 'proved'
      ? `${token}:${outcome.proof}`
      : `${token}:violation:${outcome.violation}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
