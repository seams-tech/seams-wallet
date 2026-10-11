import type { WalletId } from '@shared/utils/domainIds';
import {
  sameRouterAbMpcMaterialActivationRef,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { isPlainObject } from '@shared/utils/validation';
import { selectWalletEd25519Signer } from './d1WalletStore';
import type { WalletEd25519SignerRecord } from './WalletStore';
import { parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1 } from '../router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';
import type { RouterAbEd25519YaoProductRegistrationSharedStateV1 } from '../router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitioning';
import {
  resolveRouterAbEd25519YaoActiveCapability,
  type RouterAbEd25519YaoActiveCapabilityLookupV1,
} from '../router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';

type SignerReadResult =
  | { readonly ok: true; readonly signer: WalletEd25519SignerRecord | null }
  | { readonly ok: false; readonly message: string };

type CapabilitySnapshot = RouterAbEd25519YaoProductRegistrationSharedStateV1['recoveryCapabilities'];

/** Signer rows read with a Wallet Session; a failure surfaces after session validation. */
export class Ed25519SignerRead {
  readonly #result: SignerReadResult;

  private constructor(
    private readonly walletId: WalletId,
    private readonly activation: RouterAbMpcMaterialActivationRefWire,
    result: SignerReadResult,
    private readonly capabilities: CapabilitySnapshot | null,
  ) {
    this.#result = result;
  }

  static fromRows(
    walletId: WalletId,
    activation: RouterAbMpcMaterialActivationRefWire,
    rows: unknown,
    capabilityPartition: unknown,
  ): Ed25519SignerRead {
    let result: SignerReadResult;
    let capabilities: CapabilitySnapshot | null = null;
    try {
      if (!Array.isArray(rows) || !rows.every(isPlainObject)) {
        throw new Error('Ed25519 material rows are invalid');
      }
      result = { ok: true, signer: selectWalletEd25519Signer(rows, walletId, activation) };
      if (capabilityPartition !== null) {
        const partition =
          parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(capabilityPartition);
        if (partition?.kind !== 'router_ab_ed25519_yao_product_registration_shared_record_v1') {
          throw new Error('Ed25519 capability partition is invalid');
        }
        capabilities = partition.value.recoveryCapabilities;
      }
    } catch (error: unknown) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : 'Ed25519 material read failed',
      };
    }
    return new Ed25519SignerRead(walletId, activation, result, capabilities);
  }

  resolveActiveCapability(input: RouterAbEd25519YaoActiveCapabilityLookupV1) {
    if (input.walletId !== this.walletId) {
      throw new Error('Ed25519 capability read belongs to another wallet');
    }
    if (!this.#result.ok) throw new Error(this.#result.message);
    if (!this.capabilities) return null;
    const result = resolveRouterAbEd25519YaoActiveCapability(this.capabilities, input);
    // Missing entries retain the runtime's persisted-capability reconciliation.
    return !result.ok && result.code === 'unknown_capability' ? null : result;
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
