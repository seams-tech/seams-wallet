import { expect, test } from '@playwright/test';
import { parseWebAuthnRpId, type WebAuthnRpId } from '@shared/utils/domainIds';
import { unknownWebAuthnAuthenticatorDeviceInfo } from '@shared/utils/webauthnDeviceInfo';
import {
  verifyWebAuthnAuthenticationLiteWithStore,
  verifyWebAuthnRegistrationCredentialForIntent,
} from '../../../packages/mpc-wallet-server/src/core/authService/webauthn';
import { normalizeLogger } from '../../../packages/mpc-wallet-server/src/core/logger';
import type { WebAuthnAuthenticatorRecord } from '../../../packages/mpc-wallet-server/src/core/WebAuthnAuthenticatorStore';
import { D1WalletAuthMethodStore } from '../../../packages/mpc-wallet-server/src/core/d1WalletAuthMethodStore';
import { CloudflareD1WebAuthnAuthService } from '../../../packages/mpc-wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnAuthService';
import { CloudflareD1WebAuthnStore } from '../../../packages/mpc-wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnStore';
import { openSignerD1 } from '../../fixtures/signer-d1.mjs';
import {
  assertionResponse,
  createSoftwarePasskey,
  otherSigningKey,
  randomChallengeB64u,
  registrationResponse,
  type CeremonyOverrides,
  type SoftwarePasskey,
} from './passkeyCredentials';

// The Wallet origin and its RP ID. A `.localhost` RP ID would take the local-development
// branch of the host check, so the checks use a public-looking name.
const SCOPE = { rpId: 'wallet.example.test', origin: 'https://wallet.example.test' } as const;
const WALLET_ID = 'conformance-wallet-1';
const D1_SCOPE = {
  namespace: 'conformance',
  orgId: 'org-conformance',
  projectId: 'project-conformance',
  envId: 'env-conformance',
} as const;

