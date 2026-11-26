import type { EmailOtpAuthStateRecord } from '../EmailOtpStores';

export type EmailOtpAuthStateReadResult =
  | { ok: true; state: EmailOtpAuthStateRecord | null }
  | { ok: false; code: string; message: string };
