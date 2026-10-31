# ML-DSA MVP release gates — October 31, 2026

The local and hosted public lifecycle gates pass. The [final hosted report](ml-dsa-65-mvp-hosted-report.md) records the remaining performance and scaling limits.
This campaign corrected missing signing-session consent and a cold-registration preparation gap.

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
The consent correction changes no CSS, cryptographic code, wire format, recovery policy, or pool setting.

## Verification

The [initial local evidence](../evidence/ml-dsa-65-mvp-gates-20261031.json) records exact source and artifact hashes.
The consent implementation is committed as `0fb7fb4df4ee34c0e9b34edf1bd2ef80e8247881` on `ml-dsa`.
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
| Bloat check | Inherited failure | Rust duplicated lines remain 13,992 against a 13,754 baseline. The cold-preparation correction retains this same inherited count |
| Final hosted lifecycle | Pass | Final public SDK lifecycle, recovery, export, device linking, restoration, and NEAR finality pass. Capacity and latency limits remain in the final hosted report |

The initial local lifecycle independently verifies eight standard ML-DSA signatures.
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
The initial accepted tarballs remain in `/private/tmp/ml-dsa-mvp-gates-20261031/packages-before-cold-fix`.
Final unpublished tarballs remain in `/private/tmp/ml-dsa-mvp-gates-20261031/packages`.
The earlier local receipt predates the authorized hosted campaign and retains its historical zero-deployment counts.
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

1. Handle candidate exhaustion without losing the user's transaction context. Preserve operation binding, cooldown accounting, and single-use material.
2. Reduce cold generic preparation cost and idle expiry-maintenance work. Measure complete useful output with unchanged per-wallet capacity.
3. Repeat a fresh balanced two-group cohort after verifying directory rollout. Qualify the selected operational profile before expansion.

The [final hosted evidence](../evidence/ml-dsa-65-mvp-hosted-20261031.json) records the completed campaign and exact implementation commit.
The cold settings case now starts preparation automatically and completes in 69.23 seconds.
Prepared registration and consistent three-to-five-second SDK signing remain optimization targets.
The fifteen approved temporary Workers, their Durable Objects, four databases, and two buckets are deleted.
Authenticated resource lists verify their absence. The earlier quiet-producer fleet remains outside this cleanup approval.
No production release or merge occurred.

Wallet-seed recovery, standard FIPS export, two-at-once consumption, and per-wallet capacity remain unchanged.
Preparation stays on Workers. Default operation remains one service group, one preparation slot, one signing slot, and a sixty-second cooldown.
