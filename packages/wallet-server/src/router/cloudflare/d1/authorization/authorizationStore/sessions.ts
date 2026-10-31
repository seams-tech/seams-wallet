import {
  D1EcdsaAdmissionPolicyRead,
  D1Ed25519AdmissionPolicyRead,
  ECDSA_CREDENTIAL_POLICY_PROJECTION,
  ED25519_CREDENTIAL_POLICY_PROJECTION,
} from '../../signingAdmission/d1RouterAbNormalSigningAdmissionStore';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { parseInstalledEcdsaCustodySnapshotV1 } from '../../deviceLinking/d1LinkedDeviceAuthorityInstallService';
import { ECDSA_INSTALLATION_SNAPSHOT_COLUMNS } from '../../../../../core/ecdsaMaterialReadSnapshot';
import type {
  EcdsaWalletSessionAdmissionRead,
  Ed25519WalletSessionAdmissionRead,
} from '../../../../../authorization/service';
import type { RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { EcdsaMaterialRead } from '../../../../../core/d1EcdsaSignerRead';
import { Ed25519SignerRead } from '../../../../../core/d1Ed25519SignerRead';
import { ED25519_SIGNER_ACTIVATION_ID_PATH } from '../../../../../core/d1WalletStore';
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
  type WalletId,
} from '@shared/utils/domainIds';
import {
  parseMpcWalletSigningQuotaId,
  parsePrincipalId,
  parseTenantId,
  parseWalletSessionId,
} from '@shared/authorization/capabilityKinds';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import type {
  IssuedWalletSessionAuthorizationV2,
  LiveWalletSessionAuthorizationProjectionV2,
  WalletSessionAuthorizationV2,
  ActiveWalletSessionQuota,
  WalletSessionAuthorizationV2MintLookup,
  WalletSessionAuthorizationV2MintRead,
  ExactWalletSessionQuotaProjectionV1,
  ExactWalletSessionStatusV2,
  ExactWalletSessionStatusSnapshotV2,
  WalletSessionAdmissionSnapshotV2,
  WalletSessionExactOperationContext,
} from '../../../../../authorization/domain';
import type { WalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import type { WalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import {
  buildActiveWalletSessionQuota,
  buildExactWalletSessionQuotaProjectionV1,
  exactWalletSessionCapabilitySubjectsResolveAuthority,
  parseWalletSessionAuthorizationV2,
  walletSessionAuthorizationV2RecordsEqual,
} from '../../../../../authorization/domain';
import { parseD1WalletAuthorityRow } from '../../wallet/d1WalletAuthorityStore';
import { normalizeWalletAuthMethodV2 } from '../../../../../core/d1WalletAuthMethodStore';
import { parseD1JsonColumn, type D1Row } from '../../../../../storage/d1Sql';
import type { D1PreparedStatementLike } from '../../../../../storage/tenantRoute';
import {
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { parsePersistedWalletSessionAuthorizationV2 } from '../persistedWalletSessionAuthorization';
import { requirePositiveInteger, integerColumn, requireParsed, requireString } from './rowValues';
import type { D1AuthorizationLinkedAuthorityMaterialProjection } from './context';
import type { D1AuthorizationContext } from './context';

type SessionStatusMaterialSubject =
  | {
      readonly keyFamily: 'ed25519';
      readonly materialActivation: MpcMaterialActivationRef;
      readonly materialRead?: never;
    }
  | {
      readonly keyFamily: 'ecdsa_secp256k1';
      readonly materialActivation: MpcMaterialActivationRef;
      readonly materialRead: EcdsaMaterialRead;
    };

type WalletSessionAuthorizationV2Read =
  | {
      readonly expected: WalletSessionAuthorizationV2;
      readonly nowMs: number;
    }
  | {
      readonly identity: {
        readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
        readonly walletId: WalletSessionAuthorizationV2['walletId'];
        readonly walletSessionId: WalletSessionAuthorizationV2['walletSessionId'];
        readonly authorizationId: WalletSessionAuthorizationV2['authorizationId'];
      };
      readonly nowMs: number;
    }
  | {
      readonly operationCredentialHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
      readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
      readonly nowMs: number;
    };

export function parseWalletSessionAuthorizationV2MintRow(
  row: D1Row | null,
  input: WalletSessionAuthorizationV2MintLookup,
): WalletSessionAuthorizationV2MintRead | null {
  if (!row) return null;
  const session = parsePersistedWalletSessionAuthorizationV2(parseD1JsonColumn(row.record_json));
  const sessionColumns: D1Row = {
    session_tenant_id: row.tenant_id,
    session_authorization_id: row.authorization_id,
    session_mint_id: row.mint_id,
    session_wallet_session_id: row.wallet_session_id,
    session_quota_id: row.quota_id,
    session_principal_id: row.principal_id,
    session_wallet_id: row.wallet_id,
    session_authority_id: row.authority_id,
    session_wallet_auth_method_id: row.wallet_auth_method_id,
    session_authority_digest_b64u: row.authority_digest_b64u,
    session_authority_revocation_epoch: row.authority_revocation_epoch,
    session_issued_at_ms: row.issued_at_ms,
    session_expires_at_ms: row.expires_at_ms,
  };
  if (!walletSessionAuthorizationV2RowMatches(sessionColumns, session)) {
    throw new Error('Stored V2 Wallet Session mint columns disagree with record');
  }
  const subjectsRecord = parseWalletSessionAuthorizationV2WithSubjects(
    sessionColumns,
    parseD1JsonColumn(row.capability_subjects_json),
  );
  if (!walletSessionAuthorizationV2RecordsEqual(subjectsRecord, session)) {
    throw new Error('Stored V2 Wallet Session mint subjects disagree with record');
  }
  if (
    session.tenantId !== input.tenantId ||
    session.principalId !== input.principalId ||
    session.walletId !== input.walletId ||
    session.authorityId !== input.authorityId ||
    session.walletAuthMethodId !== input.walletAuthMethodId ||
    session.mintId !== input.mintId
  ) {
    throw new Error('Stored V2 Wallet Session mint identity does not match the request');
  }
  const primaryOperationCredentialDigestB64u = parseDigestB64u(row.operation_credential_hash);
  const retiredAtMs =
    row.retired_at_ms === null || row.retired_at_ms === undefined
      ? null
      : requirePositiveInteger(row.retired_at_ms, 'V2 session.retiredAtMs');
  return {
    kind: 'committed',
    session,
    primaryOperationCredentialDigestB64u,
    retiredAtMs,
  };
}

function walletSessionAuthorizationV2RowMatches(
  row: D1Row,
  session: WalletSessionAuthorizationV2,
): boolean {
  return (
    row.session_tenant_id === String(session.tenantId) &&
    row.session_authorization_id === String(session.authorizationId) &&
    row.session_mint_id === String(session.mintId) &&
    row.session_wallet_session_id === String(session.walletSessionId) &&
    row.session_quota_id === String(session.quotaId) &&
    row.session_principal_id === String(session.principalId) &&
    row.session_wallet_id === String(session.walletId) &&
    row.session_authority_id === String(session.authorityId) &&
    row.session_wallet_auth_method_id === String(session.walletAuthMethodId) &&
    row.session_authority_digest_b64u === String(session.authorityDigestB64u) &&
    integerColumn(row.session_authority_revocation_epoch, 'session.authorityRevocationEpoch') ===
      session.authorityRevocationEpoch &&
    integerColumn(row.session_issued_at_ms, 'session.createdAtMs') === session.createdAtMs &&
    integerColumn(row.session_expires_at_ms, 'session.expiresAtMs') === session.expiresAtMs
  );
}

function parseWalletSessionAuthorizationV2WithSubjects(
  row: D1Row,
  capabilitySubjects: unknown,
): WalletSessionAuthorizationV2 {
  return parseWalletSessionAuthorizationV2({
    kind: 'wallet_session_authorization_v2',
    tenantId: row.session_tenant_id,
    principalId: row.session_principal_id,
    walletId: row.session_wallet_id,
    authorityId: row.session_authority_id,
    walletAuthMethodId: row.session_wallet_auth_method_id,
    authorityDigestB64u: row.session_authority_digest_b64u,
    authorityRevocationEpoch: row.session_authority_revocation_epoch,
    mintId: row.session_mint_id,
    authorizationId: row.session_authorization_id,
    walletSessionId: row.session_wallet_session_id,
    quotaId: row.session_quota_id,
    capabilitySubjects,
    createdAtMs: row.session_issued_at_ms,
    expiresAtMs: row.session_expires_at_ms,
  });
}

/** The authority and auth method a joined session row carries, as read with it. */
async function joinedAuthorityAndMethod(row: D1Row): Promise<{
  readonly authority: WalletAuthorityV1 | null;
  readonly authMethod: WalletAuthMethodRecordV2 | null;
}> {
  const authority =
    row.authority_id === null || row.authority_id === undefined
      ? null
      : await parseD1WalletAuthorityRow(row);
  const authMethod =
    row.auth_method_record_json === null || row.auth_method_record_json === undefined
      ? null
      : normalizeWalletAuthMethodV2(parseD1JsonColumn(row.auth_method_record_json));
  return { authority, authMethod };
}

function parseLiveWalletSessionAuthorizationV2Row(
  row: D1Row,
  input: WalletSessionAuthorizationV2Read,
): WalletSessionAuthorizationV2 {
  if (row.session_retired_at_ms !== null && row.session_retired_at_ms !== undefined) {
    throw new Error('Stored V2 Wallet Session authorization is retired');
  }
  const session = parsePersistedWalletSessionAuthorizationV2(
    parseD1JsonColumn(row.session_record_json),
  );
  if (!walletSessionAuthorizationV2RowMatches(row, session)) {
    throw new Error('Stored V2 Wallet Session authorization columns disagree with record');
  }
  const subjectsRecord = parseWalletSessionAuthorizationV2WithSubjects(
    row,
    parseD1JsonColumn(row.session_capability_subjects_json),
  );
  if (!walletSessionAuthorizationV2RecordsEqual(subjectsRecord, session)) {
    throw new Error('Stored V2 Wallet Session capability subjects disagree with record');
  }
  if (
    row.authority_id !== String(session.authorityId) ||
    row.authority_wallet_id !== String(session.walletId) ||
    row.authority_lifecycle_state !== 'active' ||
    row.authority_digest_b64u !== String(session.authorityDigestB64u) ||
    integerColumn(row.authority_revocation_epoch, 'authority.revocationEpoch') !==
      session.authorityRevocationEpoch ||
    row.auth_method_id !== String(session.walletAuthMethodId) ||
    row.auth_method_wallet_id !== String(session.walletId) ||
    row.auth_method_authority_id !== String(session.authorityId) ||
    row.auth_method_status !== 'active'
  ) {
    throw new Error('Stored V2 Wallet Session authority provenance is no longer active');
  }
  if (
    'identity' in input &&
    (session.walletId !== input.identity.walletId ||
      session.walletSessionId !== input.identity.walletSessionId ||
      session.authorizationId !== input.identity.authorizationId)
  ) {
    throw new Error('Stored V2 Wallet Session identity does not match the request');
  }
  if ('expected' in input && !walletSessionAuthorizationV2RecordsEqual(session, input.expected)) {
    throw new Error('Stored V2 Wallet Session authorization replay does not match');
  }
  const nowMs = requirePositiveInteger(input.nowMs, 'V2 authorization read time');
  if (session.expiresAtMs <= nowMs) {
    throw new Error('Stored V2 Wallet Session authorization has expired');
  }
  return session;
}

function parseWalletSessionAuthorizationV2QuotaRow(
  row: D1Row,
  session: WalletSessionAuthorizationV2,
): ActiveWalletSessionQuota {
  if (row.quota_lifecycle_kind !== 'active') {
    throw new Error('Stored V2 Wallet Session quota is no longer active');
  }
  const quotaTenantId = requireParsed(row.quota_tenant_id, parseTenantId, 'V2 quota.tenantId');
  const quotaPrincipalId = requireParsed(
    row.quota_principal_id,
    parsePrincipalId,
    'V2 quota.principalId',
  );
  const quotaWalletSessionId = requireParsed(
    row.quota_wallet_session_id,
    parseWalletSessionId,
    'V2 quota.walletSessionId',
  );
  const quotaId = requireParsed(row.quota_id, parseMpcWalletSigningQuotaId, 'V2 quota.quotaId');
  const remainingUses = requirePositiveInteger(row.quota_remaining_uses, 'V2 quota.remainingUses');
  const expiresAtMs = requirePositiveInteger(row.quota_expires_at_ms, 'V2 quota.expiresAtMs');
  if (
    quotaTenantId !== session.tenantId ||
    quotaPrincipalId !== session.principalId ||
    quotaWalletSessionId !== session.walletSessionId ||
    quotaId !== session.quotaId ||
    expiresAtMs !== session.expiresAtMs
  ) {
    throw new Error('Stored V2 Wallet Session quota identity does not match');
  }
  return buildActiveWalletSessionQuota({
    tenantId: quotaTenantId,
    principalId: quotaPrincipalId,
    walletSessionId: quotaWalletSessionId,
    quotaId,
    remainingUses,
    expiresAtMs,
  });
}

/**
 * Reads the quota joined to an exact authorization without collapsing an
 * exhausted quota into an error. Identity disagreement remains a corrupt-row
 * exception because the quota is the authorization's own committed row.
 */
function parseExactWalletSessionQuotaProjectionRow(
  row: D1Row,
  session: WalletSessionAuthorizationV2,
): ExactWalletSessionQuotaProjectionV1 {
  if (row.quota_id === null || row.quota_id === undefined) {
    throw new Error('Stored V2 Wallet Session quota row is missing');
  }
  if (row.quota_lifecycle_kind !== 'active' && row.quota_lifecycle_kind !== 'exhausted') {
    throw new Error('Stored V2 Wallet Session quota lifecycle is unsupported');
  }
  const quotaTenantId = requireParsed(row.quota_tenant_id, parseTenantId, 'V2 quota.tenantId');
  const quotaPrincipalId = requireParsed(
    row.quota_principal_id,
    parsePrincipalId,
    'V2 quota.principalId',
  );
  const quotaWalletSessionId = requireParsed(
    row.quota_wallet_session_id,
    parseWalletSessionId,
    'V2 quota.walletSessionId',
  );
  const quotaId = requireParsed(row.quota_id, parseMpcWalletSigningQuotaId, 'V2 quota.quotaId');
  const remainingUses = integerColumn(row.quota_remaining_uses, 'V2 quota.remainingUses');
  const expiresAtMs = requirePositiveInteger(row.quota_expires_at_ms, 'V2 quota.expiresAtMs');
  if (
    quotaTenantId !== session.tenantId ||
    quotaPrincipalId !== session.principalId ||
    quotaWalletSessionId !== session.walletSessionId ||
    quotaId !== session.quotaId ||
    expiresAtMs !== session.expiresAtMs
  ) {
    throw new Error('Stored V2 Wallet Session quota identity does not match');
  }
  return buildExactWalletSessionQuotaProjectionV1({
    lifecycle: row.quota_lifecycle_kind,
    tenantId: quotaTenantId,
    principalId: quotaPrincipalId,
    walletSessionId: quotaWalletSessionId,
    quotaId,
    remainingUses,
    expiresAtMs,
  });
}

async function parseWalletSessionAdmissionRow(
  row: D1Row,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  },
): Promise<WalletSessionAdmissionSnapshotV2> {
  const session = parseLiveWalletSessionAuthorizationV2Row(row, {
    operationCredentialHash: input.tokenHash,
    tenantId: input.tenantId,
    nowMs: input.nowMs,
  });
  const { authority, authMethod } = await joinedAuthorityAndMethod(row);
  if (row.quota_lifecycle_kind === 'exhausted') {
    return {
      kind: 'exhausted',
      session,
      quota: parseExactWalletSessionQuotaProjectionRow(row, session),
      authority,
      authMethod,
    };
  }
  const quota = parseWalletSessionAuthorizationV2QuotaRow(row, session);
  return { kind: 'active', authorization: { session, quota }, authority, authMethod };
}

function installationJsonColumn(
  column: (typeof ECDSA_INSTALLATION_SNAPSHOT_COLUMNS)[number],
): string {
  return `'${column}', installation.${column}`;
}

export async function readWalletSessionAuthorizationV2ByMint(
  context: D1AuthorizationContext,
  input: WalletSessionAuthorizationV2MintLookup,
): Promise<WalletSessionAuthorizationV2MintRead | null> {
  const row = await prepareWalletSessionAuthorizationV2ByMintRead(context, input).first<D1Row>();
  return parseWalletSessionAuthorizationV2MintRow(row, input);
}

export function prepareWalletSessionAuthorizationV2ByMintRead(
  context: D1AuthorizationContext,
  input: WalletSessionAuthorizationV2MintLookup,
): D1PreparedStatementLike {
  return context.database
    .prepare(
      `SELECT
           record_json,
           capability_subjects_json,
           tenant_id,
           authorization_id,
           mint_id,
           wallet_session_id,
           quota_id,
           principal_id,
           wallet_id,
           authority_id,
           wallet_auth_method_id,
           authority_digest_b64u,
           authority_revocation_epoch,
           issued_at_ms,
           expires_at_ms,
           retired_at_ms,
           operation_credential_hash
         FROM wallet_session_authorizations_v2
        WHERE namespace = ?
          AND org_id = ?
          AND project_id = ?
          AND env_id = ?
          AND tenant_id = ?
          AND principal_id = ?
          AND wallet_id = ?
          AND authority_id = ?
          AND wallet_auth_method_id = ?
          AND mint_id = ?
        LIMIT 1`,
    )
    .bind(
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      String(input.principalId),
      String(input.walletId),
      String(input.authorityId),
      String(input.walletAuthMethodId),
      String(input.mintId),
    );
}

export async function readLiveWalletSessionAuthorizationProjectionV2(
  context: D1AuthorizationContext,
  input: {
    readonly expected: WalletSessionAuthorizationV2;
    readonly nowMs: number;
  },
): Promise<LiveWalletSessionAuthorizationProjectionV2 | null> {
  const row = await readJoinedWalletSessionAuthorizationV2Row(context, {
    projection: { kind: 'session' },
    lookupColumn: 'authorization_id',
    tenantId: input.expected.tenantId,
    lookupValue: input.expected.authorizationId,
  });
  if (!row) return null;
  const session = parseLiveWalletSessionAuthorizationV2Row(row, input);
  return { session, quota: parseExactWalletSessionQuotaProjectionRow(row, session) };
}

export async function readWalletSessionAuthorizationV2ByAuthorizationId(
  context: D1AuthorizationContext,
  input: {
    readonly expected: WalletSessionAuthorizationV2;
    readonly nowMs: number;
  },
): Promise<IssuedWalletSessionAuthorizationV2 | null> {
  return await readWalletSessionAuthorizationV2(context, input, 'authorization_id');
}

export async function readWalletSessionAuthorizationV2ByIdentity(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly walletId: WalletSessionAuthorizationV2['walletId'];
    readonly walletSessionId: WalletSessionAuthorizationV2['walletSessionId'];
    readonly authorizationId: WalletSessionAuthorizationV2['authorizationId'];
    readonly nowMs: number;
  },
): Promise<IssuedWalletSessionAuthorizationV2 | null> {
  return await readWalletSessionAuthorizationV2(
    context,
    {
      identity: {
        tenantId: input.tenantId,
        walletId: input.walletId,
        walletSessionId: input.walletSessionId,
        authorizationId: input.authorizationId,
      },
      nowMs: input.nowMs,
    },
    'authorization_id',
  );
}

export async function readActiveWalletSessionAuthorizationV2ByIdentity(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly walletId: WalletSessionAuthorizationV2['walletId'];
    readonly walletSessionId: WalletSessionAuthorizationV2['walletSessionId'];
    readonly authorizationId: WalletSessionAuthorizationV2['authorizationId'];
    readonly nowMs: number;
  },
): Promise<WalletSessionAuthorizationV2 | null> {
  const row = await context.database
    .prepare(
      `SELECT record_json, retired_at_ms
           FROM wallet_session_authorizations_v2
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ?
            AND env_id = ?
            AND tenant_id = ?
            AND wallet_id = ?
            AND wallet_session_id = ?
            AND authorization_id = ?
          LIMIT 1`,
    )
    .bind(
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      input.walletId,
      input.walletSessionId,
      input.authorizationId,
    )
    .first<D1Row>();
  if (!row) return null;
  if (row.retired_at_ms !== null && row.retired_at_ms !== undefined) return null;
  const session = parsePersistedWalletSessionAuthorizationV2(parseD1JsonColumn(row.record_json));
  if (
    session.tenantId !== input.tenantId ||
    session.walletId !== input.walletId ||
    session.walletSessionId !== input.walletSessionId ||
    session.authorizationId !== input.authorizationId
  ) {
    throw new Error('Stored V2 Wallet Session identity does not match the request');
  }
  const nowMs = requirePositiveInteger(input.nowMs, 'V2 authorization read time');
  return session.expiresAtMs > nowMs ? session : null;
}

