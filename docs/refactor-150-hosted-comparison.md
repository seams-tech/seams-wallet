# R150 isolated hosted comparison

Status: preparation. No hosted benchmark resources have been created or changed.
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

## Proposed isolated scope

- Use the currently authenticated Cloudflare account, subject to confirming its
  plan and a numeric incremental spend cap. The account was inventoried on
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
- Set each new D1 primary's location hint to `apac`. Probe from Tokyo,
  Frankfurt, and US East using hosts whose execution locations can be verified.
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
including dormant storage and refill. The monthly product cost ceiling and
incremental experiment spend cap still require confirmation before hosted
execution.

Stop at the pilot limit or earlier on unexpected usage, errors, or scope drift.
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

On a probe host with the Wallet worktree and browser dependencies installed,
set `SEAMS_INTENDED_ROUTER_URL` to the selected arm's HTTPS ingress and set
`SEAMS_INTENDED_BENCHMARK_ARM`, `SEAMS_INTENDED_PROBE_REGION`,
`SEAMS_INTENDED_BENCHMARK_RUN_ID`, `SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID`,
`SEAMS_INTENDED_PUBLISHABLE_KEY`, `SEAMS_INTENDED_SIGNING_WORKER_ID`, and
`SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN` to that
arm's isolated values. Then run:

```sh
SEAMS_INTENDED_EXTERNAL_GATEWAY=1 pnpm -C tests exec playwright test \
  -c playwright.wallet-intended.ci.config.ts \
  e2e/intended-behaviours/passkey.presign-pool.contract.test.ts \
  --grep 'unforced ECDSA registration and repeated signing'
```

This command runs one registration and two signatures. Alternate D1 and DO
invocations for 20 matched pairs per region, assigning a unique run ID to each
invocation. Stop once the cap is reached; retain failed attempts in the raw
sample set.

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

Before deploying, confirm the account, probe provider/hosts, spend cap,
prospective latency and monthly cost criteria, exact resource inventory,
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
