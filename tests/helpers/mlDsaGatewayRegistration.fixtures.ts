import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import type { CloudflareD1VersionedJsonRecordScopeV1 } from '../../packages/wallet-server/src/router/cloudflare/d1/versionedJson/d1VersionedJsonRecordStore';
import {
  buildLinkedDeviceManagementAuthorityFixture,
  type LinkedDeviceManagementAuthorityFixture,
} from '../unit/helpers/linkedDeviceManagement.fixtures';
import { buildFullOwnerPermissionsV1 } from '../../packages/shared-ts/src/authorization/delegatedAuthority';
import { prepareD1WalletAuthorityPutStatement } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
import { prepareD1WalletAuthMethodV2PutStatement } from '../../packages/wallet-server/src/core/d1WalletAuthMethodStore';
import { prepareD1WalletPutSubjectStatement } from '../../packages/wallet-server/src/core/d1WalletStore';
import { buildD1WalletRecord } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecords';
import { prepareD1WebAuthnAuthenticatorInsertStatement } from '../../packages/wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnStore';
import { unknownWebAuthnAuthenticatorDeviceInfo } from '../../packages/shared-ts/src/utils/webauthnDeviceInfo';
import {
  buildActiveEnvelopeLifecycle,
  buildMethodBoundEnvelopeOwnership,
  buildPasskeyCustodyEnvelopeRecord,
  parsePasskeyCustodySecretBinding,
  parseWalletCustodyEnvelopeFactor,
  parseEnvelopeRevision,
  parseEnvelopeNonceB64u,
  parseEnvelopeCiphertextB64u,
  parseDigestField,
  requireParsed,
} from '../../packages/shared-ts/src/passkey-custody';
import { parsePasskeyEnvelopeId } from '../../packages/shared-ts/src/utils/domainIds';
import { requireRecord, requireArray } from '../../packages/shared-ts/src/utils/validation';
import { CloudflareD1PasskeyCustodyEnvelopeStore } from '../../packages/wallet-server/src/router/cloudflare/d1/passkeyCustody/d1PasskeyCustodyEnvelopeStore';
import {
  buildWalletRecoveryEnvelopeSetRecord,
  buildWalletCustodySeedRecoveryEntry,
  buildWalletRecoveryManifestKekWrap,
  parseDerivedWalletRecoveryKeyId,
} from '../../packages/shared-ts/src/wallet-recovery';

export { createCloudflareD1RouterApiAuthService } from '../../packages/wallet-server/src/router/cloudflare/d1/auth/d1RouterApiAuthService';
export { createFetchRouter } from '../../packages/wallet-server/src/router/transport/fetch/createFetchRouter';
export { D1WalletMlDsaRegistration } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaRegistration';
export { D1WalletAuthorityStore } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
export { TracedD1Database } from '../r150-hosted/gateway/d1Trace';
export { parseWalletAddSignerStartResponse } from '../../packages/wallet/src/core/rpcClients/relayer/walletRegistration';
export { computeAddSignerIntentDigestB64u } from '../../packages/shared-ts/src/utils/registrationIntent';
export {
  WALLET_MANAGEMENT_PROTOCOL_HEADER,
  WALLET_MANAGEMENT_PROTOCOL_VERSION,
} from '../../packages/shared-ts/src/utils/walletManagementProtocol';

export async function gatewayOwner(input: {
  walletId: string;
  credentialIdB64u: string;
  credentialPublicKeyB64u: string;
  label: string;
}) {
  return buildLinkedDeviceManagementAuthorityFixture({
    label: input.label,
    provenance: 'wallet_registration',
    permissions: buildFullOwnerPermissionsV1(),
    identity: {
      walletId: input.walletId,
      authorityId: `authority:${input.label}`,
      walletAuthMethodId: `wallet-auth-method:${input.label}`,
      rpId: 'wallet.example.test',
      credentialIdB64u: input.credentialIdB64u,
    },
    credentialPublicKeyB64u: input.credentialPublicKeyB64u,
  });
}

