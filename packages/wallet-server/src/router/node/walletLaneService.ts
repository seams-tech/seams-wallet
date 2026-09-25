// VM host for the Router lane aggregate: an ordinary process serving the
// same wallet-lane store protocol as the Router wallet DO, with one
// role-private SQLite file per wallet. No Cloudflare service is involved.

import { createHash, timingSafeEqual } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { SyncSqliteConnectionV1, SyncSqliteRow, SyncSqliteValue } from '../../storage/syncSqlite';
import {
  isReadOnlyWalletLaneCallV1,
  parseWalletLaneStoreRequestV1,
  parseWalletLaneStoreResponseV1,
  serveWalletLaneStoreRequestV1,
  type WalletLaneStoreResponseV1,
  type WalletLaneStoreTransportV1,
} from '../../core/signingLanes/walletLanes/walletLaneStoreProtocol';
import {
  inspectWalletLaneDatabaseV1,
  WALLET_LANE_SCHEMA_VERSION,
  walletLaneStorageNameV1,
} from '../../core/signingLanes/walletLanes/walletLaneSchema';

/** The subset of `node:sqlite`'s DatabaseSync this adapter uses. */
export type NodeDatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: SyncSqliteValue[]): unknown[] };
  close(): void;
};

export type NodeDatabaseSyncConstructor = new (
  path: string,
  options?: { readonly readOnly?: boolean },
) => NodeDatabaseSyncLike;

export const ROUTER_WALLET_LANE_SERVICE_AUTH_HEADER = 'x-router-wallet-lane-service-auth';
const MIN_AUTH_SECRET_BYTES = 32;
const BUSY_TIMEOUT_MS = 5_000;

/** Loads `node:sqlite` at runtime so the package builds without its typings. */
export async function loadNodeDatabaseSync(): Promise<NodeDatabaseSyncConstructor> {
  const specifier = 'node:sqlite';
  const module = (await import(specifier)) as { DatabaseSync?: NodeDatabaseSyncConstructor };
  if (typeof module.DatabaseSync !== 'function') {
    throw new Error('node:sqlite DatabaseSync is unavailable; use Node.js 22.13 or newer');
  }
  return module.DatabaseSync;
}

/**
 * A SQLite file as the shared synchronous connection. Writers from separate
 * processes serialize on `BEGIN IMMEDIATE`; WAL lets readers proceed.
 */
