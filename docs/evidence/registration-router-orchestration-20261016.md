# Registration orchestration and B execution claims — October 16, 2026

The implementation removes one Router-to-object call and one B pair-record write.
Correctness checks pass. The local comparison shows no material latency change.
Hosted savings remain unmeasured.

Implementation commit: `18b095207b1f2cb1b700d9d3201a7d7de4b6d9c0`.
Control source: `cc7fd4c42ff19bc1264f2f001be7269bf7154ba4`.
The control includes the preceding finalization changes and Claude's accepted
retry work. Concurrent ML-DSA and UI edits were excluded from both frozen builds.

## Changes and durable boundaries

| Successful registration path | Control | Candidate |
| --- | --- | --- |
| Router execution calls into its wallet object | Claim, then finish: 2 calls | Execute: 1 call |
| Router claim and completion writes | 2 | 2 |
| B pair lifecycle writes | Prepared, Running, Completed: 3 | Running, Completed: 2 |
| B tenant-root D1 admission | Required | Required |

The Router wallet object now claims the registration, runs orchestration, and
records completion. Each state transition uses the existing storage transaction.
Network work runs outside those transactions. The same claim generation and lease
rules govern retries, concurrent requests, and relocation.

B keeps unused encrypted input and its exact scope in a bounded instance queue.
B combines that input with its first durable `Running` record. `Prepared` is an
advisory acknowledgement. Restart or expiry can discard unused input. An exact
retry supplies it again. Durable Running, Completed, Burned, and Expired records
retain their existing meaning. The queue holds no decrypted role share.

Cancellation guards the first Running INSERT in the same SQL statement. B refuses
the upgrade if that guard fails. The Router and B retain normal storage output
gates: outgoing messages wait for write confirmation. See Cloudflare's
[storage documentation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
Yao arithmetic and messages did not change.

The review caught an ownership gap before deployment. Relocation originally
counted only SQL state and could miss B's queued input. The implementation now:

- Counts live queued inputs before source fencing or destination reservation.
- Discards expired unused inputs consistently on queue access.
- Checks the relocation fence again before queue insertion, after the root read.
- Lets a frozen source answer admission reconciliation without writing. It returns
  Completed for a stored completion and Fenced otherwise, including after restart.

## Correctness evidence

Release builds passed for Router, Deriver A, Deriver B, Signing Worker, and tenant
root control plane. The bloat check and diff check passed. Independent source
review found no remaining production blocker after the relocation fix.

- **22 real-Worker connection scenarios passed.** These include both arrival
  orders, lost preparation replies, input eviction and expiry with exact retry,
  duplicate Router and role requests, cancellation before B's claim, changed
  generation, wrong scope, disconnects, and terminal retries.
- **5 prompt-preparation scenarios passed.** Prepared execution, expiry,
  abandonment, cancellation, and admission failure with online fallback.
- **4 home scenarios passed:** US, WEUR, APAC, and OC. They exercise stored object
  addresses, lost completion replies, Ed25519 and ECDSA signing, and relocation
  destination preparation. Local hints do not prove physical regional placement.
- The SQL observer saw only Running and Completed writes in successful B runs.
  Cancellation before Running produced no successful pair write, no upgrade,
  and no protocol message.
- A completed Router reply survived object eviction. Replaying it ran no protocol.
- All **48 comparison signatures** verified independently: 24 Ed25519 and 24 ECDSA.
  The evidence JSON retains signatures, digests, public keys, and WASM hashes.

Harness failures were classified before changes. The connection harness needed
stored object addresses. A duplicate Router result uses HTTP 200 with
`recoverable_failure`, rather than the test's assumed 409. The changed-generation
case burns both roles on the unchanged control too. The ECDSA composition needed
the existing Gateway service credential. These were valid test updates.

The new cancellation injection initially omitted required `peer_settled`. The
corrected test requires confirmation that its fence succeeded before inspecting
protocol traffic. Restart replay has a dedicated scenario; forced eviction during
the duplicate-socket scenario encountered Miniflare's active-reference timeout.

## Combined local measurement

Six sequential groups used the order control, candidate, candidate, control,
control, candidate. Each group ran all four home scenarios. Each arm therefore
contains 12 registrations, 12 Ed25519 signatures, and 12 ECDSA signatures.

| Local span | Control median | Candidate median | Control range | Candidate range |
| --- | ---: | ---: | ---: | ---: |
| Router registration execution | 295.8 ms | 295.4 ms | 287.3–343.0 ms | 286.2–313.0 ms |
| Ed25519 prepare + sign HTTP | 69.6 ms | 69.1 ms | 60.5–77.6 ms | 59.6–80.0 ms |

These spans use real release Workers, SQLite-backed objects, D1 emulation, and
independently verified signatures. They exclude the browser, passkey interaction,
Console, Gateway finalization, and client fixture computation. They also exclude
Cloudflare's network and remote write-confirmation costs. They are not full
registration or full client MPC totals.

The median differences are too small to establish a latency gain. The lower
observed maximum does not establish a tail improvement. Keep the implementation
for the verified reduction in serial calls and writes. Measure hosted latency
when staging is available.

## Reproduction and remaining work

The committed scripts are:

- `crates/router-ab-cloudflare/scripts/yao-peer-disconnect-evidence.mjs <scenario>`
- `crates/router-ab-cloudflare/scripts/registration-prompt-evidence.mjs`
- `crates/router-ab-cloudflare/scripts/wallet-home-placement-evidence.mjs`

Build all five roles with `scripts/build-strict-worker.sh` in
`crates/router-ab-cloudflare`, then run the scripts from the repository root with
`ROUTER_AB_WORKER_BUILD_PROFILE=release`. Each script writes a repeatable JSON
artifact under `.artifacts/`.

The frozen sources, build logs, scenario logs, comparison driver, and six raw
comparison artifacts are in `.artifacts/router-wallet-execution-20261015/`.
The committed [evidence JSON](registration-router-orchestration-20261016.json)
contains the result, signature proofs, and source and binary hashes. A second
verification of the saved JSON passed all 48 signatures. Repeat it from the
repository root:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
const path = 'docs/evidence/registration-router-orchestration-20261016.json';
const evidence = JSON.parse(readFileSync(path, 'utf8'));
for (const row of evidence.signatureProofs) {
  const a = row.ed25519;
  const b = row.ecdsa;
  assert(ed25519.verify(
    Buffer.from(a.signatureB64u, 'base64url'),
    Buffer.from(a.digestB64u, 'base64url'),
    Buffer.from(a.publicKeyB64u, 'base64url'),
  ));
  assert(secp256k1.verify(
    Buffer.from(b.signatureB64u, 'base64url').subarray(0, 64),
    Buffer.from(b.digestB64u, 'base64url'),
    Buffer.from(b.publicKeyB64u, 'base64url'),
  ));
}
console.log(`Verified ${evidence.signatureProofs.length * 2} signatures.`);
JS
```

**Remaining:** run a bounded hosted control/candidate comparison after Claude
releases staging. His R155J idle-gap experiment was active during this work.
No staging request, deployment, infrastructure change, or publication was made
for this comparison. R155J remains Claude's task.
