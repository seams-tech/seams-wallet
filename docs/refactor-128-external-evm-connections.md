# Refactor 128 — External EVM wallet connections

Date created: September 21, 2026

Status: implemented for the desktop EVM connector described below; release `0.5.29`
preparation is in progress.

## Remaining release steps

- [x] Validate the packed Wallet artifact contains the public external-EVM runtime
  and declaration entries, and no retired `./react/seams-auth-menu` export.
- [ ] Run the extension smoke checklist in a clean desktop browser profile with
  MetaMask, Rabby, and Phantom EVM, recording wallet versions and any unsupported
  operation. Chrome 153.0.8010.48 with MetaMask 13.48.0, Rabby 0.94.9, and
  Phantom 26.30.2 enabled discovered all three providers. MetaMask reached its
  locked extension approval screen. Rabby returned a wallet-side rejection and
  Phantom failed to inject its EVM provider while all three extensions competed
  for the legacy `window.ethereum` property. Unlocking the extensions and running
  each separately remains required before account selection, switching, signing,
  and transaction submission can be accepted as release evidence.
- [ ] Run the established Wallet release workflow from `main` with coordinated
  version `0.5.29` for `@seams/wallet` and `@seams/wallet-server`.
- [ ] Update `seams-monorepo` to published `0.5.29`, refresh its lockfile, and
  compose the public connector into Console without copying its implementation.
- [ ] Rerun the packed-package, type, focused browser, and Console adoption checks
  after publication.

## Goal and scope

Allow applications using `@seams/wallet` to connect existing MetaMask, Rabby, and
Phantom EVM accounts alongside Seams wallets. The external wallet retains its
keys and displays its own approval requests. Seams owns provider discovery,
connection state, account selection, and the typed API used by the application.

The first release supports desktop browser extensions, configured EVM networks,
message signing, EIP-712 typed-data signing, transaction submission, network
switching, and local disconnect. Use one standards-based EVM implementation for
all three wallets.

Excluded: Solana and other non-EVM networks, mobile transports, WalletConnect,
account linking, wallet-based Seams login, custody import, recovery changes,
delegated signing, and changes to the Seams MPC protocols. Connecting an external
account grants no authority over a Seams wallet.

## Existing boundaries

- `packages/wallet/src/SeamsWeb/publicApi/evm.ts` implements the Seams EVM signing
  capability using Seams wallet sessions, MPC signing, and iframe routing.
- `packages/wallet/src/SeamsWeb/publicApi/createPublicApi.ts` assembles the current
  Seams capabilities. Preserve their required session and authorization inputs.
- `packages/wallet/src/react/context/` owns the public React context integration.
- `docs/spec-7-hosted-surfaces-and-provider-boundaries.md` defines the application
  document and hosted Wallet document boundary.
- Wallet tests and intended-behavior contracts live in this repository's `tests/`.
  Private Console adoption belongs in `seams-monorepo` after package publication.

External connections have an independent lifecycle. Keep them out of custody
records, wallet key manifests, signing lanes, and Seams authentication state.

## Provider discovery and ownership

Use EIP-6963 to discover announced providers and EIP-1193 to call the selected
provider. Phantom may omit an EIP-6963 announcement, so also discover its EVM
provider from the documented `window.phantom.ethereum` namespace and require its
`isPhantom` marker. Listen for provider announcements before requesting
announcements. Support late announcements and deduplicate repeated announcements
by discovery identity and provider object. Keep a stable reference to the provider
the user selected.

Provider names, icons, UUIDs, and reverse-domain names are untrusted display and
discovery data. Parse announcements at entry, render names as text, and render
validated icons as images without inserting SVG/HTML into the document. A wallet
brand or reverse-domain name provides no authentication guarantee. Never choose
a provider by whichever extension last assigned `window.ethereum`.

The application document owns discovery, provider references, and signing calls.
The initial wallet picker renders there using public React components. Keep
external provider objects and external signing requests outside the hosted
custody iframe protocol. Instantiate browser listeners only when the external
connection module is mounted; imports must remain safe during server rendering.

