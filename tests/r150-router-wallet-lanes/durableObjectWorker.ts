// Miniflare entry for the Router wallet-lane E2E. Production composition
// binds the same class; this Worker only forwards calls to it.
import {
  RouterWalletLaneDurableObject,
  createCloudflareRouterWalletLaneTransportV1,
} from '../../packages/wallet-server/src/router/cloudflare/durableObjects/routerWalletLaneDurableObject';
import { parseWalletLaneStoreRequestV1 } from '../../packages/wallet-server/src/core/signingLanes/walletLanes/walletLaneStoreProtocol';
import type { CloudflareDurableObjectNamespaceLike } from '../../packages/wallet-server/src/core/types';

export { RouterWalletLaneDurableObject };

type Env = { readonly ROUTER_WALLET_LANES: CloudflareDurableObjectNamespaceLike };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/call') {
      const call = parseWalletLaneStoreRequestV1(await request.json());
      const response = await createCloudflareRouterWalletLaneTransportV1(env.ROUTER_WALLET_LANES)(call);
      return Response.json(response);
    }
    // Test-only misrouting probe: deliver a request to an object named for a
    // different owner, as a buggy or hostile composition might.
    if (request.method === 'POST' && url.pathname === '/misaddressed') {
      const body = (await request.json()) as { objectName: string; request: unknown };
      const stub = env.ROUTER_WALLET_LANES.get(env.ROUTER_WALLET_LANES.idFromName(body.objectName));
      return await stub.fetch('https://router-wallet-lanes.internal/v1/call', {
        method: 'POST',
        body: JSON.stringify(body.request),
      });
    }
    return new Response('not found', { status: 404 });
  },
};
