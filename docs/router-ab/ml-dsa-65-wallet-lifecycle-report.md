# ML-DSA enrollment and retained-signer lifecycle

The SDK publishes an ML-DSA signer and enrolls its ordinary key on an existing
NEAR account. Recovered owners and full-owner linked devices can discover and use the
existing server-held signer through normal Wallet transaction methods.
Normal recovery keeps the public key and material epoch. Explicit participant restoration advances the epoch.

`near.signTransaction` and `near.signAndSendTransaction` take the published `signer` reference.
They preserve transaction review, nonce leases, independent signature verification, and ordinary NEAR submission.
Explicit `mlDsaSigningSession` options authorize a key-scoped operation budget and expiry.
Later operations retain review and can reuse that grant without another biometric prompt.
The Gateway atomically debits each new operation. It rechecks the grant and current owner before releasing results.

`keys.exportKey({ kind: 'ml_dsa_65', signer })` uses the existing export approval and viewer.
It derives the canonical FIPS seed in the export worker and checks the ordinary public key.
Applications receive completion status only. Seed-backed recovered owners can export.
Linked devices hold an Ed25519 Client-root envelope and cannot export a wallet seed they do not hold.

The SDK retains verified public custody completions before publication.
Startup and unlock retry those exact completions after a lost response or browser reload.
Installed completions can publish after the execution deadline while owner and epoch fences remain valid.
An expired unpublished creation can restart through fresh owner approval and a higher material epoch.
Both participant pools preserve any installed canonical public key. Published signers use the separate restoration flow.
The [release qualification](ml-dsa-65-sdk-release-qualification.md) records the interrupted-creation control and remaining review limits.
The journal never stores an unsealed seed or private protocol state.

Each signing participant now loads its encrypted key material and consumes its first prepared pair in one storage request.
This removes one storage round trip per participant. It changes no pool or cooldown policy.
The [hosted qualification](ml-dsa-65-sdk-release-qualification.md) measures the current combined flow.
It does not isolate this storage change. Consistent five-second performance remains open.

These functions ship through `@seams/wallet/advanced`:

| Function | Result |
| --- | --- |
| `addMlDsaNearSigner` | Runs existing-wallet signer publication, then owner-approved NEAR enrollment. |
| `restoreMlDsaNearSigner` | Re-establishes participant material from the active custody owner's wallet seed. Preserves the ordinary public key. |
| `enrollMlDsaNearSigner` | Enrolls an existing published signer reference. Checks finalized chain state before requesting another approval. |
| `resumeMlDsaNearEnrollment` | Checks an uncertain submission through a public continuation. It accepts no signing port. |
| `prepareMlDsaSignerInventory` | Requests a Gateway-issued read-only approval challenge. |
| `fetchMlDsaSignerInventory` | Returns public signer identities after fresh full-owner approval. |
| `serializeMlDsaWebAuthnApproval` | Serializes a native assertion and removes extension outputs. It requires no PRF result. |

## Enrollment

Supply an explicit Wallet Session reference, NEAR account reference, relying-party identifier,
and signer slot to `addMlDsaNearSigner`. Its `wallet` argument uses the existing public
`registration` and `near` capabilities. Its `nearClient` supplies finalized access-key reads.
Use the Wallet's configured NEAR network for that client.

The result distinguishes failed registration from a published signer. A published result
contains the enrollment outcome. Only `enrollment.kind === 'enrolled'` confirms chain readiness.
Publication and chain enrollment are separate durable facts.

Enrollment validates the publication's wallet against the supplied Wallet Session. It then
uses the existing NEAR approval surface for one self-addressed `AddKey` action with full access.
It never derives a private key or changes the ML-DSA participant protocol.
An existing full-access key returns `enrolled` without another owner prompt. An existing restricted key is refused.

