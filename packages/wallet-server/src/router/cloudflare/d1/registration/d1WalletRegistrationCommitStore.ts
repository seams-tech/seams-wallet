import {
  reservePasskeyCredential,
  type PasskeyCredentialClaims,
} from '../../../../core/passkeyCredentialClaims';
import type {
  ActiveWalletAuthorityV1,
  WalletEcdsaSignerActivationV1,
} from '@shared/authorization/walletAuthority';
import {
  parseWalletAuthMethodRecordV2,
  sameWalletAuthMethodRecordV2,
  type ActiveWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import { type RegistrationAuthority } from '@shared/utils/registrationAuthMethodInput';
import { mpcMaterialActivationRefsEqual, parseWalletId } from '@shared/utils/domainIds';
import { parseWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { buildWalletSessionCapabilitySubjectsV1 } from '../../../../authorization/domain';
import {
  prepareD1WalletAuthMethodV2PutStatement,
  type D1WalletAuthMethodStoreScope,
} from '../../../../core/d1WalletAuthMethodStore';
import {
  prepareD1WalletPutSignerStatement,
  prepareD1WalletPutSubjectStatement,
  type D1WalletStoreScope,
} from '../../../../core/d1WalletStore';
import type { WalletRecord, WalletSignerRecord } from '../../../../core/WalletStore';
import { lifecycleWriteFenceStatements } from '../ed25519Yao/d1Ed25519YaoStateWriteFence';
import { validateRouterAbEd25519YaoRegistrationCapability } from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoCapabilityCommit';
import {
  prepareD1WebAuthnCredentialBindingPutStatement,
  type WebAuthnCredentialBindingRecord,
} from '../../../../core/WebAuthnCredentialBindingStore';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '../../../../storage/tenantRoute';
import {
  parseD1JsonColumn,
} from '../../../../storage/d1Sql';
import {
  prepareD1WalletAuthorityExtensionCasGuard,
  prepareD1WalletAuthorityExtensionStatement,
  prepareD1WalletAuthorityPutStatement,
} from '../wallet/d1WalletAuthorityStore';
import { prepareD1WalletSessionAuthorityProjectionStatements } from '../authorization/walletSessionAuthorityProjection';
import {
  prepareD1WebAuthnAuthenticatorPutStatement,
  type D1WebAuthnStoreScope,
} from '../webauthn/d1WebAuthnStore';
import type { D1EmailOtpRegistrationCommitPlan } from '../emailOtp/d1EmailOtpRegistrationEnrollmentFinalizer';

export type D1RegistrationCommitBatch = (
  statements: readonly D1PreparedStatementLike[],
) => Promise<readonly D1ResultLike[]>;

type ReservedWalletRegistrationCommit = (
  input: D1WalletRegistrationCommitInput,
  executeBatch?: D1RegistrationCommitBatch,
) => Promise<void>;

type D1WalletRegistrationCommitBase = {
  readonly wallet: WalletRecord;
  readonly walletSigners: readonly WalletSignerRecord[];
  readonly now: number;
  /**
   * The Ed25519 Yao lifecycle decision this commit makes visible, when it
   * finalizes one: it commits in this batch or nothing does.
   */
  readonly decisionStatements: readonly D1PreparedStatementLike[];
};

type D1WalletRegistrationFoundingFields =
  | {
      readonly foundingAuthority?: never;
      readonly foundingAuthMethod?: never;
    }
  | {
      readonly foundingAuthority: ActiveWalletAuthorityV1;
      readonly foundingAuthMethod: ActiveWalletAuthMethodRecordV2;
    };

type D1WalletRegistrationCommitInput =
  | (D1WalletRegistrationCommitBase & D1WalletRegistrationFoundingFields & {
      readonly kind: 'passkey_wallet_registration_commit_v1';
      readonly emailOtp?: never;
    })
  | (D1WalletRegistrationCommitBase & D1WalletRegistrationFoundingFields & {
      readonly kind: 'email_otp_wallet_registration_commit_v1';
      readonly emailOtp: D1EmailOtpRegistrationCommitPlan;
    });

/** A passkey claim that shared authority granted for one ceremony before its finalization. */
export type HeldRegistrationPasskeyClaim = {
  readonly walletId: string;
  readonly rpId: string;
  readonly credentialIdB64u: string;
};

export interface D1WalletRegistrationCommitStore {
  /**
   * Claims the authority's passkey through shared authority, unless `held`
   * records that the same claim was already granted for this ceremony.
   */
  reserveAuthority(
    authority: RegistrationAuthority,
    held?: HeldRegistrationPasskeyClaim | null,
  ): Promise<ReservedWalletRegistrationCommit>;
  /**
   * Claims a verified passkey before finalization and records a granted
   * claim. A refusal records nothing, so finalization claims again and
   * reports it.
   */
  claimPasskeyAhead(input: {
    readonly registrationCeremonyId: string;
    readonly authority: RegistrationAuthority;
    readonly nowMs: number;
  }): Promise<void>;
  prepareHeldPasskeyClaimRead(registrationCeremonyId: string): D1PreparedStatementLike;
  parseHeldPasskeyClaimRead(
    result: D1ResultLike<Record<string, unknown>>,
  ): HeldRegistrationPasskeyClaim | null;
  /** Removes the record of a finalized ceremony. Shared authority keeps the claim. */
  deleteHeldPasskeyClaim(registrationCeremonyId: string): Promise<void>;
}

type D1WalletRegistrationCommitScope = D1WalletStoreScope &
  D1WalletAuthMethodStoreScope &
  D1WebAuthnStoreScope;

function requireScopeString(value: string, field: string): string {
  const normalized = toOptionalTrimmedString(value);
  if (!normalized) throw new Error(`${field} is required for D1 wallet registration commit`);
  return normalized;
}

function normalizeScope(input: D1WalletRegistrationCommitScope): D1WalletRegistrationCommitScope {
  return {
    namespace: requireScopeString(input.namespace, 'namespace'),
    orgId: requireScopeString(input.orgId, 'orgId'),
    projectId: requireScopeString(input.projectId, 'projectId'),
    envId: requireScopeString(input.envId, 'envId'),
  };
}

function assertCommitWalletIdentity(
  input: D1WalletRegistrationCommitInput,
  authority: RegistrationAuthority,
): void {
  const expectedKind =
    authority.kind === 'passkey'
      ? 'passkey_wallet_registration_commit_v1'
      : 'email_otp_wallet_registration_commit_v1';
  if (input.kind !== expectedKind) {
    throw new Error('Registration commit does not match its reserved authority');
  }
  if (authority.walletId !== input.wallet.walletId) {
    throw new Error('Registration authority walletId does not match wallet record');
  }
  if (input.foundingAuthority) {
    if (!input.foundingAuthMethod) {
      throw new Error('Founding wallet authority is missing its auth method');
    }
    if (
      input.foundingAuthority.walletId !== input.wallet.walletId ||
      input.foundingAuthMethod.walletId !== input.wallet.walletId ||
      input.foundingAuthMethod.walletAuthorityId !== input.foundingAuthority.authorityId
    ) {
      throw new Error('Founding authority identities do not match wallet registration');
    }
    if (input.foundingAuthority.state !== 'active' || input.foundingAuthMethod.status !== 'active') {
      throw new Error('Founding wallet authority and auth method must be active');
    }
  } else if (input.foundingAuthMethod) {
    throw new Error('Founding wallet auth method is missing its authority');
  }
  /* No signer-count floor. An Ed25519-only wallet is committed pending, with
     its sole signer arriving later from deferred Yao — the wallet legitimately
     exists before any signer does. What must hold is that every signer
     present belongs to this wallet, which the loop below enforces. */
  for (const signer of input.walletSigners) {
    if (signer.walletId !== input.wallet.walletId) {
      throw new Error('Wallet signer walletId does not match wallet record');
    }
  }
}

function prepareAuthorityStatements(input: {
  readonly database: D1DatabaseLike;
  readonly scope: D1WalletRegistrationCommitScope;
  readonly authority: RegistrationAuthority;
  readonly walletSigners: readonly WalletSignerRecord[];
  readonly foundingAuthority: ActiveWalletAuthorityV1 | undefined;
  readonly foundingAuthMethod: ActiveWalletAuthMethodRecordV2 | undefined;
  readonly foundingStatements: readonly D1PreparedStatementLike[];
  readonly now: number;
}): readonly D1PreparedStatementLike[] {
  const foundingStatements = input.foundingStatements;
  switch (input.authority.kind) {
    case 'passkey': {
      const ed25519Signers = input.walletSigners.filter(
        (signer) => signer.version === 'wallet_signer_ed25519_v1',
      );
      if (ed25519Signers.length > 1) {
        throw new Error('Wallet registration commit received multiple Ed25519 signers');
      }
      const statements: D1PreparedStatementLike[] = [
        prepareD1WebAuthnAuthenticatorPutStatement({
          database: input.database,
          scope: input.scope,
          userId: input.authority.walletId,
          record: {
            credentialIdB64u: input.authority.credentialIdB64u,
            credentialPublicKeyB64u: input.authority.credentialPublicKeyB64u,
            counter: input.authority.counter,
            createdAtMs: input.now,
            updatedAtMs: input.now,
            deviceInfo: input.authority.device,
          },
        }),
      ];
      // The credential binding is what login resolves a passkey against, so it
      // must be written even when no Ed25519 signer exists yet — otherwise a
      // wallet whose Yao ceremony has not settled fails the next login with
      // `unknown_credential`. The Ed25519 facts are filled in when that signer
      // is committed.
      const ed25519Signer = ed25519Signers[0];
      const credentialBindingBase = {
        version: 'webauthn_credential_binding_v1',
        rpId: input.authority.rpId,
        credentialIdB64u: input.authority.credentialIdB64u,
        userId: input.authority.walletId,
        createdAtMs: input.now,
        updatedAtMs: input.now,
      } as const;
      // The Ed25519 facts are a union branch, not four independent optionals:
      // spreading them all selects the present branch, omitting them selects
      // the absent one. A partial set cannot be constructed.
      const credentialBinding: WebAuthnCredentialBindingRecord = ed25519Signer
        ? {
            ...credentialBindingBase,
            nearAccountId: ed25519Signer.nearAccountId,
            nearEd25519SigningKeyId: ed25519Signer.nearEd25519SigningKeyId,
            signerSlot: ed25519Signer.signerSlot,
            publicKey: ed25519Signer.publicKey,
            relayerKeyId: ed25519Signer.signingWorkerId,
            keyVersion: ed25519Signer.keyVersion,
            recoveryExportCapable: ed25519Signer.recoveryExportCapable,
            participantIds: [...ed25519Signer.participantIds],
            runtimePolicyScope: ed25519Signer.runtimePolicyScope,
          }
        : credentialBindingBase;
      statements.push(
        prepareD1WebAuthnCredentialBindingPutStatement({
          database: input.database,
          scope: input.scope,
          record: credentialBinding,
        }),
      );
      statements.push(...foundingStatements);
      return statements;
    }
    case 'email_otp':
      return foundingStatements;
  }
}

function requireFoundingAuthMethod(
  value: ActiveWalletAuthMethodRecordV2 | undefined,
): ActiveWalletAuthMethodRecordV2 {
  if (!value) throw new Error('Founding wallet authority is missing its auth method');
  return value;
}

function sameWalletAuthorityPermissionsV1(
  left: ActiveWalletAuthorityV1['permissions'],
  right: ActiveWalletAuthorityV1['permissions'],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameWalletAuthorityProvenanceV1(
  left: ActiveWalletAuthorityV1['provenance'],
  right: ActiveWalletAuthorityV1['provenance'],
): boolean {
  switch (left.kind) {
    case 'wallet_registration':
      return right.kind === 'wallet_registration';
    case 'device_link':
      return (
        right.kind === 'device_link' &&
        left.enrollmentId === right.enrollmentId &&
        left.sourceAuthorityId === right.sourceAuthorityId &&
        left.linkSessionId === right.linkSessionId
      );
    case 'wallet_recovery':
      return (
        right.kind === 'wallet_recovery' &&
        left.recoveryOperationId === right.recoveryOperationId &&
        left.continuityAuthorityId === right.continuityAuthorityId
      );
    default:
      return assertNeverWalletAuthorityProvenanceV1(left);
  }
}

function assertNeverWalletAuthorityProvenanceV1(value: never): never {
  throw new Error(`unsupported wallet authority provenance: ${String(value)}`);
}

function foundingAuthorityIdentityMatches(
  left: ActiveWalletAuthorityV1,
  right: ActiveWalletAuthorityV1,
): boolean {
  return (
    left.kind === right.kind &&
    left.authorityId === right.authorityId &&
    left.walletId === right.walletId &&
    left.principal.kind === right.principal.kind &&
    left.principal.deviceId === right.principal.deviceId &&
    sameWalletAuthorityProvenanceV1(left.provenance, right.provenance) &&
    sameWalletAuthorityPermissionsV1(left.permissions, right.permissions) &&
    left.revocationEpoch === right.revocationEpoch &&
    left.createdAtMs === right.createdAtMs &&
    left.state === right.state &&
    left.activatedAtMs === right.activatedAtMs
  );
}

function sameWalletEcdsaSignerActivationV1(
  left: WalletEcdsaSignerActivationV1,
  right: WalletEcdsaSignerActivationV1,
): boolean {
  return (
    left.kind === right.kind &&
    left.signer.kind === right.signer.kind &&
    left.signer.keyFamily === right.signer.keyFamily &&
    left.signer.walletId === right.signer.walletId &&
    left.signer.walletKeyId === right.signer.walletKeyId &&
    left.signer.thresholdPublicKey33B64u === right.signer.thresholdPublicKey33B64u &&
    left.signer.evmAddress === right.signer.evmAddress &&
    mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation)
  );
}

function sameActiveWalletAuthorityV1(
  left: ActiveWalletAuthorityV1,
  right: ActiveWalletAuthorityV1,
): boolean {
  return (
    foundingAuthorityIdentityMatches(left, right) &&
    left.signerActivationSetDigestB64u === right.signerActivationSetDigestB64u &&
    left.authorityDigestB64u === right.authorityDigestB64u &&
    left.updatedAtMs === right.updatedAtMs
  );
}

function canExtendFoundingAuthorityWithEd25519(
  existing: ActiveWalletAuthorityV1,
  next: ActiveWalletAuthorityV1,
): boolean {
  const existingEcdsa = existing.signerActivations.ecdsa;
  const nextEcdsa = next.signerActivations.ecdsa;
  return (
    existing.signerActivations.keyFamilies.length === 1 &&
    existing.signerActivations.keyFamilies[0] === 'ecdsa_secp256k1' &&
    next.signerActivations.keyFamilies.length === 2 &&
    next.signerActivations.keyFamilies[0] === 'ed25519' &&
    next.signerActivations.keyFamilies[1] === 'ecdsa_secp256k1' &&
    existingEcdsa !== undefined &&
    nextEcdsa !== undefined &&
    sameWalletEcdsaSignerActivationV1(existingEcdsa, nextEcdsa) &&
    foundingAuthorityIdentityMatches(existing, next) &&
    next.updatedAtMs >= existing.updatedAtMs
  );
}

type D1RegistrationRecordJsonRow = {
  readonly record_json?: unknown;
};

async function prepareFoundingStatements(input: {
  readonly database: D1DatabaseLike;
  readonly scope: D1WalletRegistrationCommitScope;
  readonly foundingAuthority: ActiveWalletAuthorityV1 | undefined;
  readonly foundingAuthMethod: ActiveWalletAuthMethodRecordV2 | undefined;
  readonly now: number;
}): Promise<readonly D1PreparedStatementLike[]> {
  if (!input.foundingAuthority) return [];
  const foundingAuthMethod = requireFoundingAuthMethod(input.foundingAuthMethod);
  const authorityRead = input.database
    .prepare(
      `SELECT record_json
         FROM wallet_authorities
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND authority_id = ?
        LIMIT 1`,
    )
    .bind(
      input.scope.namespace,
      input.scope.orgId,
      input.scope.projectId,
      input.scope.envId,
      String(input.foundingAuthority.authorityId),
    );
  const authMethodRead = input.database
    .prepare(
      `SELECT record_json
         FROM wallet_auth_methods
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND wallet_auth_method_id = ?
        LIMIT 1`,
    )
    .bind(
      input.scope.namespace,
      input.scope.orgId,
      input.scope.projectId,
      input.scope.envId,
      String(foundingAuthMethod.walletAuthMethodId),
    );
  const results = await input.database.batch<D1ResultLike<D1RegistrationRecordJsonRow>>([
    authorityRead,
    authMethodRead,
  ]);
  assertBatchSucceeded({ expectedStatementCount: 2, results });
  const authorityRow = results[0]?.results?.[0] ?? null;
  const authMethodRow = results[1]?.results?.[0] ?? null;
  let persistedAuthority: ActiveWalletAuthorityV1 | null = null;
  if (authorityRow) {
    const parsedAuthority = parseWalletAuthorityV1(
      parseD1JsonColumn(authorityRow.record_json),
    );
    if (!parsedAuthority.ok || parsedAuthority.value.state !== 'active') {
      throw new Error('Founding wallet authority replay conflicts with the persisted record');
    }
    persistedAuthority = parsedAuthority.value;
  }
  const foundingAuthorityNeedsExtension =
    persistedAuthority !== null &&
    !sameActiveWalletAuthorityV1(persistedAuthority, input.foundingAuthority);
  if (
    foundingAuthorityNeedsExtension &&
    (!persistedAuthority ||
      persistedAuthority.state !== 'active' ||
      !canExtendFoundingAuthorityWithEd25519(persistedAuthority, input.foundingAuthority))
  ) {
    throw new Error('Founding wallet authority replay conflicts with the persisted record');
  }
  if (authMethodRow) {
    const parsedAuthMethod = parseWalletAuthMethodRecordV2(
      parseD1JsonColumn(authMethodRow.record_json),
    );
    if (
      !parsedAuthMethod ||
      parsedAuthMethod.status !== 'active' ||
      !sameWalletAuthMethodRecordV2(parsedAuthMethod, foundingAuthMethod)
    ) {
      throw new Error('Founding wallet auth method replay conflicts with the persisted record');
    }
  }
  const statements: D1PreparedStatementLike[] = [];
  if (!authorityRow) {
    statements.push(
      prepareD1WalletAuthorityPutStatement({
        database: input.database,
        scope: input.scope,
        authority: input.foundingAuthority,
      }),
    );
  } else if (persistedAuthority && foundingAuthorityNeedsExtension) {
    statements.push(
      prepareD1WalletAuthorityExtensionStatement({
        database: input.database,
        scope: input.scope,
        expected: persistedAuthority,
        next: input.foundingAuthority,
      }),
      prepareD1WalletAuthorityExtensionCasGuard(input.database),
      ...prepareD1WalletSessionAuthorityProjectionStatements({
        database: input.database,
        scope: input.scope,
        projection: {
          walletId: input.foundingAuthority.walletId,
          authorityId: input.foundingAuthority.authorityId,
          authorityDigestB64u: input.foundingAuthority.authorityDigestB64u,
          authorityRevocationEpoch: input.foundingAuthority.revocationEpoch,
          capabilitySubjects: buildWalletSessionCapabilitySubjectsV1(input.foundingAuthority),
          promotionAtMs: input.now,
        },
      }),
    );
  }
  if (!authMethodRow) {
    statements.push(
      prepareD1WalletAuthMethodV2PutStatement({
        database: input.database,
        scope: input.scope,
        record: foundingAuthMethod,
      }),
    );
  }
  return statements;
}

function assertBatchSucceeded(input: {
  readonly expectedStatementCount: number;
  readonly results: readonly D1ResultLike[];
}): void {
  if (input.results.length !== input.expectedStatementCount) {
    throw new Error('D1 wallet registration commit returned an incomplete batch result');
  }
  for (const result of input.results) {
    if (!result.success) throw new Error('D1 wallet registration commit batch failed');
  }
}

function emailOtpCommitStatements(
  input: D1WalletRegistrationCommitInput,
): readonly D1PreparedStatementLike[] {
  switch (input.kind) {
    case 'passkey_wallet_registration_commit_v1':
      return [];
    case 'email_otp_wallet_registration_commit_v1':
      return input.emailOtp.statements;
  }
}

function heldClaimCovers(
  held: HeldRegistrationPasskeyClaim | null,
  authority: Extract<RegistrationAuthority, { kind: 'passkey' }>,
): boolean {
  return (
    held !== null &&
    held.walletId === authority.walletId &&
    held.rpId === authority.rpId &&
    held.credentialIdB64u === authority.credentialIdB64u
  );
}

export class CloudflareD1WalletRegistrationCommitStore
  implements D1WalletRegistrationCommitStore
{
  private readonly database: D1DatabaseLike;
  private readonly scope: D1WalletRegistrationCommitScope;
  private readonly credentialClaims: PasskeyCredentialClaims | undefined;

  constructor(input: {
    readonly credentialClaims?: PasskeyCredentialClaims;
    readonly database: D1DatabaseLike;
    readonly namespace: string;
    readonly orgId: string;
    readonly projectId: string;
    readonly envId: string;
  }) {
    this.credentialClaims = input.credentialClaims;
    this.database = input.database;
    this.scope = normalizeScope(input);
  }

  async reserveAuthority(
    authority: RegistrationAuthority,
    held: HeldRegistrationPasskeyClaim | null = null,
  ): Promise<ReservedWalletRegistrationCommit> {
    // Shared authority never reassigns a claim, so a recorded grant for this
    // exact wallet and credential still holds.
    if (authority.kind === 'passkey' && !heldClaimCovers(held, authority)) {
      await reservePasskeyCredential(this.credentialClaims, {
        walletId: authority.walletId,
        rpId: authority.rpId,
        credentialIdB64u: authority.credentialIdB64u,
      });
    }
    return this.commit.bind(this, authority);
  }

  async claimPasskeyAhead(input: {
    readonly registrationCeremonyId: string;
    readonly authority: RegistrationAuthority;
    readonly nowMs: number;
  }): Promise<void> {
    const { authority } = input;
    if (authority.kind !== 'passkey' || !this.credentialClaims) return;
    const granted = await this.credentialClaims.claim({
      walletId: authority.walletId,
      rpId: authority.rpId,
      credentialIdB64u: authority.credentialIdB64u,
    });
    if (!granted) return;
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO registration_passkey_claims (
           namespace, org_id, project_id, env_id, registration_ceremony_id,
           wallet_id, rp_id, credential_id_b64u, claimed_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        this.scope.namespace,
        this.scope.orgId,
        this.scope.projectId,
        this.scope.envId,
        input.registrationCeremonyId,
        authority.walletId,
        authority.rpId,
        authority.credentialIdB64u,
        input.nowMs,
      )
      .run();
  }

  prepareHeldPasskeyClaimRead(registrationCeremonyId: string): D1PreparedStatementLike {
    return this.database
      .prepare(
        `SELECT wallet_id, rp_id, credential_id_b64u
           FROM registration_passkey_claims
          WHERE namespace = ?1
            AND org_id = ?2
            AND project_id = ?3
            AND env_id = ?4
            AND registration_ceremony_id = ?5`,
      )
      .bind(
        this.scope.namespace,
        this.scope.orgId,
        this.scope.projectId,
        this.scope.envId,
        registrationCeremonyId,
      );
  }

  parseHeldPasskeyClaimRead(
    result: D1ResultLike<Record<string, unknown>>,
  ): HeldRegistrationPasskeyClaim | null {
    if (!result.success) throw new Error('Registration passkey claim read failed');
    const row = result.results?.[0];
    if (!row) return null;
    if (
      typeof row.wallet_id !== 'string' ||
      typeof row.rp_id !== 'string' ||
      typeof row.credential_id_b64u !== 'string'
    ) {
      throw new Error('Stored registration passkey claim is invalid');
    }
    return {
      walletId: row.wallet_id,
      rpId: row.rp_id,
      credentialIdB64u: row.credential_id_b64u,
    };
  }

  async deleteHeldPasskeyClaim(registrationCeremonyId: string): Promise<void> {
    await this.database
      .prepare(
        `DELETE FROM registration_passkey_claims
          WHERE namespace = ?1
            AND org_id = ?2
            AND project_id = ?3
            AND env_id = ?4
            AND registration_ceremony_id = ?5`,
      )
      .bind(
        this.scope.namespace,
        this.scope.orgId,
        this.scope.projectId,
        this.scope.envId,
        registrationCeremonyId,
      )
      .run();
  }

  private async commit(
    authority: RegistrationAuthority,
    input: D1WalletRegistrationCommitInput,
    executeBatch?: D1RegistrationCommitBatch,
  ): Promise<void> {
    assertCommitWalletIdentity(input, authority);
    const fenced: D1PreparedStatementLike[] = [];
    const ed25519Signer = input.walletSigners.find(isEd25519Signer);
    if (ed25519Signer) {
      const capability = ed25519Signer.activeYaoCapability;
      if (capability.version !== 'wallet_ed25519_yao_registration_capability_v1') {
        throw new Error('A registration commit requires its registration capability');
      }
      const validated = validateRouterAbEd25519YaoRegistrationCapability({
        kind: 'router_ab_ed25519_yao_registration_finalize_capability_v1',
        activeCapabilityBinding: capability.activeCapabilityBinding,
        nearAccountId: capability.nearAccountId,
        registrationAdmissionRequest: capability.admissionRequest,
        registrationAdmissionReceipt: capability.admissionReceipt,
        registrationResult: capability.activationResult,
        runtimePolicyScope: capability.runtimePolicyScope,
      });
      if (!validated.ok) throw new Error(validated.message);
      /* The signer row holds the capability, so the commit writes no recovery
         state. It still obeys the fence of the capability's wallet: a
         cancelled registration and a relocating wallet refuse the write. */
      const capabilityWallet = parseWalletId(
        capability.admissionRequest.application_binding.wallet_id,
      );
      if (!capabilityWallet.ok) throw new Error('Lifecycle wallet owner is invalid');
      fenced.push(
        ...lifecycleWriteFenceStatements(
          { database: this.database, scope: this.scope },
          new Set([capabilityWallet.value, input.wallet.walletId]),
        ),
      );
    }
    const prepared = await prepareWalletWrite(this.database, this.scope, authority, input);
    const statements = [...fenced, ...prepared.statements];
    const results = executeBatch
      ? await executeBatch(statements)
      : await this.database.batch<D1ResultLike>(statements);
    assertBatchSucceeded({
      expectedStatementCount: statements.length,
      results,
    });
  }
}

async function prepareWalletWrite(
  database: D1DatabaseLike,
  scope: D1WalletRegistrationCommitScope,
  authority: RegistrationAuthority,
  input: D1WalletRegistrationCommitInput,
) {
  const foundingStatements = await prepareFoundingStatements({
    database,
    scope,
    foundingAuthority: input.foundingAuthority,
    foundingAuthMethod: input.foundingAuthMethod,
    now: input.now,
  });
  const statements: D1PreparedStatementLike[] = [
    prepareD1WalletPutSubjectStatement({ database, scope, record: input.wallet }),
  ];
  for (const signer of input.walletSigners) {
    statements.push(prepareD1WalletPutSignerStatement({ database, scope, record: signer }));
  }
  statements.push(
    ...prepareAuthorityStatements({
      database,
      scope,
      authority,
      walletSigners: input.walletSigners,
      foundingAuthority: input.foundingAuthority,
      foundingAuthMethod: input.foundingAuthMethod,
      foundingStatements,
      now: input.now,
    }),
    ...emailOtpCommitStatements(input),
    ...input.decisionStatements,
  );
  return { statements };
}

function isEd25519Signer(signer: WalletSignerRecord) {
  return signer.version === 'wallet_signer_ed25519_v1';
}
