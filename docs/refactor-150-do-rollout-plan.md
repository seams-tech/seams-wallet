# R150 DO rollout plan

Status: proposal (2026-09-29). Nothing in this document is authorized to run
in staging or production. Each step marked **Authorization** needs the
owner's explicit approval at the time, after the step before it has passed.
Nothing is deployed to staging or production today; only the isolated
`r150-bench-*` comparison resources exist.

## Decision inputs

- The hosted pilot (see [hosted comparison](./refactor-150-hosted-comparison.md#results))
  met the directional criterion.
  - DO's p95 signing was 28-35% lower in WEUR and ENAM, and 23% lower near
    the D1 primary.
  - Registration was within 6% either way.
  - There were no signature or authority-correctness failures.
  - It cost at most $0.64.
- ENAM's D1 arm has 17 samples, short of the complete gate's 20.
- Before the release decision:
  - **Authorization (decision):** enable DO for new wallets, accepting ENAM's
    17 D1 samples or rerunning ENAM's D1 cases first.
  - **Authorization (cost):** confirm the monthly product cost ceiling
    ([cost analysis](./refactor-150-cost-analysis.md)). The pilot's $25 cap
    was an operational stop, not that ceiling.

## 1. A production wallet-object build (this repo)

Today the wallet objects for Deriver A, Deriver B and the SigningWorker build
only as harness features. The published package ships only the D1 builds.
The Router's wallet object is the exception: it is already in every Router
build, bound as `ROUTER_WALLET_DO`, migration `router_ab_router_wallet_v1`.

Work:
- **Production features.** Add a non-harness feature per role that selects the
  wallet-object paths the harness features select today.
  - Deriver A: the Yao routes to `RouterAbDeriverAWalletDurableObject`.
  - Router: pair outcomes and historical replay.
  - Deriver B: `RouterAbDeriverBWalletDurableObject`.
  - SigningWorker: material and ECDSA on
    `RouterAbSigningWorkerWalletDurableObject`.
  - Keep the harness names for the local and bench builds only.
- **Test switches out of release builds.** `R150_TEST_B_BURN_BEFORE_COMPLETE`
  (`wallet-do-b-completion-harness`) and `R150_TEST_ECDSA_INTERRUPT_AFTER_CLAIM`
  (`wallet-do-signing-worker-harness`) must not compile into any published
  build. Move each behind a dev-only feature, as the `local-intended-*`
  features are.
- **Committed Worker configs.**
  - Add the missing bindings and SQLite migrations to `wrangler.deriver-b.toml`
    and `wrangler.signing-worker.toml`:
    - `DERIVER_B_WALLET_DO`, tag `r150-deriver-b-wallet-sqlite-v1`;
    - `SIGNING_WORKER_WALLET_DO`, tag `r150-signing-worker-wallet-sqlite-v1`,
      after `router_ab_signing_worker_v4`.
  - Deriver A and the Router already have theirs. Confirm that Wrangler
    applies the Router's top-level `[[migrations]]` in each env.
  - `tests/r150-hosted/preflight.mjs` already checks the bench arms against
    these configs.
- **Packaging.**
  - The release build selects the production features.
  - `copy-cloudflare-router-runtime.mjs` ships that build.
  - `artifact-manifest.json` records the wallet-object migrations beside the
    D1 migrations, so a deploy can check them.
- **Release checks.** `docs/router-ab/deployment.md` names only the
  tenant-root and presign-session DO migrations. Add the four wallet-object
  migrations, and the rule that a Worker binary is never rolled back across
  an applied DO migration.
- **Verification.**
  - The consolidated contracts on all three hosts at the release revision,
    with the Google credential.
  - A bench redeploy of both arms from the packaged artifacts, then a smoke.
    This proves that the package, not the harness build, runs the wallet
    objects.

## 2. Release, and seams-monorepo consumption

- **Exact versions.** Publish `@seams/wallet` and `@seams/wallet-server` at
  one exact version through `release-wallet-packages.yml`. It checks the
  version input against both `package.json` files and builds without the
  harness.
- **Minimum revision.** Release from `dev` at or after the merge of this
  branch (e0777b0). That revision has item 21's Yao skew fix (a8d32e0) and
  the restored `@seams/wallet-server/router/express` entry (b74937c). No
  release before them may be used.
- **Monorepo pin.** In seams-monorepo, pin that exact release and deploy
  its artifacts unrebuilt (`router-ab/deployment.md`). Record the version
  and the manifest fingerprints in the monorepo's target, and check the
  manifest against the deployed release.
- **Deploy order** per lane, from seams-monorepo, with `pnpm deploy:backend
  plan|build|migrate|preflight|deploy|smoke`:
  1. Migrate the Gateway signer D1.
  2. Migrate and deploy the SigningWorker, then Deriver A and Deriver B.
     Their DO migrations apply with their deploys.
  3. Deploy the tenant-root control plane, then the Router.
  4. Deploy the wallet runtime, then the Gateway.
  5. Run the smoke.
- **Signer migrations.** Remote `d1 migrations apply` rejected the
  trigger-bearing signer SQL during the pilot ("incomplete input"). The
  pilot's import helper is for bench stores only. The monorepo's migrate
  step needs a supported path for these files before the first lane.
- **Staging first.** Deploy `staging-testnet`, run the consolidated smoke
  there, and keep it for the cohort's rehearsal.
  - **Authorization:** each lane's deploy.

## 3. Clean reset (Phase 3)

The production wallets are test-only and may be erased
([regional wallet homes](./refactor-150-regional-wallet-home-lanes.md)).
There is no conversion or compatibility route.

1. **Inventory** what the reset erases and what it keeps.
   - It erases the wallet-owned rows in the Gateway signer D1 and the
     role-private D1s (Yao pairs, SigningWorker material), plus any wallet
     objects.
   - It keeps tenants, configuration, tenant roots and their private D1
     tables, the presign-session and tenant-root-creation DOs, applied
     migration history, and recovery copies.
   - The inventory also records dependencies and the reset order.
2. **Rehearse** the reset on staging and verify that the DO-only path
   registers, signs and exports afterwards.
3. **Authorization:** run the production reset as its own coordinated
   operation, with registrations stopped. It is never part of a deploy.

## 4. Small DO-backed new-wallet cohort

- Enable registrations on the DO path for a small cohort. The cohort gates
  are in the [cost analysis](./refactor-150-cost-analysis.md):
  - wallet-local state is authoritative in DO SQLite, with no hidden D1 dual
    writer;
  - latency, correctness, isolation and restart gates pass;
  - cost stays within the confirmed ceiling.
- Monitor latency, errors and cost per role, and reconcile the projected
  cost with the real bill. The pilot's GraphQL cost report is a starting
  point.
- **Rollback:** stop new registrations. DO wallets are never routed back to
  D1 state. A Worker binary is not rolled back across a DO migration.
- **Authorization:** enabling the cohort, and each widening after it.

## 5. Remove the superseded D1 paths

Only after the cohort shows the DO path has replaced them:
- Deriver A and B: `yao_pair_sessions` in each role's private D1, and the
  D1 pair routes.
- SigningWorker D1:
  - `signing_worker_activations`, `_activation_revocation_fences`,
    `_lane_material` and `_secret_states`;
  - `_round1`, `_ecdsa_pool`, `_effect_claims` and `_terminal_responses`;
  - their routing.
- The Router's D1 burn-pair paths, which the wallet object's outcome
  replaced.
- The TypeScript D1 adapters kept for the comparison
  ([state ownership map](./refactor-150-state-ownership-map.md)).

Keep, by design:
- every Gateway `SIGNER_DB` family;
- the tenant-root tables in each role's private D1;
- the presign-session and tenant-root-creation DOs;
- applied migration history.

Removal ships as an ordinary release with its own contract run.

## 6. After the pilot

- Re-run the cost report before removing the `r150-bench-*` resources,
  since usage is billed late. Remove only the inventoried bench resources,
  with the owner's approval. The D1 comparison backend is no longer needed
  once the decision is made.
- **Deferred:** geographic migration, independent regional D1 databases,
  AWS/GCP provisioning, and full source retirement and cutover. Source
  retirement is reachable and untested (supported operations, decision 2).
  It needs an explicit release decision before any lane: keep it, gate it
  until the drain rule exists, or keep it by decision.

## Authorization points, in order

1. The rollout decision and the monthly cost ceiling.
2. Publishing the release that carries the production wallet-object build.
3. Each lane's deploy: staging first.
4. The production clean reset.
5. The cohort, and each widening.
6. Removing the superseded D1 paths.
7. Removing the bench resources.
8. The source-retirement release decision.