NEAR access-key lists represent ML-DSA keys by a hashed handle. Transactions and `AddKey`
actions carry the full key. The implementation uses the existing Rust `PublicKeyHandle`
codec for this distinction, as specified by [NEP-645](https://github.com/near/NEPs/blob/master/neps/nep-0645.md).
The new Wasm export processes public key bytes only.

An RPC failure before submission returns `unavailable`. No owner signing request started.
An uncertain submission returns `pending` with a continuation containing public references.
Persist that continuation and call `resumeMlDsaNearEnrollment`. Resume recomputes identifiers
from the published key and reads finalized chain state. It never submits another transaction.
A resumed read cannot replace the full key with an independently supplied hash.
Caller objects are projected through the existing reference builders before submission or continuation storage.

## Recovery and linked devices

Normal wallet recovery first completes the existing seed-recovery and replacement-factor
ceremony. Its new active owner can then collect a fresh inventory assertion under the Wallet
origin. The recovered factor does not need to receive an ML-DSA signing share.

First call `POST /wallets/:walletId/ml-dsa/inventory/prepare`. The Gateway selects and retains
the nonce and expiry. Check for a `prepared` result before collecting the passkey assertion.
The SDK checks the returned actor and challenge against the configured Wallet origin.

The approved read uses `POST /wallets/:walletId/ml-dsa/inventory`. Its proof binds the wallet, relying
party, credential, random nonce, expiry, and actual configured origin. The Gateway bounds
validity to five minutes and requires the exact issued challenge and authority. It verifies the assertion, commits the authenticator counter, and
rechecks the active authority before returning metadata. It consumes no ML-DSA pool material.
The issuer retains one challenge per actor and origin. Repeated preparation reuses a live
challenge. Expiry or an authority change replaces that record. Caller-selected future
timestamps or nonces cannot authorize inventory.

Inventory returns either a published public key manifest or an explicit unpublished phase
for each stored registration. It refuses malformed records and oversized inventories instead
of silently omitting entries. The caller can retain the returned public references after
recovery or device linking. Signing still needs a separate exact-transaction approval.

The first linked-device release requires all four owner permissions and an installed NEAR
activation. Signing-only devices remain outside ML-DSA admission. An ECDSA-only linked
authority also lacks this NEAR access. The existing device-linking ceremony must complete
target activation before its authority can resolve as active.

Each request uses the selected method's own passkey and current authority digest. The
Gateway retains its counter, revocation, publication-version, and wallet-generation checks.
A revoked linked method loses inventory, fresh signing, and cached-signature access.
Other owners retain their separate access.

The retention path leaves the ML-DSA publication, seed binding, epoch, and participant shares
unchanged. It restores access to durable server material.

## Participant restoration

Call `restoreMlDsaNearSigner` with the recorded signer and its slot. The active custody owner
approves a new intent with the exact public key, manifest, and previous material epoch.
The existing custody worker opens that owner's wallet-seed envelope with its Passkey factor.
It derives fresh participant shares through the existing private protocol.
This path also works after ordinary wallet recovery establishes a replacement owner factor.
Linked devices continue to use the existing server-held signer. They receive no wallet seed.

Restoration preserves the canonical FIPS key and its existing NEAR enrollment.
Both participants must reproduce the recorded public key and manifest before publication.
The new material epoch must exceed every previous attempt. Each attempt pins its encrypted
inputs before dispatch. Exact retries reuse the same operation.

Public signing stops while restoration is pending. Previous preparations and cached
signatures fail the publication-version checks. Authenticated inventory returns a `restoring`
entry with the recorded public key, manifest, epoch, current phase, and retry time.
After an interrupted attempt expires, another browser can use that reference for a new attempt.
An expired restoration never releases the slot for unrelated key creation.
The wallet custody envelope, recovery codes, pool capacity, and signing cooldown remain unchanged.

## Browser admission findings

The full browser campaign exposed two production integration gaps that seeded authority fixtures did not reach.

The first gap compared the intent's environment key with D1's canonical environment ID.
Read-only SQL confirmed both values in records for the same failed wallet.
An independent reviewer checked the raw records and the fix.

| Fact | Instrument and scope | Result |
| --- | --- | --- |
| The authority and Passkey method were active. The seed envelope belonged to that method. | Local Gateway D1, browser campaign, 2026-10-21 | Invalid custody ownership did not explain the refusal. |
| Storage used `local-smoke-project:dev`; the signed intent used `dev`. | Same wallet and completed start journal in D1 | The environment equality was false. |
| Earlier seeded fixtures used equal environment strings. | E2E fixture and passing control | The control did not exercise the two environment domains. |

| Candidate cause | Evidence | Result |
| --- | --- | --- |
| Invalid owner or seed envelope | Active, matching ownership records | Contradicted |
| Private ML-DSA protocol failure | Refusal preceded participant dispatch; no registration journal existed | Contradicted |
| Measurement mixed wallets | Both values came from the same wallet's stored start record | Contradicted |
| Gateway identity construction used the intent's environment key | Source construction and persisted values matched this prediction | Confirmed |

The registry now builds participant identity from its canonical tenant scope.
It checks that scope before execution, publication, inventory, and published-key reads.
The revised seeded campaign uses different intent and storage environment values.

The second gap was an SDK wire parser that required `application_binding_digest`.
Rust deliberately omits that derived field from serialization and recomputes it from the wallet and key identifiers.
The SDK now accepts the existing four-field Rust binding. Encrypted binding verification stays unchanged.

## Standard API boundary corrections

The [public controls](../evidence/ml-dsa-65-sdk-boundary-controls-20261021.json) retain RPC responses and the failing key bytes.

| Fact | Instrument | Scope |
| --- | --- | --- |
| The access-key-list fixture omitted block references. Both live RPC controls supplied them. | Shared fixture, live responses, and production decoder | The fixture needed correction. The decoder remained unchanged. |
| The failed AddKey's public key has 1,952 bytes. Its byte 40 equals the reported invalid permission tag, 180. | Read-only Gateway D1 and former Router decoder | Router read only 32 key bytes, then misread the next eight bytes as a nonce. |
| A full public key succeeds in `view_access_key`. Its hashed handle produces a parse error. | Live testnet query controls | Nonce reads now use the full public key. Enrollment still compares access-key-list handles. |
| Authorized seed import passed before the next request found a retained foreground reservation. | Browser export and subsequent normal signing | The ML-DSA branch omitted viewer-close progress. |

| Candidate cause | Result | Correction |
| --- | --- | --- |
| RPC outage caused the malformed list response. | Contradicted by both live controls and local decoder reproduction. | Add the required metadata to the fixture. Use live RPC for enrollment and finality. |
| Threshold signing caused the AddKey failure. | Contradicted. Router refused the public transaction before signing. | Replace the fixed-width key record with the exact tagged full-key enum. Existing Ed25519 vectors remain identical. |
| Closing the viewer required weaker foreground guards. | Contradicted by the existing export lifecycle. | Forward the original request's viewer lifecycle. Retain request and generation checks. |

## Full browser qualification

The [browser artifact](../evidence/ml-dsa-65-browser-lifecycle-20261021.json) records a passing
Chromium campaign against the public SDK, Gateway, D1, and local Cloudflare workerd.
The campaign includes four real 60-second cooldown waits. Its duration does not measure signing latency.

The original owner publishes the signer, reloads after a lost publication response, and unlocks.
Startup resumes the exact verified completion. The Wallet then approves a real testnet AddKey
through its Ed25519 signing path. Normal ML-DSA transaction signing starts from that enrollment.
A two-operation grant signs twice. The second operation succeeds with Passkey collection disabled.
A third operation requires fresh approval and fails while that collection remains disabled.
A separate browser context and authenticator
complete QR linking before recovery. The linked owner discovers the same key and signs.
The source browser then loses its original authenticator and local wallet storage.
Recovery uses a saved code and creates a distinct Passkey. The recovered owner unlocks,
discovers the existing signer, signs, and revokes the linked device.
The revoked credential loses ML-DSA inventory access.

The recovered owner exports through the normal `keys.exportKey` method and the Wallet viewer's Copy action.
OpenSSL imports the canonical seed, reproduces the public key, and produces an independently verified ordinary signature.
The test captures Copy inside the Wallet frame and preserves the OS clipboard. It retains no seed in evidence.
Closing the viewer releases its original foreground reservation before the next normal signature.

The recovered owner then calls public participant restoration. D1 confirms that the admitted
method is the recovered method. The public key and manifest stay unchanged at material epoch 2.
Signing succeeds again. All five threshold signatures pass independent OpenSSL verification.
The saved transaction bytes also verify independently after artifact export.
The final restored-key transaction reaches successful `FINAL` execution on NEAR testnet.
The runner checks its exact hash, full ML-DSA public key, sender, and zero-value self-transfer.
The consumed recovery code is refused. All sixteen browser checks pass.

Every approval selects the exact credential ID. The three owner credentials are distinct.
The original authenticator is removed before recovery, so a synced old Passkey cannot silently
approve the recovered owner's operations. Traces, screenshots, and video remain disabled.
The saved artifact contains public metadata and signed transactions.

With current SDK, server, Wasm, Worker, and native investigation builds, repeat the campaign
on free ports and a fresh private runtime directory:

```sh
SEAMS_INTENDED_SKIP_BUILD=1 \
SEAMS_LOCAL_PORT_OFFSET=1000 \
SEAMS_INTENDED_APP_URL=http://localhost:6201 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:5100 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:6202 \
SEAMS_INTENDED_ROUTER_AB_ROOT="$(mktemp -d /private/tmp/ml-dsa-browser.XXXXXX)" \
SEAMS_INTENDED_TRACE_DIR=/private/tmp/ml-dsa-browser-evidence \
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts \
  e2e/intended-behaviours/ml-dsa.lifecycle.contract.test.ts --reporter=line
```

The campaign uses live testnet RPC for Wallet-approved key enrollment and final ML-DSA transaction submission.
These browser results do not qualify hosted Cloudflare latency or regional capacity.

## Evidence

The [testnet enrollment artifact](../evidence/ml-dsa-65-key-enrollment-20261021.json) records
an Ed25519-owned disposable account that adds the previously verified threshold-generated
ML-DSA key. The runner checks the exact `AddKey` action and successful `FINAL` outcome.
It independently computes the expected SHA3 handle with Node OpenSSL.
After an injected lost acknowledgement and RPC outage, continuation resumes without a second
broadcast. A repeated enrollment also preserves the single broadcast. A different wallet is
refused before submission.

The account's owner signature uses a disposable Node Ed25519 key and the production native
NEAR codec. This test qualifies enrollment orchestration and chain encoding. The Wallet's
Ed25519 approval UI remains covered by its existing tests.

The [composed Worker artifact](../evidence/ml-dsa-65-lifecycle-20261021.json) adds recovered
and linked full-owner authorities through shared branch-specific fixture factories. It then
uses actual Gateway routes, local D1, fresh P-256 assertions, and local A/B Workers.
The SDK and Node OpenSSL independently verify the resulting ML-DSA signatures.

The cases check retained-key discovery and signing, unchanged custody/publication, shared
wallet cooldown, rejection of signing-only and ECDSA-only linked devices, revocation of
cached and fresh access, and continued access from a separate recovered owner.
The additional controls reject an unissued nonce, an extended inventory expiry, and an inventory assertion
presented as transaction approval.
The current campaign passes 22 registration checks, 20 signing checks, 11 session checks,
12 retained-signer lifecycle checks, and 10 participant-restoration checks.
Session controls cover concurrent budget claims, exhaustion, exact retries, and revocation.
The restoration campaign deletes A's encrypted share,
expires an admitted restoration, refuses unrelated creation in that slot, and retries at epoch 3.
The ordinary FIPS key and manifest stay unchanged. Fresh signing succeeds with independently
verified signatures. Old signing results and old execution requests remain fenced.
The separate testnet enrollment campaign passes six checks.

The SDK build, Wallet/server types, lifecycle type fixtures, intended-test types, generated
Wasm import checks, and isolated package consumers pass. The package checks include the new
advanced ML-DSA imports and reject declaration aliases that degrade their inputs to `any`.
All 38 Cargo lockfiles pass the locked check. The bloat check retains the inherited Rust
duplication excess of 13,939 lines against 13,754. Its baseline remains unchanged.

These authority fixtures begin at completed recovery/device activation. They cover real
Gateway, D1, and Worker behavior with shared authority factories.
They do not qualify browser recovery-code or QR-link ceremonies by themselves.
The earlier [hosted browser campaign](ml-dsa-65-browser-hosted-report.md)
qualifies signing and finality under its documented existing-owner fixture scope.
The [full hosted SDK campaign](ml-dsa-65-sdk-release-qualification.md) now repeats recovery-code ceremonies,
QR linking, canonical export, restoration, and finalized signing against real Cloudflare Workers.
Its browser assets remain local and its Console admission uses a disposable static authority.

Repeat the enrollment campaign with a private output directory:

```sh
cargo build --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml
wasm-pack build wasm/near_signer --release --target web --out-dir pkg
node tests/e2e/ml-dsa-enrollment.e2e.mjs <private-directory> <enrollment-evidence.json>
```

The runner uses only a disposable testnet faucet account and public ML-DSA fixture metadata.
It never writes the disposable Ed25519 private key to the artifact.

Repeat the composed campaign with separate local participant keys and matching strict Worker builds:

```sh
node tests/e2e/ml-dsa-registration-worker.e2e.mjs <private-role-key-directory> <lifecycle-evidence.json>
```

## Preserved requirements

- Wallet-seed derivation and canonical FIPS seed/key export remain unchanged.
- Preparation remains on Workers. Groups prepare four candidates and consume independent pairs.
- Pool target remains 32 candidates, with 16 ready candidates required for admission.
- The wallet cooldown remains 60 seconds. Linked and recovered owners share that wallet limit.
- GPU preparation and UI redesign remain deferred.
- No new cryptographic protocol or stronger privacy claim is introduced.
