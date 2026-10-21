# Celld cross-script Durable Object compatibility

Celld 0.6.2 fails the cross-script object gate required by our current Worker topology.
The fault is in celld, not in our Worker configuration.
The private `0.6.2-seams.7` runtime passes the same gate on October 21. See the [private runtime proof](celld-private-patch.md).
Keep the existing hosting implementations until the remaining consolidation gates pass.

This is an `environment_or_infrastructure_failure`: the proposed runtime cannot load a required binding graph.
It is not evidence of a Wallet production regression. Do not change Wallet authorization or state ownership to satisfy this probe.

## Measured result

The probe starts two Workers with the same JavaScript on both runtimes.
The owner exports a Durable Object. The caller reaches that object through a service binding and an external object binding.
One counter must persist across both paths. A successful service call alone cannot satisfy this contract.

| Fact                                          | Instrument and control                                                  | Observed result                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Local workerd accepts the graph               | Miniflare runs both scripts and both bindings                           | Service increments to 1. External object increments to 2. Service reads 2.                      |
| Celld loads the owner and stores state        | Released binary with `celld dev`, fresh directory                       | Local object increments to 1.                                                                   |
| Celld resolves a service target after restart | The caller loads the named owner deployment from the same dev directory | Service increments to 2 and reads 2.                                                            |
| Celld rejects the external binding            | Add only `durable_objects.bindings` to the caller configuration         | Startup fails: `Durable Object class TenantRoot is exported by more than one co-hosted script`. |

Each run uses a fresh directory. The service control retains the owner's state across process restarts.
No test replaces the expected success with an assertion that celld must fail.
The capability test exits with status 1 until both runtimes satisfy the same object-ownership contract.

The macOS allocator warning appears in successful and failed cases. It does not distinguish them.

## Runtime and source identity

- Celld release: `v0.6.2`, source `90b43017241f81189453d326d05948f388b34652`.
- Platform: macOS ARM64, Node `v26.4.0`.
- Reference: Miniflare `4.20260710.0`, workerd `1.20260710.1`.
- Celld archive SHA-256: `b81a38299800679e9651fd7c1544540185682dcb59eed1a24c8cc36c6b31e76d`.
- Celld executable SHA-256: `92ededd2bcfebeb1e78cc2d97219f00214a79eb6606f0eef48208fca3f98c15a`.
- `gh attestation verify` passed before execution. Its provenance identifies the source revision above.
- Generated results record the Wallet source revision, harness hash, fixture hashes, time, versions, responses, and startup failure.

The raw evidence is in [celld-bindings/result.json](celld-bindings/result.json).
The accompanying logs contain only synthetic test data.

## Cause analysis

| Candidate cause                                                      | Workerd passes | Celld service control passes | External binding fails before ingress  | Assessment                                    |
| -------------------------------------------------------------------- | -------------- | ---------------------------- | -------------------------------------- | --------------------------------------------- |
| Invalid Worker JavaScript or object contract                         | Contradicts    | Contradicts                  | Says nothing                           | Removed                                       |
| Missing named deployment or lost local storage                       | Says nothing   | Contradicts                  | Loaded graph reports a duplicate class | Removed                                       |
| Harness cannot start celld or make requests                          | Says nothing   | Contradicts                  | Explicit runtime error                 | Removed for this failure                      |
| Celld treats an external object binding as a local class declaration | Fits           | Fits                         | Fits                                   | Supported by runtime output and pinned source |
| Full Wallet protocol or cryptography failure                         | Says nothing   | Says nothing                 | No Wallet protocol executes            | Outside this probe                            |

