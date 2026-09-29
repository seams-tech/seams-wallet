// Wallet Gateway process for conventional VM deployments.
//
//   migrate   Apply pending shared-store migrations (explicit; safe to retry).
//   check     Read-only: report configuration, store schema and peer health.
//   serve     Serve the Gateway. Refuses a store with pending migrations.
//   serve-local
//             Serve the local Gateway: the same, plus the intended-suite
//             transport faults the local Worker entry serves. Local only.
//
// Configuration (environment):
//   WALLET_GATEWAY_VARS_FILE             Gateway vars and secrets (KEY='value' lines)
//   WALLET_GATEWAY_DATABASE_PATH         shared Gateway SQLite file
//   WALLET_GATEWAY_LISTEN                host:port for `serve`
//   WALLET_GATEWAY_ROUTER_URL            VM Router base URL
//   WALLET_GATEWAY_SIGNING_WORKER_URL    VM SigningWorker base URL
//   WALLET_GATEWAY_SIGNER_WASM_PATH      wasm_signer_worker_bg.wasm
//   WALLET_GATEWAY_MIGRATIONS_DIR        d1-signer migration directory

import { readFileSync } from 'node:fs';
import { handleLocalHostedWalletGatewayRequestV1 } from '../../localHostedWalletGatewayHandler';
import { createNodeHostedWalletGatewayV1 } from './nodeHostedWalletGateway';
import { checkNodeHostedWalletGatewayV1 } from './nodeHostedWalletGatewayCheck';
import { listenNodeFetchHandler } from './nodeHttp';
import { loadNodeDatabaseSync, nodeSqliteConnection, openNodeSqliteFile } from './nodeSqlite';
import { applySignerSqlMigrationsV1, inspectSignerSqlMigrationsV1 } from './signerSqlMigrations';

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  const databasePath = requireEnv('WALLET_GATEWAY_DATABASE_PATH');
  const migrationsDir = requireEnv('WALLET_GATEWAY_MIGRATIONS_DIR');
  const DatabaseSync = await loadNodeDatabaseSync();
  if (command === 'check') {
    const checks = await checkNodeHostedWalletGatewayV1({
      DatabaseSync,
      databasePath,
      migrationsDir,
      varsPath: optionalEnv('WALLET_GATEWAY_VARS_FILE'),
      readVars: readVarsFile,
      routerUrl: optionalEnv('WALLET_GATEWAY_ROUTER_URL'),
      signingWorkerUrl: optionalEnv('WALLET_GATEWAY_SIGNING_WORKER_URL'),
      signerWasmPath: optionalEnv('WALLET_GATEWAY_SIGNER_WASM_PATH'),
    });
    const ok = checks.every((check) => check.status !== 'failed');
    report({ kind: 'wallet_gateway_check_v1', ok, checks });
    return ok ? 0 : 1;
  }
  const database = openNodeSqliteFile(DatabaseSync, databasePath);
  const connection = nodeSqliteConnection(database);
  if (command === 'migrate') {
    const result = applySignerSqlMigrationsV1(connection, migrationsDir, Date.now());
    report({ kind: 'wallet_gateway_migrate_v1', ...result });
    database.close();
    return 0;
  }
  if (command === 'serve' || command === 'serve-local') {
    const status = inspectSignerSqlMigrationsV1(connection, migrationsDir);
    if (status.pending.length > 0 || status.unknown.length > 0) {
      throw new Error('shared store schema is not current; run `migrate` first');
    }
    const [host, port] = splitListen(requireEnv('WALLET_GATEWAY_LISTEN'));
    const gateway = createNodeHostedWalletGatewayV1({
      vars: readVarsFile(requireEnv('WALLET_GATEWAY_VARS_FILE')),
      connection,
      routerUrl: requireEnv('WALLET_GATEWAY_ROUTER_URL'),
      signingWorkerUrl: requireEnv('WALLET_GATEWAY_SIGNING_WORKER_URL'),
      signerWasmPath: requireEnv('WALLET_GATEWAY_SIGNER_WASM_PATH'),
      ...(command === 'serve-local' ? { handler: handleLocalHostedWalletGatewayRequestV1 } : {}),
      onBackgroundError: (error) =>
        process.stderr.write(`gateway background task failed: ${describe(error)}\n`),
    });
    const server = await listenNodeFetchHandler({ host, port, handle: gateway.handle });
    report({ kind: 'wallet_gateway_listening_v1', address: server.address() });
    const stop = () =>
      server.close(() => {
        void gateway.drain().finally(() => {
          database.close();
          process.exit(0);
        });
      });
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    return await new Promise<number>(() => undefined);
  }
  process.stderr.write('usage: wallet-gateway <migrate|check|serve|serve-local>\n');
  return 2;
}

/** Reads `KEY='value'` / `KEY=value` lines; values are never logged. */
function readVarsFile(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`invalid entry in ${path}`);
    const key = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (key in vars) throw new Error(`duplicate ${key} in ${path}`);
    vars[key] = value;
  }
  return vars;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function splitListen(value: string): [string, number] {
  const index = value.lastIndexOf(':');
  const port = Number(value.slice(index + 1));
  if (index <= 0 || !Number.isInteger(port)) {
    throw new Error('WALLET_GATEWAY_LISTEN must be host:port');
  }
  return [value.slice(0, index), port];
}

function report(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${describe(error)}\n`);
    process.exit(1);
  },
);
