import type { WalletAuthMethodRevocationProof } from '@shared/utils/registrationIntent';
import type { LinkedDeviceRevokeResultV1 } from '@shared/device-linking/contracts';
import { parseLinkedDeviceRevokeResultV1 } from '@shared/device-linking/parsers';
import type { WalletRevokeAuthMethodResponse } from '../../../../core/registrationContracts';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/encoders';
import type { WalletAuthMethodId, WalletAuthorityId, WalletId } from '@shared/utils/domainIds';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';

const REVOCATION_PROOF_DIGEST_DOMAIN_V1 = 'seams/wallet-auth-method-revocation-proof/v1';

/** The route whose answer a record holds. Each route reads back only its own. */
type RevocationAnswerKind = 'wallet_auth_method_revocation_v1' | 'linked_device_revocation_v1';

type ReplayScope = {
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

type ReplayRow = {
  readonly operation_fingerprint_digest_b64u: string;
  readonly source_proof_digest_b64u: string;
  readonly response_json: string;
  readonly answer_kind: string;
};

/** The operation and the proof one revocation request presents. */
export type WalletAuthMethodRevocationReplayIdentityV1 = {
  readonly walletId: WalletId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly operationFingerprintDigestB64u: string;
  readonly sourceProofDigestB64u: string;
};

/**
 * A digest of the proof a revocation request presents. The recorded answer
 * is bound to it, so no proof, and no one-time code, is kept.
 */
export async function computeWalletAuthMethodRevocationProofDigestV1(
  proof: WalletAuthMethodRevocationProof,
): Promise<string> {
  const digest = await sha256BytesUtf8(
    `${REVOCATION_PROOF_DIGEST_DOMAIN_V1}\n${alphabetizeStringify(proof)}`,
  );
  return base64UrlEncode(digest);
}

/**
 * Each auth-method revocation's committed answer, in the signer database. The
 * row is inserted in the batch that revokes the method, and never changes.
 */
export class D1WalletAuthMethodRevocationReplayStoreV1 {
  private readonly database: D1DatabaseLike;
  private readonly scope: ReplayScope;

  constructor(input: { readonly database: D1DatabaseLike; readonly scope: ReplayScope }) {
    this.database = input.database;
    this.scope = input.scope;
  }

  /**
   * The committed answer to exactly this request: the same operation, proven
   * by the same proof. Null for a method no revocation committed, or one a
   * different request revoked.
   */
  async readExactAnswerV1(
    identity: WalletAuthMethodRevocationReplayIdentityV1,
  ): Promise<WalletRevokeAuthMethodResponse | null> {
    const json = await this.readExactAnswerJson(identity, 'wallet_auth_method_revocation_v1');
    return json === null ? null : (JSON.parse(json) as WalletRevokeAuthMethodResponse);
  }

  /** The committed answer to exactly this linked-device revocation request. */
  async readExactLinkedDeviceAnswerV1(
    identity: WalletAuthMethodRevocationReplayIdentityV1,
  ): Promise<LinkedDeviceRevokeResultV1 | null> {
    const json = await this.readExactAnswerJson(identity, 'linked_device_revocation_v1');
    return json === null ? null : parseLinkedDeviceRevokeResultV1(JSON.parse(json));
  }

  private async readExactAnswerJson(
    identity: WalletAuthMethodRevocationReplayIdentityV1,
    answerKind: RevocationAnswerKind,
  ): Promise<string | null> {
    const row = await this.database
      .prepare(
        `SELECT operation_fingerprint_digest_b64u, source_proof_digest_b64u, response_json,
                answer_kind
           FROM wallet_auth_method_revocation_replays
          WHERE namespace = ?1
            AND org_id = ?2
            AND project_id = ?3
            AND env_id = ?4
            AND wallet_id = ?5
            AND target_wallet_auth_method_id = ?6`,
      )
      .bind(
        this.scope.namespace,
        this.scope.orgId,
        this.scope.projectId,
        this.scope.envId,
        String(identity.walletId),
        String(identity.targetWalletAuthMethodId),
      )
      .first<ReplayRow>();
    if (
      !row ||
      row.answer_kind !== answerKind ||
      row.operation_fingerprint_digest_b64u !== identity.operationFingerprintDigestB64u ||
      row.source_proof_digest_b64u !== identity.sourceProofDigestB64u
    ) {
      return null;
    }
    return row.response_json;
  }

  /**
   * The statements that record `response` as the answer to this request, for
   * the batch that revokes the method. They abort the batch unless they
   * insert it: a method whose revocation already committed commits nothing
   * more.
   */
  prepareRecordAnswerStatements(input: {
    readonly identity: WalletAuthMethodRevocationReplayIdentityV1;
    readonly sourceWalletAuthMethodId: WalletAuthMethodId;
    readonly response: WalletRevokeAuthMethodResponse;
    readonly committedAtMs: number;
  }): readonly D1PreparedStatementLike[] {
    return [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO wallet_auth_method_revocation_replays (
             namespace, org_id, project_id, env_id, wallet_id,
             target_wallet_auth_method_id, operation_fingerprint_digest_b64u,
             source_wallet_auth_method_id, source_proof_digest_b64u,
             response_json, committed_at_ms, answer_kind
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                     'wallet_auth_method_revocation_v1')`,
        )
        .bind(
          this.scope.namespace,
          this.scope.orgId,
          this.scope.projectId,
          this.scope.envId,
          String(input.identity.walletId),
          String(input.identity.targetWalletAuthMethodId),
          input.identity.operationFingerprintDigestB64u,
          String(input.sourceWalletAuthMethodId),
          input.identity.sourceProofDigestB64u,
          JSON.stringify(input.response),
          input.committedAtMs,
        ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ];
  }

  /**
   * The statements that record a linked-device revocation's answer, for the
   * end of the batch that revokes the device's method. The answer names the
   * device's authority and its revocation epoch, which the batch itself sets,
   * so the statement reads them from the row the batch wrote: the record is
   * the answer that committed. They abort the batch unless they insert it.
   */
  prepareRecordLinkedDeviceAnswerStatements(input: {
    readonly identity: WalletAuthMethodRevocationReplayIdentityV1;
    readonly sourceWalletAuthMethodId: WalletAuthMethodId;
    readonly authorityId: WalletAuthorityId;
    readonly committedAtMs: number;
  }): readonly D1PreparedStatementLike[] {
    return [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO wallet_auth_method_revocation_replays (
             namespace, org_id, project_id, env_id, wallet_id,
             target_wallet_auth_method_id, operation_fingerprint_digest_b64u,
             source_wallet_auth_method_id, source_proof_digest_b64u,
             response_json, committed_at_ms, answer_kind
           )
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                  json_object(
                    'kind', 'revoked',
                    'walletAuthMethodId', ?6,
                    'authorityId', authority.authority_id,
                    'revocationEpoch', authority.revocation_epoch
                  ),
                  ?10, 'linked_device_revocation_v1'
             FROM wallet_authorities AS authority
            WHERE authority.namespace = ?1
              AND authority.org_id = ?2
              AND authority.project_id = ?3
              AND authority.env_id = ?4
              AND authority.wallet_id = ?5
              AND authority.authority_id = ?11`,
        )
        .bind(
          this.scope.namespace,
          this.scope.orgId,
          this.scope.projectId,
          this.scope.envId,
          String(input.identity.walletId),
          String(input.identity.targetWalletAuthMethodId),
          input.identity.operationFingerprintDigestB64u,
          String(input.sourceWalletAuthMethodId),
          input.identity.sourceProofDigestB64u,
          input.committedAtMs,
          String(input.authorityId),
        ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ];
  }
}