Use a small framework-independent module under
`packages/wallet/src/externalEvm/`, with React bindings under
`packages/wallet/src/react/`. Export the controller and domain types from the
existing package entry points. External-only use must work without creating a
Seams wallet, authenticating, or initializing MPC workers. Avoid introducing a
connector framework, wallet-specific SDKs, or a second UI framework for this scope.

## Connection and operation state

Model connection state as a discriminated union with `disconnected`, `connecting`,
and `connected` branches. The connected branch requires a connection identity,
nonempty authorized account set, selected account, and current EVM chain ID.
Keep provider handles internal. Model whether the current chain is configured as
an explicit branch; connecting on an unsupported chain can still show the account
and offer a network switch, while transaction submission remains unavailable.

Use branch-specific builders and exhaustive switches. Disconnected and connecting
branches must reject connected-only fields with `never` where appropriate.
Public boundary methods normalize raw inputs once; internal operations require
the narrowest valid connection and operation state. Recoverable outcomes use
typed results for rejection, unavailable connection, changed connection,
unsupported chain/method, pending request, malformed response, and provider failure.

Each operation captures the connection generation, selected account, expected
chain, and exact request. Read current authorization and chain before dispatch;
reject stale prepared requests. Process `accountsChanged`, `chainChanged`, and
`disconnect` through the same state transitions. An empty authorized account list
disconnects the account. Preserve the selected account if still authorized;
otherwise select the first authorized account and invalidate prior preparation.
Selecting another provider or locally disconnecting advances the generation.

Permit one approval-producing request at a time per controller. Dispose listeners
on teardown and detach old provider listeners on replacement. Connecting and
network switching require explicit user actions. Discovery and rendering must
never trigger an account-access or signing prompt.

Local disconnect clears Seams' external connection state and listeners. Explain
that revoking the site's wallet permissions happens in the wallet. Start
disconnected after reload in the initial release; persist neither provider handles
nor an authoritative connected state.

## Public operations

Expose a focused external EVM controller with these responsibilities. Final names
should follow existing SDK conventions without widening the Seams MPC API.

| Operation | Behavior |
| --- | --- |
| Discover and subscribe | List available providers and observe normalized connection state. |
| Connect | Request accounts from the explicitly selected provider and read its chain. |
| Select account | Choose an account from the provider's current authorized set. |
| Switch chain | Request a configured chain using `wallet_switchEthereumChain`, then verify the resulting chain. |
| Sign message | Encode explicit message bytes for `personal_sign` using the selected account. |
| Sign typed data | Validate EIP-712 input and call `eth_signTypedData_v4`; reject a supplied domain chain ID that conflicts with the operation chain. |
| Send transaction | Validate the supported EVM transaction request, bind its sender and chain, and call `eth_sendTransaction`. |
| Disconnect / dispose | Clear local connection state and release listeners. |

Do not automatically add unknown networks or silently fall back to another
signing method. Return an actionable unsupported-network or unsupported-method
result. Connection success alone does not prove support for every operation;
normalize unsupported-method responses from the selected wallet.

Define the initial transaction boundary around ordinary EVM calls and transfers:
recipient, data, value, and supported gas/fee fields using existing value parsers
where they fit. Reject conflicting fee forms and caller-supplied sender/chain
values inconsistent with the captured operation. Leave nonce and fee selection to
the wallet when omitted. Specialized Tempo, blob, and authorization-list transaction
flows require their own support decisions and stay outside this first boundary.

Return a validated transaction hash as `submitted`, with the captured account and
chain. Receipt observation uses the configured chain RPC and distinguishes
confirmation, revert, and unresolved tracking. Reuse existing generic RPC helpers
where possible; keep Seams nonce-lane accounting out of external transactions.
Do not require raw signed transaction bytes or reuse `EvmSignedResult` for external
submission.

An in-flight provider request may complete after an account change or local
disconnect. Signing results must never become authorization for a newer connection.
A returned transaction hash still describes a submitted operation on its captured
chain and must remain available for reconciliation. Transport loss after submission
can leave the outcome unknown: never automatically resend, claim cancellation,
or report a confirmed failure without evidence.

## Application and React integration

Provide a small external connection hook and wallet picker backed by the same
controller. Show installed wallet choices, connection progress, selected account,
current network, unsupported-network guidance, rejection, and disconnect.
Support keyboard navigation and predictable focus return after dismissal.

