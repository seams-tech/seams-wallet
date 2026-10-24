# ML-DSA-65 GMW CPU screen

Date: October 24, 2026. Branch: `ml-dsa`. Source parent: `4e055e7e`.

The production runtime stays unchanged. The tested CPU-loop extraction establishes no useful complete hosted signing gain.
The five-second target remains open. The candidate patch and measurements remain in the evidence archive.

The unselected candidate separates synchronous Boolean gate work from the resumable transport function.
GMW evaluates private Boolean circuits with prepared correlations between two participants.
The gate expressions, traversal, messages, correlations, output masks, and wipe order stay unchanged.
A private enum gives each phase only the references and public role that it requires.
It never survives across an `await`.

## Checked measurements

| Fact | Instrument and scope | Result |
| --- | --- | --- |
| Fixed native workload | Five interleaved genuine-OT runs per arm, 105 independent expected outputs | A median 11.496 to 10.640 ms. B median 11.521 to 10.592 ms. |
| Compiled boundary | Wasm code-section parser checked against exact Wasm symbol digests, both roles | Async body 15,322 to 12,747 bytes. Helper 2,624 bytes. Combined bodies grow by 49 bytes. |
| Native compatibility | Both mixed-version role directions | 105 outputs, 2,467,738 AND gates, 168 exchanges. Directional byte counts match. |
| Local lifecycle | Separate real workerd runs with calibrated signing profiles | Three OpenSSL-verified signatures per arm. Activation, restart, admission, rollover, and replay checks pass. |
| Cancellation | Local stalled peer sends two valid activation exchanges | Original deadline holds. Consumed pair stays retired. Expired take fails. Private AND-exchange cancellation is untested. |
| Native lifecycle | Six canonical key-generation cases, prepared signer and durable pools | Canonical key checks pass. Pool lifecycles pass. Expected material exhaustion remains recorded. |

Native timings include pipe and peer waits. They exclude preprocessing and do not predict hosted performance.
Native lifecycle runs overlapped builds, so their timings are functional evidence only.
Local full signing workloads differ in rejection count and cache history.
The local results establish no complete signing speedup.
Profiler weights include sampled wall time. They are not provider-billed CPU measurements.

## Hosted results

| Arm | Prepared registration | Verified signing | Signatures below five seconds | Initial preparation |
| --- | --- | --- | --- | --- |
| Original control, recovery fails | Creation 4.885 s | Creation 4.179 s | 1/1 completed | Creation 68.523 s, failed recovery 54.498 s |
| Unchanged-control repeat | 4.652–5.202 s | 2.331–6.656 s | 5/6 | 48.297–49.326 s |
| Candidate | 4.120–5.330 s | 1.892–9.155 s | 4/6 | 51.933–84.704 s |

Both successful arms reproduce the same canonical key in creation and recovery.
One of two registration operations finishes below five seconds in each arm.
All thirteen completed hosted signatures have complete A/B signing traces.
The repeat captures 1,096 invocations. The candidate captures 976.
Neither capture reports truncation. That flag does not prove complete event capture.
The candidate has one B pool exception: `ML-DSA preprocessing lease is inactive`.
Its exact call does not join to a specific command. Expected cancellation or a hidden preparation failure remains unproved.
No consumed material ID repeats across observed operations within an arm.

Candidate and repeated-control rejection counts differ. The table does not establish a causal slowdown or improvement.
Control consumes 7, 1, 1, 4, 3, and 5 pairs. Candidate consumes 3, 1, 4, 1, 2, and 2 pairs.
Generic-pair observed activation medians are 178.5 ms for control and 466 ms for candidate.
Private-check medians are 288.5 and 756.5 ms. These participant-clock intervals include CPU and waits.
Committed-pair check medians are 294.5 and 343.5 ms, with only twelve and four role/pair observations.
Zero restoration intervals do not establish zero CPU cost.
The candidate has fewer rejected pairs overall and still establishes no useful complete-Worker gain.
The slower observed generic intervals justify rejecting this deployment, without establishing their underlying cause.

The candidate misses the target and adds a phase abstraction without a useful demonstrated complete-Worker gain.
The runtime source returns exactly to its parent. The tested patch remains archived.

The same policy applies throughout: four prepared candidates, two consumed candidates per pair, and thirty-two candidates of capacity.
Admission requires sixteen ready candidates. The cooldown is sixty seconds, with one active signing operation.
Wallet-seed recovery, standard FIPS seed/key export, private commitments, and Worker preparation stay unchanged.

Registration includes client canonical-key verification after preparation is ready.
Signing ends after HTTP decoding. OpenSSL verifies the result afterward.
Browser authentication, NEAR submission, and chain finality are outside these timers.
Preparation here includes key-generation material and sixteen initial signing candidates.
It is different from a four-candidate refill measurement.

