// The VM Gateway's read-only deployment check, `check`: the Gateway's
// counterpart of `router_ab_local_worker --check`. It reads the vars file
// and the shared store without writing, and asks the Router and the
// SigningWorker only for their health answers. It prints no value from the
// vars file, sends no credential and repairs nothing.

import { existsSync } from 'node:fs';
import { parseStaticWalletConsoleBindingConfigV1 } from '../cloudflare/runtime/staticWalletConsoleBinding';
import { nodeSqliteConnection, type NodeDatabaseSyncConstructor } from './nodeSqlite';
import { inspectSignerSqlMigrationsV1 } from './signerSqlMigrations';

export type NodeGatewayCheckStatusV1 = 'passed' | 'failed' | 'unverified';

export type NodeGatewayCheckItemV1 = {
  readonly check: string;
  readonly status: NodeGatewayCheckStatusV1;
  readonly detail: Readonly<Record<string, unknown>>;
};

export type NodeGatewayCheckInputV1 = {
  readonly DatabaseSync: NodeDatabaseSyncConstructor;
  readonly databasePath: string;
  readonly migrationsDir: string;
  readonly varsPath: string | undefined;
  /** Parses the vars file; its errors name the file and key, not values. */
  readonly readVars: (path: string) => Record<string, string>;
  readonly routerUrl: string | undefined;
  readonly signingWorkerUrl: string | undefined;
  readonly signerWasmPath: string | undefined;
};

export async function checkNodeHostedWalletGatewayV1(
  input: NodeGatewayCheckInputV1,
): Promise<readonly NodeGatewayCheckItemV1[]> {
  return [
    configurationCheck(input),
    signerWasmCheck(input.signerWasmPath),
    storageCheck(input),
    await peerCheck('router', input.routerUrl),
    await peerCheck('signing_worker', input.signingWorkerUrl),
    {
      check: 'peer_authentication',
      status: 'unverified',
      detail: {
        reason:
          "the check sends no credential; a peer that refuses the Gateway's service credentials is found only by an authenticated call, such as the explicit smoke test",
      },
    },
  ];
}

function configurationCheck(input: NodeGatewayCheckInputV1): NodeGatewayCheckItemV1 {
  const missing = (
    [
      ['WALLET_GATEWAY_VARS_FILE', input.varsPath],
      ['WALLET_GATEWAY_ROUTER_URL', input.routerUrl],
      ['WALLET_GATEWAY_SIGNING_WORKER_URL', input.signingWorkerUrl],
      ['WALLET_GATEWAY_SIGNER_WASM_PATH', input.signerWasmPath],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0 || !input.varsPath) {
    return { check: 'configuration', status: 'failed', detail: { missing } };
  }
  let vars: Record<string, string>;
  try {
    vars = input.readVars(input.varsPath);
  } catch (error) {
    return {
      check: 'configuration',
      status: 'failed',
      detail: { error: error instanceof Error ? error.message : 'the vars file cannot be read' },
    };
  }
  const deploymentJson = vars.WALLET_LOCAL_DEPLOYMENT_JSON;
  if (!deploymentJson) {
    return {
      check: 'configuration',
      status: 'failed',
      detail: { missing: ['WALLET_LOCAL_DEPLOYMENT_JSON'] },
    };
  }
  try {
    // Neither error is reported: JSON.parse quotes the text, which holds a
    // secret key.
    parseStaticWalletConsoleBindingConfigV1(JSON.parse(deploymentJson));
  } catch {
    return {
      check: 'configuration',
      status: 'failed',
      detail: { error: 'WALLET_LOCAL_DEPLOYMENT_JSON is not a valid deployment' },
    };
  }
  return { check: 'configuration', status: 'passed', detail: { keys: Object.keys(vars).length } };
}

function signerWasmCheck(path: string | undefined): NodeGatewayCheckItemV1 {
  if (!path) return { check: 'artifact:signer_wasm', status: 'failed', detail: { missing: true } };
  return existsSync(path)
    ? { check: 'artifact:signer_wasm', status: 'passed', detail: { path } }
    : { check: 'artifact:signer_wasm', status: 'failed', detail: { path, state: 'missing' } };
}

function storageCheck(input: NodeGatewayCheckInputV1): NodeGatewayCheckItemV1 {
  const path = input.databasePath;
  if (!existsSync(path)) {
    return {
      check: 'storage:gateway_store',
      status: 'failed',
      detail: { path, state: 'missing', action: 'apply the schema with `migrate`' },
    };
  }
  const database = new input.DatabaseSync(path, { readOnly: true });
  try {
    const status = inspectSignerSqlMigrationsV1(
      nodeSqliteConnection(database),
      input.migrationsDir,
    );
    const current = status.pending.length === 0 && status.unknown.length === 0;
    return {
      check: 'storage:gateway_store',
      status: current ? 'passed' : 'failed',
      detail: current
        ? { path, applied: status.applied.length }
        : {
            path,
            applied: status.applied.length,
            pending: status.pending,
            unknown: status.unknown,
          },
    };
  } finally {
    database.close();
  }
}

/** The role a peer's health endpoint answers as. Sends no credential. */
async function peerCheck(role: string, url: string | undefined): Promise<NodeGatewayCheckItemV1> {
  const check = `peer:${role}`;
  if (!url) return { check, status: 'failed', detail: { missing: true } };
  let answered: unknown;
  try {
    const response = await fetch(new URL('/healthz', url), { signal: AbortSignal.timeout(5_000) });
    if (response.status !== 200) {
      return {
        check,
        status: 'failed',
        detail: { url, error: `answered HTTP ${response.status}` },
      };
    }
    const body = (await response.json()) as { role_label?: unknown; role?: unknown };
    answered = body.role_label ?? body.role;
  } catch (error) {
    return {
      check,
      status: 'failed',
      detail: {
        url,
        state: 'unreachable',
        error: error instanceof Error ? error.message : 'failed',
      },
    };
  }
  return answered === role
    ? { check, status: 'passed', detail: { url } }
    : {
        check,
        status: 'failed',
        detail: {
          url,
          answered_as: answered ?? null,
          action: 'point this URL at the role it names',
        },
      };
}
