# R155: regional signing protocol feasibility

Status: first source and executable checks, October 5, 2026. Supports further
implementation design for [R155](refactor-155-regional-wallet-signing.md).
Complete regional device installation remains unverified.

## Finding

**Both signing protocols can preserve the wallet public key while separate
execution sessions use fresh one-use material.** The local experiment also reused
the original owner client shares. Geographic placement is absent from the stable
key-derivation inputs.

The current product still binds authority, sessions, and signing requests to exact
material activations and logical SigningWorker identities. It cannot select an
unrelated regional activation through an existing session without a contract change.
Copying role data alone does not create independent regional authorization.

| Question | Result |
| --- | --- |
| Can both cryptographic protocols sign the same wallet key through separate regional sessions? | Yes in the local protocol experiment below. The regional names are labels within one process. |
| Can the original owner client shares remain usable? | Yes for the tested stable derivation inputs. The Ed25519 experiment created three separate activations with distinct SigningWorker names. ECDSA used independently derived server shares and separate presign sessions. |
| Can existing device credentials retain their identities in another store? | Yes in the production authorization-store probe, with exact activation and authority records preserved. It checks two fixture device authorities and existing credentials. |
| Does the SDK already support several regional installations for one device? | No complete path was established. Current session subjects require the authority's exact activation. Regional pool selection and execution assignment are missing. |
| Are linked-device regional installation, recovery, and revocation fully verified? | No. Their binding contracts were inspected; the composed multi-region flow remains open. |

The evidence supports cryptographic feasibility. It does not close R155's complete
wallet-and-device installation gate or supersede R153/R154.

## ECDSA findings

The stable context contains the application binding digest and fixed protocol
parameters. `derive_client_share` and `derive_relayer_share_for_client_public`
derive the additive shares from that context and their existing secret inputs.
Region, database identity, and Worker URL are absent.
[Context encoder](../crates/router-ab-ecdsa-derivation/src/shared/context.rs),
[share derivation](../crates/router-ab-ecdsa-derivation/src/shared/derive.rs).

Separate client/SigningWorker presign sessions can use those shares. Their pair
contexts bind the wallet public key and presign session ID. Each region needs
unique session allocation and fresh randomness. Relabeling a copied presignature
cannot establish exclusivity.
[Presign sessions](../crates/router-ab-ecdsa-presign/src/session.rs).

The experiment independently derives each regional server share, generates a
fresh presignature pair, and signs with the original client share. The online
finalizer verifies the signature and recovers the expected public key. It also
rejects a frame from another presign session and a second extraction of completed
presign output. All three regional nonce points differ.
[Online signing](../crates/router-ab-ecdsa-online/src/lib.rs).

The product normal-signing scope includes the full activation, SigningWorker ID,
recipient key, key epoch, and activation epoch. Production validation compares the
scope with the installed server material. Changing only the requested Worker ID
cannot make existing material valid for a new logical server.
[Scope](../crates/router-ab-core/src/protocol/router_ab_ecdsa_derivation.rs),
[`validate_cloudflare_router_ab_ecdsa_derivation_normal_signing_active_material_v1`](../crates/router-ab-cloudflare/src/lib.rs).

Linked-device ECDSA material has additional lane, participant, transcript, and
recipient bindings. Source-preserving provisioning can preserve the public key,
but its current recipient check requires the admitted key to match the local
SigningWorker. It is not a generic cross-region provisioning API.
[Linked material validation](../crates/router-ab-cloudflare/src/lib.rs),
[source-preserving reservation](../crates/router-ab-cloudflare/src/ordinary_inactive_signer_material.rs).

## Ed25519 Yao findings

The stable derivation context uses wallet ID, signing-key ID, signing-root metadata,
creation slot, and participant IDs. Client and Deriver contributions derive from
that context and their corresponding secret roots. Physical placement and selected
SigningWorker identity are absent from this derivation context.
[Context builder](../crates/router-ab-ed25519-yao-protocol/src/lib.rs),
[contribution derivation](../crates/signer-core/src/ed25519_yao_derivation.rs).

The experiment runs the real A/B Yao activation circuit three times. Each run has
a different ceremony session, activation ID, and logical SigningWorker name. The
stable inputs remain the same. All activations produce the same public key and
the same owner client share. All three installations remain in memory together.

The original client share participates in fresh two-party FROST signing with each
regional server share. Standard Ed25519 verification succeeds for each signature.
The original WEUR installation also signs after APAC and US have signed, without
replacement or another activation.

This experiment uses the transport-neutral circuit and signing APIs. It does not
install the resulting activation through Gateway, encrypted role stores, or the
SDK. Those layers have additional bindings.

Normal signing requires the activation's SigningWorker to match the request.
Existing recovery/source-preserving transitions require the same selected server
and signer set. A different regional server cannot be introduced by calling the
existing recovery transition with a changed server name.
[Normal-signing scope](../crates/router-ab-core/src/protocol/lifecycle.rs),
[`same_signing_identity`](../crates/router-ab-ed25519-yao/src/activation.rs).

Linked-device Ed25519 activation additionally verifies the committed lane identity,
holder-delivery receipt, and local server recipient key. These obligations must
remain intact during regional installation.
[Lane activation](../crates/router-ab-cloudflare/src/signing_worker/ed25519_lane_activation.rs).

## Device identity and product changes