The controls and candidate run sequentially. The repeated control reuses its namespace.
Placement, load, module tiering, cache history, and rejection counts remain uncontrolled.
The forwarding Router binary is frozen and identical across arms. Its source predates the three freshly built ML-DSA roles.
No sustained refill or multi-wallet capacity qualification follows from this bounded campaign.

## Failed control and causes

The original unchanged control completes creation, then recovery preparation returns HTTP 500.
The provider reports an inactive Durable Object connection in participant A.
Four messages describe one invocation. They do not establish four separate incidents.
A's last unfinished observed boundary is `store_signing_stock`, sequence 1730.
B is canceled. Neither participant reaches final readiness acknowledgment.
Router and admission records confirm durable unclaimed-job retirement.
A bounded unchanged-control repeat then completes creation, recovery, and six signatures.
No production repair or relaxed test requirement explains that repeat.

| Candidate cause | Evidence | Status |
| --- | --- | --- |
| New helper caused the original failure | The failure runs original source | Contradicted for that incident |
| Inactive Durable Object connection at a storage call | Exact HTTP/job join and provider exception | Observed boundary |
| Application/runtime interaction | One repeat passes, underlying disconnect is unexplained | Open |
| Platform-only fault | No provider-internal cause is available | Unproved |
| Logging hides the final operation | No reported truncation, but an unfinished boundary has no terminal event | Capture still has limits |
| GMW CPU dominates every slow request | Profiles and phase clocks include other work and waits | Unproved |
| Large async function causes slow engine compilation | Smaller compiled body alone cannot establish engine behavior | Unproved |

Cross-worker clocks cannot establish the underlying failure order.
A passing repeat does not fix the failure or prove a platform-only cause.
Restart durability after this hosted failure remains untested.

## Rejected alternatives

A bound-only parallel-carry prototype reduces 42 layers to 30.
Its bound circuit grows from 28,415 to 48,383 AND gates, adding about 24.8% to full-candidate gates.
A smaller constant-modulus variant needs 35,071 gates and 45 layers.
Both were rejected before deployment. Neither changed the installed circuits or pinned schedules.
No universal equivalence proof is claimed for these unused prototypes.

An isolated warm Node/Wasm probe compares complete synthetic role-response encodings.
Removing the intermediate JSON value saves only about 0.02–0.03 ms on large replies.
The probe excludes HTTP, durable storage, encryption, and Worker startup. Hosted parity is unestablished.
The proposed production patch was never applied or compiled.

An initial two-helper extraction is optimized back into the async body.
The final shared helper remains separate in release Wasm.
This withdraws the first compiled-boundary hypothesis. Smaller async code does not itself establish lower total CPU or latency.

## Remaining implementation work

1. Prototype signing within the existing participant pool actor, to remove repeated root-Worker-to-pool RPC and response decoding.
   Preserve atomic single use, role separation, admission authority, original deadlines, refill fairness, and recovery alarms.
   Measure actual placement and CPU effects before selecting the design.
2. Resolve intermittent preparation storage/connection failures with exact call correlation and a replayable hosted failure campaign.
3. Repeat cold/warm lifecycle and sustained multi-wallet demand after starting stock is consumed.
   Close the material ledger and measure reserve restoration at the same capacity.
4. Complete release security review and public SDK composition qualification.
   Keep GPU and UI work deferred.

Both arms hit the same inherited bloat gate: 13,972 Rust duplicate lines against a 13,754 baseline.
The candidate does not increase that count. The baseline stays unchanged.

## Evidence and replay

The [summary](../evidence/ml-dsa-65-gmw-cpu-20261024.json) records the preserved policy, failures, verification, and cleanup.
The [compressed archive](../evidence/ml-dsa-65-gmw-cpu-20261024-data.json.gz) includes sanitized traces, source hashes, patches, and replay scripts.
The verifier checks policy, canonical recovery, material counters, native outputs, and nineteen stored signatures.
It also rejects all nineteen altered messages with Node/OpenSSL.

Run this command from the repository root:

```sh
python3 - <<'PYTHON'
import gzip, hashlib, json, pathlib, subprocess, sys, tempfile
base = pathlib.Path('docs/evidence')
summary = json.loads((base / 'ml-dsa-65-gmw-cpu-20261024.json').read_text())
path = base / summary['archive']['path']
assert hashlib.sha256(path.read_bytes()).hexdigest() == summary['archive']['sha256']
data = json.loads(gzip.decompress(path.read_bytes()))
script = pathlib.Path(tempfile.mkdtemp(prefix='ml-dsa-gmw-verify-')) / 'verify.py'
script.write_text(data['scripts']['verify.py'])
subprocess.run([sys.executable, str(script), str(path.resolve())], check=True)
PYTHON
```

All six temporary Workers are deleted after each deployment arm.
The archive excludes raw provider tails, credentials, role wrapping keys, and account identifiers.
An exact scan checks every approved credential value and both sets of local fixture keys before publication.
