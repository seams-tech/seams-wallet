import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { requireVisibleIdentifier } from '@shared/utils/routerAbEd25519YaoDigests';
import { requireRecord } from '@shared/utils/validation';
import type { RouterAbEd25519YaoRecoveryAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';

export class WalletLifecycleLocator {
  readonly #validated = true;
  private constructor(
    readonly kind: 'yao_recovery' | 'yao_export',
    readonly value: string,
  ) {
    Object.freeze(this);
  }

  matches(other: WalletLifecycleLocator): boolean {
    return (
      this.#validated && other.#validated && this.kind === other.kind && this.value === other.value
    );
  }

  static parse(raw: unknown): WalletLifecycleLocator {
    const record = requireRecord(raw, 'lifecycle locator');
    if (
      Object.keys(record).length !== 2 ||
      (record.kind !== 'yao_recovery' && record.kind !== 'yao_export')
    ) {
      throw new Error('Invalid lifecycle locator');
    }
    return new WalletLifecycleLocator(
      record.kind,
      requireVisibleIdentifier(record.value, 'lifecycle ID'),
    );
  }
}

export interface WalletLifecycleRoutingPublisher {
  publishLifecycle(input: {
    readonly walletId: WalletId;
    readonly locator: WalletLifecycleLocator;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: 'locator_conflict' }>;
}

type PublicationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 409 | 503;
      readonly code: string;
      readonly message: string;
    };

export async function publishWalletLifecycleHome(
  publisher: WalletLifecycleRoutingPublisher | null,
  kind: WalletLifecycleLocator['kind'],
  admission: Pick<RouterAbEd25519YaoRecoveryAdmissionRequestV1, 'scope' | 'application_binding'>,
): Promise<PublicationResult> {
  if (!publisher) return { ok: true };
  const wallet = parseWalletId(admission.application_binding.wallet_id);
  if (!wallet.ok)
    return {
      ok: false,
      status: 409,
      code: 'wallet_home_conflict',
      message: 'Lifecycle wallet identity is invalid',
    };
  try {
    const published = await publisher.publishLifecycle({
      walletId: wallet.value,
      locator: WalletLifecycleLocator.parse({ kind, value: admission.scope.lifecycle_id }),
    });
    if (!published.ok)
      return {
        ok: false,
        status: 409,
        code: 'wallet_home_conflict',
        message: 'Lifecycle belongs to another wallet home',
      };
    return { ok: true };
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'wallet_home_unavailable',
      message: 'Lifecycle home publication is unavailable',
    };
  }
}
