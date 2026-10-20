import {
  buildCapabilityOperationEnvelope,
  buildNearMlDsa65MpcOperationRef,
  parseTenantId,
  parsePrincipalId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parseAuthorizedOperationId,
  parseAuthorizationAuditEventId,
  parseAuthFactorId,
  parseAuthorizationEvidenceId,
  parseAuthorizationEvidenceSetId,
} from '@shared/authorization';
import { computeCapabilityOperationFingerprintDigest } from '@shared/authorization/operationFingerprint';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { sha256Utf8DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/base64';
import { requireRecord } from '@shared/utils/validation';
import { requireBytes } from '@shared/utils/routerAbEd25519YaoDigests';
import { walletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import {
  parseMlDsaTransactionInspection,
  parseMlDsaSignedTransaction,
  type MlDsaSigningRequest,
  type MlDsaSigningPreparationOutcome,
  type MlDsaSigningOutcome,
  type MlDsaSigningFailure,
  type MlDsaSigningFailureCode,
} from '@shared/near/mlDsaSigning';
import type { WalletId } from '@shared/utils/domainIds';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { verifyWebAuthnAuthenticationLiteWithStore } from '../../../../core/authService/webauthn';
import {
  ensureSignerWasmRuntime,
  type SignerWasmRuntimeState,
} from '../../../../core/authService/wasm';
import { normalizeLogger } from '../../../../core/logger';
import type {
  SignerWasmModuleSupplier,
  WebAuthnAuthenticationCredential,
} from '../../../../core/types';
import { buildVerifiedWalletOperationPasskeyFactorResult } from '../../../../authorization/factorEvidence';
import {
  buildAuthorizedOperation,
  parseVerifiedOwnerProofId,
  type SessionOrigin,
} from '../../../../authorization/domain';
import type { AuthorizationService } from '../../../../authorization/service';
import {
  MlDsaSigningTarget,
  MlDsaTransactionIntent,
  mlDsaOwnerOperationDigests,
  prepareMlDsaOwnerOperation,
} from '../../../domains/signingOperations/mlDsaOwnerAdmission';
import { dispatchMlDsaOwnerOperation } from '../../../transport/fetch/routes/mlDsaSigning';
import type { RouterAbNormalSigningRouterProxy } from '../../../framework/routerApi';
import { CloudflareD1VersionedJsonRecordStore } from '../versionedJson/d1VersionedJsonRecordStore';
import { prepareAuthorizedOperationInsert } from '../authorization/authorizedOperationStatements';
import type { CloudflareD1WebAuthnStore } from '../webauthn/d1WebAuthnStore';
import type { CloudflareD1WalletAuthMethodService } from './d1WalletAuthMethodService';
import { D1WalletMlDsaRegistration } from './d1WalletMlDsaRegistration';
import { D1MlDsaWebAuthnVerification } from './d1MlDsaWebAuthnVerification';
import {
  encodeMlDsaSigningRecord,
  parseMlDsaSigningRecord,
  type MlDsaSigningRecord,
} from './mlDsaSigningRecord';
import {
  ml_dsa65_inspect_near_transaction,
  ml_dsa65_finalize_near_transaction,
} from '../../../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';

export type MlDsaSigningExecuteRequest = {
  readonly walletId: WalletId;
  readonly operationIdB64u: DigestB64u;
  readonly credential: WebAuthnAuthenticationCredential;
};
function refusal(code: MlDsaSigningFailureCode, message: string): MlDsaSigningFailure {
  return { kind: 'refused', code, message };
}
function requestKey(walletId: WalletId, operationId: DigestB64u): string {
  return JSON.stringify([walletId, operationId]);
}
function approvedRecord(
  record: MlDsaSigningRecord,
  verifiedAtMs: number,
  assertionDigest: DigestB64u,
): MlDsaSigningRecord {
  return {
    preparation: record.preparation,
    target: record.target,
    owner: record.owner,
    publicationVersion: record.publicationVersion,
    origin: record.origin,
    phase: { kind: 'approved', verifiedAtMs, assertionDigest },
  };
}

/** Exact passkey operations. Generic signing sessions do not admit ML-DSA. */
export class D1WalletMlDsaSigning {
  private readonly records: CloudflareD1VersionedJsonRecordStore<MlDsaSigningRecord>;
  private wasmState: SignerWasmRuntimeState = { signerWasmReady: false };
  constructor(
    private readonly options: {
      readonly database: D1DatabaseLike;
      readonly scope: D1TenantScope;
      readonly proxy: RouterAbNormalSigningRouterProxy | null;
      readonly registration: D1WalletMlDsaRegistration | null;
      readonly walletAuthMethods: Pick<
        CloudflareD1WalletAuthMethodService,
        'resolveActivePasskeyAuthorityForVerifiedCredential'
      >;
      readonly webAuthnStore: CloudflareD1WebAuthnStore;
      readonly authorizations: AuthorizationService;
      readonly signerWasmModuleOrPath?: SignerWasmModuleSupplier;
    },
  ) {
    this.records = new CloudflareD1VersionedJsonRecordStore({
      database: options.database,
      scope: options.scope,
      keyPrefix: 'ml-dsa-signing',
      encode: encodeMlDsaSigningRecord,
      parse: parseMlDsaSigningRecord,
    });
  }
  private async initializeCodec(): Promise<void> {
    this.wasmState = await ensureSignerWasmRuntime({
      state: this.wasmState,
      override: this.options.signerWasmModuleOrPath,
      logger: normalizeLogger(),
    });
  }
  async prepare(
    request: MlDsaSigningRequest,
    origin: SessionOrigin,
  ): Promise<MlDsaSigningPreparationOutcome> {
    if (!this.options.proxy || !this.options.registration)
      return refusal('not_configured', 'ML-DSA signing is not configured');
    const existing = await this.records.read(requestKey(request.walletId, request.operationIdB64u));
    if (existing.kind === 'present') {
      if (
        alphabetizeStringify(existing.value.preparation.request) !==
          alphabetizeStringify(request) ||
        existing.value.origin !== origin
      )
        return refusal('idempotency_conflict', 'The signing operation changed');
      if (!(await this.current(existing.value)))
        return refusal('unauthorized', 'The signing approval or published key is no longer valid');
      if (Date.now() >= existing.value.preparation.expiresAtMs)
        return refusal('expired', 'The signing approval expired');
      return { kind: 'prepared', preparation: existing.value.preparation };
    }
    const published = await this.options.registration.readPublished(
      request.walletId,
      request.signingKeyId,
    );
    if (!published) return refusal('not_found', 'The ML-DSA key is not published');
    const resolved =
      await this.options.walletAuthMethods.resolveActivePasskeyAuthorityForVerifiedCredential({
        walletId: request.walletId,
        rpId: request.rpId,
        credentialIdB64u: request.credentialIdB64u,
      });
    if (
      !resolved.ok ||
      resolved.walletAuthority.provenance.kind === 'device_link' ||
      resolved.walletAuthority.permissions.length !== 4
    )
      return refusal('unauthorized', 'ML-DSA signing requires an active wallet owner');
    await this.initializeCodec();
    let transaction;
    try {
      transaction = parseMlDsaTransactionInspection(
        JSON.parse(
          ml_dsa65_inspect_near_transaction(
            JSON.stringify({
              unsignedTransactionBorshB64u: request.unsignedTransactionBorshB64u,
              publicKeyB64u: published.key.registeredPublicKeyB64u,
            }),
          ),
        ),
      );
    } catch {
      return refusal('invalid_body', 'Invalid ML-DSA NEAR transaction or public key');
    }
    const target = MlDsaSigningTarget.parse({
      tenantId: this.options.scope.orgId,
      identity: published.identity,
      capabilityId: `ml-dsa:${published.key.walletKeyId}`,
      key: published.key,
      scheduleDigest: published.scheduleDigestB64u,
      authority: await walletAuthAuthorityRef({ authority: resolved.authority }),
    });
    const expiresAtMs = Date.now() + 300_000;
    const partial = { request, transaction, expiresAtMs };
    const fingerprint = await computeCapabilityOperationFingerprintDigest(
      await operationEnvelope(target, partial),
    );
    const record: MlDsaSigningRecord = {
      preparation: {
        request,
        transaction,
        expiresAtMs,
        challengeB64u: await sha256Utf8DigestB64u(
          `seams/ml-dsa/sign-approval/v1|${fingerprint}|${origin}|${expiresAtMs}`,
        ),
      },
      target,
      owner: resolved.walletAuthority,
      publicationVersion: published.publicationVersion,
      origin,
      phase: { kind: 'awaiting_approval' },
    };
    const result = await this.records.putManyWithAdditionalStatements(
      [
        {
          key: requestKey(request.walletId, request.operationIdB64u),
          value: record,
          expectedVersion: null,
        },
      ],
      [this.guard(record, false)],
    );
    if (result.kind !== 'stored')
      return refusal('conflict', 'Signing preparation changed; retry the same operation');
    return { kind: 'prepared', preparation: record.preparation };
  }
  async sign(
    request: MlDsaSigningExecuteRequest,
    origin: SessionOrigin,
  ): Promise<MlDsaSigningOutcome> {
    if (!this.options.proxy) return refusal('not_configured', 'ML-DSA signing is not configured');
    const key = requestKey(request.walletId, request.operationIdB64u);
    const read = await this.records.read(key);
    if (read.kind !== 'present') return refusal('not_found', 'The signing operation is absent');
    let record = read.value;
    if (record.origin !== origin || !(await this.current(record)))
      return refusal('unauthorized', 'The signing approval or published key is no longer valid');
    if (Date.now() >= record.preparation.expiresAtMs)
      return refusal('expired', 'The signing approval expired');
    if (
      request.credential.id !== record.preparation.request.credentialIdB64u ||
      request.credential.rawId !== request.credential.id
    )
      return refusal('unauthorized', 'The signing credential differs');
    const assertionDigest = await sha256Utf8DigestB64u(alphabetizeStringify(request.credential));
    let counter: D1MlDsaWebAuthnVerification | null = null;
    if (record.phase.kind === 'approved') {
      if (record.phase.assertionDigest !== assertionDigest)
        return refusal('idempotency_conflict', 'The approved assertion changed');
    } else {
      counter = new D1MlDsaWebAuthnVerification(this.options.webAuthnStore);
      const verified = await verifyWebAuthnAuthenticationLiteWithStore({
        userId: request.walletId,
        rpId: record.preparation.request.rpId,
        expectedOrigin: origin,
        expectedChallenge: record.preparation.challengeB64u,
        webauthnAuthentication: request.credential,
        authenticatorStore: counter,
        logger: normalizeLogger(),
      });
      if (!verified.success || !verified.verified)
        return refusal('unauthorized', 'ML-DSA signing approval failed');
      record = approvedRecord(record, Date.now(), assertionDigest);
    }
    if (record.phase.kind !== 'approved') throw new Error('ML-DSA operation approval is absent');
    const operation = await operationEnvelope(record.target, record.preparation);
    const factor = buildVerifiedWalletOperationPasskeyFactorResult({
      tenantId: record.target.tenantId,
      principalId: operation.principalId,
      walletId: request.walletId,
      authorityRef: record.target.authority,
      requestOrigin: origin,
      audience: origin,
      factorId: requireParsed(parseAuthFactorId(`ml-dsa:${assertionDigest}`), 'factorId'),
      operation,
      credentialIdB64u: record.preparation.request.credentialIdB64u,
      assertionDigest,
      verifiedAtMs: record.phase.verifiedAtMs,
      expiresAtMs: record.preparation.expiresAtMs,
    });
    const evidenceId = `ml-dsa:${assertionDigest}:${record.phase.verifiedAtMs}`;
    const evidence =
      await this.options.authorizations.recordVerifiedWalletOperationFactorEvidenceSet({
        operation,
        factor,
        evidenceId: requireParsed(parseAuthorizationEvidenceId(evidenceId), 'evidenceId'),
        evidenceSetId: requireParsed(parseAuthorizationEvidenceSetId(evidenceId), 'evidenceSetId'),
      });
    const proof = await this.options.authorizations.buildVerifiedOwnerProof({
      purpose: 'operation',
      proofId: parseVerifiedOwnerProofId(evidenceId),
      factor,
    });
    if (proof.purpose !== 'operation') throw new Error('ML-DSA requires an operation proof');
    const authorizedOperation = await buildAuthorizedOperation({
      tenantId: record.target.tenantId,
      authorizedOperationId: requireParsed(
        parseAuthorizedOperationId(`ml-dsa:${request.walletId}:${request.operationIdB64u}`),
        'authorizedOperationId',
      ),
      auditEventId: requireParsed(
        parseAuthorizationAuditEventId(`ml-dsa:${request.walletId}:${request.operationIdB64u}`),
        'auditEventId',
      ),
      operation,
      authorization: { kind: 'verified_step_up', evidenceSetDigest: evidence.evidenceSetDigest },
      quota: { kind: 'quota_neutral' },
      claimedAtMs: record.phase.verifiedAtMs,
    });
    if (counter) {
      const saved = await this.records.putManyWithAdditionalStatements(
        [{ key, value: record, expectedVersion: read.version }],
        [
          this.guard(record, false),
          ...counter.statements(this.options.database, this.options.scope),
          prepareAuthorizedOperationInsert({
            database: this.options.database,
            namespace: this.options.scope.namespace,
            walletSignerScope: this.options.scope,
            operation: authorizedOperation,
            material: null,
            materialSnapshot: null,
            existingOperation: 'reject',
          }),
          this.options.database.prepare(D1_BATCH_CAS_GUARD_SQL),
        ],
      );
      if (saved.kind !== 'stored')
        return refusal('conflict', 'Signing approval changed; retry the same operation');
    }
    const claimed = await this.options.authorizations.readAuthorizedOperation({
      tenantId: record.target.tenantId,
      operationFingerprintDigest: authorizedOperation.operationFingerprintDigest,
    });
    if (
      !claimed ||
      claimed.authorizedOperationId !== authorizedOperation.authorizedOperationId ||
      claimed.authorization.kind !== 'verified_step_up' ||
      claimed.authorization.evidenceSetDigest !== evidence.evidenceSetDigest
    )
      return refusal('conflict', 'The durable signing claim differs');
    if (!(await this.current(record)))
      return refusal('unauthorized', 'The signing approval or published key is no longer valid');
    if (claimed.lifecycle === 'completed')
      return parseSigningOutcome(JSON.parse(claimed.response.bodyText));
    const admitted = await prepareMlDsaOwnerOperation({
      target: record.target,
      intent: MlDsaTransactionIntent.parse({
        transactionHash: record.preparation.transaction.transactionHashB64u,
      }),
      operation: claimed,
      evidence,
      ownerProof: proof,
      nowMs: Date.now(),
      requestOrigin: origin,
      audience: origin,
    });
    if (admitted.kind !== 'prepared')
      return refusal('unauthorized', 'The exact ML-DSA operation is not authorized');
    let response: Response;
    try {
      response = await dispatchMlDsaOwnerOperation(this.options.proxy, admitted.operation);
    } catch {
      return { kind: 'retry', reason: 'running', retryAtMs: Date.now() + 1000 };
    }
    let outcome: MlDsaSigningOutcome;
    try {
      outcome = await this.routerOutcome(record, response);
    } catch {
      return refusal('protocol_failed', 'The private ML-DSA response is invalid');
    }
    if (outcome.kind === 'retry') return outcome;
    const completed = await this.options.authorizations.completeAuthorizedOperation({
      operation: claimed,
      result: outcome.kind === 'signed' ? 'succeeded' : 'failed_after_side_effect',
      completedAtMs: Date.now(),
      response: { status: 200, contentType: 'application/json', bodyText: JSON.stringify(outcome) },
    });
    if (!(await this.current(record)))
      return refusal('unauthorized', 'The signing approval or published key is no longer valid');
    if (completed.lifecycle !== 'completed')
      return refusal('conflict', 'Signing completion changed');
    return parseSigningOutcome(JSON.parse(completed.response.bodyText));
  }
  private async routerOutcome(
    record: MlDsaSigningRecord,
    response: Response,
  ): Promise<MlDsaSigningOutcome> {
    const raw = requireRecord(await response.json(), 'ML-DSA Router result');
    if (response.status !== 200) throw new Error('Router request failed');
    if (raw.status === 'unavailable') {
      if (
        typeof raw.retry_at_ms !== 'number' ||
        !Number.isSafeInteger(raw.retry_at_ms) ||
        raw.retry_at_ms < 0
      )
        throw new Error('Invalid retry');
      return { kind: 'retry', reason: 'unavailable', retryAtMs: raw.retry_at_ms };
    }
    if (raw.status !== 'existing') throw new Error('Invalid Router operation');
    const operation = requireRecord(raw.operation, 'ML-DSA operation');
    if (operation.state === 'running')
      return { kind: 'retry', reason: 'running', retryAtMs: Date.now() + 500 };
    if (operation.state === 'failed') return refusal('protocol_failed', 'ML-DSA signing failed');
    if (operation.state !== 'succeeded') throw new Error('Invalid Router state');
    const signature = base64UrlEncode(
      Uint8Array.from(requireBytes(operation.signature, 'ML-DSA signature', 3309, 3309)),
    );
    await this.initializeCodec();
    try {
      return {
        kind: 'signed',
        transaction: parseMlDsaSignedTransaction(
          JSON.parse(
            ml_dsa65_finalize_near_transaction(
              JSON.stringify({
                unsignedTransactionBorshB64u:
                  record.preparation.request.unsignedTransactionBorshB64u,
                publicKeyB64u: record.target.key.registeredPublicKeyB64u,
                signatureB64u: signature,
              }),
            ),
          ),
        ),
      };
    } catch {
      return refusal('invalid_signature', 'The ML-DSA signature does not verify');
    }
  }
  private ownerCondition(record: MlDsaSigningRecord, allowDraining: boolean) {
    const identity = record.target.identity;
    return {
      sql: `EXISTS (
        SELECT 1 FROM wallet_authorities a JOIN wallet_auth_methods m
        ON m.namespace=a.namespace AND m.org_id=a.org_id AND m.project_id=a.project_id AND m.env_id=a.env_id
          AND m.wallet_id=a.wallet_id AND m.wallet_authority_id=a.authority_id
        WHERE a.namespace=?1 AND a.org_id=?2 AND a.project_id=?3 AND a.env_id=?4 AND a.wallet_id=?5
          AND a.authority_id=?6 AND a.authority_digest_b64u=?7 AND a.revocation_epoch=?8 AND a.lifecycle_state='active'
          AND m.wallet_auth_method_id=?9 AND m.status='active')
      AND EXISTS (SELECT 1 FROM router_ab_yao_versioned_json_records
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND record_key=?10 AND version=?11
          AND json_extract(record_json,'$.phase.kind')='published')
      AND EXISTS (SELECT 1 FROM wallet_execution_generations
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND wallet_id=?5 AND generation=?12 AND state='active')
      AND NOT EXISTS (SELECT 1 FROM wallet_relocation_authorization_fences
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND wallet_id=?5)
      AND NOT EXISTS (SELECT 1 FROM wallet_relocation_write_blocks
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND wallet_id=?5
          AND state IN (${allowDraining ? "'checked','frozen'" : "'draining','checked','frozen'"}))
      AND ?13 > CAST(round(unixepoch('subsec')*1000) AS INTEGER)`,
      bindings: [
        identity.walletId,
        record.owner.authorityId,
        record.owner.authorityDigestB64u,
        record.owner.revocationEpoch,
        record.target.authority.walletAuthMethodId,
        `ml-dsa-registration:${JSON.stringify([identity.walletId, record.target.key.mlDsaSigningKeyId])}`,
        record.publicationVersion,
        identity.ownershipGeneration,
        record.preparation.expiresAtMs,
      ],
    };
  }
  private guard(record: MlDsaSigningRecord, allowDraining: boolean): D1PreparedStatementLike {
    const condition = this.ownerCondition(record, allowDraining);
    return prepareD1TenantStatement(
      this.options.database,
      this.options.scope,
      `INSERT INTO router_ab_yao_versioned_json_cas_guard (guard_id) SELECT 1 WHERE NOT (${condition.sql})`,
      condition.bindings,
    );
  }
  private async current(record: MlDsaSigningRecord): Promise<boolean> {
    const condition = this.ownerCondition(record, record.phase.kind === 'approved');
    const row = await prepareD1TenantStatement(
      this.options.database,
      this.options.scope,
      `SELECT (${condition.sql}) AS allowed`,
      condition.bindings,
    ).first<{ allowed: number }>();
    return row?.allowed === 1;
  }
}

async function operationEnvelope(
  target: MlDsaSigningTarget,
  preparation: Pick<MlDsaSigningRecord['preparation'], 'request' | 'transaction'>,
) {
  return buildCapabilityOperationEnvelope({
    tenantId: requireParsed(parseTenantId(target.tenantId), 'tenantId'),
    principalId: requireParsed(parsePrincipalId(target.identity.walletId), 'principalId'),
    capabilityId: requireParsed(parseCapabilityId(target.capabilityId), 'capabilityId'),
    operationId: requireParsed(
      parseCapabilityOperationId(`ml-dsa:${preparation.request.operationIdB64u}`),
      'operationId',
    ),
    operation: buildNearMlDsa65MpcOperationRef('near.sign_transaction'),
    digests: await mlDsaOwnerOperationDigests(
      target,
      MlDsaTransactionIntent.parse({
        transactionHash: preparation.transaction.transactionHashB64u,
      }),
      await sha256Utf8DigestB64u(preparation.transaction.displayJson),
    ),
  });
}
function parseSigningOutcome(raw: unknown): MlDsaSigningOutcome {
  const r = requireRecord(raw, 'stored ML-DSA signing outcome');
  if (r.kind === 'signed')
    return { kind: 'signed', transaction: parseMlDsaSignedTransaction(r.transaction) };
  if (r.kind === 'refused' && (r.code === 'protocol_failed' || r.code === 'invalid_signature'))
    return refusal(r.code, typeof r.message === 'string' ? r.message : 'ML-DSA signing failed');
  throw new Error('Invalid stored ML-DSA outcome');
}