The pinned [deployment parser](https://github.com/denoland/celld/blob/90b43017241f81189453d326d05948f388b34652/crates/celld/deploy.rs#L1400-L1426)
collects each binding's class as a local class and omits `script_name` from its metadata.
The [generation builder](https://github.com/denoland/celld/blob/90b43017241f81189453d326d05948f388b34652/crates/celld/generation.rs#L529-L599)
rejects a user class declared by multiple scripts. The observed startup error matches that path.

## Configuration recheck

On October 21, direct stock-runtime controls removed the two configuration causes.
Each control starts the caller in a dev directory where the owner is already deployed.
The raw record is [celld-bindings/stock-current.json](celld-bindings/stock-current.json).

| Candidate cause                          | Control                                            | Observed result                                                          | Assessment |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| The caller omits `script_name`           | One external binding with `script_name = "owner"`  | Same startup error: `exported by more than one co-hosted script`.        | Removed    |
|                                          | The same binding without `script_name`             | The same error. Stock celld ignores the field.                           |            |
| The caller re-exports the class          | `caller.mjs` exports only its default handler      | No `TenantRoot` export exists in the caller.                             | Removed    |
| Celld treats a binding as a local export | Two bindings to the same owner class in one caller | `duplicate Durable Object class TenantRoot`: a second local-class check. | Supported  |

The production manifests set `script_name` on every external `RouterAbTenantRootCreationDurableObject` binding.
No configuration change in this repository can pass the gate on stock 0.6.2.

The current harness also checks streaming `Response.clone()` before the cross-script stage.
Stock 0.6.2 now stops at that earlier stage with `Cannot clone a streaming response before consumption`.
The direct controls above preserve the original cross-script measurement.

## Relevance and limits

Our [control-plane manifest](../../crates/router-ab-cloudflare/wrangler.tenant-root-control-plane.toml)
and both Deriver manifests bind the Router-owned `RouterAbTenantRootCreationDurableObject` through `script_name`.
The [Router manifest](../../crates/router-ab-cloudflare/wrangler.router.toml) owns the class and reaches the control plane through a service binding.
They must share one authoritative lifecycle object. Creating another namespace would change correctness.

The probe's caller reaches the owner through a service binding. The production graph reaches the caller from the Router.
Both place an owner and an external declaration of its class in one deployment graph.
Source analysis predicts the same collision in the production graph because celld registers classes across that complete graph.
The exact product graph was not executed.

This proves a local runtime capability failure. Full Wallet parity is not established.
The probe does not execute release WASM, registration, signing, recovery, Console composition, remote buckets, or distributed failover.
The workerd reference is local Miniflare. It is not a new hosted Cloudflare acceptance run.
Linux, AWS, Google Cloud, and Confidential VM execution remain untested.

Role-private storage is a separate unresolved gate. Celld's pinned
[R2 implementation](https://github.com/denoland/celld/blob/90b43017241f81189453d326d05948f388b34652/crates/celld/r2_store.rs#L45-L49)
maps bucket names to prefixes in the fleet bucket.
Our [deployment contract](../router-ab/deployment.md#secret-separation) requires distinct A/B backup buckets.
This source review does not prove a cross-role access exploit. It also does not establish that prefixes satisfy that contract.
Independent fleets still need a supported binding topology and access tests.

An independent review checked the harness, raw results, production manifests, and pinned runtime source.
It found no harness flaw that explains the measured failure. It required the topology and execution limits stated above.

## Repeat the gate

Install the repository's locked dependencies. Download and verify the pinned runtime:

```sh
mkdir -p .artifacts/celld-runtime
gh release download v0.6.2 --repo denoland/celld \
  --pattern celld-aarch64-apple-darwin.gz --dir .artifacts/celld-runtime
gh attestation verify .artifacts/celld-runtime/celld-aarch64-apple-darwin.gz \
  --repo denoland/celld
gzip -dc .artifacts/celld-runtime/celld-aarch64-apple-darwin.gz > .artifacts/celld-runtime/celld
chmod +x .artifacts/celld-runtime/celld
node tests/e2e/celld-bindings.e2e.mjs \
  "$PWD/.artifacts/celld-runtime/celld" \
  "$PWD/.artifacts/celld-runtime/celld"
```

With the stock runtime as both arguments, the test exits with status 1. Pass the private build as the first argument to check the fix.
Use the matching release asset on another platform. Recheck its attestation and record its hash.
The script prints its evidence directory and stops its child processes.
It uses loopback listeners and local celld storage. It requires no cloud credentials.

## Next acceptance condition

A candidate runtime must pass the object-ownership contract before application migration starts.
The private `0.6.2-seams.7` build now passes an expanded version of this check.
Then prove the complete role graph, exact release artifacts, storage isolation, and the remaining lifecycle gates.
The user selected a private runtime proof. Production adoption, a new HTTP object adapter, or a changed custody boundary still needs its own design decision.
No upstream issue, pull request, or maintainer contact was made.