export async function readWalletSessionAuthorizationV2ByOperationCredential(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  },
): Promise<IssuedWalletSessionAuthorizationV2 | null> {
  return await readWalletSessionAuthorizationV2(
    context,
    {
      operationCredentialHash: input.tokenHash,
      tenantId: input.tenantId,
      nowMs: input.nowMs,
    },
    'operation_credential_hash',
  );
}

/**
 * The live session, its authority and its auth method from one joined read.
 * A commit between separate reads could pair the session with an authority
 * it was never bound to; one statement cannot.
 */
export async function readWalletSessionAdmissionSnapshotByOperationCredential(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  },
): Promise<WalletSessionAdmissionSnapshotV2 | null> {
  const row = await readJoinedWalletSessionAuthorizationV2Row(context, {
    projection: { kind: 'session' },
    lookupColumn: 'operation_credential_hash',
    tenantId: input.tenantId,
    lookupValue: input.tokenHash,
  });
  if (!row || row.session_retired_at_ms !== null) return null;
  return parseWalletSessionAdmissionRow(row, input);
}

export async function readEcdsaWalletSessionAdmissionSnapshotByOperationCredential(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
    readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  },
): Promise<EcdsaWalletSessionAdmissionRead | null> {
  const row = await readJoinedWalletSessionAuthorizationV2Row(context, {
    projection: { kind: 'ecdsa_material', materialActivation: input.materialActivation },
    lookupColumn: 'operation_credential_hash',
    tenantId: input.tenantId,
    lookupValue: input.tokenHash,
  });
  if (!row || row.session_retired_at_ms !== null) return null;
  const snapshot = await parseWalletSessionAdmissionRow(row, input);
  const session = snapshot.kind === 'active' ? snapshot.authorization.session : snapshot.session;
  return {
    snapshot,
    materialRead: EcdsaMaterialRead.fromRows(
      context.walletSignerScope,
      session.walletId,
      input.materialActivation,
      parseD1JsonColumn(row.ecdsa_material_records_json),
      await parseInstalledEcdsaCustodySnapshotV1({
        scope: context.walletSignerScope,
        walletId: session.walletId,
        materialActivation: routerAbMpcMaterialActivationRefFromWire(input.materialActivation),
        installations: parseD1JsonColumn(row.ecdsa_installations_json),
        signers: parseD1JsonColumn(row.ecdsa_source_signers_json),
      }),
    ),
    policyRead: D1EcdsaAdmissionPolicyRead.fromRows(
      context.database,
      context.namespace,
      session.walletId,
      input.materialActivation.activation_id,
      parseD1JsonColumn(row.ecdsa_policy_records_json),
    ),
  };
}

