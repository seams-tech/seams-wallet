import type { ConnectionCapability, SeamsWeb } from '@/SeamsWeb';

function finishConnectionWait(
  timer: ReturnType<typeof setTimeout>,
  resolve: (ready: boolean) => void,
  connection: ConnectionCapability,
): void {
  clearTimeout(timer);
  resolve(connection.getState().kind === 'ready');
}

function startConnectionWait(
  connection: ConnectionCapability,
  timeoutMs: number,
  resolve: (ready: boolean) => void,
): void {
  const timer = setTimeout(resolve, timeoutMs, false);
  const finish = finishConnectionWait.bind(null, timer, resolve, connection);
  void connection.connect().then(finish, finish);
}

/** Wait for reconciled connection readiness within the caller's UI deadline. */
export async function awaitWalletIframeReady(
  manager: Pick<SeamsWeb, 'connection'>,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const timeoutMs = Math.max(500, Math.min(15_000, opts?.timeoutMs ?? 4000));
  return await new Promise(startConnectionWait.bind(null, manager.connection, timeoutMs));
}
