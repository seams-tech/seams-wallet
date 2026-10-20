# Seams Wallet SDK

`@seams/wallet` **0.15.4** provides browser wallet lifecycle, NEAR and EVM-family
threshold signing, React components, and hosted wallet runtime assets.

## Install

```sh
pnpm add @seams/wallet@0.15.4
```

React integrations support React 18 and 19. Import the provider and UI from
`@seams/wallet/react` and its stylesheet from `@seams/wallet/react/styles`.
Keep the application package, wallet-origin assets, and
`@seams/wallet-server@0.15.4` on the matching release. The wallet iframe protocol
is `16.0.0`. A 0.13 application and a 0.14-or-later wallet host reject each other
with a protocol version mismatch.

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

`useSeams()` exposes the SDK client and authentication state. `useWallet()`
provides `near`, `evm`, and `tempo` signers bound to the authenticated wallet.
`near` is null until a NEAR account is ready. Check registration's pending
branches and use `registration.waitForNearAccount` before signing NEAR.

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

Use the documented package exports. Agent-lane issuance and VoiceID
authentication are planned and have no public API in this release.

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