/**
 * The session with the Ed25519 signer and the policy rows its admission
 * needs, in one statement. The signer and the policy are those of the
 * session's own wallet, whatever wallet the request names.
 */
export async function readEd25519WalletSessionAdmissionSnapshotByOperationCredential(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
    readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  },
): Promise<Ed25519WalletSessionAdmissionRead | null> {
  const row = await readJoinedWalletSessionAuthorizationV2Row(context, {
    projection: { kind: 'ed25519_material', materialActivation: input.materialActivation },
    lookupColumn: 'operation_credential_hash',
    tenantId: input.tenantId,
    lookupValue: input.tokenHash,
  });
  if (!row || row.session_retired_at_ms !== null) return null;
  const snapshot = await parseWalletSessionAdmissionRow(row, input);
  const session = snapshot.kind === 'active' ? snapshot.authorization.session : snapshot.session;
  return {
    snapshot,
    signerRead: Ed25519SignerRead.fromRows(
      session.walletId,
      input.materialActivation,
      parseD1JsonColumn(row.ed25519_material_records_json),
    ),
    policyRead: D1Ed25519AdmissionPolicyRead.fromRows(
      context.database,
      context.namespace,
      session.walletId,
      session.authorityId,
      parseD1JsonColumn(row.ed25519_policy_records_json),
    ),
  };
}