Keep Seams login state and external connection state separately observable. Where
the example offers an active signing account, model its source with an explicit
`seams` / `external_evm` union. Each branch carries its own required identity and
operation inputs. Route through an exhaustive switch; do not manufacture a
`WalletSessionRef` for external accounts or add optional provider fields to Seams
session types.

Update `examples/wallet-console-lite` to demonstrate both account sources and
external message signing, typed-data signing, and a testnet transaction. Require
the user to choose the signing account visibly. Use the existing React styling
patterns and keep this work independent of internal renderer refactors.

## Implementation sequence

1. **Define the contract.** Update `docs/intended-behaviours.md` and Spec 7 with
   external connection ownership, account-source separation, supported operations,
   and local disconnect semantics. Add the corresponding intended-behavior cases
   in the same change set as implementation.
2. **Implement discovery and state.** Add provider boundary parsers, the discovery
   registry, branch builders, controller lifecycle, and event cleanup. Add shared
   test factories and type fixtures alongside this work.
3. **Implement operations.** Add account/chain binding, network switching, message
   and typed-data signing, transaction submission, result normalization, and
   receipt observation. Cover in-flight state changes and uncertain submission.
4. **Expose the SDK and UI.** Add exports, React bindings, the host-side picker,
   and the Console Lite example. Verify external-only usage and SSR-safe imports.
5. **Verify and document.** Run focused automated checks and real extension smoke
   tests. Document installation, supported chains/methods, disconnect semantics,
   and transaction outcomes. Remove superseded helpers or fixtures introduced
   during implementation.
6. **Release and adopt.** Publish the Wallet package through its established
   release process. Update exact package releases in `seams-monorepo` and compose
   the public APIs into Console without duplicating connector implementation.

## Verification and completion criteria

All automated tests belong under top-level `tests/`. Use shared branch-specific
factories for connection and operation records. Add type fixtures proving that
disconnected state cannot authorize operations, Seams and external identities
cannot be interchanged, and broad spreads cannot create invalid branch combinations.
Review unsafe casts at boundaries; TypeScript cannot prevent an explicit assertion
from bypassing its type system.

Focused behavioral coverage must include:

- Multiple providers, repeated/late announcements, explicit provider selection,
  and cleanup after unmount/replacement.
- Rejected connection, empty accounts, malformed provider results, unsupported
  methods/chains, and successful explicit network switching.
- Account/chain changes during preparation and while approval is pending,
  disconnect/reconnect races, and stale completions.
- Correct message and EIP-712 requests, sender/chain binding, fee validation,
  transaction hash parsing, receipt success/revert, and unknown submission outcome.
- External-only operation without a Seams session, and preserved Seams signing
  behavior when the application switches account sources.

Run the selected files through `pnpm -C tests test:wallet-browser <test-paths>`,
the state type fixtures through `pnpm -C tests type-check:wallet-state`, and the
affected package/example type checks. Run the relevant intended-behavior contracts
and `pnpm check:packed-wallet` for the public API and package export changes.
Broaden verification when shared behavior changes. Classify any failing existing
test against the current invariant before repairing it.

Use real MetaMask, Rabby, and Phantom extensions separately and together on a
mutually supported configured testnet. Verify discovery, account selection,
network switching, message signing, typed-data signing, transaction submission,
rejection, and disconnect. Record wallet versions and any unsupported operation;
mock provider tests alone do not establish extension interoperability.

Completion means all three wallets work through the shared EVM path, documented
outcomes match behavior, public package exports work, and existing Seams custody
and signing contracts remain valid. Mobile transport and account linking stay
separate follow-up work.

## Standards and provider references

- [EIP-6963: provider discovery](https://eips.ethereum.org/EIPS/eip-6963)
- [EIP-1193: provider requests and events](https://eips.ethereum.org/EIPS/eip-1193)
- [MetaMask EIP-6963 example](https://github.com/MetaMask/vite-vanilla-ts-eip-6963)
- [Rabby integration guide](https://rabby.io/docs/integrating-rabby-wallet)
- [Phantom EVM provider](https://docs.phantom.com/ethereum-monad-testnet-base-and-polygon/getting-started)
