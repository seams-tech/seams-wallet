import { expect, test } from '@playwright/test';
import {
  parseWalletAddAuthMethodRegistrationOptions,
  type WalletAddAuthMethodRegistrationOptions,
} from '@shared/utils/addAuthMethodRegistration';
import { parseWalletAuthMethodId, parseWebAuthnRpId } from '@shared/utils/domainIds';
import { createBrowserPlatformRuntime } from '../../../packages/wallet/src/core/platform/browser/createBrowserPlatformRuntime';
import { toRpId } from '../../../packages/wallet/src/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import { TouchIdPrompt } from '../../../packages/wallet/src/core/signingEngine/stepUpConfirmation/passkeyPrompt/touchIdPrompt';
import type { WalletRecoveryRegistrationOptions } from '../../../packages/wallet/src/core/rpcClients/relayer/walletRecoveryPrepare';
import {
  PRF_FIRST_SALT_V1_HEX,
  PRF_SECOND_SALT_V1_HEX,
  bytesToBase64Url,
  hexToBase64Url,
  walletUserHandleB64u,
} from './ceremonyFixtures';

const RP_ID = 'wallet.example.test';
const WALLET_ID = 'conformance-wallet-1';
const CHALLENGE_B64U = bytesToBase64Url(new Uint8Array(32).fill(9));
const CREDENTIAL_ID_B64U = bytesToBase64Url(new Uint8Array(16).fill(3));
const PROMPT = { kind: 'immediate', requestId: 'conformance', cancellation: { kind: 'none' } } as const;

/** The fields of the creation options that a stored credential depends on. */
function describeCreation(publicKey: PublicKeyCredentialCreationOptions) {
  const prf = publicKey.extensions?.prf?.eval;
  return {
    rp: publicKey.rp,
    userIdB64u: bytesToBase64Url(publicKey.user.id),
    userName: publicKey.user.name,
    algorithms: publicKey.pubKeyCredParams.map((parameter) => [parameter.type, parameter.alg]),
    authenticatorSelection: publicKey.authenticatorSelection,
    attestation: publicKey.attestation,
    timeout: publicKey.timeout,
    prf: [bytesToBase64Url(prf?.first), bytesToBase64Url(prf?.second)],
  };
}

function describeRequest(publicKey: PublicKeyCredentialRequestOptions) {
  const prf = publicKey.extensions?.prf?.eval;
  return {
    rpId: publicKey.rpId,
    userVerification: publicKey.userVerification,
    allowCredentialIds: (publicKey.allowCredentials ?? []).map((entry) => bytesToBase64Url(entry.id)),
    challengeB64u: bytesToBase64Url(publicKey.challenge),
    prf: [bytesToBase64Url(prf?.first), bytesToBase64Url(prf?.second)],
  };
}

/** The contract that every builder keeps, apart from `rp.name`. */
function expectedCreation(rpName: string, userIdB64u = walletUserHandleB64u(WALLET_ID)) {
  return {
    rp: { id: RP_ID, name: rpName },
    userIdB64u,
    userName: WALLET_ID,
    algorithms: [
      ['public-key', -7],
      ['public-key', -257],
    ],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    attestation: 'none',
    timeout: 60_000,
    prf: [hexToBase64Url(PRF_FIRST_SALT_V1_HEX), hexToBase64Url(PRF_SECOND_SALT_V1_HEX)],
  };
}

/** Options as the server builds them: the user handle is the UTF-8 bytes of the wallet ID. */
function serverAddAuthMethodOptions(): WalletAddAuthMethodRegistrationOptions {
  return parseWalletAddAuthMethodRegistrationOptions({
    kind: 'webauthn_add_auth_method_registration_v1',
    challengeId: 'challenge-1',
    challengeB64u: CHALLENGE_B64U,
    rpId: RP_ID,
    user: { idB64u: walletUserHandleB64u(WALLET_ID), name: WALLET_ID, displayName: WALLET_ID },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    timeoutMs: 60_000,
    attestation: 'none',
    extensions: {
      prf: {
        eval: {
          firstB64u: hexToBase64Url(PRF_FIRST_SALT_V1_HEX),
          secondB64u: hexToBase64Url(PRF_SECOND_SALT_V1_HEX),
        },
      },
    },
    excludeCredentials: [],
  });
}

function serverRecoveryOptions(): WalletRecoveryRegistrationOptions {
  const addOptions = serverAddAuthMethodOptions();
  const methodId = parseWalletAuthMethodId('wallet-auth-method:recovery');
  const rpId = parseWebAuthnRpId(RP_ID);
  if (!methodId.ok || !rpId.ok) throw new Error('fixture identifiers are invalid');
  return {
    ...addOptions,
    kind: 'webauthn_recovery_registration_v1',
    replacementId: 'replacement-1',
    walletAuthMethodId: methodId.value,
    rpId: rpId.value,
    excludeCredentials: [],
  };
}

type CapturedCall =
  | { readonly kind: 'create'; readonly publicKey: PublicKeyCredentialCreationOptions }
  | { readonly kind: 'get'; readonly publicKey: PublicKeyCredentialRequestOptions };

/**
 * A credentials container that records each call and returns no credential. The passkey
 * prompt reads `navigator.credentials` and listens on `window` and `document`, so the check
 * installs stand-ins for the length of one call.
 */
