import { sha256HexUtf8 } from '@shared/utils/digests';
import { prepareD1TenantStatement } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import type { RegistrationSetupRateLimitInput } from '../../../framework/registrationSetupRateLimit';

/** Regional counters bound the work that runs before a passkey is verified. */
export async function consumeRegistrationSetupRateLimit(
  database: D1DatabaseLike,
  namespace: string,
  input: RegistrationSetupRateLimitInput,
): Promise<{ readonly allowed: boolean }> {
  const scope = { namespace, orgId: input.orgId, projectId: input.projectId, envId: input.envId };
  const key = await sha256HexUtf8(JSON.stringify([input.apiKeyId, input.sourceIp]));
  const now = Date.now();
  const results = await database.batch<D1ResultLike<{ readonly consumed_count: number }>>([
    database.prepare(`DELETE FROM registration_setup_rate_limits WHERE rowid IN (
      SELECT rowid FROM registration_setup_rate_limits WHERE reset_at_ms <= ? LIMIT 100
    )`).bind(now),
    prepareD1TenantStatement(database, scope, `INSERT INTO registration_setup_rate_limits
      (namespace, org_id, project_id, env_id, rate_key, consumed_count, reset_at_ms)
      VALUES (?1, ?2, ?3, ?4, ?5, 1, ?7)
      ON CONFLICT (namespace, org_id, project_id, env_id, rate_key) DO UPDATE SET
        consumed_count = CASE WHEN reset_at_ms <= ?6 THEN 1 ELSE consumed_count + 1 END,
        reset_at_ms = CASE WHEN reset_at_ms <= ?6 THEN ?7 ELSE reset_at_ms END
      WHERE reset_at_ms <= ?6 OR consumed_count < 30
      RETURNING consumed_count`, [key, now, now + 60_000]),
  ]);
  if (results.length !== 2 || !results[0].success || !results[1].success) {
    throw new Error('Registration setup rate limit is unavailable');
  }
  return { allowed: results[1].results?.length === 1 };
}
