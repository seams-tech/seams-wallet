import { existsSync } from 'node:fs';
import path from 'node:path';

type PendingWalletRecoveryCommitIdentity = {
  readonly walletId: string;
  readonly recoveryOperationId: string;
  readonly stage: string;
};

export function intendedIndexedDbModulePath(appUrl: string): string {
  const configured = String(process.env.SEAMS_REPO_ROOT || '').trim();
  const cwd = process.cwd();
  const repoRoot =
    configured || (existsSync(path.join(cwd, 'packages/wallet')) ? cwd : path.resolve(cwd, '..'));
  return `${new URL(appUrl).origin}/@fs/${path.join(
    repoRoot,
    'packages/wallet/dist/esm/core/indexedDB/index.js',
  )}`;
}

export async function readPendingWalletRecoveryCommitIdentitiesInBrowser(input: {
  readonly modulePath: string;
}): Promise<readonly PendingWalletRecoveryCommitIdentity[]> {
  const { IndexedDBManager } = await import(input.modulePath);
  const records: readonly {
    readonly walletId: unknown;
    readonly recoveryOperationId: unknown;
    readonly stage: unknown;
  }[] = await IndexedDBManager.listPendingWalletRecoveryCommits();
  return records.map((record) => ({
    walletId: String(record.walletId),
    recoveryOperationId: String(record.recoveryOperationId),
    stage: String(record.stage),
  }));
}