async function captureCalls(run: (credentials: CredentialsContainer) => Promise<unknown>) {
  const calls: CapturedCall[] = [];
  const credentials = {
    async create(options?: CredentialCreationOptions) {
      if (options?.publicKey) calls.push({ kind: 'create', publicKey: options.publicKey });
      return null;
    },
    async get(options?: CredentialRequestOptions) {
      if (options?.publicKey) calls.push({ kind: 'get', publicKey: options.publicKey });
      return null;
    },
    async store() {},
    async preventSilentAccess() {},
  } satisfies CredentialsContainer;
  const saved = {
    window: Reflect.get(globalThis, 'window'),
    document: Reflect.get(globalThis, 'document'),
    credentials: Reflect.getOwnPropertyDescriptor(globalThis.navigator, 'credentials'),
  };
  Reflect.set(globalThis, 'window', new EventTarget());
  Reflect.set(globalThis, 'document', new EventTarget());
  Object.defineProperty(globalThis.navigator, 'credentials', {
    value: credentials,
    configurable: true,
  });
  try {
    await run(credentials).catch(() => undefined);
  } finally {
    Reflect.set(globalThis, 'window', saved.window);
    Reflect.set(globalThis, 'document', saved.document);
    if (saved.credentials) {
      Object.defineProperty(globalThis.navigator, 'credentials', saved.credentials);
    } else {
      Reflect.deleteProperty(globalThis.navigator, 'credentials');
    }
  }
  return calls;
}

async function captureCreation(run: (credentials: CredentialsContainer) => Promise<unknown>) {
  const [call] = await captureCalls(run);
  if (call?.kind !== 'create') throw new Error('the builder did not call credentials.create');
  return describeCreation(call.publicKey);
}

async function captureRequest(run: (credentials: CredentialsContainer) => Promise<unknown>) {
  const [call] = await captureCalls(run);
  if (call?.kind !== 'get') throw new Error('the builder did not call credentials.get');
  return describeRequest(call.publicKey);
}

test('a new wallet passkey: the prompt builds the options and the user handle itself', async () => {
  const prompt = new TouchIdPrompt(RP_ID);
  const register = (signerSlot?: number) =>
    captureCreation(() =>
      prompt.generateRegistrationCredentialsInternal({
        kind: 'wallet_registration',
        walletId: WALLET_ID,
        intendedUserName: WALLET_ID,
        challengeB64u: CHALLENGE_B64U,
        prompt: PROMPT,
        ...(signerSlot === undefined ? {} : { signerSlot }),
      }),
    );
  expect(await register()).toEqual(expectedCreation('WebAuthn Passkey'));
  expect(await register(1)).toEqual(expectedCreation('WebAuthn Passkey'));
  // A signer slot above 1 adds a suffix to the user handle.
  expect(await register(2)).toEqual(
    expectedCreation('WebAuthn Passkey', walletUserHandleB64u(WALLET_ID, 2)),
  );
  // The user name must be the wallet ID.
  expect(
    await captureCalls(() =>
      prompt.generateRegistrationCredentialsInternal({
        kind: 'wallet_registration',
        walletId: WALLET_ID,
        intendedUserName: 'someone-else',
        challengeB64u: CHALLENGE_B64U,
        prompt: PROMPT,
      }),
    ),
  ).toEqual([]);
});

test('server options: the prompt and the platform runtime keep the server user handle and fields', async () => {
  const prompt = new TouchIdPrompt(RP_ID);
  // Add a passkey to a wallet.
  expect(
    await captureCreation(() =>
      prompt.generateRegistrationCredentialsInternal({
        kind: 'wallet_add_auth_method',
        walletId: WALLET_ID,
        intendedUserName: WALLET_ID,
        registration: serverAddAuthMethodOptions(),
        prompt: PROMPT,
      }),
    ),
  ).toEqual(expectedCreation('Seams Wallet'));
  // Recover a wallet with a new passkey.
  expect(
    await captureCreation(() =>
      prompt.generateRegistrationCredentialsInternal({
        kind: 'wallet_recovery',
        walletId: WALLET_ID,
        intendedUserName: WALLET_ID,
        recoveryRegistration: serverRecoveryOptions(),
        prompt: PROMPT,
      }),
    ),
  ).toEqual(expectedCreation('Seams Wallet'));
  // The platform runtime names the relying party by its ID.
  expect(
    await captureCreation((credentials) =>
      createBrowserPlatformRuntime({ credentials }).authenticator.run({
        kind: 'create_passkey',
        registrationOptions: serverAddAuthMethodOptions(),
        requirePrfFirst: false,
      }),
    ),
  ).toEqual(expectedCreation(RP_ID));
});

test('an assertion asks for both PRF salts, the RP ID and preferred user verification', async () => {
  const expected = {
    rpId: RP_ID,
    userVerification: 'preferred',
    allowCredentialIds: [CREDENTIAL_ID_B64U],
    challengeB64u: CHALLENGE_B64U,
    prf: [hexToBase64Url(PRF_FIRST_SALT_V1_HEX), hexToBase64Url(PRF_SECOND_SALT_V1_HEX)],
  };
  expect(
    await captureRequest(() =>
      new TouchIdPrompt(RP_ID).getAuthenticationCredentialsSerializedForChallengeB64u({
        subjectId: WALLET_ID,
        challengeB64u: CHALLENGE_B64U,
        allowCredentials: [{ id: CREDENTIAL_ID_B64U, type: 'public-key', transports: ['internal'] }],
      }),
    ),
  ).toEqual(expected);
  expect(
    await captureRequest((credentials) =>
      createBrowserPlatformRuntime({ credentials }).authenticator.run({
        kind: 'get_passkey',
        rpId: toRpId(RP_ID),
        credentialIdB64u: CREDENTIAL_ID_B64U,
        challengeB64u: CHALLENGE_B64U,
        requirePrfFirst: true,
      }),
    ),
  ).toEqual(expected);
});