export async function readWalletSessionExactOperationContextByCredential(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  },
): Promise<WalletSessionExactOperationContext | null> {
  const row = await readJoinedWalletSessionAuthorizationV2Row(context, {
    projection: { kind: 'session' },
    lookupColumn: 'operation_credential_hash',
    tenantId: input.tenantId,
    lookupValue: input.tokenHash,
  });
  if (!row) return null;
  if (
    (row.session_retired_at_ms !== null && row.session_retired_at_ms !== undefined) ||
    integerColumn(row.session_expires_at_ms, 'session.expiresAtMs') <= input.nowMs
  ) {
    return null;
  }
  const session = parseLiveWalletSessionAuthorizationV2Row(row, {
    operationCredentialHash: input.tokenHash,
    tenantId: input.tenantId,
    nowMs: input.nowMs,
  });
  // Exhaustion permits identity resolution; exact-operation admission grants authority.
  parseExactWalletSessionQuotaProjectionRow(row, session);
  const authority = await parseD1WalletAuthorityRow(row);
  const authMethod = normalizeWalletAuthMethodV2(parseD1JsonColumn(row.auth_method_record_json));
  if (
    authority.state !== 'active' ||
    !authMethod ||
    authMethod.status !== 'active' ||
    authority.walletId !== session.walletId ||
    authority.authorityId !== session.authorityId ||
    authority.authorityDigestB64u !== session.authorityDigestB64u ||
    authority.revocationEpoch !== session.authorityRevocationEpoch ||
    authMethod.walletId !== session.walletId ||
    authMethod.walletAuthorityId !== session.authorityId ||
    authMethod.walletAuthMethodId !== session.walletAuthMethodId
  ) {
    return null;
  }
  return {
    session,
    authority,
    authMethod,
    retiredAtMs: null,
    ownerWalletScope: {
      ownershipGeneration: requirePositiveInteger(
        row.execution_generation,
        'session.ownershipGeneration',
      ),
      orgId: requireString(row.session_org_id, 'session.ownerWalletScope.orgId'),
      projectId: requireString(row.session_project_id, 'session.ownerWalletScope.projectId'),
      projectEnvironmentId: requireString(
        row.session_env_id,
        'session.ownerWalletScope.projectEnvironmentId',
      ),
      walletId: session.walletId,
    },
  };
}

