import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../../storage/tenantRoute';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type {
  RouterAbEd25519YaoLifecycleDecisionKindV1,
  RouterAbEd25519YaoLifecycleDecisionV1,
} from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoLifecycleDecision';

type DecisionScope = {
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

type DecisionRow = {
  readonly decision_kind: string;
  readonly decision_id: string;
  readonly wallet_id: string;
};

/**
 * The Gateway's Ed25519 Yao lifecycle decisions, in the signer database. A
 * decision is inserted once, in the batch that makes its finalization
 * visible, and never changes.
 */
export class CloudflareD1Ed25519YaoLifecycleDecisionStoreV1 {
  private readonly database: D1DatabaseLike;
  private readonly scope: DecisionScope;

  constructor(input: {
    readonly database: D1DatabaseLike;
    readonly namespace: string;
    readonly orgId: string;
    readonly projectId: string;
    readonly envId: string;
  }) {
    this.database = input.database;
    this.scope = {
      namespace: input.namespace,
      orgId: input.orgId,
      projectId: input.projectId,
      envId: input.envId,
    };
  }

  async read(lifecycleId: string): Promise<RouterAbEd25519YaoLifecycleDecisionV1 | null> {
    const row = await this.database
      .prepare(
        `SELECT decision_kind, decision_id, wallet_id
           FROM yao_lifecycle_decisions
          WHERE namespace = ?1
            AND org_id = ?2
            AND project_id = ?3
            AND env_id = ?4
            AND lifecycle_id = ?5`,
      )
      .bind(
        this.scope.namespace,
        this.scope.orgId,
        this.scope.projectId,
        this.scope.envId,
        lifecycleId,
      )
      .first<DecisionRow>();
    if (!row) return null;
    const kind = parseDecisionKind(row.decision_kind);
    if (!kind) throw new Error('Stored Ed25519 Yao lifecycle decision has an unknown kind');
    return {
      lifecycleId,
      kind,
      decisionId: row.decision_id,
      walletId: row.wallet_id,
    };
  }

  /**
   * The statements that record `decision`, for a batch whose other statements
   * make its finalization visible. The batch aborts unless they insert the
   * decision: a lifecycle already decided, even the same way, commits nothing
   * more.
   */
  prepareDecideStatements(
    decision: RouterAbEd25519YaoLifecycleDecisionV1,
    decidedAtMs: number,
  ): readonly D1PreparedStatementLike[] {
    return [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO yao_lifecycle_decisions (
             namespace, org_id, project_id, env_id, lifecycle_id,
             decision_kind, decision_id, wallet_id, decided_at_ms
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          this.scope.namespace,
          this.scope.orgId,
          this.scope.projectId,
          this.scope.envId,
          decision.lifecycleId,
          decision.kind,
          decision.decisionId,
          decision.walletId,
          decidedAtMs,
        ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ];
  }

  /**
   * Commits `decision` and the statements that make its finalization visible
   * in one batch. A guard among `visibility`, or a decision already recorded,
   * aborts it and nothing commits: the caller reads what holds instead.
   */
  async decide(
    decision: RouterAbEd25519YaoLifecycleDecisionV1,
    visibility: readonly D1PreparedStatementLike[],
    decidedAtMs: number,
  ): Promise<void> {
    const statements = [...visibility, ...this.prepareDecideStatements(decision, decidedAtMs)];
    const results = await this.database.batch<D1ResultLike>(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new Error('Ed25519 Yao lifecycle decision batch did not complete');
    }
  }
}

function parseDecisionKind(value: string): RouterAbEd25519YaoLifecycleDecisionKindV1 | null {
  switch (value) {
    case 'registration_finalized':
    case 'add_signer_finalized':
      return value;
    default:
      return null;
  }
}
