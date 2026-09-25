# R150 isolated hosted comparison

Status: approved preparation. No hosted benchmark resources have been created or changed.
This is a pilot to decide whether the measured regional benefit warrants finishing
the DO conversion. It is not the R150 release gate.

## Current boundary

The matched [local diagnostic](./refactor-150-state-ownership-map.md#matched-local-gatewaybrowser-diagnostic-2026-09-25)
verified the D1 and wallet-DO authority selected for each arm. It could not
measure geographic latency. The existing browser runner starts local Workers,
and the DO candidate uses dev-build feature flags. Its local config generator
adds Deriver B and SigningWorker wallet-DO bindings and SQLite migrations that
the checked-in staging manifests do not have. Existing staging and production
resources must remain untouched.

## Approved isolated scope

- Use the currently authenticated Cloudflare account, subject to confirming its
  plan. The incremental experiment spend cap is **$25 USD total across Cloudflare
  and probe hosts**. The account was inventoried on
  2026-09-25; its existing D1 databases include shared staging and production
  stores. None is a benchmark store.
- Reserve `r150-bench-20260925-{d1,do}-` for new resources. The exact suffixes
  for each arm are:

  | Resource | Suffixes |
  | --- | --- |
  | Workers | `ingress`, `gateway`, `router`, `deriver-a`, `deriver-b`, `signing-worker`, `tenant-root-control-plane` |
  | D1 databases | `signer-db`, `deriver-a-db`, `deriver-b-db`, `signing-worker-db` |
  | R2 buckets, if role manifests require them | `deriver-a-backup`, `deriver-b-backup` |

  The DO arm additionally needs A, B, and SigningWorker wallet-object
  namespaces. Both arms retain the Router tenant-root-creation object. The
  ingress is the only public Worker; all custody Workers use service bindings.
  No role shares credentials, custody stores, or writable wallet state across
  arms.
- Generate synthetic, arm-specific keys and tenant roots. Use the same source
  revision, protocol, Gateway/client code, presign-refill policy, and request
  payloads. Serve the test app and wallet iframe from each probe host; send all
  custody requests to the arm's isolated HTTPS Gateway through an authenticated
  benchmark ingress. Disable implicit NEAR account test funding in both
  Gateways. No funded wallet, relayer transfer, or chain submission is part of
  the workload.
- Set each new D1 primary's location hint to `apac`. Probe from Tokyo (`nrt`),
  Frankfurt (`fra`), and US East (`iad`) using separately verified Fly.io hosts.
  Create fresh wallet objects from their probe region; record actual routing
  evidence. Cloudflare treats D1 and DO location hints as best-effort.

The proposed initial pilot limit is 20 fresh-wallet registrations and 40
ECDSA/Tempo signatures **per arm per region**, at concurrency one, alternating
one-case runs between arms. The current Wallet Session grants three uses, and
the matched browser case makes two signatures per new wallet. A 200-signature
cohort would require
an explicit reauthorization workload and separate measurement. Record
registration return, first signature, and subsequent signature separately;
preserve every raw sample, signature verification result, request fan-out,
background refill, Gateway D1 timing, role calls, rows, active duration, and
stored bytes. Fresh-wallet first requests and reused-wallet requests are separate
cohorts; they do not by themselves prove runtime cold starts.

Proposed directional decision criterion: at least 20% lower end-to-end p95
signing latency in both regions remote from the observed D1 primary, no more
than 10% p95 regression near the primary, and zero signature or
authority-correctness failures. Each arm and region yields 20 observations for
registration, 20 for first signing, and 20 for subsequent signing. Report
their p50/p95 descriptively because these cohorts are too small for a robust
tail-latency gate. Model cost at 10 and 20 signatures per wallet per week,
including dormant storage and refill. The monthly product cost ceiling still
requires confirmation before a release decision. The $25 pilot cap is an operational stop condition, not a monthly
product-cost acceptance threshold.

Stop at the pilot limit, before the $25 incremental cap, or earlier on
unexpected usage, errors, or scope drift. Do not upgrade a billing plan to
run this pilot. Record baseline and final Cloudflare usage and the probe-host
charges, leaving a margin for delayed metering.
No production route or existing wallet authority changes. Keep the isolated
resources until the raw artifacts and cost report are reviewed, then remove
only those explicitly inventoried benchmark resources.

## Preparation and execution gate

The existing E2E scenario now accepts `SEAMS_INTENDED_EXTERNAL_GATEWAY=1` and
targets a benchmark-prefixed HTTPS Gateway while keeping its test app and wallet
iframe local to the probe host. It requires explicit arm, region, run ID,
project environment, publishable key, SigningWorker identity, and a benchmark
access token. The browser attaches the token only to the selected ingress
origin; the ingress strips it before forwarding to the private Gateway. Hosted
Playwright traces, screenshots, and videos are disabled to keep request credentials
and wallet material out of diagnostic artifacts. Each repeated
run writes a distinct timing artifact. Local mode remains the default.

Build the Wallet SDK with `pnpm -C packages/wallet run build:sdk-full` from
the committed comparison revision, then run
`node tests/r150-hosted/probe/prepare-image-context.mjs`. It requires a fresh
Wallet distribution and a clean worktree. The command archives only committed
files, adds the built Wallet distribution, and writes the source/build
fingerprints plus three private Fly app configurations under a new ignored
`.runtime/r150-hosted/probe-image-*` directory. Build or deploy from that
returned directory only. It excludes uncommitted identity material, ingress
tokens, and other ignored runtime state from the image context. The pinned
Playwright image matches the repository's browser-test version. Each Fly app
has one 2-GB, two-shared-CPU Machine, no public service, and restart-persistent
rootfs; review the provider's current regional price before creating it.
Do not redeploy while results remain only on the Machine.

On each private Fly.io probe Machine, place a mode-0600 input at
`.runtime/r150-hosted/probe/<region>/input.json`. Populate each arm from its
rendered `probe-values/<arm>.json` and `ingress-secrets/<arm>.json`; copy the
secret token into `accessToken` without printing it. The `deploymentFingerprint`
is already in the rendered probe values. The input shape is:

```json
{
  "kind": "r150_hosted_probe_input_v1",
  "region": "nrt",
  "probe": {
    "provider": "fly",
    "region": "nrt",
    "instanceId": "<FLY_MACHINE_ID>",
    "appName": "<FLY_APP_NAME>",
    "observedAt": "<UTC timestamp>",
    "evidenceRef": "<private Fly machine status evidence file>"
  },
  "arms": {
    "d1": {
      "ingressUrl": "<D1 ingress HTTPS origin>",
      "environmentId": "<D1 environment ID>",
      "publishableKey": "<D1 publishable key>",
      "signingWorkerId": "<D1 SigningWorker ID>",
      "deploymentFingerprint": "<D1 SHA-256 fingerprint>",
      "accessToken": "<D1 ingress token>"
    },
    "do": {
      "ingressUrl": "<DO ingress HTTPS origin>",
      "environmentId": "<DO environment ID>",
      "publishableKey": "<DO publishable key>",
      "signingWorkerId": "<DO SigningWorker ID>",
      "deploymentFingerprint": "<DO SHA-256 fingerprint>",
      "accessToken": "<DO ingress token>"
    }
  }
}
```

Capture the Fly machine's control-plane status and runtime `FLY_MACHINE_ID`,
`FLY_APP_NAME`, and `FLY_REGION` in the private evidence file. The runner checks
the runtime values against the inventory before each attempt. The environment
region label alone does not prove physical location. Keep probe and billing
evidence available for review.

For case 1, run:

```sh
node tests/r150-hosted/run-sample.mjs .runtime/r150-hosted/probe/nrt/input.json 1 d1
node tests/r150-hosted/run-sample.mjs .runtime/r150-hosted/probe/nrt/input.json 1 do
```

For case 2, run `2 do` then `2 d1`; alternate that order through case
20. Repeat in `fra` and `iad`. Each invocation runs one registration and two
signatures. The runner records an attempt before any wallet work, caps each
region at 40 invocations, and refuses an automatic retry or continuation after
a failure. Each start and end event is flushed before the next action.
Continuation requires the same source, build, probe, deployment fingerprints,
and collected artifacts as every completed attempt. Reconcile any failed or
unfinished attempt explicitly; do not replace it silently to obtain 20
successes. Preserve each probe directory's
`attempts.jsonl` and `artifacts/` when collecting results.

Analyze all three collected probe directories with:

```sh
node tests/r150-hosted/analyze-samples.mjs <nrt-dir> <fra-dir> <iad-dir> --complete --output <private-report.json>
```

A partial report omits `--complete`. The complete
gate requires 20 successful observations per arm and phase in every region,
the same source revision and each arm's unchanged intended-deployment fingerprint.
It reports nearest-rank p50/p95, paired case deltas, Gateway request and refill
counts, and available Server-Timing coverage. It leaves cost and actual DO
placement unverified until independent usage and execution evidence is added.

The local app ports can be moved with `SEAMS_INTENDED_APP_URL` and
`SEAMS_INTENDED_WALLET_ORIGIN`. The hosted ingress must remain the only public
custody endpoint, and its access gate must be configured before this command
is used against live resources.

The isolated ingress configuration is in
[`tests/r150-hosted/ingress/wrangler.jsonc`](../tests/r150-hosted/ingress/wrangler.jsonc).
It binds to an arm-specific private Gateway, allows only the two local probe
origins, requires separate arm tokens and an expiry timestamp secret, and
forwards no token to the Gateway. Set `BENCHMARK_ACCESS_TOKEN` and
`BENCHMARK_EXPIRES_AT_MS` separately in each ingress environment. The latter is
a Unix timestamp in milliseconds and should bound the pilot window. Readiness
responses disclose only success or failure; readiness and custody paths require
the token. The ingress rejects local intended-test fault headers. The benchmark
Gateway entrypoint uses the shared production request handler and a static
Wallet Console binding for the isolated test tenant, without local fault
injection or a scheduled handler. Its static control-plane responses are part
of the benchmark setup and do not represent a deployed Console backend.
Both Gateway arm configurations are in
[`tests/r150-hosted/gateway/wrangler.jsonc`](../tests/r150-hosted/gateway/wrangler.jsonc).
Their D1 IDs are intentionally invalid placeholders until newly created
benchmark databases are inventoried. The deployment JSON secret must use the
same arm-specific organization, project, and environment IDs as its Gateway
configuration; the entrypoint rejects a mismatch. The Gateway is private and
keeps shared Wallet Session state in its own D1 database in both arms.
The Router, A, B, SigningWorker, and tenant-root control-plane configurations
are in [`tests/r150-hosted/roles`](../tests/r150-hosted/roles). They keep all
role Workers private, disable preview URLs, and bind only to arm-specific
services, stores, and namespaces. The DO arm alone adds A/B/SigningWorker
wallet objects. Both arms retain the Router tenant-root and SigningWorker
presign-session objects. All public-key and database-ID placeholders require
fresh benchmark bootstrap values before deployment; no staging key or database
identity is a valid replacement. Optimized D1 and wallet-DO binaries are built
to separate directories so one arm cannot overwrite the other's artifact.

Run `node tests/r150-hosted/prepare-identities.mjs` once before rendering
manifests. It creates fresh D1 and DO role, issuer, ceremony, ingress-token,
and service-auth material under the Git-ignored
`.runtime/r150-hosted/identities/` directory with private file permissions.
Reruns verify the recorded identity fingerprints and reuse the same material;
an incomplete identity directory fails closed. The generator reuses the local
role-identity primitives with an explicit per-arm tenant-root issuer input.
It does not fill D1 IDs, create tenant roots, deploy secrets, or touch hosted
resources. Keep the generated files off shared logs and artifacts.

After creating the eight benchmark D1 databases and determining the two
benchmark ingress HTTPS origins, record their IDs and origins in a private
JSON file:

```json
{
  "accountId": "ba924da36f2ffc3839e8d323000b66b4",
  "arms": {
    "d1": {
      "ingressUrl": "https://r150-bench-20260925-d1-ingress.<account-subdomain>.workers.dev",
      "databases": {
        "signer": "<new-D1-UUID>",
        "deriverA": "<new-D1-UUID>",
        "deriverB": "<new-D1-UUID>",
        "signingWorker": "<new-D1-UUID>"
      }
    },
    "do": {
      "ingressUrl": "https://r150-bench-20260925-do-ingress.<account-subdomain>.workers.dev",
      "databases": {
        "signer": "<new-D1-UUID>",
        "deriverA": "<new-D1-UUID>",
        "deriverB": "<new-D1-UUID>",
        "signingWorker": "<new-D1-UUID>"
      }
    }
  }
}
```

Use `node tests/r150-hosted/render-manifests.mjs <private-inventory.json>`
to render the two arm configurations and role secret bundles under ignored
`.runtime/r150-hosted/rendered/`. The renderer checks the exact Cloudflare
account, stable identity fingerprints, required public keys, database IDs,
same-arm ingress origins, and existing output before writing. It never prints
secret values and refuses to overwrite changed output. Run the manifest
preflight with `--root .runtime/r150-hosted/rendered --ready` and a Wrangler
dry-run for every arm and role before deploying. Pass an absolute `--outdir`
outside the rendered-manifest directory so Wrangler's bundles stay separate
from the private deployment inputs. Gateway and ingress secrets
remain separate setup inputs; their presence and expiry require live checks.

Cloudflare requires a service-binding target to exist before its caller is
deployed. The A/B and Router/control-plane graph has cycles. The renderer also
emits `first-pass/roles/` configurations for the same optimized private role
binaries, with only cross-Worker service and DO bindings removed. Deploy the
five roles in each arm from those first-pass configurations only after a
read-only Worker inventory proves those exact names are new and empty. Install
their separate role secrets, then deploy the complete role manifests without
deleting or recreating the Workers or their DO namespaces. Retire the local
first-pass config copies after final-binding verification. Keep the
Gateway and public ingress undeployed until every final binding and private
role is verified. The first pass has no wallet traffic and is a temporary
deployment step, not an alternate backend.

After the private role Workers are deployed, bootstrap each synthetic tenant
root through the local-only Worker in `tests/r150-hosted/bootstrap/`. Start
Wrangler development with its `d1` or `do` environment bound to
`127.0.0.1`; the selected service binding targets that arm's deployed private
Router. The adapter forwards only the exact tenant-root creation POST and
preserves the Router's internal authentication. Invoke the existing
`bootstrap-local-tenant-root.mjs` with the matching identity root,
`--issuer-env-path` pointing at that arm's private issuer file, and
`--router-url` pointing at the loopback adapter. Set `--grant-file` to a
private path inside that identity root: the signed grant is persisted before
dispatch and reused after a lost reply. An expired grant requires Router-state
reconciliation before any new attempt. Record and verify the returned ready
receipt before installing that arm's static Console deployment secret.
Cloudflare documents remote service bindings for local Workers; this repo path
still requires a live isolated smoke test before use. Never deploy the local
bootstrap adapter as a public Worker.

`node tests/r150-hosted/bootstrap/reply-loss.e2e.mjs` exercises a dropped
response followed by a fresh bootstrap process. It verifies replay of the
same signed grant and writes a private, non-secret result artifact under
`.runtime/r150-hosted/`.

Wrap the two successful bootstrap script JSON responses in a private receipts
file shaped as `{ "arms": { "d1": <D1 response>, "do": <DO response> } }`.
After checking each ready receipt against the intended arm, run
`node tests/r150-hosted/render-gateway-secrets.mjs <private-receipts.json> <ingress-expiry-unix-ms>`.
It requires private file permissions, verifies the persisted identities and
Router/Gateway public keys, and writes stable Gateway secret bundles plus
bounded ingress secret bundles and per-arm probe values under the rendered
directory. The expiry must be 5 minutes to 48 hours ahead; the renderer
refuses changed output on rerun. Synthetic or missing
receipts are never an authority check; the live bootstrap response and its
Router state must be verified before use. Gateway and ingress Workers should
remain undeployed until their own secrets and expiry are installed.

Before deploying, verify the account plan and Fly.io access, provision probe
hosts with recorded region/instance evidence, estimate the $25 cap from
current rates, and check the exact resource inventory,
ingress authentication, and that the selected build exposes no unauthenticated
dev fault, debug, or material-export endpoint. Verify a smoke registration and
signature in both arms, then run the bounded matched pilot. Cloudflare's current
[DO](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/), and
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) rates
must be applied to measured usage and the account's actual billing plan.

Run `node tests/r150-hosted/preflight.mjs` before provisioning to check the
checked-in arm isolation and public/private routing. Render a separate copy of
the manifests with fresh benchmark IDs and public keys, then run
`node tests/r150-hosted/preflight.mjs --root <rendered-manifest-directory> --ready`.
The ready check rejects unresolved placeholders, malformed or reused D1 IDs,
and cross-arm bindings. It reads manifests only.
It does not verify deployed Cloudflare state, installed secrets, the ingress
expiry value, the actual account, or the spend cap. Confirm those separately
before the first hosted request.
