// Router wallet-lane Durable Object: the Cloudflare host for one wallet's
// Router lane aggregate (enrollments, protocol operations, product epochs,
// receipts, locks and effect journal). Its SQLite storage is the only
// authority for those records; there is no D1 copy or fallback.

import type { CloudflareDurableObjectNamespaceLike } from '../../../core/types';
import type { SyncSqliteConnectionV1, SyncSqliteRow, SyncSqliteValue } from '../../../storage/syncSqlite';
import {
  parseWalletLaneStoreRequestV1,
  parseWalletLaneStoreResponseV1,
  serveWalletLaneStoreRequestV1,
  type WalletLaneStoreResponseV1,
  type WalletLaneStoreTransportV1,
} from '../../../core/signingLanes/walletLanes/walletLaneStoreProtocol';
import { walletLaneStorageNameV1 } from '../../../core/signingLanes/walletLanes/walletLaneSchema';

type DurableObjectSqlCursorLike = { toArray(): SyncSqliteRow[] };

type DurableObjectSqlStorageLike = {
  exec(query: string, ...bindings: SyncSqliteValue[]): DurableObjectSqlCursorLike;
};

type DurableObjectSqliteStorageLike = {
  readonly sql: DurableObjectSqlStorageLike;
  transactionSync<T>(body: () => T): T;
};

type RouterWalletLaneDurableObjectStateLike = {
  readonly id: { readonly name?: string };
  readonly storage: DurableObjectSqliteStorageLike;
};

const ROUTER_WALLET_LANE_CALL_URL = 'https://router-wallet-lanes.internal/v1/call';

/** DO SQLite storage presented as the shared synchronous connection. */
export function durableObjectSqliteConnection(
  storage: DurableObjectSqliteStorageLike,
): SyncSqliteConnectionV1 {
  return {
    execute: (sql, params) => storage.sql.exec(sql, ...params).toArray(),
    transaction: (body) => storage.transactionSync(body),
    executeScript: (sql) => {
      storage.sql.exec(sql);
    },
  };
}

export class RouterWalletLaneDurableObject {
  private readonly state: RouterWalletLaneDurableObjectStateLike;
  private readonly connection: SyncSqliteConnectionV1;

  constructor(state: RouterWalletLaneDurableObjectStateLike, _env: unknown) {
    this.state = state;
    this.connection = durableObjectSqliteConnection(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method.toUpperCase() !== 'POST' || new URL(request.url).pathname !== '/v1/call') {
      return laneResponse({ kind: 'wallet_lane_store_response_v1', ok: false, error: 'not found' }, 404);
    }
    let parsed;
    try {
      parsed = parseWalletLaneStoreRequestV1(await request.json());
    } catch (error) {
      return laneResponse(failure(error), 400);
    }
    // Objects are addressed by the owner's stable storage name. A request for
    // a different owner cannot use this object even before its owner is pinned.
    const objectName = this.state.id.name;
    if (objectName !== undefined && objectName !== (await walletLaneStorageNameV1(parsed.owner))) {
      return laneResponse(
        { kind: 'wallet_lane_store_response_v1', ok: false, error: 'wallet lane object belongs to another owner' },
        403,
      );
    }
    const response = await serveWalletLaneStoreRequestV1({
      connection: this.connection,
      request: parsed,
    });
    return laneResponse(response, 200);
  }
}

/**
 * Transport from the composing Worker to each owner's Router wallet-lane
 * object. Only Workers bound to the namespace can reach it; the object name
 * is derived from the owner, never from request input.
 */
export function createCloudflareRouterWalletLaneTransportV1(
  namespace: CloudflareDurableObjectNamespaceLike,
): WalletLaneStoreTransportV1 {
  return async (request) => {
    const name = await walletLaneStorageNameV1(request.owner);
    const stub = namespace.get(namespace.idFromName(name));
    const response = await stub.fetch(ROUTER_WALLET_LANE_CALL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    return parseWalletLaneStoreResponseV1(await response.json());
  };
}

function failure(error: unknown): WalletLaneStoreResponseV1 {
  return {
    kind: 'wallet_lane_store_response_v1',
    ok: false,
    error: error instanceof Error ? error.message : 'wallet lane store request failed',
  };
}

function laneResponse(body: WalletLaneStoreResponseV1, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