/**
 * Resolves one exact operation credential to the whole digest-free
 * authorization lifecycle. Every observed row returns typed data: expiry,
 * exhaustion, retirement, and an unavailable authority, method, or capability
 * are lifecycle states, not failures. Corrupt rows, columns disagreeing with
 * their record, and broken foreign-key identity still throw.
 */
export async function readExactWalletSessionStatusByOperationCredential(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  },
): Promise<ExactWalletSessionStatusV2> {
  return (await readExactWalletSessionStatusSnapshotByOperationCredential(context, input)).status;
}

/**
 * The exact status with the authority and auth method it was judged
 * against, all from the one joined read.
 */
export async function readExactWalletSessionStatusSnapshotByOperationCredential(
  context: D1AuthorizationContext,
  input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  },
): Promise<ExactWalletSessionStatusSnapshotV2> {
  const unjudged = (status: ExactWalletSessionStatusV2): ExactWalletSessionStatusSnapshotV2 => ({
    status,
    authority: null,
    authMethod: null,
  });
  const nowMs = requirePositiveInteger(input.nowMs, 'exact Wallet Session status time');
  const row = await readJoinedWalletSessionAuthorizationV2Row(context, {
    projection: { kind: 'session_status' },
    lookupColumn: 'operation_credential_hash',
    tenantId: input.tenantId,
    lookupValue: input.tokenHash,
  });
  if (!row) return unjudged({ kind: 'missing' });

  const session = parsePersistedWalletSessionAuthorizationV2(
    parseD1JsonColumn(row.session_record_json),
  );
  if (!walletSessionAuthorizationV2RowMatches(row, session)) {
    throw new Error('Stored V2 Wallet Session authorization columns disagree with record');
  }
  const subjectsRecord = parseWalletSessionAuthorizationV2WithSubjects(
    row,
    parseD1JsonColumn(row.session_capability_subjects_json),
  );
  if (!walletSessionAuthorizationV2RecordsEqual(subjectsRecord, session)) {
    throw new Error('Stored V2 Wallet Session capability subjects disagree with record');
  }
  if (session.tenantId !== input.tenantId) {
    throw new Error('Stored V2 Wallet Session tenant does not match the request');
  }
  const quota = parseExactWalletSessionQuotaProjectionRow(row, session);
  if (session.expiresAtMs <= nowMs) return unjudged({ kind: 'expired', session, quota });

  if (row.session_retired_at_ms !== null && row.session_retired_at_ms !== undefined) {
    return unjudged({
      kind: 'retired',
      session,
      quota,
      retiredAtMs: requirePositiveInteger(row.session_retired_at_ms, 'V2 session.retiredAtMs'),
    });
  }

  // The authority and method come from the same row as the session: a
  // separate read could see an authority committed after the session read.
  const joined = await joinedAuthorityAndMethod(row);
  const judged = (status: ExactWalletSessionStatusV2): ExactWalletSessionStatusSnapshotV2 => ({
    status,
    ...joined,
  });
  if (quota.lifecycle === 'exhausted') return judged({ kind: 'exhausted', session, quota });

  const authority = joined.authority;
  if (!authority) return judged({ kind: 'authority_unavailable', session, quota });
  if (
    authority.authorityId !== session.authorityId ||
    authority.walletId !== session.walletId ||
    authority.state !== row.authority_lifecycle_state ||
    authority.authorityDigestB64u !== row.authority_digest_b64u ||
    authority.revocationEpoch !==
      integerColumn(row.authority_revocation_epoch, 'authority.revocationEpoch')
  ) {
    throw new Error('Stored V2 Wallet Session authority identity does not match the record');
  }
  if (
    authority.authorityId !== session.authorityId ||
    authority.walletId !== session.walletId ||
    authority.authorityDigestB64u !== session.authorityDigestB64u ||
    authority.revocationEpoch !== session.authorityRevocationEpoch ||
    authority.state !== 'active'
  ) {
    return judged({ kind: 'authority_unavailable', session, quota });
  }

  if (row.auth_method_id === null || row.auth_method_id === undefined) {
    return judged({ kind: 'method_unavailable', session, quota });
  }
  if (
    row.auth_method_id !== String(session.walletAuthMethodId) ||
    row.auth_method_wallet_id !== String(session.walletId) ||
    row.auth_method_authority_id !== String(session.authorityId)
  ) {
    throw new Error('Stored V2 Wallet Session auth method identity does not match the record');
  }
  if (row.auth_method_status !== 'active') {
    return judged({ kind: 'method_unavailable', session, quota });
  }

  if (
    !exactWalletSessionCapabilitySubjectsResolveAuthority({
      session,
      signerActivations: authority.signerActivations,
    })
  ) {
    return judged({ kind: 'capability_unavailable', session, quota });
  }
  if (
    !(await exactWalletSessionCapabilitySubjectsResolveMaterial(
      context,
      session,
      parseD1JsonColumn(row.status_ecdsa_material_records_json),
    ))
  ) {
    return judged({ kind: 'capability_unavailable', session, quota });
  }
  return judged({ kind: 'active', session, quota });
}

