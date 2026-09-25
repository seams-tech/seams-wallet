// VM host for the hosted Wallet Gateway: the same Gateway handler the
// Cloudflare Worker runs, with its shared SQL store on a SQLite file and its
// Router and SigningWorker service bindings replaced by authenticated HTTP.

import { readFileSync } from 'node:fs';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayEnv,
  type HostedWalletGatewayDependenciesV1,
} from '../../hosted-wallet-gateway';
import type { CfExecutionContext } from '../cloudflare/runtime/cloudflare.types';
import type { CloudflareServiceBindingFetcher } from '../cloudflare/runtime/routerAbServiceBindings';
import {
  createStaticWalletConsoleBindingV1,
  parseStaticWalletConsoleBindingConfigV1,
} from '../cloudflare/runtime/staticWalletConsoleBinding';
import { createSyncSqliteDatabase, type SyncSqliteConnectionV1 } from '../../storage/syncSqlite';

export type NodeHostedWalletGatewayOptionsV1 = {
  /** Gateway configuration and secrets, as the Worker receives them as vars. */
  readonly vars: Readonly<Record<string, string>>;
  /** Shared Gateway SQL store (already migrated). */
  readonly connection: SyncSqliteConnectionV1;
  /** VM Router base URL. */
  readonly routerUrl: string;
  /** VM SigningWorker base URL. */
  readonly signingWorkerUrl: string;
  /** Path to wasm_signer_worker_bg.wasm. */
  readonly signerWasmPath: string;
  readonly onBackgroundError?: (error: unknown) => void;
};

export type NodeHostedWalletGatewayV1 = {
  handle(request: Request): Promise<Response>;
  /** Resolves when every background task started by handled requests settles. */
  drain(): Promise<void>;
};

export function createNodeHostedWalletGatewayV1(
  options: NodeHostedWalletGatewayOptionsV1,
): NodeHostedWalletGatewayV1 {
  const deploymentJson = options.vars.WALLET_LOCAL_DEPLOYMENT_JSON;
  if (!deploymentJson) throw new Error('WALLET_LOCAL_DEPLOYMENT_JSON is required');
  const env: CloudflareD1GatewayEnv = {
    ...options.vars,
    ROUTER_AB_PREWARM_ENABLED: options.vars.ROUTER_AB_PREWARM_ENABLED ?? 'false',
    SIGNER_DB: createSyncSqliteDatabase(options.connection),
    MPC_ROUTER: httpServiceBinding(options.routerUrl),
    SIGNING_WORKER: httpServiceBinding(options.signingWorkerUrl),
    WALLET_CONSOLE: createStaticWalletConsoleBindingV1(
      parseStaticWalletConsoleBindingConfigV1(JSON.parse(deploymentJson)),
    ),
  };
  const signerWasmBytes = readFileSync(options.signerWasmPath);
  const dependencies: HostedWalletGatewayDependenciesV1 = {
    signerWasm: async () => await WebAssembly.compile(signerWasmBytes),
  };
  const pending = new Set<Promise<unknown>>();
  const ctx: CfExecutionContext = {
    waitUntil(promise: Promise<unknown>) {
      const tracked = promise.catch((error: unknown) => options.onBackgroundError?.(error));
      pending.add(tracked);
      void tracked.finally(() => pending.delete(tracked));
    },
    passThroughOnException() {},
  };
  return {
    handle: async (request) => await handleSplitGatewayRequest(request, env, ctx, dependencies),
    drain: async () => {
      await Promise.all([...pending]);
    },
  };
}

/**
 * A Cloudflare service binding delivers to one Worker whatever URL the
 * caller used; the Gateway sends both its fixed internal origins and
 * forwarded public requests through them. On a VM each binding forwards the
 * path and query to its one configured base URL, and nowhere else.
 */
function httpServiceBinding(baseUrl: string): CloudflareServiceBindingFetcher {
  const base = new URL(baseUrl);
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const target = new URL(`${url.pathname}${url.search}`, base);
      return await fetch(new Request(target, request));
    },
  };
}
