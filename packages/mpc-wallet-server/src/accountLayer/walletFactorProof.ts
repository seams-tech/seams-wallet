import type { WalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import { webauthnChallengeB64u } from '../../../auth/src/proofs/audience';
import { verifyDeviceKeySignature } from '../../../auth/src/proofs/deviceKey';
import {
  verifyProofStatement,
  verifyRemovalNotice,
  type AuthJwks,
} from '../../../auth/src/proofs/tokens';
import {
  verifyPasskeyAssertion,
  type PasskeyCeremonyScope,
} from '../../../auth/src/proofs/webauthn';

// The wallet's check of a proof from `auth.prove` for the audience `wallet` (D7). The wallet
// trusts its own records: the method record that it stored with the envelope holds the key of
// the factor, and that record is the pinned key. A passkey and a device key are checked against
// it with no call to the Auth Worker. An email code comes as a statement of the Auth Worker; the
// wallet checks it with the Worker's public keys from its own configuration, and the address
// in it must be the address that the wallet pinned.

export const WALLET_AUDIENCE = 'wallet';

/** The proof as the MPC wallet plugin sends it, with the method that it names. */
export type WalletFactorProof =
  | { readonly factor: 'webauthn'; readonly assertion: unknown }
  | { readonly factor: 'device_key'; readonly signatureB64u: string }
  | { readonly factor: 'email_code'; readonly statement: string };

export type WalletProofContext = {
  readonly passkeys: PasskeyCeremonyScope;
  /** The public keys of the Auth Worker. They are configuration, not a network read. */
  readonly authJwks: AuthJwks;
  readonly authIssuer: string;
  readonly nowMs: number;
};

export type WalletFactorProofResult =
  | { readonly ok: true; readonly newCounter: number | null }
  | {
      readonly ok: false;
      readonly code: 'method_not_active' | 'wrong_factor' | 'proof_rejected';
      readonly message: string;
    };

function refused(
  code: Extract<WalletFactorProofResult, { ok: false }>['code'],
  message: string,
): WalletFactorProofResult {
  return { ok: false, code, message };
}

/**
 * Checks a proof of one method for a challenge that the wallet server issued. `deviceKeyMessage`
 * is the message that the server built for its challenge: a device key signs the wallet's own
 * message (`seams:wallet-session:voiceid-device:v1` for a Wallet Session).
 */
export async function verifyWalletFactorProof(input: {
  readonly method: WalletAuthMethodRecordV2;
  readonly challenge: string;
  readonly proof: WalletFactorProof;
  readonly deviceKeyMessage?: Uint8Array<ArrayBuffer>;
  readonly context: WalletProofContext;
}): Promise<WalletFactorProofResult> {
  const { method, proof, context } = input;
  if (method.status !== 'active') return refused('method_not_active', 'The method is not active');
  switch (method.kind) {
    case 'passkey': {
      if (proof.factor !== 'webauthn')
        return refused('wrong_factor', 'A passkey proves with WebAuthn');
      const verified = await verifyPasskeyAssertion({
        assertion: proof.assertion,
        scope: { rpId: method.rpId, origins: context.passkeys.origins },
        expectedChallengeB64u: await webauthnChallengeB64u(WALLET_AUDIENCE, input.challenge),
        key: {
          credentialIdB64u: method.credentialIdB64u,
          publicKeyB64u: method.credentialPublicKeyB64u,
          counter: method.counter,
        },
      });
      return verified.ok
        ? { ok: true, newCounter: verified.newCounter }
        : refused('proof_rejected', verified.message);
    }
    case 'voiceid': {
      if (proof.factor !== 'device_key' || !input.deviceKeyMessage) {
        return refused('wrong_factor', 'VoiceID proves with its device key');
      }
      const verified = await verifyDeviceKeySignature({
        publicKeyB64u: method.devicePublicKeyB64u,
        deviceKeyId: method.deviceKeyId,
        signatureB64u: proof.signatureB64u,
        signedBytes: input.deviceKeyMessage,
      });
      return verified
        ? { ok: true, newCounter: null }
        : refused('proof_rejected', 'The device signature is not valid');
    }
    case 'email_otp': {
      if (proof.factor !== 'email_code') {
        return refused('wrong_factor', 'Email OTP proves with a statement of the Auth Worker');
      }
      const statement = await verifyProofStatement(proof.statement, {
        jwks: context.authJwks,
        issuer: context.authIssuer,
        audience: WALLET_AUDIENCE,
        challenge: input.challenge,
        nowMs: context.nowMs,
      });
      if (!statement.ok) return refused('proof_rejected', statement.reason);
      // The statement must name this method and the address that the wallet pinned.
      if (
        statement.factor !== 'email_code' ||
        statement.methodId !== method.walletAuthMethodId ||
        statement.emailHashHex !== method.emailHashHex
      ) {
        return refused('proof_rejected', 'The statement names another method or address');
      }
      return { ok: true, newCounter: null };
    }
  }
}

export type MethodRemovalAnswer =
  | {
      readonly status: 200;
      readonly body: { readonly ok: true };
      readonly revoke: WalletAuthMethodRecordV2 | null;
    }
  | { readonly status: 409; readonly body: { readonly ok: false; readonly code: 'last_envelope' } }
  | {
      readonly status: 401;
      readonly body: { readonly ok: false; readonly code: 'invalid_notice' };
    };

/**
 * The wallet's answer to a removal notice of the Auth Worker (Section 6). It refuses the removal
 * of the last active method of a wallet, so a wallet never loses its last envelope by a removal
 * in auth. It agrees to the removal of a method that it does not have. `revoke` is the method
 * whose envelope the wallet revokes before it answers.
 */
export async function answerMethodRemoval(input: {
  readonly notice: unknown;
  /** The URL of this subscriber, as the Auth Worker's configuration names it. */
  readonly subscriberUrl: string;
  readonly context: Pick<WalletProofContext, 'authJwks' | 'authIssuer' | 'nowMs'>;
  readMethod(methodId: string): Promise<WalletAuthMethodRecordV2 | null>;
  activeMethodsOfWallet(walletId: string): Promise<readonly WalletAuthMethodRecordV2[]>;
}): Promise<MethodRemovalAnswer> {
  const notice = await verifyRemovalNotice(input.notice, {
    jwks: input.context.authJwks,
    issuer: input.context.authIssuer,
    audience: input.subscriberUrl,
    nowMs: input.context.nowMs,
  });
  if (!notice.ok) return { status: 401, body: { ok: false, code: 'invalid_notice' } };
  const method = await input.readMethod(notice.methodId);
  // The account ID of a wallet's account is the wallet ID.
  if (!method || method.walletId !== notice.accountId || method.status !== 'active') {
    return { status: 200, body: { ok: true }, revoke: null };
  }
  const active = await input.activeMethodsOfWallet(method.walletId);
  if (active.every((other) => other.walletAuthMethodId === method.walletAuthMethodId)) {
    return { status: 409, body: { ok: false, code: 'last_envelope' } };
  }
  return { status: 200, body: { ok: true }, revoke: method };
}
