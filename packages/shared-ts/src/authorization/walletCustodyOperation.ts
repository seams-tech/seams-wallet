import { sha256Utf8DigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { alphabetizeStringify } from '../utils/digests';

export type WalletCustodyAdminOperation =
  | 'credentials_list'
  | 'credential_label'
  | 'recovery_rotate'
  | 'recovery_read';

/** Public challenge digest for a single wallet-administration factor proof. */
export async function computeWalletCustodyAdminChallengeDigest(input: {
  readonly walletId: string;
  readonly operation: WalletCustodyAdminOperation;
  readonly payload: Record<string, unknown>;
  readonly requestOrigin: string;
}): Promise<DigestB64u> {
  return sha256Utf8DigestB64u(
    `seams:wallet-custody:challenge:v1|${alphabetizeStringify({
      walletId: input.walletId,
      operation: input.operation,
      payload: input.payload,
      requestOrigin: input.requestOrigin,
    })}`,
  );
}
