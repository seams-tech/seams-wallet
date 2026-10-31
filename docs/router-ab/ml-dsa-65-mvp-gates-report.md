# ML-DSA MVP release gates — October 31, 2026

The current local lifecycle and package gates pass. The final Cloudflare lifecycle and larger wallet-group screen remain open.
This campaign found and corrected a missing signing-session consent notice.

## Implementation

A new reusable ML-DSA session now requires one visible Wallet-origin approval after the exact grant exists.
The notice states the total operation limit and maximum duration. It includes the current transaction.
Caller text, `uiMode: none`, and automatic approval cannot suppress this notice.
The existing iframe surface controller presents the approval. Signer configuration remains in Signing keys settings.

The client conservatively creates a foreground surface whenever a NEAR request carries a session policy.
It cannot know whether Wallet will use an existing session or create a grant.
This may allocate an unnecessary surface for a warm request. It preserves the required approval for new grants.

Two obsolete browser checks also changed. The drawer now opens Signing keys instead of the retired Export keys item.
The removed Signing key / Change picker test no longer specifies transaction UI.
No CSS, cryptographic code, wire format, recovery policy, or pool setting changed.

## Verification

The [public evidence](../evidence/ml-dsa-65-mvp-gates-20261031.json) records exact source and artifact hashes.
The implementation is committed as `0fb7fb4df4ee34c0e9b34edf1bd2ef80e8247881` on `ml-dsa`.
The browser runs started at `cd714be06` with the recorded fix applied. Their evidence retains that original revision.

| Gate | Result | Scope |
| --- | --- | --- |
| Full browser lifecycle | Pass | Public SDK, separate local Workerd participants, live NEAR testnet enrollment and finality |
| Onward device linking | Pass | Original, linked, onward-linked, Email OTP, and recovered owners retain canonical export rights |
| Ordinary NEAR and ECDSA | Pass | Both production browser cases skip optional ML-DSA cryptography |
| Current settings and confirmation UI | 17 passing cases | Includes cancellation coverage after obsolete selectors were retired |
| Final cancellation selection | 9 passing cases | Separate repeat of a subset of the UI coverage |
| Configured type checks | Pass | Wallet and intended-browser application use their configured `tsrs` commands |
| Exact package acceptance | Pass | Real pack, install, runtime entries, and static assets for Wallet, Wallet Server, and VoiceID 0.34.0 |
| Worker package identity | Pass | All 48 files across five ordinary and three dedicated ML-DSA Worker builds match the final package |
| Browser Wasm identity | Pass | All eight module hashes remain unchanged through the consent fix |
| Bloat check | Inherited failure | Rust duplicated lines remain 13,992 against a 13,754 baseline. This task changes no Rust source |
| Current hosted qualification | Pending | Fifteen local Wrangler deployment dry runs pass. No new cloud resources or credentials were uploaded |

The full lifecycle independently verifies eight standard ML-DSA signatures.
It covers warm sessions, budget exhaustion, Email OTP challenge binding and rollback, recovery, owner revocation, canonical export, and participant restoration.
A restored signer completes a finalized NEAR testnet transaction.
The app also requests hidden automatic approval and supplies replacement text. Wallet still presents the required session notice.

Run the retained public verification with:

```sh
node docs/evidence/ml-dsa-65-mvp-gates-20261031.mjs
```

This verifies all eight retained signatures and rejects altered messages. It checks the recorded receipt invariants.
It does not rerun browser execution, package installation, source review, or hosted tests.
Use the existing isolated intended-behaviour runner to repeat those browser cases.
Exact unpublished tarballs remain in `/private/tmp/ml-dsa-mvp-gates-20261031/packages`.
Raw development logs and secret credentials stay outside the public evidence.

An initial claim that the package used outdated Worker builds was withdrawn.
The package prepack step refreshed those builds. Every ordinary and dedicated ML-DSA Worker file matches the final build.
An ad hoc `tsc` command produced errors in existing compiler-specific fixtures. The configured package type checks pass.
No production type was widened to satisfy that invocation.

## Privacy review boundary

The bounded source-only review covers role-local secrets, output opening after bound checks, single-use material, exact operation binding, and export authorization.
It also covers the consent correction and iframe presentation. It found no additional concrete blocker in that scope.
This result does not establish a complete protocol composition proof or FIPS module validation.

The combined-view and commitment-entropy proof remains incomplete. Exact silent-OT security parameters and V8 timing and erasure remain assumptions.
Storage encryption does not protect against database rollback. Classical X25519 storage encryption and base OT do not establish post-quantum preparation confidentiality.

Canonical FIPS seed/key export and standard signature verification remain required and tested.
The online protocol uses fresh joint signing masks. This differs from the prescribed hedged nonce derivation in [FIPS 204](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf).
A complete FIPS signing-algorithm conformance claim is outside the established result.
The [Dilithium leakage analysis](https://research.dial.uclouvain.be/server/api/core/bitstreams/db763926-a2e9-4daa-8993-489aed9a3eca/content) informs the documented public-value disclosures.
It does not prove this implementation's complete combined view.

## Remaining high-impact steps

1. Run the corrected public SDK lifecycle against fresh Cloudflare Workers. Keep exact versions and package hashes with the receipt.
2. Compare four active wallets in one group with eight active wallets in two groups. Add inactive wallets and test short idle return.
   Count verified signatures, failed work, empty-pool waits, and complete reserve restoration. A short idle window does not qualify one-hour expiry behavior.
3. Select the bounded pilot configuration from those results. Integrate the reviewed changes into `dev` when authorized.

The concrete deployment and credential scope is ready at `/private/tmp/ml-dsa-mvp-gates-20261031/hosted/hosted-upload-scope.md`.
It includes cleanup for the new fifteen Workers, four databases, and two buckets.
Specific approval for these fresh payloads and destinations remains pending.
The earlier eight quiet-producer Workers also retain their separate cleanup-approval requirement.

Wallet-seed recovery, standard FIPS export, two-at-once consumption, and per-wallet capacity remain unchanged.
Preparation stays on Workers. Default operation remains one service group, one preparation slot, one signing slot, and a sixty-second cooldown.
