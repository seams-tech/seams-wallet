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

export {
  prepareMlDsaNearSigning,
  executeMlDsaNearSigning,
} from '../../packages/wallet/src/core/rpcClients/relayer/mlDsaSigning';
import initSigner from '../../wasm/near_signer/pkg/wasm_signer_worker.js';
let signingModule: WebAssembly.Module | null = null;
export async function initializeSigningCodec(bytes: Uint8Array): Promise<void> {
  const copied = new Uint8Array(bytes.length);
  copied.set(bytes);
  signingModule = await WebAssembly.compile(copied);
  await initSigner({ module_or_path: signingModule });
}
export function signingWasmModule(): WebAssembly.Module {
  if (signingModule === null) throw new Error('Signing codec is not initialized');
  return signingModule;
}

import {
  buildCapabilityOperationEnvelope,
  buildNearEd25519MpcOperationRef,
  buildEvmEcdsaMpcOperationRef,
  parseTenantId,
  parsePrincipalId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parseAuthFactorId,
  parseAuthorizationEvidenceId,
  parseAuthorizationEvidenceSetId,
} from '../../packages/shared-ts/src/authorization';
import {
  buildPasskeyWalletAuthAuthority,
  walletAuthAuthorityRef,
} from '../../packages/shared-ts/src/utils/walletAuthAuthority';
import {
  buildVerifiedWalletOperationPasskeyFactorResult,
  buildVerifiedWalletOperationFactorEvidenceSet,
} from '../../packages/wallet-server/src/authorization/factorEvidence';
import { parseDigestB64u } from '../../packages/shared-ts/src/utils/canonicalPrimitives';
import { parseSessionOrigin } from '../../packages/wallet-server/src/authorization/domain';
import { CloudflareD1AuthorizationStore } from '../../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
export { submitMlDsaNearTransaction } from '../../packages/wallet/src/core/rpcClients/relayer/mlDsaSigning';

export async function seedClassicalMigrationEvidence(
  database: D1DatabaseLike,
  scope: CloudflareD1VersionedJsonRecordScopeV1,
): Promise<void> {
  const authority = buildPasskeyWalletAuthAuthority({
    walletId: 'migration-wallet',
    rpId: 'wallet.example.test',
    credentialIdB64u: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  });
  const digest = parseDigestB64u('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE');
  const tenantId = requireParsed(parseTenantId(scope.orgId), 'tenantId');
  const principalId = requireParsed(parsePrincipalId('migration-owner'), 'principalId');
  const origin = parseSessionOrigin('https://wallet.example.test');
  const store = new CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  for (const operationRef of [
    buildNearEd25519MpcOperationRef('near.sign_transaction'),
    buildEvmEcdsaMpcOperationRef('evm.sign_transaction'),
  ]) {
    const label = operationRef.capabilityKind;
    const operation = buildCapabilityOperationEnvelope({
      tenantId,
      principalId,
      capabilityId: requireParsed(parseCapabilityId(`migration:${label}`), 'capabilityId'),
      operationId: requireParsed(parseCapabilityOperationId(`migration:${label}`), 'operationId'),
      operation: operationRef,
      digests: { laneDigest: digest, intentDigest: digest, displayDigest: digest },
    });
    const factor = buildVerifiedWalletOperationPasskeyFactorResult({
      tenantId,
      principalId,
      walletId: authority.walletId,
      authorityRef: await walletAuthAuthorityRef({ authority }),
      requestOrigin: origin,
      audience: origin,
      factorId: requireParsed(parseAuthFactorId(`migration:${label}`), 'factorId'),
      operation,
      credentialIdB64u: authority.factor.credentialIdB64u,
      assertionDigest: digest,
      verifiedAtMs: Date.now(),
      expiresAtMs: Date.now() + 300_000,
    });
    await store.putVerifiedEvidenceSet(
      await buildVerifiedWalletOperationFactorEvidenceSet({
        operation,
        factor,
        evidenceId: requireParsed(parseAuthorizationEvidenceId(`migration:${label}`), 'evidenceId'),
        evidenceSetId: requireParsed(
          parseAuthorizationEvidenceSetId(`migration:${label}`),
          'evidenceSetId',
        ),
      }),
    );
  }
}
