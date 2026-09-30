import { toOptionalTrimmedString } from '@shared/utils/validation';
import type { ScopedD1Prepare } from '../../../../core/emailOtpD1Statements';
import { NEAR_PUBLIC_KEYS_BY_USER_SQL } from '../../../../core/NearPublicKeyStore';
import {
  parseNearPublicKey,
  type D1RecordJsonRow,
  type NearPublicKeyRecord,
} from '../webauthn/d1WebAuthnRecords';

type D1NearPublicKeyListResult =
  | {
      readonly ok: true;
      readonly keys: {
        readonly publicKey: string;
        readonly kind: NearPublicKeyRecord['kind'];
        readonly signerSlot?: number;
        readonly createdAtMs?: number;
        readonly updatedAtMs?: number;
        readonly authBinding?: NearPublicKeyRecord['authBinding'];
      }[];
    }
  | {
      readonly ok: false;
      readonly code: 'invalid_args' | 'internal';
      readonly message: string;
    };

export class CloudflareD1NearPublicKeyStore {
  private readonly prepare: ScopedD1Prepare;

  constructor(input: { readonly prepare: ScopedD1Prepare }) {
    this.prepare = input.prepare;
  }

  async listForRelayUser(input: { readonly userId?: unknown }): Promise<D1NearPublicKeyListResult> {
    try {
      const userId = toOptionalTrimmedString(input.userId);
      if (!userId) return { ok: false, code: 'invalid_args', message: 'Missing userId' };
      const records = await this.listForUser(userId);
      const keys: Extract<D1NearPublicKeyListResult, { readonly ok: true }>['keys'] = records.map(
        nearPublicKeyForRelayResponse,
      );
      return { ok: true, keys };
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'internal',
        message: nearPublicKeyErrorMessage(error) || 'Failed to list keys',
      };
    }
  }

  async listForUser(userId: string): Promise<NearPublicKeyRecord[]> {
    const result = await this.prepare(NEAR_PUBLIC_KEYS_BY_USER_SQL, [
      userId,
    ]).all<D1RecordJsonRow>();
    const records: NearPublicKeyRecord[] = [];
    for (const row of result.results || []) {
      const record = parseNearPublicKey(row);
      if (record) records.push(record);
    }
    return records;
  }
}

function nearPublicKeyForRelayResponse(record: NearPublicKeyRecord): Extract<
  D1NearPublicKeyListResult,
  { readonly ok: true }
>['keys'][number] {
  return {
    publicKey: record.publicKey,
    kind: record.kind,
    signerSlot: record.signerSlot,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(record.authBinding ? { authBinding: record.authBinding } : {}),
  };
}

function nearPublicKeyErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}
