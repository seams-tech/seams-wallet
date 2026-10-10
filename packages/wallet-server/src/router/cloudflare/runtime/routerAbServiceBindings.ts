import { D1WalletObjectAddresses } from '../d1/walletObjectAddresses';
import type { D1DatabaseLike } from '../../../storage/tenantRoute';
import {
  readWalletObjectIdentityHeader,
  type WalletObjectAddressSnapshot,
  WALLET_OBJECT_IDENTITY_HEADER,
  WALLET_OBJECT_ADDRESSES_HEADER,
} from './walletObjectAddresses';

export interface CloudflareServiceBindingFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface RouterAbServiceBindingEnv {
  readonly MPC_ROUTER: CloudflareServiceBindingFetcher;
  readonly SIGNING_WORKER: CloudflareServiceBindingFetcher;
}

export type WalletHomeRegion = 'US' | 'WEUR' | 'APAC' | 'OC';

/** Apply only after the host admits this request to the wallet's fixed home. */
export class WalletHomeCustodyBinding implements CloudflareServiceBindingFetcher {
  constructor(
    private readonly binding: CloudflareServiceBindingFetcher,
    private readonly home: WalletHomeRegion,
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
    private readonly initialAddresses: WalletObjectAddressSnapshot | null,
  ) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    request.headers.set('x-seams-wallet-home-region', this.home);
    request.headers.delete(WALLET_OBJECT_ADDRESSES_HEADER);
    const identity = readWalletObjectIdentityHeader(request.headers);
    request.headers.delete(WALLET_OBJECT_IDENTITY_HEADER);
    if (identity !== null) {
      const store = new D1WalletObjectAddresses(this.database, {
        namespace: this.namespace,
        orgId: identity.orgId,
        projectId: identity.projectId,
        envId: identity.envId,
      });
      const addresses = this.initialAddresses?.resolve(this.namespace, identity)
        ?? await store.read(identity);
      if (addresses === null) throw new Error('Wallet object addresses are not initialized');
      request.headers.set(WALLET_OBJECT_ADDRESSES_HEADER, JSON.stringify(addresses));
    }
    return this.binding.fetch(request);
  }
}

export const ROUTER_AB_MPC_ROUTER_ORIGIN = 'https://mpc-router.router-ab.internal';
export const ROUTER_AB_SIGNING_WORKER_ORIGIN = 'https://signing-worker.router-ab.internal';

type RouterAbServiceBindingOrigin =
  | typeof ROUTER_AB_MPC_ROUTER_ORIGIN
  | typeof ROUTER_AB_SIGNING_WORKER_ORIGIN;

class RouterAbServiceBindingDispatcher {
  constructor(private readonly env: RouterAbServiceBindingEnv) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const binding = this.bindingForOrigin(new URL(request.url).origin);
    return await binding.fetch(request);
  }

  private bindingForOrigin(origin: string): CloudflareServiceBindingFetcher {
    switch (parseRouterAbServiceBindingOrigin(origin)) {
      case ROUTER_AB_MPC_ROUTER_ORIGIN:
        return this.env.MPC_ROUTER;
      case ROUTER_AB_SIGNING_WORKER_ORIGIN:
        return this.env.SIGNING_WORKER;
    }
  }
}

function parseRouterAbServiceBindingOrigin(origin: string): RouterAbServiceBindingOrigin {
  switch (origin) {
    case ROUTER_AB_MPC_ROUTER_ORIGIN:
    case ROUTER_AB_SIGNING_WORKER_ORIGIN:
      return origin;
    default:
      throw new Error(`Unsupported Router A/B service-binding origin: ${origin}`);
  }
}

export function createRouterAbServiceBindingFetch(
  env: RouterAbServiceBindingEnv,
): typeof globalThis.fetch {
  const dispatcher = new RouterAbServiceBindingDispatcher(env);
  return dispatcher.fetch.bind(dispatcher);
}
