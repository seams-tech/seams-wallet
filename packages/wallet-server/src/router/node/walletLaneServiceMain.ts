// Router wallet-lane service process for conventional VM deployments.
//
//   serve   Listen for wallet-lane store calls from the authorized caller.
//   check   Read-only: report data-directory and per-wallet schema problems.
//
// Configuration (environment):
//   ROUTER_WALLET_LANE_DATA_DIR                   role-private directory (required)
//   ROUTER_WALLET_LANE_SERVICE_LISTEN             host:port for `serve`
//   ROUTER_WALLET_LANE_SERVICE_AUTH_SECRET_FILE   file holding the dedicated credential

import {
  checkNodeWalletLaneDataDirectoryV1,
  createNodeWalletLaneServiceV1,
  listenNodeFetchHandler,
  loadNodeDatabaseSync,
  readAuthSecretFile,
} from './walletLaneService';

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  const dataDirectory = requireEnv('ROUTER_WALLET_LANE_DATA_DIR');
  const DatabaseSync = await loadNodeDatabaseSync();
  if (command === 'check') {
    const report = await checkNodeWalletLaneDataDirectoryV1({ dataDirectory, DatabaseSync });
    process.stdout.write(`${JSON.stringify({ kind: 'router_wallet_lane_check_v1', ...report })}\n`);
    return report.ok ? 0 : 1;
  }
  if (command === 'serve') {
    const [host, portText] = splitListen(requireEnv('ROUTER_WALLET_LANE_SERVICE_LISTEN'));
    const service = createNodeWalletLaneServiceV1({
      dataDirectory,
      authSecret: readAuthSecretFile(requireEnv('ROUTER_WALLET_LANE_SERVICE_AUTH_SECRET_FILE')),
      DatabaseSync,
    });
    const server = await listenNodeFetchHandler({ host, port: Number(portText), handle: service.handle });
    const address = server.address();
    process.stdout.write(
      `${JSON.stringify({ kind: 'router_wallet_lane_service_listening_v1', address })}\n`,
    );
    const stop = () => server.close(() => process.exit(0));
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    return await new Promise<number>(() => undefined);
  }
  process.stderr.write('usage: router-wallet-lane-service <serve|check>\n');
  return 2;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function splitListen(value: string): [string, string] {
  const index = value.lastIndexOf(':');
  if (index <= 0) throw new Error('ROUTER_WALLET_LANE_SERVICE_LISTEN must be host:port');
  const port = value.slice(index + 1);
  if (!/^\d+$/.test(port)) throw new Error('ROUTER_WALLET_LANE_SERVICE_LISTEN port is invalid');
  return [value.slice(0, index), port];
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
