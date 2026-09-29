import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from './storage/tenantRoute';

export const LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1 = 'x-seams-intended-yao-export-fault-v1';
export const LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-export-fault-token-v1';
/* The proof rides the Yao fault proof header, which the intended suite
   collects from every response. */
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';

/**
 * An Ed25519 Yao export admission loses the Gateway's storage once, right
 * after the batch that authorized the export committed: its next storage call
 * fails, and the request ends there. The identical request is then sent
 * again, and must admit the export from the authorization that batch made
 * durable. Local only.
 */
type LocalIntendedYaoExportFaultModeV1 = 'lose_storage_after_export_authorization_once';

type LocalIntendedYaoExportFaultProofV1 = 'export_authorization_committed_then_storage_lost';

type LocalIntendedYaoExportFaultViolationV1 =
  | 'export_authorization_not_committed'
  | 'no_storage_call_after_authorization'
  | 'interrupted_admission_answered'
  | 'retried_admission_failed';

type LocalIntendedYaoExportFaultStateV1 =
  { readonly kind: 'armed' } | { readonly kind: 'authorized' } | { readonly kind: 'lost' };

type LocalIntendedYaoExportFaultOutcomeV1 =
  | { readonly kind: 'proved'; readonly proof: LocalIntendedYaoExportFaultProofV1 }
  | { readonly kind: 'violated'; readonly violation: LocalIntendedYaoExportFaultViolationV1 };

/* The authorization batch holds the export's authorized operation and the
   state records that authorize it; either alone is some other write. */
type StatementRoleV1 = 'authorized_operation' | 'state_record' | 'other';

const AUTHORIZED_OPERATION_INSERT_PATTERN = /^\s*INSERT INTO authorized_operations\b/;
const STATE_RECORD_WRITE_PATTERN =
  /^\s*(?:INSERT OR IGNORE INTO|UPDATE)\s+router_ab_yao_versioned_json_records\b/;

export function parseLocalIntendedYaoExportFaultModeV1(
  value: string | null,
): LocalIntendedYaoExportFaultModeV1 | null {
  return value === 'lose_storage_after_export_authorization_once' ? value : null;
}

export function parseLocalIntendedYaoExportFaultTokenV1(value: string | null): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

/** The signer database, losing itself once after an export authorization commits. */
export class LocalIntendedYaoExportFaultDatabaseV1 implements D1DatabaseLike {
  private state: LocalIntendedYaoExportFaultStateV1 = { kind: 'armed' };

  constructor(private readonly base: D1DatabaseLike) {}

  prepare(query: string): D1PreparedStatementLike {
    return new LocalIntendedYaoExportFaultStatementV1(
      this,
      statementRole(query),
      this.base.prepare(query),
    );
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    this.loseStorageIfAuthorized();
    const roles = new Set(statements.map(roleOf));
    const results = await this.base.batch<T>(statements.map(unwrapStatement));
    if (
      roles.has('authorized_operation') &&
      roles.has('state_record') &&
      this.state.kind === 'armed'
    ) {
      this.state = { kind: 'authorized' };
    }
    return results;
  }

  async exec(query: string): Promise<unknown> {
    this.loseStorageIfAuthorized();
    return await this.base.exec(query);
  }

  loseStorageIfAuthorized(): void {
    if (this.state.kind !== 'authorized') return;
    this.state = { kind: 'lost' };
    throw new Error(
      'Local intended fault: the Gateway lost its storage after an Ed25519 Yao export authorization committed',
    );
  }

  /** The fault's outcome, from whether each of the two identical requests was admitted. */
  outcome(answers: {
    readonly interruptedOk: boolean;
    readonly retriedOk: boolean;
  }): LocalIntendedYaoExportFaultOutcomeV1 {
    switch (this.state.kind) {
      case 'armed':
        return { kind: 'violated', violation: 'export_authorization_not_committed' };
      case 'authorized':
        return { kind: 'violated', violation: 'no_storage_call_after_authorization' };
      case 'lost':
        break;
    }
    if (answers.interruptedOk) {
      return { kind: 'violated', violation: 'interrupted_admission_answered' };
    }
    if (!answers.retriedOk) return { kind: 'violated', violation: 'retried_admission_failed' };
    return { kind: 'proved', proof: 'export_authorization_committed_then_storage_lost' };
  }
}

class LocalIntendedYaoExportFaultStatementV1 implements D1PreparedStatementLike {
  constructor(
    private readonly database: LocalIntendedYaoExportFaultDatabaseV1,
    readonly role: StatementRoleV1,
    readonly inner: D1PreparedStatementLike,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new LocalIntendedYaoExportFaultStatementV1(
      this.database,
      this.role,
      this.inner.bind(...values),
    );
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    this.database.loseStorageIfAuthorized();
    return await this.inner.first<T>(columnName);
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    this.database.loseStorageIfAuthorized();
    return await this.inner.all<T>();
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    this.database.loseStorageIfAuthorized();
    return await this.inner.run<T>();
  }
}

function statementRole(query: string): StatementRoleV1 {
  if (AUTHORIZED_OPERATION_INSERT_PATTERN.test(query)) return 'authorized_operation';
  if (STATE_RECORD_WRITE_PATTERN.test(query)) return 'state_record';
  return 'other';
}

function roleOf(statement: D1PreparedStatementLike): StatementRoleV1 {
  return statement instanceof LocalIntendedYaoExportFaultStatementV1 ? statement.role : 'other';
}

function unwrapStatement(statement: D1PreparedStatementLike): D1PreparedStatementLike {
  return statement instanceof LocalIntendedYaoExportFaultStatementV1 ? statement.inner : statement;
}

export function requestWithoutLocalIntendedYaoExportFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedYaoExportFaultOutcomeV1(
  response: Response,
  outcome: LocalIntendedYaoExportFaultOutcomeV1,
  token: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(
    LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1,
    outcome.kind === 'proved'
      ? `${token}:${outcome.proof}`
      : `${token}:violated:${outcome.violation}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
