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

Before deploying, confirm the account, probe provider/hosts, spend cap,
prospective latency and monthly cost criteria, exact resource inventory,
ingress authentication, and that the selected build exposes no unauthenticated
dev fault, debug, or material-export endpoint. Verify a smoke registration and
signature in both arms, then run the bounded matched pilot. Cloudflare's current
[DO](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/), and
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) rates
must be applied to measured usage and the account's actual billing plan.
