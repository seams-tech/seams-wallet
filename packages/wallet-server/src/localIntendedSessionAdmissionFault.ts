import { isLocalIntendedYaoFaultTokenV1 } from './localIntendedYaoFault';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from './storage/tenantRoute';

export const LOCAL_INTENDED_SESSION_ADMISSION_FAULT_HEADER_V1 =
  'x-seams-intended-session-admission-fault-v1';
export const LOCAL_INTENDED_SESSION_ADMISSION_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-session-admission-fault-token-v1';
export const LOCAL_INTENDED_SESSION_ADMISSION_FAULT_PROOF_HEADER_V1 =
  'x-seams-intended-session-admission-fault-proof-v1';
/** The ECDSA signing prepare: it admits the Wallet Session's operation credential. */
export const ECDSA_SIGN_PREPARE_PATH_V1 = '/router-ab/ecdsa-derivation/sign/prepare';

/**
 * `hold_after_session_read_until_authority_changes` lets the request's first
 * operation-credential session read return, then holds the request until the
 * wallet's stored authority digest differs from the one that read saw: another
 * request, NEAR provisioning extending the authority, committed in between.
 * The request then continues. Admission read the authority again at this
 * point before it judged one snapshot, and paired the session with the newer
 * authority.
 */
type LocalIntendedSessionAdmissionFaultModeV1 = 'hold_after_session_read_until_authority_changes';

type LocalIntendedSessionAdmissionFaultProofV1 = 'held_until_authority_changed';

type LocalIntendedSessionAdmissionFaultViolationV1 =
  | 'session_read_not_observed'
  | 'authority_unchanged';

type LocalIntendedSessionAdmissionFaultStateV1 =
  | { readonly kind: 'armed' }
  | { readonly kind: 'proved'; readonly proof: LocalIntendedSessionAdmissionFaultProofV1 }
  | {
      readonly kind: 'violated';
      readonly violation: LocalIntendedSessionAdmissionFaultViolationV1;
    };

const SESSION_READ_PATTERN =
  /FROM wallet_session_authorizations_v2 AS session[\s\S]*\bsession\.operation_credential_hash = \?/;
const HOLD_LIMIT_MS = 60_000;
const POLL_INTERVAL_MS = 50;

export function parseLocalIntendedSessionAdmissionFaultModeV1(
  value: string | null,
): LocalIntendedSessionAdmissionFaultModeV1 | null {
  return value === 'hold_after_session_read_until_authority_changes' ? value : null;
}

export function parseLocalIntendedSessionAdmissionFaultTokenV1(
  value: string | null,
): string | null {
  return isLocalIntendedYaoFaultTokenV1(value) ? value : null;
}

/** The signer database, holding one request after its session read. */
export class LocalIntendedSessionAdmissionFaultDatabaseV1 implements D1DatabaseLike {
  private state: LocalIntendedSessionAdmissionFaultStateV1 = { kind: 'armed' };

  constructor(private readonly base: D1DatabaseLike) {}

  prepare(query: string): D1PreparedStatementLike {
    const inner = this.base.prepare(query);
    return SESSION_READ_PATTERN.test(query)
      ? new LocalIntendedSessionReadStatementV1(this, inner)
      : inner;
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    return await this.base.batch<T>(statements.map(unwrapStatement));
  }

  async exec(query: string): Promise<unknown> {
    return await this.base.exec(query);
  }

  async holdAfterSessionRead(row: unknown): Promise<void> {
    if (this.state.kind !== 'armed') return;
    const authority = readAuthorityOfSessionRow(row);
    if (!authority) {
      this.state = { kind: 'violated', violation: 'session_read_not_observed' };
      return;
    }
    const deadline = Date.now() + HOLD_LIMIT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const current = await this.base
        .prepare(
          `SELECT authority_digest_b64u
             FROM wallet_authorities
            WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
              AND authority_id = ?
            LIMIT 1`,
        )
        .bind(
          authority.namespace,
          authority.orgId,
          authority.projectId,
          authority.envId,
          authority.authorityId,
        )
        .first<{ readonly authority_digest_b64u: string }>();
      if (current && current.authority_digest_b64u !== authority.digest) {
        this.state = { kind: 'proved', proof: 'held_until_authority_changed' };
        return;
      }
    }
    this.state = { kind: 'violated', violation: 'authority_unchanged' };
  }

  outcome():
    | { readonly kind: 'proved'; readonly proof: LocalIntendedSessionAdmissionFaultProofV1 }
    | {
        readonly kind: 'violated';
        readonly violation: LocalIntendedSessionAdmissionFaultViolationV1;
      } {
    switch (this.state.kind) {
      case 'proved':
      case 'violated':
        return this.state;
      case 'armed':
        return { kind: 'violated', violation: 'session_read_not_observed' };
    }
  }
}

class LocalIntendedSessionReadStatementV1 implements D1PreparedStatementLike {
  constructor(
    private readonly database: LocalIntendedSessionAdmissionFaultDatabaseV1,
    readonly inner: D1PreparedStatementLike,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new LocalIntendedSessionReadStatementV1(this.database, this.inner.bind(...values));
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = await this.inner.first<T>(columnName);
    await this.database.holdAfterSessionRead(row);
    return row;
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    return await this.inner.all<T>();
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    return await this.inner.run<T>();
  }
}

/** The joined row carries the authority as it was read with the session. */
function readAuthorityOfSessionRow(row: unknown): {
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly authorityId: string;
  readonly digest: string;
} | null {
  if (!row || typeof row !== 'object') return null;
  const value = row as Record<string, unknown>;
  const fields = [
    value.namespace,
    value.org_id,
    value.project_id,
    value.env_id,
    value.authority_id,
    value.authority_digest_b64u,
  ];
  if (!fields.every((field): field is string => typeof field === 'string' && field.length > 0)) {
    return null;
  }
  const [namespace, orgId, projectId, envId, authorityId, digest] = fields;
  return { namespace, orgId, projectId, envId, authorityId, digest };
}

function unwrapStatement(statement: D1PreparedStatementLike): D1PreparedStatementLike {
  return statement instanceof LocalIntendedSessionReadStatementV1 ? statement.inner : statement;
}

export function requestWithoutLocalIntendedSessionAdmissionFaultHeadersV1(
  request: Request,
): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_SESSION_ADMISSION_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_SESSION_ADMISSION_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

export function responseWithLocalIntendedSessionAdmissionFaultOutcomeV1(
  response: Response,
  outcome: ReturnType<LocalIntendedSessionAdmissionFaultDatabaseV1['outcome']>,
  token: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(
    LOCAL_INTENDED_SESSION_ADMISSION_FAULT_PROOF_HEADER_V1,
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
