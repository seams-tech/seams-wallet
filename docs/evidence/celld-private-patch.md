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

The private deployment repository owns `deployment/celld/cross-script-objects.patch` and its build instructions.
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

## Scope limits

The patch retains celld's requirement that each application Durable Object class name has one owner in a fleet.
Our current role classes have distinct names. Two independent owners declaring the same class remain unsupported.
External references reuse the owning namespace. Object addressing and persistent storage scopes remain unchanged.

An independent reviewer checked the patch, harness, and initial successful run.
The review requested direct upgrade and downgrade evidence. The final run adds both checks.
No blocking owner-resolution defect was found under the unique-class constraint.

The test uses macOS ARM64 and a debug build. It does not establish production performance or distributed durability.
The complete Wallet graph, release WASM, signing, recovery, live reload, relocation, managed upload paths,
Linux, AWS, Google Cloud, and Confidential VMs remain unverified.
Separate A/B backup-bucket isolation is still an open design and validation gate.
The existing hosting implementations remain in place.
