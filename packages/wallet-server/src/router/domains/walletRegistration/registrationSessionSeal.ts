import type { RegistrationEstablishedSessionProjectionV2 } from '@shared/utils/registrationEstablishedSession';
import { isPlainObject } from '@shared/utils/validation';
import type {
  SigningSessionSealRouteResult,
  SigningSessionSealServerSealRequest,
  SigningSessionSealService,
} from '../../../threshold/session/signingSessionSeal/signingSessionSeal.types';

type SealSession = Pick<
  RegistrationEstablishedSessionProjectionV2,
  'walletId' | 'walletSessionId' | 'expiresAtMs' | 'remainingUses' | 'tokens'
>;

type SealFailure = { readonly ok: false; readonly code: string; readonly message: string };
type SealResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly ciphertext: string;
        readonly keyVersion: string;
        readonly expiresAtMs: number;
        readonly remainingUses: number;
      };
    }
  | SealFailure;

/** Holds one request's computation until registration can publish its response. */
class RegistrationPreparedSessionSeal {
  private prepared: {
    readonly walletId: string;
    readonly walletSessionId: string;
    readonly expiresAtMs: number;
    readonly result: Promise<SigningSessionSealRouteResult>;
  } | null = null;

  constructor(
    private readonly request: SigningSessionSealServerSealRequest,
    private readonly service: SigningSessionSealService | null,
  ) {}

  async prepare(session: RegistrationEstablishedSessionProjectionV2): Promise<void> {
    // A seal failure must not strand an otherwise committed registration.
    // The route reports it only after the completion receipt is durable.
    await this.finish(session);
  }

  async finish(session: SealSession): Promise<SealResult> {
    const tokens = session.tokens;
    const ed25519 =
      tokens.kind === 'near_ed25519' || tokens.kind === 'near_ed25519_and_evm_family_ecdsa'
        ? tokens.ed25519
        : null;
    if (!ed25519 || String(ed25519.thresholdSessionId) !== this.request.thresholdSessionId) {
      return {
        ok: false,
        code: 'invalid_session_seal',
        message: 'Prepared seal does not match the established Ed25519 session',
      };
    }
    if (this.prepared === null) {
      this.prepared = {
        walletId: String(session.walletId),
        walletSessionId: String(session.walletSessionId),
        expiresAtMs: session.expiresAtMs,
        result: applyRegistrationSessionSeal(this.service, this.request, session),
      };
    }
    if (
      this.prepared.walletId !== String(session.walletId) ||
      this.prepared.walletSessionId !== String(session.walletSessionId) ||
      this.prepared.expiresAtMs !== session.expiresAtMs
    ) {
      return {
        ok: false,
        code: 'invalid_session_seal',
        message: 'Prepared seal does not match the committed Wallet Session',
      };
    }
    const sealed = await this.prepared.result;
    if (!sealed.ok) return sealed;
    const keyVersion = String(sealed.keyVersion || '').trim();
    if (!keyVersion) {
      return {
        ok: false,
        code: 'invalid_session_seal',
        message: 'Signing-session seal response is missing its key version',
      };
    }
    const expiresAtMs = Math.min(sealed.expiresAtMs ?? session.expiresAtMs, session.expiresAtMs);
    if (expiresAtMs <= Date.now()) {
      return { ok: false, code: 'expired', message: 'threshold session expired' };
    }
    return {
      ok: true,
      value: {
        ciphertext: sealed.ciphertext,
        keyVersion,
        expiresAtMs,
        remainingUses: session.remainingUses,
      },
    };
  }
}

async function applyRegistrationSessionSeal(
  service: SigningSessionSealService | null,
  request: SigningSessionSealServerSealRequest,
  session: SealSession,
): Promise<SigningSessionSealRouteResult> {
  if (!service) {
    return {
      ok: false,
      code: 'signing_session_seal_unavailable',
      message: 'Signing-session sealing is unavailable',
    };
  }
  try {
    return await service.applyServerSeal(request, {
      userId: String(session.walletId),
      session: {
        kind: 'exact_wallet_session_operation_credential',
        curve: 'ed25519',
        thresholdSessionId: request.thresholdSessionId,
        userId: String(session.walletId),
        expiresAtMs: session.expiresAtMs,
      },
    });
  } catch {
    return {
      ok: false,
      code: 'signing_session_seal_unavailable',
      message: 'Signing-session sealing failed',
    };
  }
}

export function parseRegistrationPreparedSessionSeal(
  raw: unknown,
  service: SigningSessionSealService | null,
):
  | { readonly ok: true; readonly value: RegistrationPreparedSessionSeal | null }
  | { readonly ok: false; readonly code: 'invalid_body'; readonly message: string } {
  if (raw === undefined) return { ok: true, value: null };
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'invalid_body', message: 'sessionSeal must be an object' };
  }
  for (const field of Object.keys(raw)) {
    if (!['thresholdSessionId', 'ciphertext', 'keyVersion'].includes(field)) {
      return { ok: false, code: 'invalid_body', message: 'sessionSeal has unknown fields' };
    }
  }
  const thresholdSessionId = String(raw.thresholdSessionId || '').trim();
  const ciphertext = String(raw.ciphertext || '').trim();
  const keyVersion = String(raw.keyVersion || '').trim();
  if (!thresholdSessionId || !ciphertext) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'sessionSeal thresholdSessionId and ciphertext are required',
    };
  }
  return {
    ok: true,
    value: new RegistrationPreparedSessionSeal(
      { thresholdSessionId, ciphertext, ...(keyVersion ? { keyVersion } : {}) },
      service,
    ),
  };
}
