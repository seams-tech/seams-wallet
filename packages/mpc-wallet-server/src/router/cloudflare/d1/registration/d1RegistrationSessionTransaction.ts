import type { D1Row } from '../../../../storage/d1Sql';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../../storage/tenantRoute';
import type { D1RegistrationCommitBatch } from './d1WalletRegistrationCommitStore';

/** The wallet's version checks and the session's winner read share one batch. */
export class D1RegistrationSessionTransaction {
  private sessionResults: readonly D1ResultLike<D1Row>[] | null = null;

  constructor(
    private readonly database: D1DatabaseLike,
    private readonly commitWallet: (executeBatch: D1RegistrationCommitBatch) => Promise<void>,
  ) {}

  async execute(
    sessionStatements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<D1Row>[]> {
    await this.commitWallet(this.commit.bind(this, sessionStatements));
    if (this.sessionResults === null) {
      throw new Error('Registration wallet commit did not execute its session transaction');
    }
    return this.sessionResults;
  }

  private async commit(
    sessionStatements: readonly D1PreparedStatementLike[],
    walletStatements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike[]> {
    this.sessionResults = null;
    const results = await this.database.batch<D1ResultLike<D1Row>>([
      ...walletStatements,
      ...sessionStatements,
    ]);
    if (
      results.length !== walletStatements.length + sessionStatements.length ||
      results.some(batchStatementFailed)
    ) {
      throw new Error('Registration wallet/session transaction returned incomplete results');
    }
    this.sessionResults = results.slice(walletStatements.length);
    return results.slice(0, walletStatements.length);
  }
}

function batchStatementFailed(result: D1ResultLike): boolean {
  return !result.success;
}
