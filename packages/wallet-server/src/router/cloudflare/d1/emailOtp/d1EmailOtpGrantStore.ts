import type { EmailOtpGrantRecord } from '../../../../core/EmailOtpStores';
import { emailOtpGrantRows, type ScopedD1Prepare } from '../../../../core/emailOtpD1Statements';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { parseEmailOtpGrantRow, type D1EmailOtpGrantRow } from './d1EmailOtpRecords';

export class CloudflareD1EmailOtpGrantStore {
  private readonly prepare: ScopedD1Prepare;

  constructor(input: { readonly prepare: ScopedD1Prepare }) {
    this.prepare = input.prepare;
  }

  async put(record: EmailOtpGrantRecord): Promise<void> {
    await emailOtpGrantRows.insert(this.prepare, record).run();
  }

  async read(grantToken: string): Promise<EmailOtpGrantRecord | null> {
    const row = await emailOtpGrantRows
      .read(this.prepare, grantToken)
      .first<D1EmailOtpGrantRow>();
    return parseEmailOtpGrantRow(row);
  }

  prepareConsumeMatching(record: EmailOtpGrantRecord, nowMs: number): D1PreparedStatementLike {
    return emailOtpGrantRows.consumeMatching(this.prepare, record, nowMs);
  }
}
