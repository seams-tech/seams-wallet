import { ensureLeadingSlash } from '@shared/utils/validation';
import {
  createCloudflareD1RouterAbNormalSigningAdmissionStore,
  type CloudflareD1RouterAbNormalSigningAdmissionStoreOptions,
} from '../d1/signingAdmission/d1RouterAbNormalSigningAdmissionStore';
import { createRouterAbNormalSigningAdmissionAdapter } from '../../domains/signingOperations/routerAbNormalSigningAdmissionCore';
import type { RouterApiOptions } from '../../framework/routerApi';
import type { RouteDefinition } from '../../framework/routeDefinitions';
import type { RouterApiRouteExtension } from '../../framework/routeExtensions';
import type { FetchHandler } from './cloudflare.types';
import { createCloudflareRouter } from './createCloudflareRouter';
import { WALLET_CONSOLE_SERVICE_ORIGIN_V1 } from './walletConsoleOps';
import {
  createWalletConsoleOpsClient,
  type WalletConsoleServiceBinding,
} from './walletConsoleOpsClient';

export const WALLET_CONSOLE_API_WALLET_DETAIL_PREFIX_V1 = '/v1/wallets/';
export const WALLET_CONSOLE_SIGNED_DELEGATE_ROUTE_ID_V1 = 'signed_delegate';
export const WALLET_CONSOLE_SPONSORED_EVM_CALL_ROUTE_ID_V1 = 'sponsored_evm_call';
export const DEFAULT_WALLET_CONSOLE_SIGNED_DELEGATE_ROUTE_V1 = '/signed-delegate';
export const DEFAULT_WALLET_CONSOLE_SPONSORED_EVM_CALL_ROUTE_V1 = '/sponsorships/evm/call';

const WALLET_CONSOLE_SIGNED_DELEGATE_SERVICES = [
  'signedDelegateAuth',
  'publishableKeyAuth',
  'billing',
  'runtimeSnapshots',
  'sponsoredCalls',
] as const;

export function walletConsoleApiWalletListRouteDefinitionV1(): RouteDefinition {
  return {
    id: 'api_wallets_list',
    surface: 'relay',
    method: 'GET',
    path: '/v1/wallets',
    summary: 'List wallets for the authenticated API credential environment',
    auth: {
      plane: 'api_credentials',
      credentials: ['secret_key'],
      scopes: ['wallets.read'],
    },
    metering: { kind: 'none' },
    requiredServices: ['apiKeyAuth', 'wallets'],
  };
}

export function walletConsoleApiWalletSearchRouteDefinitionV1(): RouteDefinition {
  return {
    id: 'api_wallets_search',
    surface: 'relay',
    method: 'GET',
    path: '/v1/wallets/search',
    summary: 'Search wallets for the authenticated API credential environment',
    auth: {
      plane: 'api_credentials',
      credentials: ['secret_key'],
      scopes: ['wallets.read'],
    },
    metering: { kind: 'none' },
    requiredServices: ['apiKeyAuth', 'wallets'],
  };
}

export function walletConsoleApiWalletGetRouteDefinitionV1(): RouteDefinition {
  return {
    id: 'api_wallets_get',
    surface: 'relay',
    method: 'GET',
    path: '/v1/wallets/:id',
    summary: 'Get a wallet for the authenticated API credential environment',
    auth: {
      plane: 'api_credentials',
      credentials: ['secret_key'],
      scopes: ['wallets.read'],
    },
    metering: { kind: 'none' },
    requiredServices: ['apiKeyAuth', 'wallets'],
  };
}

export function walletConsoleSignedDelegateRouteDefinitionV1(routePath: string): RouteDefinition {
  return {
    id: WALLET_CONSOLE_SIGNED_DELEGATE_ROUTE_ID_V1,
    surface: 'relay',
    method: 'POST',
    path: ensureLeadingSlash(routePath) || DEFAULT_WALLET_CONSOLE_SIGNED_DELEGATE_ROUTE_V1,
    summary: 'Execute signed NEAR delegate',
    auth: {
      plane: 'api_credentials',
      credentials: ['publishable_key'],
      environmentBinding: 'required',
      originBinding: 'required',
    },
    metering: { kind: 'gas', ledger: 'near_delegate' },
    requiredServices: WALLET_CONSOLE_SIGNED_DELEGATE_SERVICES,
  };
}