async function exactWalletSessionCapabilitySubjectsResolveMaterial(
  context: D1AuthorizationContext,
  session: WalletSessionAuthorizationV2,
  ecdsaMaterialRows: unknown,
): Promise<boolean> {
  const materials: SessionStatusMaterialSubject[] = [];
  for (const subject of session.capabilitySubjects) {
    switch (subject.kind) {
      case 'sign':
      case 'export_keys': {
        const alreadyRead = materials.some(
          (material) =>
            material.keyFamily === subject.keyFamily &&
            mpcMaterialActivationRefsEqual(material.materialActivation, subject.materialActivation),
        );
        if (!alreadyRead) {
          if (subject.keyFamily === 'ed25519') {
            materials.push({
              keyFamily: 'ed25519',
              materialActivation: subject.materialActivation,
            });
          } else {
            materials.push({
              keyFamily: 'ecdsa_secp256k1',
              materialActivation: subject.materialActivation,
              materialRead: EcdsaMaterialRead.fromRows(
                context.walletSignerScope,
                session.walletId,
                routerAbMpcMaterialActivationRefToWire(subject.materialActivation),
                ecdsaMaterialRows,
                null,
              ),
            });
          }
        }
        break;
      }
      case 'link_devices':
      case 'revoke_devices':
        break;
      default:
        return false;
    }
  }
  const resolved = await Promise.all(
    materials.map(exactWalletSessionMaterialResolves.bind(null, context, session.walletId)),
  );
  return resolved.every(Boolean);
}

