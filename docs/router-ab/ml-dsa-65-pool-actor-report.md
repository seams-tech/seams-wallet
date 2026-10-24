# ML-DSA signing in participant pool actors

Date: October 24, 2026. Source parent: `715f4599`. Branch: `ml-dsa`.

Keep signing in the current role Workers. The pool-actor prototype misses the five-second target and is removed from the active runtime.
All six candidate signatures verify, but only three finish below five seconds.
The tested patch remains archived. The stronger concurrent-inspection E2E remains in the codebase.

The prototype executes signing inside each participant's existing wallet pool Durable Object.
A Durable Object is a Cloudflare actor with durable storage.
The role Worker authenticates and validates the request, then forwards it to the same wallet-derived actor identity.
The actor rechecks the live permit before execution.

Each later pair retains its admission lookup, A-side alarm scheduling, and transactional queue insertion.
Typed local transactions load material and consume prepared pairs.
They commit before decryption or protocol execution.
Peer and admission calls stay outside storage transactions.
The old `load_signing_inputs` command and unused caller-stage variant are removed.
No alternate execution flag or compatibility path is added.

The signature protocol, gate schedules, correlations, storage records, actor names, and SDK request/response encodings stay unchanged.
Private material remains within its participant boundary.
The passive, honest-execution privacy model gains no new assumption.
This focused review does not complete the release security review.

## Fixed policy

| Setting | Value |
| --- | --- |
| Prepared candidates per group | 4 |
| Consumed candidates per pair | 2 |
| Pool capacity | 32 candidates |
| Minimum ready capacity | 16 candidates |
| Hosted wallet cooldown | 60 seconds |
| Service signing capacity | 1 active operation |
| Signing deadline | 30 seconds |

Wallet-seed recovery and standard FIPS seed/key export remain required.
GPU and UI work remain deferred.

## Local behavior checks

The real-Worker control lifecycle passes at unchanged capacity.
Its stalled peer sends two valid activation exchanges.
The pool answers a concurrent inspection in 2.83 ms, before the signing deadline.
The consumed pair is already retired. Deadline overrun is 5 ms.
This check establishes B responsiveness during a network wait.
It does not establish A alarm progress or fairness during CPU-heavy signing.

The candidate lifecycle also passes with three OpenSSL-verified stored signatures.
Concurrent inspection returns in 2.69 ms. The pair is already retired, and deadline overrun is 9 ms.
Six injected 200 ms admission delays produce store-stage intervals of 202–204 ms.
The observer's `authorized` mark follows authorization and A-side alarm scheduling. Its interval includes both.

The lifecycle covers typed owner admission, duplicate reuse, restart, rollover, failed publication, producer handoff, and refill settlement.
The interruption occurs during activation. Private AND-exchange interruption remains untested.
The control run overlaps release compilation. Its timings are functional evidence only.
The candidate calibration injects authorization delays. Its timings are also unsuitable for a direct latency comparison.

## Hosted comparison

| Arm | Prepared create / recovery | Verified signing | Below five seconds | Initial preparation |
| --- | --- | --- | --- | --- |
| Current role Workers | 5.478 / 4.184 s | 1.205–4.850 s | 5/5 | 48.370–87.284 s |
| Pool-actor prototype | 4.415 / 4.904 s | 2.254–8.214 s | 3/6 | 65.537–68.344 s |

The control preserves the wallet cooldown at recovery, so that immediate request starts no signature.
Four later recovered-key requests complete in each arm.
Both arms reproduce the same canonical key across creation and recovery.
The two registration cases per arm establish no consistent latency guarantee or causal registration improvement.

Registration includes client verification of the canonical key after preparation is ready.
Signing ends after response decoding. OpenSSL verifies the signature afterward.
Browser authentication, NEAR submission, and finality are outside these timers.
Initial preparation includes key-generation material plus sixteen initial signing candidates.
These values are different from four-candidate refill times.

Control operations consume 5, 1, 2, 1, and 2 pairs. Candidate operations consume 4, 6, 7, 1, 1, and 3 pairs.
The control uses 11 pairs for five signatures. The candidate uses 22 pairs for six signatures.
These different workloads prevent a direct estimate of the complete latency effect.
Candidate creation uses fewer pairs than control creation and still takes longer to sign.

For A's later generic pairs, observed consumption medians are 110 ms in control and 22.5 ms in the candidate.
There are six and eight observations. The cached first pair is excluded from this consumption comparison.
Across all observed generic A pairs, activation medians are 164 and 421 ms. Private-check medians are 333 and 813.5 ms.
There are eleven control observations and ten candidate observations. Candidate generic capture contains A only.
The candidate also has ten committed role/pair observations, with a 637 ms private-check median.
This screen has no control committed-pair observations.
These are Worker-clock intervals, including CPU and waits. They do not isolate storage, CPU, or network RTT.

