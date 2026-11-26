import type { ThresholdRuntimePolicyScope } from './types';
import { isObject, toOptionalTrimmedString } from '@shared/utils/validation';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import { prepareD1TenantStatement, type D1TenantScope } from './d1TenantStore';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';

/**
 * The Ed25519 facts on a credential binding are denormalized from the wallet's
 * Ed25519 signer row. A passkey wallet can exist before its Ed25519 Yao
 * ceremony has settled (non-blocking provisioning), so they are absent until
 * that signer is committed. They are written together or not at all — a
 * binding never carries a partial Ed25519 identity.
 */
type WebAuthnCredentialBindingEd25519Facts = {
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  signerSlot: number;
  /** NEAR ed25519 public key (e.g. `ed25519:...`). In threshold-signer mode, this is the group public key. */
  publicKey: string;
};

/** Present only once the wallet's Ed25519 signer is committed. */
type WebAuthnCredentialBindingEd25519Present = WebAuthnCredentialBindingEd25519Facts;

/** Absent as a set, so a partial Ed25519 identity cannot be constructed. */
type WebAuthnCredentialBindingEd25519Absent = {
  [K in keyof WebAuthnCredentialBindingEd25519Facts]?: never;
};

type WebAuthnCredentialBindingBase = {
  version: 'webauthn_credential_binding_v1';
  rpId: string;
  credentialIdB64u: string;
  userId: string;
  /** Threshold relayer key id (often equal to `publicKey`). */
  relayerKeyId?: string;
  keyVersion?: string;
  recoveryExportCapable?: boolean;
  clientParticipantId?: number;
  relayerParticipantId?: number;
  participantIds?: number[];
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WebAuthnCredentialBindingRecord = WebAuthnCredentialBindingBase &
  (WebAuthnCredentialBindingEd25519Present | WebAuthnCredentialBindingEd25519Absent);

export interface WebAuthnCredentialBindingStore {
  get(rpId: string, credentialIdB64u: string): Promise<WebAuthnCredentialBindingRecord | null>;
  put(record: WebAuthnCredentialBindingRecord): Promise<void>;
  del(rpId: string, credentialIdB64u: string): Promise<void>;
  getMaxSignerSlot?(input: { userId: string; rpId?: string }): Promise<number | null>;
  /**
   * List credential bindings for a user (optionally scoped to an RP ID).
   *
   * Optional because not all backing stores can efficiently enumerate keys.
   */
  listByUserId?(input: {
    userId: string;
    rpId?: string;
  }): Promise<WebAuthnCredentialBindingRecord[]>;
}

type D1WebAuthnCredentialBindingWrite = {
  readonly database: D1DatabaseLike;
  readonly scope: D1TenantScope;
  readonly record: WebAuthnCredentialBindingRecord;
};

const INSERT_CREDENTIAL_BINDING_SQL = `INSERT INTO webauthn_credential_bindings (
        namespace,
        org_id,
        project_id,
        env_id,
        rp_id,
        credential_id_b64u,
        user_id,
        signer_slot,
        record_json,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function prepareCredentialBindingWrite(
  input: D1WebAuthnCredentialBindingWrite,
  sql: string,
): D1PreparedStatementLike {
  const parsed = parseWebAuthnCredentialBindingRecord(input.record);
  if (!parsed) throw new Error('Invalid credential binding record');
  return prepareD1TenantStatement(input.database, input.scope, sql, [
    parsed.rpId,
    parsed.credentialIdB64u,
    parsed.userId,
    parsed.signerSlot ?? null,
    JSON.stringify(parsed),
    parsed.createdAtMs,
    parsed.updatedAtMs,
  ]);
}

export function prepareD1WebAuthnCredentialBindingPutStatement(
  input: D1WebAuthnCredentialBindingWrite,
): D1PreparedStatementLike {
  return prepareCredentialBindingWrite(
    input,
    `${INSERT_CREDENTIAL_BINDING_SQL}
      ON CONFLICT (namespace, org_id, project_id, env_id, rp_id, credential_id_b64u)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        signer_slot = EXCLUDED.signer_slot,
        -- Reads parse record_json, not the columns, so the JSON has to carry
        -- the same reconciled timestamps the columns do. Replacing it wholesale
        -- let a second write (the Ed25519 commit, or an out-of-order replay)
        -- appear to reset createdAtMs and regress updatedAtMs while the columns
        -- stayed correct.
        record_json = json_set(
          EXCLUDED.record_json,
          '$.createdAtMs',
          MIN(webauthn_credential_bindings.created_at_ms, EXCLUDED.created_at_ms),
          '$.updatedAtMs',
          MAX(webauthn_credential_bindings.updated_at_ms, EXCLUDED.updated_at_ms)
        ),
        created_at_ms = MIN(
          webauthn_credential_bindings.created_at_ms,
          EXCLUDED.created_at_ms
        ),
        updated_at_ms = MAX(
          webauthn_credential_bindings.updated_at_ms,
          EXCLUDED.updated_at_ms
        )`,
  );
}

/** Insert-only binding write for credential promotion. */
export function prepareD1WebAuthnCredentialBindingInsertStatement(
  input: D1WebAuthnCredentialBindingWrite,
): D1PreparedStatementLike {
  return prepareCredentialBindingWrite(input, INSERT_CREDENTIAL_BINDING_SQL);
}

function parseWebAuthnCredentialBindingRecord(
  raw: unknown,
): WebAuthnCredentialBindingRecord | null {
  if (!isObject(raw)) return null;
  const version = toOptionalTrimmedString(raw.version);
  const rpId = toOptionalTrimmedString(raw.rpId);
  const credentialIdB64u = toOptionalTrimmedString(raw.credentialIdB64u);
  const userId = toOptionalTrimmedString(raw.userId);
  const nearAccountId = toOptionalTrimmedString(raw.nearAccountId);
  const nearEd25519SigningKeyId = toOptionalTrimmedString(raw.nearEd25519SigningKeyId);
  const publicKey = toOptionalTrimmedString(raw.publicKey);
  const signerSlotRaw = raw.signerSlot;
  const signerSlot = typeof signerSlotRaw === 'number' ? signerSlotRaw : Number(signerSlotRaw);
  const createdAtMsRaw = raw.createdAtMs;
  const updatedAtMsRaw = raw.updatedAtMs;
  const createdAtMs = typeof createdAtMsRaw === 'number' ? createdAtMsRaw : Number(createdAtMsRaw);
  const updatedAtMs = typeof updatedAtMsRaw === 'number' ? updatedAtMsRaw : Number(updatedAtMsRaw);

  if (version !== 'webauthn_credential_binding_v1') return null;
  if (!rpId || !credentialIdB64u || !userId) return null;
  /* Ed25519 facts are all-or-nothing. Absent means the wallet's Yao ceremony
     has not settled; a partial set means a corrupt record and is rejected.
     Resolved into one typed value so the record type's union stays the only
     way to express presence. */
  const hasAnyEd25519Fact =
    Boolean(nearAccountId || nearEd25519SigningKeyId || publicKey) || Number.isFinite(signerSlot);
  let ed25519Facts: WebAuthnCredentialBindingEd25519Facts | null = null;
  if (hasAnyEd25519Fact) {
    if (!nearAccountId || !nearEd25519SigningKeyId || !publicKey) return null;
    if (!Number.isFinite(signerSlot) || signerSlot < 1) return null;
    ed25519Facts = {
      nearAccountId,
      nearEd25519SigningKeyId,
      signerSlot: Math.floor(signerSlot),
      publicKey,
    };
  }
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;

  const relayerKeyId = toOptionalTrimmedString(raw.relayerKeyId);
  const keyVersion = toOptionalTrimmedString(raw.keyVersion);
  const recoveryExportCapable =
    typeof raw.recoveryExportCapable === 'boolean' ? Boolean(raw.recoveryExportCapable) : undefined;
  const clientParticipantIdRaw = raw.clientParticipantId;
  const relayerParticipantIdRaw = raw.relayerParticipantId;
  const clientParticipantId =
    typeof clientParticipantIdRaw === 'number'
      ? clientParticipantIdRaw
      : Number(clientParticipantIdRaw);
  const relayerParticipantId =
    typeof relayerParticipantIdRaw === 'number'
      ? relayerParticipantIdRaw
      : Number(relayerParticipantIdRaw);
  const participantIdsRaw = raw.participantIds;
  const participantIds = Array.isArray(participantIdsRaw)
    ? participantIdsRaw
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((n) => Number.isFinite(n) && n >= 1)
        .map((n) => Math.floor(n))
    : null;
  const runtimePolicyScopeRaw = raw.runtimePolicyScope;
  const runtimePolicyScope = isObject(runtimePolicyScopeRaw)
    ? (() => {
        try {
          return normalizeRuntimePolicyScope(runtimePolicyScopeRaw) satisfies ThresholdRuntimePolicyScope;
        } catch {
          return null;
        }
      })()
    : null;

  const base: WebAuthnCredentialBindingBase = {
    version: 'webauthn_credential_binding_v1',
    rpId,
    credentialIdB64u,
    userId,
    ...(relayerKeyId ? { relayerKeyId } : {}),
    ...(keyVersion ? { keyVersion } : {}),
    ...(typeof recoveryExportCapable === 'boolean' ? { recoveryExportCapable } : {}),
    ...(Number.isFinite(clientParticipantId) && clientParticipantId >= 1
      ? { clientParticipantId: Math.floor(clientParticipantId) }
      : {}),
    ...(Number.isFinite(relayerParticipantId) && relayerParticipantId >= 1
      ? { relayerParticipantId: Math.floor(relayerParticipantId) }
      : {}),
    ...(participantIds && participantIds.length ? { participantIds } : {}),
    ...(runtimePolicyScope ? { runtimePolicyScope } : {}),
    createdAtMs: Math.floor(createdAtMs),
    updatedAtMs: Math.floor(updatedAtMs),
  };
  // Spreading the facts selects the union's present branch; omitting them
  // selects the absent branch. A partial spread cannot type-check.
  return ed25519Facts ? { ...base, ...ed25519Facts } : base;
}
