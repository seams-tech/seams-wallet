# Seams Wallet SDK

`@seams/wallet` **0.29.0** provides browser wallet lifecycle, NEAR and EVM-family
threshold signing, React components, and hosted wallet runtime assets.

## Install

```sh
pnpm add @seams/wallet@0.29.0
```

React integrations support React 18 and 19. Import the provider and UI from
`@seams/wallet/react` and its stylesheet from `@seams/wallet/react/styles`.
Keep the application package, wallet-origin assets, and
`@seams/wallet-server@0.29.0` on the matching release. The wallet iframe protocol
is `19.0.0`. The application and wallet host must use the same protocol version.

## Current API

The public API groups calls under `auth`, `connection`, `config`, `events`,
`registration`, and the chain namespaces. See the
[browser reference](https://wallet.seams.sh/docs/reference/core).
Use `auth.lock()` to end the session while retaining valid durable presignatures.

Custom email unlock uses a host-owned challenge:

```ts
const requested = await seams.auth.requestEmailCode({
  method: 'google',
  idToken,
  target: { kind: 'wallet', walletId },
});
if (!requested.ok) throw new Error(requested.error.message);
const result = await seams.auth.unlockWithEmailCode({
  challenge: requested.value,
  code,
});
if (!result.ok) throw new Error(result.error.message);
```

For an existing local email method, request with
`{ method: 'email', walletId, email }`. The challenge supports `resend()` and
`cancel()`. Use the replacement challenge returned by a successful resend.
The SDK selects signers and completes pending activation internally.

Request email codes only after a user chooses that method. The wallet host owns
the challenge and its expiry. The application receives the typed challenge handle.

## Application sessions and fresh owner approval

SDK 0.29.0 accepts a handoff from an explicitly trusted application backend.
Google and app-passkey login can use the same stable application user ID.
Use `registration.registerOwnerWallet` for NEAR-only passkey onboarding and `near.prepareOwnerTransaction` for fresh approval of each transaction.
These operations create no reusable signing authority.
React read connections expose owner-operation handles separately from reusable signers.
See the [application-session guide](https://wallet.seams.sh/docs/guides/application-auth).

## Bring your own Google authentication

SDK 0.29.0 can reuse an application's Google ID token to open associated wallet settings.
Configure the environment's Google client ID and let the owner associate their wallet once.
Then pass the token after the application's existing Google login:

```ts
const result = await seams.auth.authenticate({ method: 'google', walletId, idToken });
if (!result.ok) throw new Error(result.code);
```

Apps that retain the token on their backend use `prepareExternalAuth` and a browser-bound handoff.
Call `seams.auth.lock()` when the app logs out or switches accounts.
These sessions grant settings reads. Signing, export, recovery, and security changes retain their owner authentication requirements.
See the [Google SSO guide](https://wallet.seams.sh/docs/guides/google-sso) for both exchange paths, association, expiry, and revocation.

## React quick start

The three required values are the wallet origin, Gateway/relayer URL, and
managed-registration publishable key. Obtain them from your project and allow
your application's origin in that environment. Browser configuration is public.

```tsx
import {
  HostedSeamsAuthMenu,
  SeamsWebProvider,
  seamsTestnetConfig,
  type HostedAuthMenuOutcome,
} from '@seams/wallet/react';
import '@seams/wallet/react/styles';

const config = seamsTestnetConfig({
  walletOrigin: import.meta.env.VITE_WALLET_ORIGIN,
  relayerUrl: import.meta.env.VITE_RELAYER_URL,
  publishableKey: import.meta.env.VITE_SEAMS_PUBLISHABLE_KEY,
});

function handleOutcome(outcome: HostedAuthMenuOutcome): void {
  console.log('Wallet authentication:', outcome);
}

export function App() {
  return (
    <SeamsWebProvider config={config}>
      <HostedSeamsAuthMenu onOutcome={handleOutcome} />
    </SeamsWebProvider>
  );
}
```

`seamsTestnetConfig` selects NEAR and Tempo testnets. Use `defineSeamsConfig`
for another chain set. EVM-family chain records require their numeric `chainId`.
An optional `projectEnvironmentId` cross-check rejects a publishable key for a
different environment.

The hosted menu owns registration, sign-in, OTP prompts, recovery-code backup,
and user presence. Supply `externalAuthBroker` when your application acquires
Google identity evidence for the wallet host. Keep secret credentials and
recovery material out of app configuration and logs.

## Signing and lifecycle

`useSeams()` exposes authentication actions, lifecycle state, and the current
`wallet`. The wallet is null while signed out. An authenticated wallet provides
`near`, `evm`, and `tempo` signers bound to its identity.
`wallet.near` is null until a NEAR account is ready. Check registration's pending
branches and use `registration.waitForNearAccount` before signing NEAR.

```tsx
const { unlock, lock, wallet } = useSeams();
```

Unlock updates the wallet in a subsequent React render. Use the authenticated
render's wallet in signing handlers. `wallet.walletId` identifies that wallet.

The framework-neutral `SeamsWeb` client groups operations under `registration`,
`auth`, `near`, `evm`, `tempo`, `recovery`, `devices`, and `keys`. Signing can
use fresh authorization for one operation; `unlock` provisions a bounded
reusable Wallet Session. An EVM-family signing or export call requires a
`chainTarget` naming a configured chain.

`keys.exportKey` opens a wallet-origin viewer and returns `{ kind: 'exported' }`.
It does not return a private key to the application. `recovery.syncAccount`
synchronizes a known wallet's account state; the hosted menu handles recovery
codes and new-factor verification.

See the [compiled examples](https://wallet.seams.sh/docs/examples/) for
registration, unlock, signing, linked devices, export, recovery, and theming.

## Wallet settings

`WalletSettingsPage` provides accounts, key export, recovery codes,
authentication methods, device linking, linked devices, and transaction
preferences. Signed-out users see the hosted authentication menu.

```tsx
import {
  SeamsWebProvider,
  WalletSettingsPage,
  type SeamsConfigsInput,
} from '@seams/wallet/react';
import '@seams/wallet/react/styles';

export function WalletSettingsApp({ config }: { config: SeamsConfigsInput }) {
  return (
    <SeamsWebProvider config={config}>
      <WalletSettingsPage />
    </SeamsWebProvider>
  );
}
```

Keep the configured `/wallet-service` endpoint available. A bare service HTML
asset needs the deployment's bootstrap and configuration before it can serve a
complete settings application.

## Hosted boundary and regional homes

The dedicated wallet origin serves `/wallet-service` and `/sdk/*`, including
workers, WASM, and the export viewer. The SDK iframe delegates WebAuthn
permissions to that origin. Credential creation and assertions execute there;
there is no application-origin credential bridge.

Regional hosted deployments assign each wallet a home at registration.
Wallets in one project can have different homes, while all devices of one
wallet use the same home. Travel does not change it. The owner can move a wallet
to another region with the wallet region setting. Automatic region relocation is
a future capability.

For APAC, registration and relocation request Southeast Asia placement through
`apac-se`. The hint does not guarantee a city or move existing objects. Operators
must verify the actual object locations and database primaries.

Follow the [upgrade guide](https://wallet.seams.sh/docs/deploy-and-operate/hosted-integration)
before changing the application, wallet assets, or backend. An incompatible open
client must reload matching assets before retrying.

## Initial loading and registration

When the wallet origin stores no wallet, the host answers connection reads from
its boot code. It loads the runtime when an operation needs it. Call
`seams.authMenu.prepare()` on sign-in intent to download the sign-in code earlier.
Mounting `HostedSeamsAuthMenu` starts that download without an additional call.

Opening the hosted registration view prepares its wallet and passkey challenge.
`authMenu.prepare()` only downloads code. A direct `registerWallet()` call starts
registration setup within that call. See the
[compiled hosted-menu examples](https://wallet.seams.sh/docs/examples/wallet-setup-and-authentication).

Registration can sign before its completion appears in the Console directory.
The Gateway retries pending directory publications. Until acknowledgment, the
wallet can be absent from the Console list and unavailable for region moves.

## Public entrypoints

- `@seams/wallet` — browser client, config builders, public results and values.
- `@seams/wallet/react` — providers, hooks, components, transaction review, and themes.
- `@seams/wallet/external-evm` — browser EVM extension connector.
- `@seams/wallet/advanced` — exact identity builders, RPC and encoding helpers.
- `@seams/wallet/threshold` — session-policy helpers, PRF salts, and intent digests.
- `@seams/wallet/runtime` — explicit platform ports and custom signing runtime.

Use the documented package exports. Agent-lane issuance remains planned.
The VoiceID approval prototype is opt-in:

```ts
import { defineSeamsConfig } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';

const config = defineSeamsConfig({
  walletOrigin,
  relayerUrl,
  publishableKey,
  authMethods: [voiceIdAuthMethod()],
});
```

VoiceID is a separate optional package. The Wallet host operator must deploy its
assets alongside the Wallet host. The descriptor alone downloads no implementation
or models. VoiceID supports enrollment, Wallet Session unlock, and reviewed NEAR
and Arc testnet signing. See [`@seams/voiceid`](../voiceid/README.md) for installation.

## Develop from source

From the repository root:

```sh
pnpm install
pnpm build
pnpm -C packages/wallet dev
pnpm test:wallet-browser
pnpm -C packages/wallet type-check
```

With the required WASM and server artifacts already built, rebuild only the SDK
with `pnpm -C packages/wallet build:sdk`. See the repository README for the full
local stack and Console Lite example.

## License and support

Apache-2.0. See the package's `LICENSE.md` and `THIRD_PARTY_NOTICES.md`.

- [Documentation](https://wallet.seams.sh/docs/)
- [Repository and issues](https://github.com/seams-tech/seams-wallet)