The captures contain 1,854 provider invocations, with no exception or truncation reports.
All ten expected control role traces appear. Only eight of twelve expected candidate role traces appear.
Three candidate operations lack a complete A/B capture. No reported truncation does not establish complete capture.
Several A signing traces appear under alarm invocations whose provider wall times are shorter than the signing interval.
Those record totals cannot be assigned to complete signing operations merely because they contain the corresponding log.
The source/runtime logging context and missing-trace cause remain unresolved.
No material ID is observed in two different operations for the same participant. The incomplete candidate capture prevents a complete hosted consumption ledger.

Fresh deployments run sequentially using the same six approved destinations and exact approved test credentials.
Placement, host load, rejection counts, module tiering, and cache history remain uncontrolled.
Provider CPU and wall time describe their recorded invocation context.
The observed alarm attribution prevents treating those totals as isolated signing CPU.
Per-pair Worker clocks include waits. A zero interval does not establish zero CPU cost.
Cloudflare describes default [service-binding execution](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) on one server thread.
Its [actor-placement documentation](https://developers.cloudflare.com/durable-objects/reference/data-location/) allows an actor to reside away from its caller.
This motivates a placement hypothesis. These tests do not identify the actors' physical locations or establish a placement cause.
The forwarding Router binary is identical across arms and predates this source parent.
The control's three ML-DSA binaries are reused from code-identical parent `4e055e7e`.
The intervening commit changes documentation only. Source hashes and the Git comparison record that reuse.
Local artifacts also contain ambient checkout and default-JavaScript metadata.
The campaign source maps, configured entrypoint hashes, and actual Wasm hashes identify the frozen binaries used.

## Evidence and remaining limits

| Fact | Instrument | Scope |
| --- | --- | --- |
| Pair consumption commits before protocol work | Existing transactional pool API and concurrent inspection | Real local Worker lifecycle |
| Store-stage observer sees a known delay | Injected admission wait and `take_store` events | Calibrated candidate lifecycle |
| Canonical recovery and ordinary signatures agree | Native canonical client and Node/OpenSSL | Hosted creation/recovery and stored signatures |
| Signing executes in the pool actor | Source routing and eight observed role traces associated with the pool entrypoint | Hosted candidate |

| Candidate cause | Evidence | Status |
| --- | --- | --- |
| Repeated material RPC adds work | Original source fetches and decodes every pair | Confirmed old path |
| That RPC dominates all slow signing | Complete latency also includes checks, peer waits, startup, and settlement | Unproved |
| Actor placement removes repeated material transfer | Typed local consumption and provider actor entrypoints | Candidate behavior |
| Actor placement guarantees five seconds | Small sequential campaign has uncontrolled rejection counts and placement | Unqualified |
| Runtime or measurement conditions explain a difference | Whole-invocation ownership and cache histories change | Remains possible |

The lifecycle proves post-signing refill and tested settlement/recovery paths.
It does not qualify sustained multi-wallet demand, complete material accounting after starting stock, or alarm fairness during CPU-heavy signing.
Further release work must measure those conditions at the same capacity.
Intermittent preparation connection and lease failures from earlier screens also remain unresolved unless reproduced and explained here.

The actor prototype removes repeated material transfer but establishes no useful complete signing gain.
Its source returns exactly to the parent. The retained eight-line E2E change verifies committed retirement before peer closure.
Seventeen stored local/hosted signatures verify again with Node/OpenSSL. All seventeen altered messages fail.
The offline verifier also reproduces the incomplete candidate capture. It does not label that capture complete.

Next, reduce first-use generic activation by investigating earlier key-bound commitments through the existing preparation flow.
Measure its registration and refill cost before selecting it. Preserve single use, wallet-seed recovery, FIPS export, and current capacity.
Binary prepared-material delivery is another bounded option that keeps signing in the current Worker services.
Complete cold/warm, sustained-demand, interruption, and security qualification before release.

The bloat check retains the inherited failure: 13,972 Rust duplicate lines against a 13,754 baseline.
The prototype does not increase that count. The baseline stays unchanged.

The [summary](../evidence/ml-dsa-65-pool-actor-20261024.json) records policy, selection, results, and cleanup.
The [compressed archive](../evidence/ml-dsa-65-pool-actor-20261024-data.json.gz) contains the tested patch, source hashes, sanitized traces, observation limits, and replay scripts.
Both incomplete pre-review builds were canceled before deployment and contribute no measurement evidence.
All six temporary Workers are deleted after each deployment arm.
The archive excludes raw provider tails, credentials, wrapping keys, and account identifiers.
An exact scan checks all approved credential values and the local fixture keys before publication.

Run this command from the repository root:

```sh
python3 - <<'PYTHON'
import gzip, hashlib, json, pathlib, subprocess, sys, tempfile
base = pathlib.Path('docs/evidence')
summary = json.loads((base / 'ml-dsa-65-pool-actor-20261024.json').read_text())
path = base / summary['archive']['path']
assert hashlib.sha256(path.read_bytes()).hexdigest() == summary['archive']['sha256']
data = json.loads(gzip.decompress(path.read_bytes()))
script = pathlib.Path(tempfile.mkdtemp(prefix='ml-dsa-pool-verify-')) / 'verify.py'
script.write_text(data['scripts']['verify.py'])
subprocess.run([sys.executable, str(script), str(path.resolve())], check=True)
PYTHON
```