export function nodeSqliteConnection(database: NodeDatabaseSyncLike): SyncSqliteConnectionV1 {
  let inTransaction = false;
  return {
    execute: (sql, params) => database.prepare(sql).all(...params) as SyncSqliteRow[],
    executeScript: (sql) => database.exec(sql),
    transaction: (body) => {
      if (inTransaction) throw new Error('nested SQLite transactions are not supported');
      inTransaction = true;
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = body();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
}

export function openNodeWalletLaneFile(
  DatabaseSync: NodeDatabaseSyncConstructor,
  path: string,
): NodeDatabaseSyncLike {
  const database = new DatabaseSync(path);
  database.exec(
    `PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`,
  );
  return database;
}

export type NodeWalletLaneServiceOptionsV1 = {
  /** Role-private directory holding one SQLite file per wallet owner. */
  readonly dataDirectory: string;
  /** Dedicated credential shared only with the authorized lane caller. */
  readonly authSecret: string;
  readonly DatabaseSync: NodeDatabaseSyncConstructor;
  readonly now?: () => number;
};

export type NodeWalletLaneServiceV1 = {
  handle(request: Request): Promise<Response>;
};

export function createNodeWalletLaneServiceV1(
  options: NodeWalletLaneServiceOptionsV1,
): NodeWalletLaneServiceV1 {
  const expected = secretDigest(requireAuthSecret(options.authSecret));
  mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
  return {
    async handle(request) {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/healthz') return text('ok', 200);
      if (request.method === 'GET' && url.pathname === '/readyz') {
        return readiness(options.dataDirectory);
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/call') return text('not found', 404);
      const presented = request.headers.get(ROUTER_WALLET_LANE_SERVICE_AUTH_HEADER) ?? '';
      if (!timingSafeEqual(secretDigest(presented), expected)) {
        return laneResponse(
          { kind: 'wallet_lane_store_response_v1', ok: false, error: 'unauthorized' },
          401,
        );
      }
      let parsed;
      try {
        parsed = parseWalletLaneStoreRequestV1(await request.json());
      } catch (error) {
        return laneResponse(failure(error), 400);
      }
      const file = join(options.dataDirectory, `${await walletLaneStorageNameV1(parsed.owner)}.sqlite`);
      // A missing wallet file stays missing: the shared handler answers reads
      // from an empty database and only a write initializes the owner's file.
      const database = existsSync(file)
        ? openNodeWalletLaneFile(options.DatabaseSync, file)
        : isReadOnlyWalletLaneCallV1(parsed.call)
          ? new options.DatabaseSync(':memory:')
          : openNodeWalletLaneFile(options.DatabaseSync, file);
      try {
        return laneResponse(
          await serveWalletLaneStoreRequestV1({
            connection: nodeSqliteConnection(database),
            request: parsed,
            now: options.now,
          }),
          200,
        );
      } finally {
        database.close();
      }
    },
  };
}

/**
 * Read-only deployment check. It never creates, migrates, or repairs a wallet
 * database; each file must carry the current schema and the owner its name
 * was derived from.
 */
export async function checkNodeWalletLaneDataDirectoryV1(input: {
  readonly dataDirectory: string;
  readonly DatabaseSync: NodeDatabaseSyncConstructor;
}): Promise<{
  readonly ok: boolean;
  readonly wallets: number;
  readonly problems: readonly string[];
}> {
  const problems: string[] = [];
  try {
    accessSync(input.dataDirectory, constants.R_OK | constants.W_OK);
  } catch {
    return { ok: false, wallets: 0, problems: ['data directory is missing or not writable'] };
  }
  const files = readdirSync(input.dataDirectory).filter((name) => name.endsWith('.sqlite'));
  for (const name of files) {
    const database = new input.DatabaseSync(join(input.dataDirectory, name), { readOnly: true });
    try {
      const inspected = inspectWalletLaneDatabaseV1(nodeSqliteConnection(database));
      if (inspected.kind !== 'wallet_lanes') {
        problems.push(`${name}: not a wallet lane database`);
        continue;
      }
      if (inspected.schemaVersion !== WALLET_LANE_SCHEMA_VERSION) {
        problems.push(`${name}: schema version ${inspected.schemaVersion} is not supported`);
      }
      if (`${await walletLaneStorageNameV1(inspected.owner)}.sqlite` !== name) {
        problems.push(`${name}: owner does not match its storage name`);
      }
    } finally {
      database.close();
    }
  }
  return { ok: problems.length === 0, wallets: files.length, problems };
}

/** HTTP transport from the composing caller to the VM lane service. */
export function createHttpRouterWalletLaneTransportV1(input: {
  readonly baseUrl: string;
  readonly authSecret: string;
  readonly fetch?: typeof fetch;
}): WalletLaneStoreTransportV1 {
  const secret = requireAuthSecret(input.authSecret);
  const endpoint = new URL('/v1/call', input.baseUrl).toString();
  const send = input.fetch ?? fetch;
  return async (request) => {
    const response = await send(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [ROUTER_WALLET_LANE_SERVICE_AUTH_HEADER]: secret,
      },
      body: JSON.stringify(request),
    });
    return parseWalletLaneStoreResponseV1(await response.json());
  };
}

/** Serves a fetch-style handler on an ordinary Node HTTP listener. */
export function listenNodeFetchHandler(input: {
  readonly host: string;
  readonly port: number;
  readonly handle: (request: Request) => Promise<Response>;
}): Promise<Server> {
  const server = createServer((incoming, outgoing) => {
    void forward(incoming, outgoing, input.handle);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, input.host, () => resolve(server));
  });
}

export function readAuthSecretFile(path: string): string {
  return requireAuthSecret(readFileSync(path, 'utf8').trim());
}

async function forward(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  handle: (request: Request) => Promise<Response>,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    }
    const method = incoming.method ?? 'GET';
    const request = new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 500;
    outgoing.end('internal error');
  }
}

function readiness(dataDirectory: string): Response {
  try {
    accessSync(dataDirectory, constants.R_OK | constants.W_OK);
    return text('ready', 200);
  } catch {
    return text('data directory is not writable', 503);
  }
}

function requireAuthSecret(secret: string): string {
  if (Buffer.byteLength(secret, 'utf8') < MIN_AUTH_SECRET_BYTES) {
    throw new Error(`wallet lane service credential must be at least ${MIN_AUTH_SECRET_BYTES} bytes`);
  }
  return secret;
}

function secretDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
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

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}