function rpId(value: string): WebAuthnRpId {
  const parsed = parseWebAuthnRpId(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function authenticatorRecord(passkey: SoftwarePasskey): WebAuthnAuthenticatorRecord {
  return {
    version: 'webauthn_authenticator_v1',
    credentialIdB64u: passkey.credentialIdB64u,
    credentialPublicKeyB64u: passkey.publicKeyB64u,
    counter: passkey.counter,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    deviceInfo: unknownWebAuthnAuthenticatorDeviceInfo(),
  };
}

/** A refusal is a failed result or a thrown error. */
async function settleRegistration(
  overrides: CeremonyOverrides,
): Promise<{ readonly ok: boolean; readonly code: string }> {
  const passkey = createSoftwarePasskey();
  const challengeB64u = randomChallengeB64u();
  try {
    const result = await verifyWebAuthnRegistrationCredentialForIntent({
      webauthnRegistration: registrationResponse(passkey, SCOPE, challengeB64u, overrides),
      expectedChallenge: challengeB64u,
      expectedOrigin: SCOPE.origin,
      rpId: rpId(SCOPE.rpId),
    });
    return result.ok ? { ok: true, code: '' } : { ok: false, code: result.code };
  } catch {
    return { ok: false, code: 'thrown' };
  }
}

test('a registration with the expected challenge, origin and RP ID gives the COSE key and counter', async () => {
  const passkey = createSoftwarePasskey();
  const challengeB64u = randomChallengeB64u();
  const result = await verifyWebAuthnRegistrationCredentialForIntent({
    webauthnRegistration: registrationResponse(passkey, SCOPE, challengeB64u),
    expectedChallenge: challengeB64u,
    expectedOrigin: SCOPE.origin,
    rpId: rpId(SCOPE.rpId),
  });
  // The stored public key is the COSE key bytes exactly as the authenticator gave them.
  expect(result).toEqual({
    ok: true,
    credential: {
      credentialIdB64u: passkey.credentialIdB64u,
      credentialPublicKeyB64u: passkey.publicKeyB64u,
      counter: 0,
    },
    authenticator: {
      aaguid: '00000000-0000-0000-0000-000000000000',
      backedUp: false,
      transports: ['internal'],
    },
  });
});

test('a registration without user verification is refused with its own code', async () => {
  // The registration is valid in every other way, so the code names the one fault.
  expect(await settleRegistration({ userVerified: false })).toEqual({
    ok: false,
    code: 'user_verification_required',
  });
  expect(await settleRegistration({ userVerified: true })).toEqual({ ok: true, code: '' });
});

test('a registration is refused for a wrong challenge, origin, RP ID hash or ceremony type', async () => {
  // These codes come from the checks before the WebAuthn library runs.
  expect(await settleRegistration({ challengeB64u: randomChallengeB64u() })).toEqual({
    ok: false,
    code: 'challenge_mismatch',
  });
  expect(await settleRegistration({ origin: 'https://evil.example' })).toEqual({
    ok: false,
    code: 'invalid_origin',
  });
  expect(await settleRegistration({ type: 'webauthn.get' })).toEqual({
    ok: false,
    code: 'invalid_body',
  });
  // The WebAuthn library refuses these; today it throws instead of returning a code.
  expect((await settleRegistration({ origin: 'https://app.wallet.example.test' })).ok).toBe(false);
  expect((await settleRegistration({ rpIdForHash: 'other.example.test' })).ok).toBe(false);
});

/** One server assertion check over one authenticator store. */
type AssertionCheck = {
  readonly name: string;
  open(): Promise<{
    seed(passkey: SoftwarePasskey): Promise<void>;
    verify(input: {
      credential: ReturnType<typeof assertionResponse>;
      expectedChallenge: string;
    }): Promise<{ readonly success: boolean; readonly code?: string }>;
    storedCounter(passkey: SoftwarePasskey): Promise<number | null>;
    close(): Promise<void>;
  }>;
};

const storeAssertionCheck: AssertionCheck = {
  name: 'the custody envelope check (authenticator store port)',
  async open() {
    const records = new Map<string, WebAuthnAuthenticatorRecord>();
    const key = (userId: string, credentialIdB64u: string) => `${userId}\n${credentialIdB64u}`;
    const store = {
      async get(userId: string, credentialIdB64u: string) {
        return records.get(key(userId, credentialIdB64u)) ?? null;
      },
      async put(userId: string, record: WebAuthnAuthenticatorRecord) {
        records.set(key(userId, record.credentialIdB64u), record);
      },
      async del(userId: string, credentialIdB64u: string) {
        records.delete(key(userId, credentialIdB64u));
      },
    };
    return {
      seed: (passkey) => store.put(WALLET_ID, authenticatorRecord(passkey)),
      verify: (input) =>
        verifyWebAuthnAuthenticationLiteWithStore({
          userId: WALLET_ID,
          rpId: rpId(SCOPE.rpId),
          expectedChallenge: input.expectedChallenge,
          webauthnAuthentication: input.credential,
          expectedOrigin: SCOPE.origin,
          authenticatorStore: store,
          logger: normalizeLogger(null),
        }),
      storedCounter: async (passkey) =>
        (await store.get(WALLET_ID, passkey.credentialIdB64u))?.counter ?? null,
      close: async () => {},
    };
  },
};

const d1AssertionCheck: AssertionCheck = {
  name: 'the D1 WebAuthn service (sign-in, unlock and sync)',
  async open() {
    const opened = await openSignerD1();
    const webAuthnStore = new CloudflareD1WebAuthnStore({ database: opened.database, ...D1_SCOPE });
    const service = new CloudflareD1WebAuthnAuthService({
      webAuthnStore,
      walletManifestSource: { getEd25519KeyManifestBySlot: async () => null },
      walletAuthMethodStore: new D1WalletAuthMethodStore({
        database: opened.database,
        ...D1_SCOPE,
      }),
    });
    return {
      seed: (passkey) =>
        webAuthnStore.writeAuthenticator({ userId: WALLET_ID, record: authenticatorRecord(passkey) }),
      verify: (input) =>
        service.verifyWebAuthnAuthenticationLite({
          userId: WALLET_ID,
          rpId: rpId(SCOPE.rpId),
          expectedChallenge: input.expectedChallenge,
          webauthn_authentication: input.credential,
          expected_origin: SCOPE.origin,
        }),
      storedCounter: async (passkey) =>
        (
          await webAuthnStore.readAuthenticator({
            userId: WALLET_ID,
            credentialIdB64u: passkey.credentialIdB64u,
          })
        )?.counter ?? null,
      close: opened.close,
    };
  },
};

for (const check of [storeAssertionCheck, d1AssertionCheck]) {
  test(`${check.name}: a valid assertion passes and moves the counter; each fault is refused with its code`, async () => {
    const opened = await check.open();
    try {
      const passkey = createSoftwarePasskey();
      await opened.seed(passkey);
      const challengeB64u = randomChallengeB64u();
      const attempt = (overrides: CeremonyOverrides) =>
        opened.verify({
          credential: assertionResponse(passkey, SCOPE, challengeB64u, overrides),
          expectedChallenge: challengeB64u,
        });

      expect(await attempt({})).toMatchObject({ success: true, verified: true });
      expect(await opened.storedCounter(passkey)).toBe(1);

      const refusals: readonly (readonly [CeremonyOverrides, string])[] = [
        [{ challengeB64u: randomChallengeB64u() }, 'invalid_assertion'],
        [{ origin: 'https://evil.example' }, 'invalid_origin'],
        [{ origin: 'https://app.wallet.example.test' }, 'invalid_assertion'],
        [{ rpIdForHash: 'other.example.test' }, 'invalid_assertion'],
        [{ signingKey: otherSigningKey() }, 'not_verified'],
        // A counter that does not grow is a cloned or replayed authenticator.
        [{ counter: 1 }, 'invalid_assertion'],
        // The authenticator did not verify the user, for example a security key with no PIN.
        [{ userVerified: false }, 'user_verification_required'],
        // A missing UV flag does not hide a bad signature.
        [{ userVerified: false, signingKey: otherSigningKey() }, 'not_verified'],
      ];
      for (const [overrides, code] of refusals) {
        expect(await attempt(overrides), JSON.stringify(Object.keys(overrides))).toMatchObject({
          success: false,
          code,
        });
      }
      // A refused assertion does not move the stored counter.
      expect(await opened.storedCounter(passkey)).toBe(1);

      const unknown = createSoftwarePasskey();
      expect(
        await opened.verify({
          credential: assertionResponse(unknown, SCOPE, challengeB64u),
          expectedChallenge: challengeB64u,
        }),
      ).toMatchObject({ success: false, code: 'unknown_credential' });
    } finally {
      await opened.close();
    }
  });
}