async function exactWalletSessionMaterialResolves(
  context: D1AuthorizationContext,
  walletId: WalletId,
  subject: SessionStatusMaterialSubject,
): Promise<boolean> {
  const materialActivation = routerAbMpcMaterialActivationRefToWire(subject.materialActivation);
  const signer =
    subject.keyFamily === 'ed25519'
      ? await context.walletStore.getEd25519SignerByMaterialActivation({
          walletId,
          materialActivation,
        })
      : subject.materialRead.resolve(context.walletSignerScope, walletId, materialActivation)
          ?.signer;

  if (!signer) {
    // Linked-device material lives on its installed authority projection.
    return (await readLinkedAuthorityMaterial(context, walletId, subject)) !== null;
  }
  if (signer.walletId !== walletId) {
    throw new Error('Stored wallet signer material identity does not match the session');
  }
  return true;
}

async function readLinkedAuthorityMaterial(
  context: D1AuthorizationContext,
  walletId: WalletId,
  subject: {
    readonly keyFamily: 'ed25519' | 'ecdsa_secp256k1';
    readonly materialActivation: MpcMaterialActivationRef;
  },
): Promise<D1AuthorizationLinkedAuthorityMaterialProjection | null> {
  const reader = context.getLinkedDeviceAuthorityReader();
  if (!reader) return null;
  const projection =
    subject.keyFamily === 'ed25519'
      ? await reader.readInstalledEd25519AuthorityByMaterialActivationV1({
          walletId,
          materialActivation: subject.materialActivation,
        })
      : await reader.readInstalledEcdsaAuthorityByMaterialActivationV1({
          walletId,
          materialActivation: subject.materialActivation,
        });
  if (!projection) return null;
  if (projection.walletId !== String(walletId)) {
    throw new Error('Installed linked authority material identity does not match the session');
  }
  if (
    !sameRouterAbMpcMaterialActivationRef(
      routerAbMpcMaterialActivationRefToWire(projection.materialActivation),
      routerAbMpcMaterialActivationRefToWire(subject.materialActivation),
    )
  ) {
    throw new Error('Installed linked authority material does not match the session subject');
  }
  return projection;
}

