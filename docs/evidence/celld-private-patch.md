# Private celld binding proof

The private `0.6.2-seams.1` build passes the local cross-script object capability test.
The original [stock-runtime failure](celld-bindings.md) remains reproducible with celld 0.6.2.
This proof adds no Wallet forwarding endpoint and changes no application protocol.

## Measured behavior

The test creates an object with the verified upstream binary. The private binary continues using that same local store.
It checks the following results:

| Scenario                            | Result                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Workerd reference through Miniflare | Service and object bindings reach the same object.                                            |
| Stock-to-private upgrade            | State and object ID remain unchanged.                                                         |
| External reference and alias        | Both access paths reach the owner's object.                                                   |
| Environment ownership               | The object receives the owner's environment, distinct from the caller's.                      |
| Process restart                     | State and object ID persist.                                                                  |
| Object-only dependency              | The owner loads without a service binding to it.                                              |
| Router-shaped cycle                 | The owner calls a service whose object binding points back to that owner.                     |
| Wrong or missing owner              | Startup fails with the corresponding owner-resolution error.                                  |
| Return to valid deployment          | Previously committed state remains accessible after the rejected deployments.                 |
| Downgrade                           | Stock 0.6.2 refuses `external-durable-objects-v1` when loading the existing patched manifest. |

The downgrade check uses celld's internal local-store setting, as `celld dev` does.
It invokes the original runtime directly. It does not rebuild the deployment with the old deploy command.

## Evidence and reproduction

- [Generated responses and refusals](celld-private-patch/result.json).
- [Runtime source, patch, toolchain, and binary identity](celld-private-patch/runtime-build.json).
- [Old-runtime rejection](celld-private-patch/downgrade.txt).
- [Wrong-owner rejection](celld-private-patch/wrong-owner.txt).
- [Missing-owner rejection](celld-private-patch/missing-owner.txt).

The original object-only patch is retained in Git history. The private deployment repository now owns the combined `deployment/celld/workers-runtime.patch` and its build instructions.
The patch is based on celld source `90b43017241f81189453d326d05948f388b34652`.
It applies to a clean copy of that revision. All ten patched files match the source used for this build.
Access to that private patch is necessary to reproduce the candidate executable.

Run the committed capability test with the candidate and verified original executables:

```sh
node tests/e2e/celld-bindings.e2e.mjs \
  /absolute/path/to/private-celld \
  /absolute/path/to/stock-celld-0.6.2
```

The generated result records the Wallet revision and harness hashes alongside both binary hashes.
No cloud credentials or real Wallet data are used.

## Scope of the original object-only proof

The patch retains celld's requirement that each application Durable Object class name has one owner in a fleet.
Our current role classes have distinct names. Two independent owners declaring the same class remain unsupported.
External references reuse the owning namespace. Object addressing and persistent storage scopes remain unchanged.

An independent reviewer checked the patch, harness, and initial successful run.
The review requested direct upgrade and downgrade evidence. The final run adds both checks.
No blocking owner-resolution defect was found under the unique-class constraint.

That original test uses macOS ARM64 and a debug build. It does not establish production performance or distributed durability.
The complete Wallet graph, release WASM, signing, recovery, live reload, relocation, managed upload paths,
Linux, AWS, Google Cloud, and Confidential VMs remain unverified.
Separate A/B backup-bucket isolation was open at that checkpoint. The later storage extension verifies physical separation locally.
The existing hosting implementations remain in place.

## Physical bucket extension

The later private `0.6.2-seams.2` build also passes this object-binding scenario.
Its storage scenario is `tests/e2e/celld-storage.e2e.mjs` and uses a pinned Moto 5.1.14 S3 emulator.
It checks separate A/B physical buckets, concurrent 9 MiB streams, multipart uploads, conditional writes,
restart, direct storage reads, configuration refusals, and failed writes after bucket removal.
The private deployment repository retains generated build, storage, and packaged Worker graph records under `deployment/celld/evidence/`.
Cloud permissions, distributed durability, and complete Wallet lifecycle acceptance remain open.

## Current runtime and Wallet checkpoint

Private `0.6.2-seams.4` passes the expanded binding scenario and the physical-storage scenario.
The build adds workers-rs binding identities and unread streaming response cloning to the prior object and physical-bucket patch.
The stream control fails on `.3` with the same error as real browser signing. The `.4` build preserves both readable copies.
It rejects cloning a locked, consumed, or disturbed body.
The recorded workerd reference permits cloning after a partial read and reader release.
That difference remains explicit; the checks do not claim complete API parity.

- [Current pristine-source build identity](celld-private-patch/current-runtime-build.json).
- [Current binding and stream results](celld-private-patch/current-bindings.json).

The private deployment repository also retains the exact Wallet Server and SDK 0.9.3 lifecycle run.
All six unchanged browser contracts pass: mixed registration/signing, lost-response retry, quota contention,
Router signature replay, unlock/export/shared-budget signing, and recovery after response loss.
Its harness requires all six named tests to pass without skips. A separate forced-node-kill check recovers the same tenant-root result.
The browser recovery contract resets the browser runtime; it does not kill celld during recovery.
VM-only direct SigningWorker ledger checks remain unmeasured on this Workers branch.

The Linux ARM64 release builds with locked dependencies and Clippy warnings denied.
A focused container scenario verifies the shared object/stream fixtures and persisted state after restart.
The six browser lifecycle contracts have been run on macOS ARM64 debug, not that Linux release.
AWS, Google Cloud, Confidential VMs, distributed failures, the remaining lifecycle matrix, and cutover qualification remain open.
The existing Node/Express and native VM hosts remain in place until those gates pass.
