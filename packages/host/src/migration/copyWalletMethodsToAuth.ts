import { sha256HexUtf8 } from '@shared/utils/digests';
import {
  AuthStore,
  type AuthDatabase,
  type AuthMethodRecord,
  type AuthScope,
} from '../../../auth/src/worker/store';

// The copy of the wallet's sign-in records into the database of the Auth Worker: one account
// for each wallet, with the wallet ID as the account ID, and one auth method for each wallet
// method, with the same method ID. It changes nothing in the wallet's database, and it can run
// again: a record that the auth database has stays as it is. Delete this file after each
// deployment has run it.

type SourceMethodRow = {
  org_id: string;
  project_id: string;
  env_id: string;
  wallet_id: string;
  wallet_auth_method_id: string;
  kind: 'passkey' | 'email_otp' | 'voiceid';
  status: 'pending_local_install' | 'active' | 'revoked';
  rp_id: string;
  auth_identifier_key: string;
  credential_public_key_b64u: string | null;
  email_hash_hex: string | null;
  method_counter: number | null;
  authenticator_counter: number | null;
  verified_email: string | null;
  created_at_ms: number;
  revoked_at_ms: number | null;
};

type SourceWalletRow = {
  org_id: string;
  project_id: string;
  env_id: string;
  wallet_id: string;
  created_at_ms: number;
};

export type WalletMethodCopyReport = {
  /** Wallets in the source, and accounts in the auth database after the copy. */
  readonly wallets: number;
  readonly accounts: number;
  /** Active and revoked wallet methods in the source, and auth methods after the copy. */
  readonly sourceMethods: number;
  readonly authMethods: number;
  /** Methods that are not yet installed on a device. They are not copied. */
  readonly pendingMethods: number;
  /**
   * Email methods whose address is not known: the wallet has no enrollment, or the digest of
   * its address is not the digest of the method. Such a method is copied as revoked, because
   * the Auth Worker cannot send it a code.
   */
  readonly emailMethodsWithoutAddress: readonly string[];
  /** True when each wallet has one account and each copied method has one auth record. */
  readonly complete: boolean;
};

type SourceDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<Row>(): Promise<{ results: Row[] }> };
  };
};

const PAGE_SIZE = 200;

function scopeKey(scope: AuthScope): string {
  return JSON.stringify([scope.orgId, scope.projectId, scope.envId]);
}

async function methodRecord(
  row: SourceMethodRow,
): Promise<{ method: AuthMethodRecord & { revokedAtMs: number | null }; addressKnown: boolean }> {
  let email: string | null = null;
  if (row.kind === 'email_otp' && row.verified_email) {
    const address = row.verified_email.trim().toLowerCase();
    if ((await sha256HexUtf8(address)) === row.email_hash_hex) email = address;
  }
  const addressKnown = row.kind !== 'email_otp' || email !== null;
  const active = row.status === 'active' && addressKnown;
  return {
    addressKnown,
    method: {
      methodId: row.wallet_auth_method_id,
      accountId: row.wallet_id,
      kind: row.kind,
      status: active ? 'active' : 'revoked',
      identifier: row.auth_identifier_key,
      publicKeyB64u: row.kind === 'email_otp' ? null : row.credential_public_key_b64u,
      counter: Math.max(row.method_counter ?? 0, row.authenticator_counter ?? 0),
      rpId: row.kind === 'passkey' ? row.rp_id : '',
      // The schema needs an address for each email method. An unknown one is the empty text.
      email: row.kind === 'email_otp' ? (email ?? '') : null,
      createdAtMs: row.created_at_ms,
      revokedAtMs: active ? null : (row.revoked_at_ms ?? row.created_at_ms),
    },
  };
}

/**
 * Copies each wallet and each wallet method of one storage namespace, then compares the
 * counts. `source` is the Gateway's database; `target` is the database of the Auth Worker.
 */
export async function copyWalletMethodsToAuth(input: {
  readonly source: SourceDatabase;
  readonly target: AuthDatabase;
  readonly namespace: string;
}): Promise<WalletMethodCopyReport> {
  const stores = new Map<string, AuthStore>();
  function storeOf(row: { org_id: string; project_id: string; env_id: string }): AuthStore {
    const scope = { orgId: row.org_id, projectId: row.project_id, envId: row.env_id };
    const key = scopeKey(scope);
    const store = stores.get(key) ?? new AuthStore(input.target, scope);
    stores.set(key, store);
    return store;
  }

  let wallets = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await input.source
      .prepare(
        `SELECT org_id, project_id, env_id, wallet_id, created_at_ms FROM wallets
         WHERE namespace = ? ORDER BY org_id, project_id, env_id, wallet_id LIMIT ? OFFSET ?`,
      )
      .bind(input.namespace, PAGE_SIZE, offset)
      .all<SourceWalletRow>();
    for (const row of page.results) {
      await storeOf(row).importRecords(
        [{ accountId: row.wallet_id, createdAtMs: row.created_at_ms }],
        [],
      );
    }
    wallets += page.results.length;
    if (page.results.length < PAGE_SIZE) break;
  }

  let sourceMethods = 0;
  let pendingMethods = 0;
  const emailMethodsWithoutAddress: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await input.source
      .prepare(
        `SELECT m.org_id, m.project_id, m.env_id, m.wallet_id, m.wallet_auth_method_id, m.kind,
           m.status, m.rp_id, m.auth_identifier_key, m.credential_public_key_b64u,
           m.email_hash_hex, json_extract(m.record_json, '$.counter') AS method_counter,
           a.counter AS authenticator_counter, e.verified_email, m.created_at_ms,
           m.revoked_at_ms
         FROM wallet_auth_methods m
         LEFT JOIN webauthn_authenticators a
           ON a.namespace = m.namespace AND a.org_id = m.org_id AND a.project_id = m.project_id
          AND a.env_id = m.env_id AND a.user_id = m.wallet_id
          AND a.credential_id_b64u = m.credential_id_b64u
         LEFT JOIN email_otp_wallet_enrollments e
           ON e.namespace = m.namespace AND e.org_id = m.org_id AND e.project_id = m.project_id
          AND e.env_id = m.env_id AND e.wallet_id = m.wallet_id
         WHERE m.namespace = ?
         ORDER BY m.org_id, m.project_id, m.env_id, m.wallet_auth_method_id LIMIT ? OFFSET ?`,
      )
      .bind(input.namespace, PAGE_SIZE, offset)
      .all<SourceMethodRow>();
    for (const row of page.results) {
      if (row.status === 'pending_local_install') {
        pendingMethods += 1;
        continue;
      }
      sourceMethods += 1;
      const { method, addressKnown } = await methodRecord(row);
      if (!addressKnown && row.status === 'active') {
        emailMethodsWithoutAddress.push(row.wallet_auth_method_id);
      }
      // A method of a wallet with no wallet row still gets its account.
      await storeOf(row).importRecords(
        [{ accountId: row.wallet_id, createdAtMs: row.created_at_ms }],
        [method],
      );
    }
    if (page.results.length < PAGE_SIZE) break;
  }

  let accounts = 0;
  let authMethods = 0;
  for (const store of stores.values()) {
    const counts = await store.recordCounts();
    accounts += counts.accounts;
    authMethods += counts.activeMethods + counts.revokedMethods;
  }
  return {
    wallets,
    accounts,
    sourceMethods,
    authMethods,
    pendingMethods,
    emailMethodsWithoutAddress,
    complete: accounts >= wallets && authMethods === sourceMethods,
  };
}
