import { D1WalletAuthorityStore } from './d1WalletAuthorityStore';
import { extendWalletAuthorityWithMlDsa65SignerV1 } from '@shared/authorization/walletAuthority';
import { parseExactAdministeredMlDsa65SignerV1 } from '@shared/device-linking/delegatedActivationPlan';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { expireUnusedMlDsaAdmissions } from './d1MlDsaRegistrationExpiry';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import type { ActivePasskeyWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type {
  MlDsaCustodyCommit,
  MlDsaSignerPurpose,
  MlDsaRegistrationFailure,
  MlDsaRegistrationFailureCode,
} from '@shared/passkey-custody/mlDsaCustody';
import { mlDsaSigningKeyIdForSlot } from '@shared/passkey-custody/mlDsaCustody';
import {
  parseMlDsaEncryptedInputs,
  type MlDsaEncryptedInputs,
} from '@shared/passkey-custody/mlDsaCustody';
import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import type { MlDsaSignerInventoryEntry } from '@shared/near/mlDsaInventory';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { alphabetizeStringify } from '@shared/utils/digests';
import { sha256Utf8DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import {
  buildMlDsa65WalletKeyRecord,
  parseMlDsaSigningKeyId,
  parseWalletKeyVersion,
} from '@shared/signing-lanes/recordParsers';
import { parseWalletKeyId, type WalletId } from '@shared/utils/domainIds';
import { parseMlDsaMaterialEpoch, requireParsed } from '@shared/passkey-custody/primitives';
import type { RouterAbNormalSigningRouterProxy } from '../../../framework/routerApi';
import {
  walletObjectIdentity,
  type WalletObjectIdentity,
} from '../../runtime/walletObjectAddresses';
import {
  parseMlDsaAddSignerPreparation,
  buildMlDsaAddSignerPreparation,
  type MlDsaAddSignerPreparation,
} from '../../../domains/walletRegistration/mlDsaAddSigner';
import {
  discoverMlDsaRecipientKeys,
  executeMlDsaRegistration,
  parseMlDsaInstalledRegistration,
  type MlDsaInstalledRegistration,
} from '../../../transport/fetch/routes/mlDsaRegistration';
import {
  CloudflareD1VersionedJsonRecordStore,
  type CloudflareD1VersionedJsonRecordScopeV1,
} from '../versionedJson/d1VersionedJsonRecordStore';
import { lifecycleWriteFenceStatements } from '../ed25519Yao/d1Ed25519YaoStateWriteFence';
import { D1WalletCeremonyActivity } from '../ed25519Yao/d1WalletCeremonyActivity';
import {
  PASSKEY_ENVELOPE_KEY_PREFIX,
  passkeyCustodyEnvelopeLocatorOf,
  passkeyCustodyEnvelopeRecordKey,
} from '../passkeyCustody/d1PasskeyCustodyEnvelopeStore';

type RegistrationPhase = ReadonlyExclusiveUnion<
  | { readonly kind: 'admitted' }
  | { readonly kind: 'expired_admission' }
  | { readonly kind: 'executing'; readonly inputs: MlDsaEncryptedInputs }
  | {
      readonly kind: 'installed';
      readonly inputs: MlDsaEncryptedInputs;
      readonly result: MlDsaInstalledRegistration;
    }
  | {
      readonly kind: 'published';
      readonly inputs: MlDsaEncryptedInputs;
      readonly result: MlDsaInstalledRegistration;
      readonly publishedAtMs: number;
    }
>;
type RegistrationRecord = {
  readonly ceremonyId: string;
  readonly expiresAtMs: number;
  readonly preparation: MlDsaAddSignerPreparation;
  readonly phase: RegistrationPhase;
};
type Failure = MlDsaRegistrationFailure;
type PreparationResult =
  | { readonly ok: true; readonly preparation: MlDsaAddSignerPreparation }
  | Failure;

function failure(code: MlDsaRegistrationFailureCode, message: string): Failure {
  return { ok: false, code, message };
}
function positiveTime(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0)
    throw new Error('Invalid ML-DSA timestamp');
  return raw;
}
function parseRegistration(raw: unknown): RegistrationRecord | null {
  try {
    const record = exactRecord(
      raw,
      ['ceremonyId', 'expiresAtMs', 'preparation', 'phase'],
      'ML-DSA registration',
    );
    const phase = exactRecord(record.phase, phaseFields(record.phase), 'ML-DSA registration phase');
    let parsedPhase: RegistrationPhase;
    switch (phase.kind) {
      case 'expired_admission':
        parsedPhase = { kind: 'expired_admission' };
        break;
      case 'admitted':
        parsedPhase = { kind: 'admitted' };
        break;
      case 'executing':
        parsedPhase = { kind: 'executing', inputs: parseMlDsaEncryptedInputs(phase.inputs) };
        break;
      case 'installed':
        parsedPhase = {
          kind: 'installed',
          inputs: parseMlDsaEncryptedInputs(phase.inputs),
          result: parseMlDsaInstalledRegistration(phase.result),
        };
        break;
      case 'published':
        parsedPhase = {
          kind: 'published',
          inputs: parseMlDsaEncryptedInputs(phase.inputs),
          result: parseMlDsaInstalledRegistration(phase.result),
          publishedAtMs: positiveTime(phase.publishedAtMs),
        };
        break;
      default:
        throw new Error('Unknown ML-DSA registration phase');
    }
    return {
      ceremonyId: requireCanonicalString(record.ceremonyId, 'ML-DSA ceremony'),
      expiresAtMs: positiveTime(record.expiresAtMs),
      preparation: parseMlDsaAddSignerPreparation(record.preparation),
      phase: parsedPhase,
    };
  } catch {
    return null;
  }
}
function phaseFields(raw: unknown): readonly string[] {
  const phase = requireRecord(raw, 'ML-DSA phase');
  switch (phase.kind) {
    case 'admitted':
    case 'expired_admission':
      return ['kind'];
    case 'executing':
      return ['kind', 'inputs'];
    case 'installed':
      return ['kind', 'inputs', 'result'];
    case 'published':
      return ['kind', 'inputs', 'result', 'publishedAtMs'];
    default:
      throw new Error('Unknown ML-DSA phase');
  }
}
function encodePhase(phase: RegistrationPhase): VersionedJsonObject {
  switch (phase.kind) {
    case 'admitted':
    case 'expired_admission':
      return { kind: phase.kind };
    case 'executing':
      return { kind: 'executing', inputs: phase.inputs };
    case 'installed':
      return { kind: 'installed', inputs: phase.inputs, result: phase.result };
    case 'published':
      return {
        kind: 'published',
        inputs: phase.inputs,
        result: phase.result,
        publishedAtMs: phase.publishedAtMs,
      };
  }
}
function encodeRegistration(record: RegistrationRecord): VersionedJsonObject {
  const preparation = record.preparation;
  const protocol = preparation.protocolInputs;
  return {
    ceremonyId: record.ceremonyId,
    expiresAtMs: record.expiresAtMs,
    preparation: {
      purpose:
        preparation.purpose.kind === 'create'
          ? { kind: 'create' }
          : {
              kind: 'restore',
              publicKeyB64u: preparation.purpose.publicKeyB64u,
              keyManifestDigestB64u: preparation.purpose.keyManifestDigestB64u,
              materialEpoch: preparation.purpose.materialEpoch,
            },
      identity: preparation.identity,
      owner: preparation.owner,
      recipientKeyVersions: preparation.recipientKeyVersions,
      custodyEnvelope: preparation.custodyEnvelope,
      protocolInputs: {
        walletId: protocol.walletId,
        signingKeyId: protocol.signingKeyId,
        operationIdB64u: protocol.operationIdB64u,
        materialEpoch: protocol.materialEpoch,
        roleAPublicKeyB64u: protocol.roleAPublicKeyB64u,
        roleBPublicKeyB64u: protocol.roleBPublicKeyB64u,
        continuity:
          protocol.continuity.kind === 'create'
            ? { kind: 'create' }
            : {
                kind: 'recover',
                recordedKeyManifestDigestB64u: protocol.continuity.recordedKeyManifestDigestB64u,
              },
      },
    },
    phase: encodePhase(record.phase),
  };
}
function recordKey(preparation: MlDsaAddSignerPreparation): string {
  return JSON.stringify([preparation.identity.walletId, preparation.protocolInputs.signingKeyId]);
}
function withPhase(record: RegistrationRecord, phase: RegistrationPhase): RegistrationRecord {
  return {
    ceremonyId: record.ceremonyId,
    expiresAtMs: record.expiresAtMs,
    preparation: record.preparation,
    phase,
  };
}

export class MlDsaRegistrationAuthorityChanged extends Error {
  constructor() {
    super('The ML-DSA registration owner or custody changed');
  }
}

/** The publication row is also the operation journal. Both change in one D1 transaction. */
export class D1WalletMlDsaRegistration {
  private readonly records: CloudflareD1VersionedJsonRecordStore<RegistrationRecord>;
  private readonly activity: D1WalletCeremonyActivity;
  constructor(
    private readonly options: {
      readonly database: D1DatabaseLike;
      readonly scope: CloudflareD1VersionedJsonRecordScopeV1;
      readonly proxy: RouterAbNormalSigningRouterProxy;
    },
  ) {
    this.records = new CloudflareD1VersionedJsonRecordStore({
      database: options.database,
      scope: options.scope,
      keyPrefix: 'ml-dsa-registration',
      encode: encodeRegistration,
      parse: parseRegistration,
    });
    this.activity = new D1WalletCeremonyActivity(options.database, options.scope);
  }

  async prepare(input: {
    readonly ceremonyId: string;
    readonly expiresAtMs: number;
    readonly signerSlot: number;
    readonly purpose: MlDsaSignerPurpose;
    readonly walletId: WalletId;
    readonly ownershipGeneration: WalletObjectIdentity['ownershipGeneration'];
    readonly owner: ActiveWalletAuthorityV1;
    readonly authMethod: ActivePasskeyWalletAuthMethodRecordV2;
    readonly envelope: PasskeyCustodyEnvelopeRecord;
    readonly envelopeStoreVersion: string;
  }): Promise<PreparationResult> {
    const { owner, authMethod, envelope } = input;
    const identity = walletObjectIdentity(
      input.walletId,
      input.ownershipGeneration,
      this.options.scope,
    );
    if (
      owner.walletId !== identity.walletId ||
      authMethod.walletId !== identity.walletId ||
      authMethod.walletAuthorityId !== owner.authorityId ||
      owner.provenance.kind === 'device_link' ||
      owner.permissions.length !== 4 ||
      envelope.walletId !== identity.walletId ||
      envelope.binding.kind !== 'wallet_custody_seed_v1' ||
      envelope.lifecycle.state !== 'active' ||
      envelope.ownership.kind !== 'method_bound' ||
      envelope.ownership.walletAuthMethodId !== authMethod.walletAuthMethodId
    ) {
      return failure('unauthorized', 'ML-DSA registration requires the active custody owner');
    }
    if (
      !Number.isSafeInteger(input.signerSlot) ||
      input.signerSlot < 1 ||
      input.expiresAtMs <= Date.now()
    )
      return failure('expired', 'ML-DSA registration is expired');
    const signingKeyId = mlDsaSigningKeyIdForSlot(input.signerSlot);
    const key = JSON.stringify([identity.walletId, signingKeyId]);
    await expireUnusedMlDsaAdmissions(
      this.options.database,
      this.options.scope,
      identity.walletId,
      Date.now(),
    );
    const existing = await this.records.read(key);
    if (existing.kind === 'present' && existing.value.ceremonyId === input.ceremonyId) {
      await this.assertCurrentOwner(existing.value.preparation);
      return { ok: true, preparation: existing.value.preparation };
    }
    let materialEpoch = 1;
    switch (input.purpose.kind) {
      case 'create':
        if (existing.kind === 'present') {
          const previous = existing.value;
          if (
            previous.preparation.purpose.kind !== 'create' ||
            previous.phase.kind === 'published' ||
            (previous.phase.kind !== 'expired_admission' && previous.expiresAtMs > Date.now())
          )
            return failure('signer_conflict', 'The ML-DSA signer slot is reserved');
          // Fresh approval replaces an expired, unpublished attempt. Never resume
          // its private state or reuse its epoch, inputs, or preparation.
          materialEpoch = previous.preparation.protocolInputs.materialEpoch + 1;
        }
        break;
      case 'restore': {
        if (existing.kind !== 'present')
          return failure('not_found', 'ML-DSA restoration requires a recorded signer');
        const previous = existing.value;
        const purpose = input.purpose;
        const matchesPublished =
          previous.phase.kind === 'published' &&
          previous.phase.result.publicKeyB64u === purpose.publicKeyB64u &&
          previous.phase.result.manifestDigestB64u === purpose.keyManifestDigestB64u &&
          previous.preparation.protocolInputs.materialEpoch === purpose.materialEpoch;
        const matchesInterrupted =
          previous.expiresAtMs <= Date.now() &&
          previous.preparation.purpose.kind === 'restore' &&
          alphabetizeStringify(previous.preparation.purpose) === alphabetizeStringify(purpose);
        if (!matchesPublished && !matchesInterrupted)
          return failure(
            'signer_conflict',
            'ML-DSA restoration changed the recorded key or an operation is active',
          );
        materialEpoch = previous.preparation.protocolInputs.materialEpoch + 1;
        break;
      }
    }
    if (!Number.isSafeInteger(materialEpoch))
      return failure('unavailable', 'ML-DSA material epoch is exhausted');
    const recipients = await discoverMlDsaRecipientKeys(this.options.proxy);
    if (recipients.kind !== 'ready')
      return failure('unavailable', 'ML-DSA recipients are unavailable');
    const preparation = buildMlDsaAddSignerPreparation({
      purpose: input.purpose,
      identity,
      protocolInputs: {
        walletId: identity.walletId,
        signingKeyId,
        operationIdB64u: await sha256Utf8DigestB64u(
          `seams/ml-dsa/add-signer/v1|${input.ceremonyId}`,
        ),
        materialEpoch,
        continuity:
          input.purpose.kind === 'create'
            ? { kind: 'create' }
            : {
                kind: 'recover',
                recordedKeyManifestDigestB64u: input.purpose.keyManifestDigestB64u,
              },
        roleAPublicKeyB64u: recipients.a.publicKeyB64u,
        roleBPublicKeyB64u: recipients.b.publicKeyB64u,
      },
      owner: {
        walletAuthorityId: owner.authorityId,
        walletAuthMethodId: authMethod.walletAuthMethodId,
        authorityDigestB64u: owner.authorityDigestB64u,
        revocationEpoch: owner.revocationEpoch,
      },
      recipientKeyVersions: { a: recipients.a.keyVersion, b: recipients.b.keyVersion },
      custodyEnvelope: {
        recordKey: passkeyCustodyEnvelopeRecordKey(passkeyCustodyEnvelopeLocatorOf(envelope)),
        storeVersion: input.envelopeStoreVersion,
      },
    });
    const record: RegistrationRecord = {
      ceremonyId: input.ceremonyId,
      expiresAtMs: input.expiresAtMs,
      preparation,
      phase: { kind: 'admitted' },
    };
    const stored = await this.commit(record, existing.kind === 'present' ? existing.version : null);
    if (stored.kind !== 'stored') return failure('conflict', 'ML-DSA registration changed; retry');
    return { ok: true, preparation };
  }

  async execute(preparation: MlDsaAddSignerPreparation, inputs: MlDsaEncryptedInputs) {
    const read = await this.records.read(recordKey(preparation));
    if (
      read.kind !== 'present' ||
      alphabetizeStringify(read.value.preparation) !== alphabetizeStringify(preparation)
    )
      return failure('not_found', 'ML-DSA registration is absent');
    const current = read.value;
    if (current.phase.kind === 'expired_admission')
      return failure('expired', 'ML-DSA admission expired');
    await this.assertCurrentOwner(preparation);
    if (
      current.phase.kind !== 'admitted' &&
      alphabetizeStringify(current.phase.inputs) !== alphabetizeStringify(inputs)
    )
      return failure('idempotency_conflict', 'ML-DSA encrypted input changed');
    if (current.phase.kind === 'installed' || current.phase.kind === 'published')
      return { ok: true as const, result: current.phase.result };
    if (current.expiresAtMs <= Date.now()) return failure('expired', 'ML-DSA registration expired');
    let version = read.version;
    if (current.phase.kind === 'admitted') {
      const stored = await this.commit(withPhase(current, { kind: 'executing', inputs }), version);
      if (stored.kind !== 'stored') return failure('conflict', 'ML-DSA input claim changed; retry');
      version = stored.version;
    }
    const result = await executeMlDsaRegistration(this.options.proxy, preparation, inputs);
    if (result.kind !== 'installed') {
      switch (result.kind) {
        case 'unavailable':
          return {
            ok: false as const,
            code: 'pool_unavailable' as const,
            message: 'ML-DSA preparation is unavailable',
            retryAfterMs: result.retryAfterMs,
          };
        case 'pending':
          return failure('pending', 'ML-DSA execution is running; retry the same operation');
        case 'failed':
          return failure(`ml_dsa_${result.reason}`, 'ML-DSA execution did not complete');
      }
    }
    if (
      preparation.purpose.kind === 'restore' &&
      (result.result.publicKeyB64u !== preparation.purpose.publicKeyB64u ||
        result.result.manifestDigestB64u !== preparation.purpose.keyManifestDigestB64u)
    )
      return failure('custody_mismatch', 'ML-DSA restoration did not reproduce the recorded key');
    const stored = await this.commit(
      withPhase(current, { kind: 'installed', inputs, result: result.result }),
      version,
    );
    if (stored.kind !== 'stored') return failure('conflict', 'ML-DSA completion changed; retry');
    return { ok: true as const, result: result.result };
  }

  async publish(input: {
    readonly walletId: WalletId;
    readonly addSignerCeremonyId: string;
    readonly custodyCommit: MlDsaCustodyCommit;
  }): Promise<
    | MlDsaRegistrationFailure
    | {
        readonly ok: true;
        readonly key: MlDsaCustodyCommit['key'];
        readonly publishedAtMs: number;
        readonly authority: ActiveWalletAuthorityV1;
      }
  > {
    const commit = input.custodyCommit;
    if (commit.key.walletId !== input.walletId)
      return failure('custody_mismatch', 'ML-DSA completion names a different wallet');
    const read = await this.records.read(JSON.stringify([input.walletId, commit.key.signingKeyId]));
    if (read.kind !== 'present' || read.value.ceremonyId !== input.addSignerCeremonyId)
      return failure('not_found', 'ML-DSA registration is absent');
    const record = read.value;
    const preparation = record.preparation;
    const phase = record.phase;
    if (phase.kind !== 'installed' && phase.kind !== 'published')
      return failure('not_ready', 'Both ML-DSA participant installations must complete');
    const context = preparation.protocolInputs;
    if (
      commit.custodyAction !== 'joined' ||
      commit.key.walletId !== context.walletId ||
      commit.key.signingKeyId !== context.signingKeyId ||
      commit.key.operationIdB64u !== context.operationIdB64u ||
      commit.key.materialEpoch !== context.materialEpoch ||
      commit.key.publicKeyB64u !== phase.result.publicKeyB64u ||
      commit.key.keyManifestDigestB64u !== phase.result.manifestDigestB64u
    ) {
      return failure(
        'custody_mismatch',
        'ML-DSA custody completion does not match the installed key',
      );
    }
    const authorityStore = new D1WalletAuthorityStore({
      database: this.options.database,
      scope: this.options.scope,
    });
    const authority = await authorityStore.readById(preparation.owner.walletAuthorityId);
    if (
      !authority ||
      authority.state !== 'active' ||
      authority.walletId !== input.walletId ||
      authority.revocationEpoch !== preparation.owner.revocationEpoch
    )
      throw new MlDsaRegistrationAuthorityChanged();
    const signer = parseExactAdministeredMlDsa65SignerV1({
      kind: 'exact_administered_ml_dsa_65_signer_v1',
      keyFamily: 'ml_dsa_65',
      walletId: commit.key.walletId,
      walletKeyId: `wallet-key:ml-dsa:${commit.key.walletId}:${commit.key.signingKeyId}`,
      mlDsaSigningKeyId: commit.key.signingKeyId,
      registeredPublicKeyB64u: commit.key.publicKeyB64u,
      keyManifestDigestB64u: commit.key.keyManifestDigestB64u,
    });
    const publishedAtMs = phase.kind === 'published' ? phase.publishedAtMs : Date.now();
    const next = await extendWalletAuthorityWithMlDsa65SignerV1({
      authority,
      signer,
      now: publishedAtMs,
    });
    if (phase.kind === 'published') {
      if (next !== authority) throw new MlDsaRegistrationAuthorityChanged();
      await this.assertCurrentOwner(preparation, authority.authorityDigestB64u);
      return { ok: true as const, key: commit.key, publishedAtMs, authority };
    }
    await this.assertCurrentOwner(preparation);
    const extension =
      next === authority
        ? []
        : authorityStore.prepareActiveAuthorityExtension({
            expected: authority,
            next,
            walletSigners: [],
            promotionAtMs: publishedAtMs,
          });
    try {
      const stored = await this.commit(
        withPhase(record, {
          kind: 'published',
          inputs: phase.inputs,
          result: phase.result,
          publishedAtMs,
        }),
        read.version,
        extension,
      );
      if (stored.kind === 'stored')
        return { ok: true as const, key: commit.key, publishedAtMs, authority: next };
    } catch (error: unknown) {
      const latest = await this.records.read(recordKey(preparation));
      if (
        latest.kind === 'present' &&
        latest.value.ceremonyId === input.addSignerCeremonyId &&
        latest.value.phase.kind === 'published'
      )
        return this.publish(input);
      throw error;
    }
    const latest = await this.records.read(recordKey(preparation));
    if (
      latest.kind === 'present' &&
      latest.value.ceremonyId === input.addSignerCeremonyId &&
      latest.value.phase.kind === 'published'
    )
      return this.publish(input);
    return failure('conflict', 'ML-DSA publication changed; retry');
  }

  /** Public metadata only. Signing still requires current operation authorization. */
  async listForWallet(walletId: WalletId): Promise<readonly MlDsaSignerInventoryEntry[]> {
    const rows = await this.options.database
      .prepare(
        `SELECT record_json FROM router_ab_yao_versioned_json_records
       WHERE namespace=? AND org_id=? AND project_id=? AND env_id=?
         AND record_key LIKE 'ml-dsa-registration:%'
         AND json_extract(record_json,'$.preparation.identity.walletId')=?
       ORDER BY record_key LIMIT 65`,
      )
      .bind(
        this.options.scope.namespace,
        this.options.scope.orgId,
        this.options.scope.projectId,
        this.options.scope.envId,
        walletId,
      )
      .all<{ readonly record_json: string }>();
    if (!rows.results || rows.results.length > 64)
      throw new Error('ML-DSA signer inventory is unavailable or exceeds its response limit');
    const entries: MlDsaSignerInventoryEntry[] = [];
    for (const row of rows.results) {
      const record = parseRegistration(JSON.parse(row.record_json));
      if (!record || record.preparation.identity.walletId !== walletId)
        throw new Error('Stored ML-DSA inventory identity differs');
      this.assertScope(record.preparation.identity);
      const protocol = record.preparation.protocolInputs;
      const phase = record.phase;
      if (phase.kind === 'published') {
        entries.push({
          kind: 'published',
          key: {
            walletId,
            signingKeyId: protocol.signingKeyId,
            keySet: 'near_ml_dsa_65_v1',
            publicKeyB64u: phase.result.publicKeyB64u,
            keyManifestDigestB64u: phase.result.manifestDigestB64u,
            operationIdB64u: protocol.operationIdB64u,
            materialEpoch: protocol.materialEpoch,
          },
        });
      } else if (record.preparation.purpose.kind === 'restore') {
        const recorded = record.preparation.purpose;
        entries.push({
          kind: 'restoring',
          signingKeyId: parseMlDsaSigningKeyId(protocol.signingKeyId),
          phase: phase.kind,
          recordedKey: {
            publicKeyB64u: recorded.publicKeyB64u,
            keyManifestDigestB64u: recorded.keyManifestDigestB64u,
            materialEpoch: recorded.materialEpoch,
          },
          retryAtMs: record.expiresAtMs,
        });
      } else {
        entries.push({
          kind: 'unpublished',
          signingKeyId: parseMlDsaSigningKeyId(protocol.signingKeyId),
          phase: phase.kind,
        });
      }
    }
    return entries;
  }

  async readPublished(walletId: WalletId, signingKeyId: string) {
    const read = await this.records.read(JSON.stringify([walletId, signingKeyId]));
    if (read.kind !== 'present' || read.value.phase.kind !== 'published') return null;
    const { preparation, phase } = read.value;
    if (
      preparation.identity.walletId !== walletId ||
      preparation.protocolInputs.signingKeyId !== signingKeyId
    )
      throw new Error('Stored ML-DSA publication identity differs');
    this.assertScope(preparation.identity);
    return {
      identity: preparation.identity,
      publicationVersion: read.version,
      scheduleDigestB64u: phase.result.scheduleDigestB64u,
      key: buildMlDsa65WalletKeyRecord({
        walletId,
        walletKeyId: requireParsed(
          parseWalletKeyId(`wallet-key:ml-dsa:${walletId}:${signingKeyId}`),
          'walletKeyId',
        ),
        walletKeyVersion: parseWalletKeyVersion('version:1'),
        mlDsaSigningKeyId: parseMlDsaSigningKeyId(signingKeyId),
        registeredPublicKeyB64u: phase.result.publicKeyB64u,
        materialEpoch: parseMlDsaMaterialEpoch(preparation.protocolInputs.materialEpoch),
        keyManifestDigestB64u: phase.result.manifestDigestB64u,
        lifecycle: { state: 'active', activatedAtMs: phase.publishedAtMs },
      }),
    };
  }

  private authorityCondition(allowDraining = true): string {
    return `EXISTS (
        SELECT 1 FROM wallet_authorities a JOIN wallet_auth_methods m
          ON m.namespace=a.namespace AND m.org_id=a.org_id AND m.project_id=a.project_id AND m.env_id=a.env_id
          AND m.wallet_authority_id=a.authority_id AND m.wallet_id=a.wallet_id
        WHERE a.namespace=?1 AND a.org_id=?2 AND a.project_id=?3 AND a.env_id=?4 AND a.wallet_id=?5
          AND a.authority_id=?6 AND a.authority_digest_b64u=?7 AND a.revocation_epoch=?8 AND a.lifecycle_state='active'
          AND m.wallet_auth_method_id=?9 AND m.status='active'
      ) AND EXISTS (
        SELECT 1 FROM router_ab_yao_versioned_json_records
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND record_key=?10 AND version=?11
      ) AND EXISTS (
        SELECT 1 FROM wallet_execution_generations
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND wallet_id=?5 AND generation=?12 AND state='active'
      ) AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_write_blocks
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND wallet_id=?5
          AND source_generation=?12 AND (state IN ('checked', 'frozen') OR
            (state='draining' AND (${allowDraining ? '0' : '1'}=1 OR NOT EXISTS (
              SELECT 1 FROM wallet_ceremony_activity activity
              WHERE activity.namespace=?1 AND activity.org_id=?2 AND activity.project_id=?3
                AND activity.env_id=?4 AND activity.wallet_id=?5 AND activity.record_key=?13
            ))))
      ) AND NOT EXISTS (
        SELECT 1 FROM wallet_relocation_authorization_fences
        WHERE namespace=?1 AND org_id=?2 AND project_id=?3 AND env_id=?4 AND wallet_id=?5
      )`;
  }
  private authorityBindings(
    preparation: MlDsaAddSignerPreparation,
    authorityDigestB64u = preparation.owner.authorityDigestB64u,
  ): readonly unknown[] {
    const scope = this.options.scope;
    return [
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      preparation.identity.walletId,
      preparation.owner.walletAuthorityId,
      authorityDigestB64u,
      preparation.owner.revocationEpoch,
      preparation.owner.walletAuthMethodId,
      `${PASSKEY_ENVELOPE_KEY_PREFIX}:${preparation.custodyEnvelope.recordKey}`,
      preparation.custodyEnvelope.storeVersion,
      preparation.identity.ownershipGeneration,
      this.records.storageKey(recordKey(preparation)),
    ];
  }
  private guard(preparation: MlDsaAddSignerPreparation, allowDraining: boolean) {
    return this.options.database
      .prepare(
        `INSERT INTO router_ab_yao_versioned_json_cas_guard (guard_id) SELECT 1 WHERE NOT (${this.authorityCondition(allowDraining)})`,
      )
      .bind(...this.authorityBindings(preparation));
  }
  private assertScope(identity: WalletObjectIdentity): void {
    if (
      identity.orgId !== this.options.scope.orgId ||
      identity.projectId !== this.options.scope.projectId ||
      identity.envId !== this.options.scope.envId
    )
      throw new MlDsaRegistrationAuthorityChanged();
  }
  async assertCurrentOwner(
    preparation: MlDsaAddSignerPreparation,
    authorityDigestB64u = preparation.owner.authorityDigestB64u,
  ) {
    this.assertScope(preparation.identity);
    const row = await this.options.database
      .prepare(`SELECT (${this.authorityCondition()}) AS allowed`)
      .bind(...this.authorityBindings(preparation, authorityDigestB64u))
      .first<{ allowed: number }>();
    if (row?.allowed !== 1) throw new MlDsaRegistrationAuthorityChanged();
  }
  private async commit(
    record: RegistrationRecord,
    version: string | null,
    additionalStatements: readonly D1PreparedStatementLike[] = [],
  ) {
    const key = recordKey(record.preparation);
    let result: Awaited<ReturnType<typeof this.records.putManyWithAdditionalStatements>>;
    try {
      result = await this.records.putManyWithAdditionalStatements(
        [{ key, value: record, expectedVersion: version }],
        [
          this.guard(record.preparation, record.phase.kind !== 'admitted'),
          ...additionalStatements,
          ...this.executionDeadlineStatements(record),
          ...lifecycleWriteFenceStatements(
            this.options,
            new Set([record.preparation.identity.walletId]),
          ),
          this.activity.project(
            this.records.storageKey(key),
            record.preparation.identity.walletId,
            record.phase.kind === 'published',
          ),
        ],
      );
    } catch (error: unknown) {
      await this.assertCurrentOwner(record.preparation);
      throw error;
    }
    if (result.kind !== 'stored') return { kind: 'conflict' as const };
    for (const saved of result.versions) {
      if (saved.key === key) return { kind: 'stored' as const, version: saved.version };
    }
    throw new Error('ML-DSA commit omitted its version');
  }
  private executionDeadlineStatements(record: RegistrationRecord) {
    if (record.phase.kind === 'published') return [];
    return [
      this.options.database
        .prepare(
          "INSERT INTO router_ab_yao_versioned_json_cas_guard (guard_id) SELECT 1 WHERE ?1 <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)",
        )
        .bind(record.expiresAtMs),
    ];
  }
}
