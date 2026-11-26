import type { WalletId } from '@shared/utils/domainIds';
import {
  sameRouterAbMpcMaterialActivationRef,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { isPlainObject } from '@shared/utils/validation';
import { selectWalletEd25519Signer } from './d1WalletStore';
import type { WalletEd25519SignerRecord } from './WalletStore';

type SignerReadResult =
  | { readonly ok: true; readonly signer: WalletEd25519SignerRecord | null }
  | { readonly ok: false; readonly message: string };

/** Signer rows read with a Wallet Session; a failure surfaces after session validation. */
export class Ed25519SignerRead {
  readonly #result: SignerReadResult;

  private constructor(
    private readonly walletId: WalletId,
    private readonly activation: RouterAbMpcMaterialActivationRefWire,
    result: SignerReadResult,
  ) {
    this.#result = result;
  }

  static fromRows(
    walletId: WalletId,
    activation: RouterAbMpcMaterialActivationRefWire,
    rows: unknown,
  ): Ed25519SignerRead {
    let result: SignerReadResult;
    try {
      if (!Array.isArray(rows) || !rows.every(isPlainObject)) {
        throw new Error('Ed25519 material rows are invalid');
      }
      result = { ok: true, signer: selectWalletEd25519Signer(rows, walletId, activation) };
    } catch (error: unknown) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : 'Ed25519 material read failed',
      };
    }
    return new Ed25519SignerRead(walletId, activation, result);
  }

  /** The session wallet's signer for the activation this read selected, or null. */
  resolve(
    walletId: WalletId,
    activation: RouterAbMpcMaterialActivationRefWire,
  ): WalletEd25519SignerRecord | null {
    if (
      walletId !== this.walletId ||
      !sameRouterAbMpcMaterialActivationRef(activation, this.activation)
    ) {
      throw new Error('Ed25519 material read does not match the requested activation');
    }
    if (!this.#result.ok) throw new Error(this.#result.message);
    return this.#result.signer;
  }
}
