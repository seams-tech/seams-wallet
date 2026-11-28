import type { RouteUsageData } from './routeMeteringPolicy';

export type RouteMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export const ROUTE_SERVICE_KEYS = [
  'apiKeyAuth',
  'emailOtp',
  'identity',
  'nearFunding',
  'orgProjectEnv',
  'passkeyCustody',
  'publishableKeyAuth',
  'recovery',
  'signingSessionSeal',
  'router',
  'session',
  'signedDelegateAuth',
  'thresholdRuntime',
  'walletAuthMethods',
  'walletRegistration',
  'walletUnlock',
  'webAuthn',
] as const;
export type CoreRouteServiceKey = (typeof ROUTE_SERVICE_KEYS)[number];
export type RouteServiceKey = string;

export type RouteServices = Partial<Record<CoreRouteServiceKey, unknown>>;

export interface RouteResponse<TBody = unknown> {
  status: number;
  body: TBody;
  headers?: Record<string, string>;
  usage?: RouteUsageData;
}
