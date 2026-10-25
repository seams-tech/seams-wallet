import { expect, type Page, type Route } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { isolatedGatewayDatabasePath, loadIsolatedDatabaseSync } from './local-gateway-database';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { hostedGatewayHeaders } from './hosted-gateway-access';

/** Keep credentials in memory only. Evidence contains no requests or OTP codes. */
export class MlDsaEmailProofProbe {
  private preparation: {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } | null = null;
  private readonly onPrepare = this.prepare.bind(this);
  private readonly onSign = this.sign.bind(this);
  private readonly observedAuthorizations = new Set<string>();
  private readonly rolledBackApprovals = new Set<string>();
  private wrongOperationRefused = false;
  private completedReplayVerified = false;

  async install(page: Page): Promise<void> {
    await page.route('**/ml-dsa/sign/prepare', this.onPrepare);
    await page.route('**/ml-dsa/sign', this.onSign);
  }
  async remove(page: Page): Promise<void> {
    await page.unroute('**/ml-dsa/sign/prepare', this.onPrepare);
    await page.unroute('**/ml-dsa/sign', this.onSign);
    this.preparation = null;
  }
  evidence() {
    expect(this.wrongOperationRefused).toBe(true);
    expect(this.completedReplayVerified).toBe(true);
    expect([...this.observedAuthorizations].sort()).toEqual([
      'email_otp',
      'email_otp_session_start',
      'session',
    ]);
    if (!process.env.ML_DSA_HOSTED_DEPLOYMENT)
      expect([...this.rolledBackApprovals].sort()).toEqual([
        'email_otp',
        'email_otp_session_start',
      ]);
    return {
      wrongOperationRefused: this.wrongOperationRefused,
      completedReplayVerified: this.completedReplayVerified,
      authorizationKinds: [...this.observedAuthorizations].sort(),
      atomicApprovalRollback: process.env.ML_DSA_HOSTED_DEPLOYMENT
        ? { kind: 'not_run', reason: 'hosted' }
        : { kind: 'verified', authorizationKinds: [...this.rolledBackApprovals].sort() },
    };
  }
  private async prepare(route: Route): Promise<void> {
    const request = route.request();
    this.preparation = {
      url: request.url(),
      headers: await proofProbeHeaders(route),
      body: requireRecord(request.postDataJSON(), 'signing request'),
    };
    await route.continue({ headers: this.preparation.headers });
  }
  private async sign(route: Route): Promise<void> {
    const headers = await proofProbeHeaders(route);
    const body = requireRecord(route.request().postDataJSON(), 'signing execution');
    const authorization = requireRecord(body.authorization, 'signing authorization');
    const authorizationKind = requireCanonicalString(authorization.kind, 'authorization kind');
    this.observedAuthorizations.add(authorizationKind);
    if (authorization.kind === 'email_otp' && !this.wrongOperationRefused) {
      const source = this.preparation;
      if (!source) throw new Error('Missing exact signing preparation');
      const otherOperation = randomBytes(32).toString('base64url');
      const prepared = await route.fetch({
        url: source.url,
        method: 'POST',
        headers: source.headers,
        postData: { ...source.body, operationIdB64u: otherOperation },
      });
      expect(requireRecord(await prepared.json(), 'other preparation').kind).toBe('prepared');
      const wrong = await route.fetch({
        headers,
        postData: { ...body, operationIdB64u: otherOperation },
      });
      const refusal = requireRecord(await wrong.json(), 'wrong-operation result');
      expect(refusal.kind).toBe('refused');
      expect(refusal.code).toBe('unauthorized');
      this.wrongOperationRefused = true;
    }
    if (
      !process.env.ML_DSA_HOSTED_DEPLOYMENT &&
      authorizationKind !== 'session' &&
      !this.rolledBackApprovals.has(authorizationKind)
    ) {
      const rollback = await injectApprovalCommitFailure();
      try {
        const failedCommit = await route.fetch({ headers });
        const result = requireRecord(await failedCommit.json(), 'injected commit result');
        expect(result.kind).toBe('refused');
        expect(['conflict', 'protocol_failed']).toContain(result.code);
      } finally {
        rollback();
      }
      this.rolledBackApprovals.add(authorizationKind);
    }
    const response = await route.fetch({ headers });
    const result = requireRecord(await response.json(), 'signing result');
    if (result.kind === 'signed' && authorization.kind === 'email_otp') {
      const replay = await route.fetch({ headers });
      expect(await replay.json()).toEqual(result);
      this.completedReplayVerified = true;
    }
    await route.fulfill({ response });
  }
}

async function proofProbeHeaders(route: Route): Promise<Record<string, string>> {
  const mode = process.env.ML_DSA_HOSTED_DEPLOYMENT ? 'external_staging' : 'managed_local';
  return { ...(await route.request().allHeaders()), ...hostedGatewayHeaders(mode) };
}

/** Fault injection is confined to the fresh local test database. */
async function injectApprovalCommitFailure(): Promise<() => void> {
  const DatabaseSync = await loadIsolatedDatabaseSync();
  const database = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: false });
  try {
    for (const mutation of ['INSERT', 'UPDATE']) {
      database
        .prepare(
          `CREATE TRIGGER ml_dsa_test_fail_${mutation} BEFORE ${mutation} ON router_ab_yao_versioned_json_records
        WHEN NEW.record_key LIKE 'ml-dsa-signing:%' AND json_extract(NEW.record_json, '$.phase.kind') IN ('email_otp_approved', 'session_approved')
        BEGIN SELECT RAISE(ABORT, 'Injected ML-DSA approval commit failure'); END`,
        )
        .run();
    }
  } catch (error) {
    removeApprovalCommitFailure(database);
    throw error;
  }
  return removeApprovalCommitFailure.bind(null, database);
}
function removeApprovalCommitFailure(
  database: InstanceType<Awaited<ReturnType<typeof loadIsolatedDatabaseSync>>>,
): void {
  try {
    database.prepare('DROP TRIGGER IF EXISTS ml_dsa_test_fail_INSERT').run();
    database.prepare('DROP TRIGGER IF EXISTS ml_dsa_test_fail_UPDATE').run();
  } finally {
    database.close();
  }
}
