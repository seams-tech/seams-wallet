import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from './storage/tenantRoute';

export const LOCAL_INTENDED_YAO_FINALIZE_FAULT_HEADER_V1 = 'x-seams-intended-yao-finalize-fault-v1';
export const LOCAL_INTENDED_YAO_FINALIZE_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-finalize-fault-token-v1';
/* The proof rides the Yao fault proof header, which the intended suite
   collects from every response. */
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
export const WALLET_REGISTRATION_NEAR_PROVISIONING_PATH_V1 = '/wallets/register/near-provisioning';

/**
 * The Gateway loses its storage once, right after the batch that made an
 * Ed25519 Yao registration visible committed the lifecycle's decision: the
 * finalize's next storage call fails. The finalize reports a retryable
 * failure, and a retry must resume from the decision instead of committing
 * the registration again.
 */
type LocalIntendedYaoFinalizeFaultModeV1 = 'lose_storage_after_decision_once';

type LocalIntendedYaoFinalizeFaultProofV1 = 'decision_committed_then_storage_lost';

type LocalIntendedYaoFinalizeFaultViolationV1 =
  | 'decision_not_committed'
  | 'no_storage_call_after_decision';

type LocalIntendedYaoFinalizeFaultStateV1 =
  | { readonly kind: 'armed' }
  | { readonly kind: 'decided' }
  | { readonly kind: 'proved' };

const DECISION_INSERT_PATTERN = /^\s*INSERT OR IGNORE INTO yao_lifecycle_decisions\b/;

export function parseLocalIntendedYaoFinalizeFaultModeV1(
  value: string | null,
): LocalIntendedYaoFinalizeFaultModeV1 | null {
  return value === 'lose_storage_after_decision_once' ? value : null;
}

export function parseLocalIntendedYaoFinalizeFaultTokenV1(value: string | null): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

/** The signer database, losing itself once after a Yao decision commits. */
export class LocalIntendedYaoFinalizeFaultDatabaseV1 implements D1DatabaseLike {
  private state: LocalIntendedYaoFinalizeFaultStateV1 = { kind: 'armed' };

  constructor(private readonly base: D1DatabaseLike) {}

  prepare(query: string): D1PreparedStatementLike {
    return new LocalIntendedYaoFinalizeFaultStatementV1(
      this,
      DECISION_INSERT_PATTERN.test(query),
      this.base.prepare(query),
    );
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    this.loseStorageIfDecided();
    const decides = statements.some(
      (statement) => statement instanceof LocalIntendedYaoFinalizeFaultStatementV1 && statement.decides,
    );
    const results = await this.base.batch<T>(statements.map(unwrapStatement));
    if (decides && this.state.kind === 'armed') this.state = { kind: 'decided' };
    return results;
  }

  async exec(query: string): Promise<unknown> {
    this.loseStorageIfDecided();
    return await this.base.exec(query);
  }

  loseStorageIfDecided(): void {
    if (this.state.kind !== 'decided') return;
    this.state = { kind: 'proved' };
    throw new Error(
      'Local intended fault: the Gateway lost its storage after an Ed25519 Yao decision committed',
    );
  }

  outcome():
    | { readonly kind: 'proved'; readonly proof: LocalIntendedYaoFinalizeFaultProofV1 }
    | { readonly kind: 'violated'; readonly violation: LocalIntendedYaoFinalizeFaultViolationV1 } {
    switch (this.state.kind) {
      case 'proved':
        return { kind: 'proved', proof: 'decision_committed_then_storage_lost' };
      case 'decided':
        return { kind: 'violated', violation: 'no_storage_call_after_decision' };
      case 'armed':
        return { kind: 'violated', violation: 'decision_not_committed' };
    }
  }
}

class LocalIntendedYaoFinalizeFaultStatementV1 implements D1PreparedStatementLike {
  constructor(
    private readonly database: LocalIntendedYaoFinalizeFaultDatabaseV1,
    readonly decides: boolean,
    readonly inner: D1PreparedStatementLike,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new LocalIntendedYaoFinalizeFaultStatementV1(
      this.database,
      this.decides,
      this.inner.bind(...values),
    );
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    this.database.loseStorageIfDecided();
    return await this.inner.first<T>(columnName);
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    this.database.loseStorageIfDecided();
    return await this.inner.all<T>();
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    this.database.loseStorageIfDecided();
    return await this.inner.run<T>();
  }
}

function unwrapStatement(statement: D1PreparedStatementLike): D1PreparedStatementLike {
  return statement instanceof LocalIntendedYaoFinalizeFaultStatementV1 ? statement.inner : statement;
}

export function requestWithoutLocalIntendedYaoFinalizeFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_YAO_FINALIZE_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_YAO_FINALIZE_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedYaoFinalizeFaultOutcomeV1(
  response: Response,
  outcome: ReturnType<LocalIntendedYaoFinalizeFaultDatabaseV1['outcome']>,
  token: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(
    LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1,
    outcome.kind === 'proved' ? `${token}:${outcome.proof}` : `${token}:violated:${outcome.violation}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
