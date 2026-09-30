import { isPlainObject } from '@shared/utils/validation';
import {
  sameRouterAbMpcMaterialActivationRef,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { EcdsaMaterialReadSnapshot } from './ecdsaMaterialReadSnapshot';
import type { WalletId } from '@shared/utils/domainIds';
import type { D1WalletStoreScope } from './d1WalletStore';
import { parseWalletEcdsaSignerRecord, type WalletEcdsaSignerRecord } from './WalletStore';
import { parseD1JsonColumn } from '../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';

export function prepareWalletEcdsaSignersRead(
  database: D1DatabaseLike,
  scope: D1WalletStoreScope,
  walletId: WalletId,
): D1PreparedStatementLike {
  return database.prepare(
    `SELECT record_json FROM wallet_signers
      WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
        AND wallet_id = ? AND signer_family = 'ecdsa'
      ORDER BY signer_id`,
  ).bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId);
}

export function parseWalletEcdsaSignerRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  walletId: WalletId,
): readonly WalletEcdsaSignerRecord[] {
  const signers: WalletEcdsaSignerRecord[] = [];
  for (const row of rows) {
    const signer = parseWalletEcdsaSignerRecord(parseD1JsonColumn(row.record_json));
    if (!signer || signer.walletId !== walletId) {
      throw new Error('Wallet ECDSA signer record is invalid');
    }
    signers.push(signer);
  }
  return signers;
}

/** Parsed persistence evidence; material failures are surfaced after session validation. */
export class EcdsaCanonicalMaterialRead {
  readonly #result: CanonicalMaterialReadResult;

  private constructor(
    readonly walletId: WalletId,
    private readonly scope: D1WalletStoreScope,
    private readonly activation: RouterAbMpcMaterialActivationRefWire,
    result: CanonicalMaterialReadResult,
  ) {
    this.#result = result;
  }

  static fromRows(
    scope: D1WalletStoreScope,
    walletId: WalletId,
    activation: RouterAbMpcMaterialActivationRefWire,
    rows: unknown,
  ): EcdsaCanonicalMaterialRead {
    try {
      if (!Array.isArray(rows)) throw new Error('ECDSA material rows are invalid');
      const storedRows: { readonly record_json: string }[] = [];
      const matches: WalletEcdsaSignerRecord[] = [];
      for (const raw of rows) {
        if (!isPlainObject(raw) || typeof raw.record_json !== 'string') {
          throw new Error('ECDSA material row is invalid');
        }
        storedRows.push({ record_json: raw.record_json });
        const signer = parseWalletEcdsaSignerRecord(parseD1JsonColumn(raw.record_json));
        if (
          signer && signer.walletId === walletId && sameRouterAbMpcMaterialActivationRef(
            signer.walletKey.publicCapability.material_activation, activation,
          )
        ) {
          matches.push(signer);
        }
      }
      const signer = matches[0];
      if (!signer) {
        return new EcdsaCanonicalMaterialRead(walletId, scope, activation, { ok: true, value: null });
      }
      for (const other of matches) {
        if (!signer.walletKey.keyHandle || other.walletKey.keyHandle !== signer.walletKey.keyHandle) {
          throw new Error('Wallet has conflicting ECDSA material activations');
        }
      }
      return new EcdsaCanonicalMaterialRead(walletId, scope, activation, {
        ok: true,
        value: {
          signer,
          readSnapshot: EcdsaMaterialReadSnapshot.canonical(
            scope, walletId, activation.activation_id, storedRows,
          ),
        },
      });
    } catch (error: unknown) {
      return new EcdsaCanonicalMaterialRead(walletId, scope, activation, {
        ok: false,
        message: error instanceof Error ? error.message : 'ECDSA material read failed',
      });
    }
  }

  resolve(
    scope: D1WalletStoreScope,
    walletId: WalletId,
    activation: RouterAbMpcMaterialActivationRefWire,
  ): CanonicalMaterialSnapshot | null {
    if (
      walletId !== this.walletId || !sameRouterAbMpcMaterialActivationRef(activation, this.activation) ||
      scope.namespace !== this.scope.namespace || scope.orgId !== this.scope.orgId ||
      scope.projectId !== this.scope.projectId || scope.envId !== this.scope.envId
    ) {
      throw new Error('ECDSA material read scope does not match');
    }
    if (!this.#result.ok) throw new Error(this.#result.message);
    return this.#result.value;
  }
}

type CanonicalMaterialSnapshot = {
  readonly signer: WalletEcdsaSignerRecord;
  readonly readSnapshot: EcdsaMaterialReadSnapshot;
};

type CanonicalMaterialReadResult =
  | { readonly ok: true; readonly value: CanonicalMaterialSnapshot | null }
  | { readonly ok: false; readonly message: string };

export type EcdsaMaterialReadSource =
  | { readonly kind: 'database'; readonly canonicalMaterial?: never }
  | { readonly kind: 'credential_snapshot'; readonly canonicalMaterial: EcdsaCanonicalMaterialRead };

export type EcdsaMaterialActivationReadInput = {
  readonly walletId: string;
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly source: EcdsaMaterialReadSource;
};