Wallet/device authority and auth-method IDs do not identify a physical region.
The authorization probe copies exact records into an independent D1 database.
Existing primary and hosted credentials remain valid. A second device retains its
authority and credential without reissuance. Revoking the first device session
leaves the second active. Scope changes, expiry, and consumed exchanges are rejected.

These are fixture authorities exercised through production stores. This probe
does not link a real device or install its cryptographic material in several regions.
Its result must remain separate from the protocol experiment.
[Authorization probe](../tests/e2e/authorization-storage-transfer.e2e.mjs).

The source review identifies these concrete changes or decisions:

| Boundary | Current behavior | R155 implication |
| --- | --- | --- |
| Session and authority | `exactWalletSessionCapabilitySubjectsResolveAuthority` compares each subject with one exact activation for that key family. | Distinct regional activations need an explicit authorized installation relationship. Keep wallet/device identity stable and preserve revocation and quota ownership. |
| Material identity | Both protocols bind normal signing to an activation and logical SigningWorker. | Keep logical replicas identical, or provision and authorize distinct regional activations. Never weaken the existing binding checks. |
| Device material | Linked material seals bind authority, factor, package digest, and complete activation. | Existing sealed bytes remain valid only with those bindings. A new activation needs a valid installation and local material record. |
| Client presign pools | Pool identity binds the public URL, complete signing scope, and activation. No explicit physical executor distinguishes replicas of that same scope. | Add an authenticated executor/pool partition or equivalent exact routing before several regions serve the same logical activation. Keep presign/finalize/retry on their assigned executor. |
| Regional preparation | ECDSA presigning exchanges client and server messages. | Server-only refill cannot prepare the corresponding client share. Establish preparation while the device is online and measure first-use readiness. |
| Tenant custody | Root-use admissions retain epoch obligations and pair-object references. | Preserve shared tenant-root authority. Regional pair references must resolve the correct physical executor during refresh and retirement. |
| Deployment | Private generation derives logical server names from Worker names; deployment supplies lane IDs as encryption environment labels. | Separate physical location from logical identity, or perform valid new installation. An independently generated deployment is not an interchangeable replica. |

Sources: [session/authority matching](../packages/wallet-server/src/authorization/domain.ts),
[linked material seal](../packages/wallet/src/core/indexedDB/linkedAuthoritySignerMaterial.ts),
[pool identity](../packages/wallet/src/core/signingEngine/workerManager/ecdsaPresignPoolIdentity.ts),
[root-use records](../crates/router-ab-cloudflare/migrations/deriver-a/0017_tenant_root_root_use_admission_claims.sql).
Private deployment sources are `deployment/wallet-system/scripts/generate-github-env-values.mjs`
and `scripts/deploy-backend.mjs` in `seams-monorepo`.

## Supported direction and remaining decision

The smallest candidate preserves each device's existing logical activation and
long-lived role material. Regional replicas generate independent one-use material.
A separate regional executor identity binds permission, pool selection, and effects.
This reduces changes to device credentials and activation references.

Distinct regional SigningWorker identities are also plausible at the cryptographic
layer. They require an explicit multi-installation model in authority, session,
provisioning, and SDK state. They can support separate transport/encryption keys,
with additional installation and lifecycle work.

Neither option permits copying usable one-use state or independently regenerating
tenant roots. New tenant derivation inputs can change wallet keys. Copying sealed
role records also requires their original encryption context or a valid role-owned
re-encryption step. The permission service must never collect the role secrets.

Choose between these options before changing protocol or lifecycle types. Next,
prove the chosen installation path with a founding device and a linked device,
both protocols, separate durable stores, restart, revocation, and recovery. Preserve
all identity checks and test that stale regional material cannot resume execution.

## Executed evidence and reproduction

Reviewed public source at `235eb98714f77261c53d4e3e4d1653b33260ce45` plus this
validation change. Private deployment source is
`8a40b44d3fa2aeaebd8ef4289b37fed066c4320e`. Concurrent frontend changes are outside
the checked protocol paths. The checkpoint retains hashes of relevant source files.

Run from `seams-wallet`:

```sh
cargo test --offline --locked --manifest-path crates/router-ab-ed25519-yao/Cargo.toml --release --test real_role_relay
node tests/e2e/authorization-storage-transfer.e2e.mjs
```

The Rust integration target passed all four tests in 0.39 seconds, excluding
compilation. The new protocol scenario verifies three regional ECDSA signatures,
three regional Ed25519 signatures, and a return signature from the original
Ed25519 installation. The production authorization-store probe also passed.
These durations are not geographic latency measurements.

The [protocol scenario](../crates/router-ab-ed25519-yao/tests/support/regional_installations.rs)
writes `.artifacts/r155/protocol-feasibility/evidence.json`. It records public keys,
messages, verified signatures, public nonce points, distinct Ed25519 activation
references, the source revision, and the runner hash. It contains no secret material.

Retained evidence in `.artifacts/r155/protocol-feasibility/`:

- `evidence.json`: SHA-256 `93debb00002d8d2cf48dc0a1ca1e54cce9b0758d3cc87130487428db9b390b1e`.
- `authorization-evidence.json`: SHA-256 `3bf0f49cf1a6499561e1cda825b9b3405b6532b818bb4482262ddbaffeb9c7b7`.
- `checkpoint.json`: commands, results, source hashes, artifact hashes, and scope limits.

Fresh randomness changes signature and artifact hashes on subsequent runs. Verify
the new run's assertions and evidence together. No hosted deployment, complete
multi-region SDK installation, execution fencing, or latency result is claimed.