export async function seedOwner(
  database: D1DatabaseLike,
  scope: CloudflareD1VersionedJsonRecordScopeV1,
  owner: LinkedDeviceManagementAuthorityFixture,
) {
  await database.batch([
    prepareD1WalletPutSubjectStatement({
      database,
      scope,
      record: buildD1WalletRecord({ walletId: owner.authority.walletId, now: Date.now() }),
    }),
    prepareD1WalletAuthorityPutStatement({ database, scope, authority: owner.authority }),
    prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: owner.authMethod }),
    prepareD1WebAuthnAuthenticatorInsertStatement({
      database,
      scope,
      userId: owner.authority.walletId,
      record: {
        credentialIdB64u: owner.authMethod.credentialIdB64u,
        credentialPublicKeyB64u: owner.authMethod.credentialPublicKeyB64u,
        counter: 0,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        deviceInfo: unknownWebAuthnAuthenticatorDeviceInfo(),
      },
    }),
  ]);
}

function recoveryWrap(now: number, raw: unknown) {
  const wrap = requireRecord(raw, 'fixture recovery wrap');
  return buildWalletRecoveryManifestKekWrap({
    recoveryKeyId: parseDerivedWalletRecoveryKeyId(wrap.recoveryKeyId),
    nonceB64u: parseEnvelopeNonceB64u(wrap.nonceB64u),
    wrappedManifestKekB64u: parseEnvelopeCiphertextB64u(wrap.ciphertextB64u),
    aadHashB64u: parseDigestField(wrap.aadHashB64u, 'recovery AAD'),
    lifecycle: { state: 'active', issuedAtMs: now },
  });
}

export async function seedCustody(
  database: D1DatabaseLike,
  scope: CloudflareD1VersionedJsonRecordScopeV1,
  owner: LinkedDeviceManagementAuthorityFixture,
  raw: unknown,
) {
  const ready = requireRecord(raw, 'native fixture');
  const source = requireRecord(ready.envelope, 'native envelope');
  const binding = requireRecord(source.binding, 'native binding');
  const now = Date.now();
  const envelope = buildPasskeyCustodyEnvelopeRecord({
    envelopeId: requireParsed(parsePasskeyEnvelopeId(binding.envelopeId), 'envelopeId'),
    walletId: owner.authority.walletId,
    ownership: buildMethodBoundEnvelopeOwnership(owner.authMethod.walletAuthMethodId),
    binding: parsePasskeyCustodySecretBinding(binding.binding),
    factor: parseWalletCustodyEnvelopeFactor(binding.factor),
    envelopeRevision: parseEnvelopeRevision(1),
    nonceB64u: parseEnvelopeNonceB64u(source.nonceB64u),
    sealedCustodySecretB64u: parseEnvelopeCiphertextB64u(source.ciphertextB64u),
    ciphertextDigestB64u: parseDigestField(source.ciphertextDigestB64u, 'ciphertext digest'),
    aadHashB64u: parseDigestField(source.aadHashB64u, 'envelope AAD'),
    lifecycle: buildActiveEnvelopeLifecycle({ activatedAtMs: now }),
    createdAtMs: now,
    updatedAtMs: now,
  });
  const inserted = await new CloudflareD1PasskeyCustodyEnvelopeStore({
    database,
    scope,
  }).createEnvelope(envelope);
  if (inserted.kind !== 'stored') throw new Error('Fixture envelope was not stored');
  const recovery = requireRecord(ready.recovery, 'native recovery');
  const recoverySet = buildWalletRecoveryEnvelopeSetRecord({
    walletId: owner.authority.walletId,
    manifestKekWraps: requireArray(recovery.wraps, 'recovery wraps').map(
      recoveryWrap.bind(undefined, now),
    ),
    entries: [
      buildWalletCustodySeedRecoveryEntry({
        nonceB64u: parseEnvelopeNonceB64u(recovery.entryNonceB64u),
        wrappedCustodySecretB64u: parseEnvelopeCiphertextB64u(recovery.entryCiphertextB64u),
        aadHashB64u: parseDigestField(recovery.entryAadHashB64u, 'recovery entry AAD'),
      }),
    ],
    issuedAtMs: now,
    updatedAtMs: now,
  });
  await database
    .prepare(
      `INSERT INTO router_ab_yao_versioned_json_records (namespace, org_id, project_id, env_id, record_key, version, record_json) VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(
      scope.namespace,
      scope.orgId,
      scope.projectId,
      scope.envId,
      `passkey-envelope:recovery-set:${owner.authority.walletId}`,
      JSON.stringify(recoverySet),
    )
    .run();
  return envelope;
}

export { D1WalletRelocationWriteBlock } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationWriteBlock';
export { WalletRelocationSessionSource } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationSessions';

export { expireUnusedMlDsaAdmissions } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1MlDsaRegistrationExpiry';