async function readJoinedWalletSessionAuthorizationV2Row(
  context: D1AuthorizationContext,
  input: {
    readonly projection:
      | { readonly kind: 'session' | 'session_status'; readonly materialActivation?: never }
      | {
          readonly kind: 'ecdsa_material' | 'ed25519_material';
          readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
        };
    readonly lookupColumn: 'mint_id' | 'authorization_id' | 'operation_credential_hash';
    readonly tenantId: unknown;
    readonly lookupValue: unknown;
  },
): Promise<D1Row | null> {
  const installationProjection =
    ECDSA_INSTALLATION_SNAPSHOT_COLUMNS.map(installationJsonColumn).join(', ');
  let materialProjection = '';
  let materialBindings: readonly string[] = [];
  if (input.projection.kind === 'ecdsa_material') {
    materialProjection = `
           (SELECT json_group_array(json_object('record_json', signer.record_json))
              FROM wallet_signers AS signer
             WHERE signer.namespace = session.namespace
               AND signer.org_id = session.org_id
               AND signer.project_id = session.project_id
               AND signer.env_id = session.env_id
               AND signer.wallet_id = session.wallet_id
               AND signer.signer_family = 'ecdsa'
               AND CASE WHEN json_valid(signer.record_json) THEN
                 json_extract(signer.record_json,
                   '$.walletKey.publicCapability.material_activation.activation_id') = ?
                 ELSE 1 END
           ) AS ecdsa_material_records_json,
           CASE WHEN authority.provenance_kind = 'device_link' THEN
             (SELECT json_group_array(json_object(${installationProjection}))
                FROM linked_device_authority_installations AS installation
               WHERE installation.namespace = session.namespace
                 AND installation.org_id = session.org_id
                 AND installation.project_id = session.project_id
                 AND installation.env_id = session.env_id
                 AND installation.wallet_id = session.wallet_id)
           END AS ecdsa_installations_json,
           CASE WHEN authority.provenance_kind = 'device_link' THEN
             (SELECT json_group_array(json_object('record_json', source_signer.record_json))
                FROM wallet_signers AS source_signer
               WHERE source_signer.namespace = session.namespace
                 AND source_signer.org_id = session.org_id
                 AND source_signer.project_id = session.project_id
                 AND source_signer.env_id = session.env_id
                 AND source_signer.wallet_id = session.wallet_id
                 AND source_signer.signer_family = 'ecdsa')
           END AS ecdsa_source_signers_json,
           ${ECDSA_CREDENTIAL_POLICY_PROJECTION}`;
    materialBindings = [
      input.projection.materialActivation.activation_id,
      input.projection.materialActivation.activation_id,
    ];
  } else if (input.projection.kind === 'ed25519_material') {
    // The wallet store reads Ed25519 signers under the configured signer scope.
    const signerScope = [
      context.walletSignerScope.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
    ];
    materialProjection = `
           (SELECT json_group_array(json_object('record_json', signer.record_json))
              FROM wallet_signers AS signer
             WHERE signer.namespace = ? AND signer.org_id = ?
               AND signer.project_id = ? AND signer.env_id = ?
               AND signer.wallet_id = session.wallet_id
               AND signer.signer_family = 'ed25519'
               AND CASE WHEN json_valid(signer.record_json) THEN
                 json_extract(signer.record_json, '${ED25519_SIGNER_ACTIVATION_ID_PATH}') = ?
                 ELSE 0 END
           ) AS ed25519_material_records_json,
           ${ED25519_CREDENTIAL_POLICY_PROJECTION}`;
    materialBindings = [
      ...signerScope,
      input.projection.materialActivation.activation_id,
      ...signerScope,
      input.projection.materialActivation.activation_id,
    ];
  } else if (input.projection.kind === 'session_status') {
    // Canonical ECDSA material shares the status snapshot. The configured
    // signer scope may use a different namespace from session storage.
    materialProjection = `
        (SELECT json_group_array(json_object('record_json', signer.record_json))
           FROM wallet_signers AS signer
          WHERE signer.namespace = ? AND signer.org_id = ?
            AND signer.project_id = ? AND signer.env_id = ?
            AND signer.wallet_id = session.wallet_id
            AND signer.signer_family = 'ecdsa'
        ) AS status_ecdsa_material_records_json,`;
    materialBindings = [
      context.walletSignerScope.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
    ];
  }
  return await context.database
    .prepare(
      `SELECT ${materialProjection}
           authority.*,
           (SELECT execution.generation FROM wallet_execution_generations AS execution
             WHERE execution.namespace = session.namespace
               AND execution.org_id = session.org_id
               AND execution.project_id = session.project_id
               AND execution.env_id = session.env_id
               AND execution.wallet_id = session.wallet_id
               AND execution.state = 'active') AS execution_generation,
           session.namespace AS session_namespace,
           session.record_json AS session_record_json,
           session.capability_subjects_json AS session_capability_subjects_json,
           session.tenant_id AS session_tenant_id,
           session.authorization_id AS session_authorization_id,
           session.mint_id AS session_mint_id,
           session.wallet_session_id AS session_wallet_session_id,
           session.quota_id AS session_quota_id,
           session.principal_id AS session_principal_id,
           session.wallet_id AS session_wallet_id,
           session.org_id AS session_org_id,
           session.project_id AS session_project_id,
           session.env_id AS session_env_id,
           session.authority_id AS session_authority_id,
           session.wallet_auth_method_id AS session_wallet_auth_method_id,
           session.authority_digest_b64u AS session_authority_digest_b64u,
           session.authority_revocation_epoch AS session_authority_revocation_epoch,
           session.issued_at_ms AS session_issued_at_ms,
           session.expires_at_ms AS session_expires_at_ms,
           session.retired_at_ms AS session_retired_at_ms,
           authority.wallet_id AS authority_wallet_id,
           authority.lifecycle_state AS authority_lifecycle_state,
           authority.authority_digest_b64u AS authority_digest_b64u,
           authority.revocation_epoch AS authority_revocation_epoch,
           authority.signer_activations_json AS authority_signer_activations_json,
           auth_method.record_json AS auth_method_record_json,
           auth_method.wallet_auth_method_id AS auth_method_id,
           auth_method.wallet_id AS auth_method_wallet_id,
           auth_method.wallet_authority_id AS auth_method_authority_id,
           auth_method.status AS auth_method_status,
           quota.tenant_id AS quota_tenant_id,
           quota.principal_id AS quota_principal_id,
           quota.wallet_session_id AS quota_wallet_session_id,
           quota.quota_id AS quota_id,
           quota.remaining_uses AS quota_remaining_uses,
           quota.lifecycle_kind AS quota_lifecycle_kind,
           quota.expires_at_ms AS quota_expires_at_ms
         FROM wallet_session_authorizations_v2 AS session
         LEFT JOIN wallet_authorities AS authority
           ON authority.namespace = session.namespace
          AND authority.org_id = ?
          AND authority.project_id = ?
          AND authority.env_id = ?
          AND authority.authority_id = session.authority_id
          AND authority.wallet_id = session.wallet_id
         LEFT JOIN wallet_auth_methods AS auth_method
           ON auth_method.namespace = session.namespace
          AND auth_method.org_id = ?
          AND auth_method.project_id = ?
          AND auth_method.env_id = ?
          AND auth_method.wallet_auth_method_id = session.wallet_auth_method_id
          AND auth_method.wallet_id = session.wallet_id
          AND auth_method.wallet_authority_id = session.authority_id
         LEFT JOIN authorization_wallet_session_quotas AS quota
           ON quota.namespace = session.namespace
          AND quota.tenant_id = session.tenant_id
          AND quota.quota_id = session.quota_id
        WHERE session.namespace = ?
          AND session.org_id = ?
          AND session.project_id = ?
          AND session.env_id = ?
          AND session.tenant_id = ?
          AND session.${input.lookupColumn} = ?
        LIMIT 1`,
    )
    .bind(
      ...materialBindings,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      context.namespace,
      context.walletSignerScope.orgId,
      context.walletSignerScope.projectId,
      context.walletSignerScope.envId,
      input.tenantId,
      input.lookupValue,
    )
    .first<D1Row>();
}

async function readWalletSessionAuthorizationV2(
  context: D1AuthorizationContext,
  input: WalletSessionAuthorizationV2Read,
  lookupColumn: 'mint_id' | 'authorization_id' | 'operation_credential_hash',
): Promise<IssuedWalletSessionAuthorizationV2 | null> {
  const lookup = 'expected' in input ? input.expected : 'identity' in input ? input.identity : null;
  const operationCredentialHash =
    'operationCredentialHash' in input ? input.operationCredentialHash : null;
  const row = await readJoinedWalletSessionAuthorizationV2Row(context, {
    projection: { kind: 'session' },
    lookupColumn,
    tenantId: 'operationCredentialHash' in input ? input.tenantId : lookup?.tenantId,
    lookupValue:
      lookupColumn === 'mint_id'
        ? String('expected' in input ? input.expected.mintId : lookup?.authorizationId)
        : lookupColumn === 'authorization_id'
          ? String(lookup?.authorizationId)
          : operationCredentialHash,
  });
  if (!row) return null;
  const session = parseLiveWalletSessionAuthorizationV2Row(row, input);
  const quota = parseWalletSessionAuthorizationV2QuotaRow(row, session);
  return { session, quota };
}
