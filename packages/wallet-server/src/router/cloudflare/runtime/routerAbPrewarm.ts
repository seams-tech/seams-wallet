import type { CfScheduledEvent } from './cloudflare.types';
import {
  ROUTER_AB_MPC_ROUTER_ORIGIN,
  type CloudflareServiceBindingFetcher,
} from './routerAbServiceBindings';

const ROUTER_AB_PREWARM_CRON = '* * * * *';
const ROUTER_AB_PREWARM_PATH = '/internal/prewarm';
const ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER = 'x-router-ab-internal-service-auth';

export interface RouterAbPrewarmScheduledEnvV1 {
  readonly MPC_ROUTER: CloudflareServiceBindingFetcher;
  readonly ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET?: string;
  readonly ROUTER_AB_PREWARM_ENABLED: string;
}

function parseRouterAbPrewarmEnabled(value: unknown): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('ROUTER_AB_PREWARM_ENABLED must be true or false');
}

function requireRouterAbInternalServiceAuthSecret(env: RouterAbPrewarmScheduledEnvV1): string {
  const value = String(env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET || '').trim();
  if (!value) throw new Error('ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET is required');
  return value;
}

function isSuccessfulRouterAbPrewarmResponse(value: unknown): boolean {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  return fields.size === 1 && fields.get('ok') === true;
}

export async function runRouterAbPrewarmScheduledV1(
  event: CfScheduledEvent,
  env: RouterAbPrewarmScheduledEnvV1,
): Promise<void> {
  if (event.cron !== ROUTER_AB_PREWARM_CRON) return;
  if (!parseRouterAbPrewarmEnabled(env.ROUTER_AB_PREWARM_ENABLED)) return;
  const response = await env.MPC_ROUTER.fetch(
    new Request(`${ROUTER_AB_MPC_ROUTER_ORIGIN}${ROUTER_AB_PREWARM_PATH}`, {
      method: 'POST',
      headers: {
        [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER]: requireRouterAbInternalServiceAuthSecret(env),
      },
    }),
  );
  if (!response.ok) {
    throw new Error(`Router A/B prewarm failed with HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isSuccessfulRouterAbPrewarmResponse(body)) {
    throw new Error('Router A/B prewarm returned an invalid response');
  }
}
