import { toOptionalTrimmedString } from '@shared/utils/validation';
import type { MpcMaterialActivationId } from '@shared/utils/domainIds';
import { type RouterAbNormalSigningServerPolicy } from '../ThresholdService/routerAbNormalSigningPolicy';
import type {
  Ed25519WalletSessionStore,
  EcdsaWalletSessionStore,
} from '../ThresholdService/stores/WalletSessionStore';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type RouterAbSigningWorkerPrivateTransport = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'configured';
      readonly signingWorkerBaseUrl: string;
      readonly auth: {
        readonly kind: 'internal_service_auth_secret';
        readonly secret: string;
      };
      readonly fetchImpl?: typeof fetch;
    }
  | { readonly kind: 'unconfigured' }
>;

export type RouterAbConfiguredSigningWorkerPrivateTransport = Extract<
  RouterAbSigningWorkerPrivateTransport,
  { readonly kind: 'configured' }
>;

type RouterAbNormalSigningRuntimeConfig = {
  readonly policy: RouterAbNormalSigningServerPolicy;
  readonly signingWorkerTransport: RouterAbSigningWorkerPrivateTransport;
};

export type RouterAbNormalSigningAuthorizationIdentity =
  | {
      readonly kind: 'reusable_wallet_session';
      readonly walletSessionId: string;
    }
  | {
      readonly kind: 'operation_step_up';
      readonly materialActivationId: MpcMaterialActivationId;
    };

type RouterAbNormalSigningPrepareReplayReservationInput = {
  readonly curve: 'ed25519' | 'ecdsa';
  readonly authorizationIdentity: RouterAbNormalSigningAuthorizationIdentity;
  readonly requestId: string;
  readonly expiresAtMs: number;
};

type RouterAbNormalSigningPrepareReplayReservationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

export class RouterAbNormalSigningRuntime {
  private readonly walletSessionStore: Ed25519WalletSessionStore;
  private readonly ecdsaWalletSessionStore: EcdsaWalletSessionStore;
  private readonly config: RouterAbNormalSigningRuntimeConfig;

  constructor(input: {
    readonly walletSessionStore: Ed25519WalletSessionStore;
    readonly ecdsaWalletSessionStore: EcdsaWalletSessionStore;
    readonly config: RouterAbNormalSigningRuntimeConfig;
  }) {
    this.walletSessionStore = input.walletSessionStore;
    this.ecdsaWalletSessionStore = input.ecdsaWalletSessionStore;
    this.config = input.config;
  }

  getSigningWorkerPrivateTransport(): RouterAbSigningWorkerPrivateTransport {
    return this.config.signingWorkerTransport;
  }

  async reservePrepareReplay(
    input: RouterAbNormalSigningPrepareReplayReservationInput,
  ): Promise<RouterAbNormalSigningPrepareReplayReservationResult> {
    const rawReplayIdentity =
      input.authorizationIdentity.kind === 'reusable_wallet_session'
        ? input.authorizationIdentity.walletSessionId
        : input.authorizationIdentity.materialActivationId;
    const replayIdentityValue = toOptionalTrimmedString(rawReplayIdentity);
    const requestId = toOptionalTrimmedString(input.requestId);
    const expiresAtMs = Number(input.expiresAtMs);
    if (!replayIdentityValue || !requestId || !Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_body',
        message:
          'Router A/B normal-signing replay reservation requires authorization identity, request id, and expiry',
      };
    }
    const store =
      input.curve === 'ed25519' ? this.walletSessionStore : this.ecdsaWalletSessionStore;
    const replayIdentity = `${input.authorizationIdentity.kind}:${replayIdentityValue}`;
    const replayGuard = await store.reserveReplayGuard(
      ['router-ab-normal-signing', input.curve, 'prepare', replayIdentity].join(':'),
      requestId,
      expiresAtMs,
    );
    if (replayGuard.ok) return { ok: true };
    if (replayGuard.code === 'export_nonce_replay') {
      return {
        ok: false,
        status: 400,
        code: 'one_use_replay_rejected',
        message: 'Router A/B normal-signing prepare request id already used',
      };
    }
    if (replayGuard.code === 'export_authorization_expired') {
      return {
        ok: false,
        status: 400,
        code: 'expired_request',
        message: 'Router A/B normal-signing prepare request is expired',
      };
    }
    return {
      ok: false,
      status: 500,
      code: 'internal',
      message: replayGuard.message,
    };
  }

}