export function walletConsoleSponsoredEvmCallRouteDefinitionV1(
  routePath?: string,
): RouteDefinition {
  return {
    id: WALLET_CONSOLE_SPONSORED_EVM_CALL_ROUTE_ID_V1,
    surface: 'relay',
    method: 'POST',
    path: String(routePath || '').trim() || DEFAULT_WALLET_CONSOLE_SPONSORED_EVM_CALL_ROUTE_V1,
    summary: 'Execute a sponsored EVM call',
    auth: {
      plane: 'api_credentials',
      credentials: ['publishable_key'],
      environmentBinding: 'required',
      originBinding: 'required',
    },
    metering: { kind: 'gas', ledger: 'evm' },
    requiredServices: ['routerApiSponsoredEvmCall'],
  };
}

export function walletConsoleRelayRouteDefinitionsV1(): readonly RouteDefinition[] {
  return Object.freeze([
    walletConsoleApiWalletListRouteDefinitionV1(),
    walletConsoleApiWalletSearchRouteDefinitionV1(),
    walletConsoleApiWalletGetRouteDefinitionV1(),
    walletConsoleSignedDelegateRouteDefinitionV1(DEFAULT_WALLET_CONSOLE_SIGNED_DELEGATE_ROUTE_V1),
    walletConsoleSponsoredEvmCallRouteDefinitionV1(
      DEFAULT_WALLET_CONSOLE_SPONSORED_EVM_CALL_ROUTE_V1,
    ),
  ]);
}

export function createWalletConsoleRelayProxyExtensionV1(
  binding: WalletConsoleServiceBinding,
): RouterApiRouteExtension {
  return {
    kind: 'fetch_route_extension',
    id: 'wallet_console_relay_proxy',
    routes: walletConsoleRelayRouteDefinitionsV1(),
    async handleFetchRoute(input): Promise<Response> {
      const sourceUrl = new URL(input.request.url);
      const targetUrl = new URL(
        `${sourceUrl.pathname}${sourceUrl.search}`,
        WALLET_CONSOLE_SERVICE_ORIGIN_V1,
      );
      return await binding.fetch(new Request(targetUrl, input.request));
    },
  };
}

type WalletGatewayManagedRouterOption =
  | 'apiKeyAuth'
  | 'publishableKeyAuth'
  | 'apiKeyUsageMeter'
  | 'orgProjectEnv'
  | 'routerAbNormalSigningAdmission'
  | 'routeExtensions';

export interface CloudflareWalletGatewayRouterOptionsV1 {
  readonly service: Parameters<typeof createCloudflareRouter>[0];
  readonly walletConsole: WalletConsoleServiceBinding;
  readonly signerDatabase: CloudflareD1RouterAbNormalSigningAdmissionStoreOptions['database'];
  readonly signerStorageNamespace: string;
  readonly router: Omit<RouterApiOptions, WalletGatewayManagedRouterOption>;
}

export function createCloudflareWalletGatewayRouterV1(
  input: CloudflareWalletGatewayRouterOptionsV1,
): FetchHandler {
  const consoleOps = createWalletConsoleOpsClient(input.walletConsole);
  const admissionStore = createCloudflareD1RouterAbNormalSigningAdmissionStore({
    database: input.signerDatabase,
    storageNamespace: input.signerStorageNamespace,
  });
  return createCloudflareRouter(input.service, {
    ...input.router,
    apiKeyAuth: consoleOps.apiKeyAuth,
    publishableKeyAuth: consoleOps.publishableKeyAuth,
    apiKeyUsageMeter: consoleOps.usageMeter,
    orgProjectEnv: consoleOps.projectEnvironments,
    routerAbNormalSigningAdmission: createRouterAbNormalSigningAdmissionAdapter(admissionStore),
    routeExtensions: [createWalletConsoleRelayProxyExtensionV1(input.walletConsole)],
  });
}
