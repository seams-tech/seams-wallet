# Direct sealing for ML-DSA registration

Date: October 24, 2026. Branch: `ml-dsa`.

Direct sealing removes the duplicate delivery cache and passes the lifecycle checks.
Candidate prepared creation/recovery takes 5.453/6.102 seconds.
Both registration samples still exceed five seconds.
The implementation remains on the experimental branch for further qualification. Production selection remains open.

## What changes

Registration commits independently prepared pairs in bounded cohorts.
It seals each committed pair against its final participant-pool binding before publishing the local registration result.
That immutable ciphertext supplies exact retries after a lost acknowledgement.
Delivery compares the complete persisted binding before sending the stored ciphertext.
It performs no decryption, resealing, or second cache publication.

Compared with the archived batched prototype, one online seal and one online open disappear per pair.
The earlier generic-preparation envelope remains necessary before the wallet key is known.
After commitment, source ciphertext copies fall from two to one per pair.
The separate destination copy remains required. Storage-call counts and storage bytes are not measured by the record audit.

Source storage uses explicit Generic, Committing, and Committed states with a v4 sealing domain.
Every selected input burns durably before private state opens.
Publication requires a live consumed preparation and all selected Committing markers.
The final binding authenticates key scope, participant, material ID, expiry, and wrapping-key version.
A version mismatch fails before pending delivery. No silent rebinding or resealing occurs.
Destination admission, atomic installation, exact Ready replay, and permanent consumption records remain unchanged.
Ciphertext authentication remains at the existing consuming HPKE-open boundary.

The new source format requires fresh preparation. Existing preparation must be retired and regenerated.
Mixed binaries and existing prepared namespaces are outside this screen.
No compatibility execution path is added.

## Hosted measurements

| Arm | Prepared registration: create / recovery, s | Successful signing, s | Signatures below 5 s | Consumed pairs |
| --- | --- | --- | --- | --- |
| Control | 7.222 / 6.920 | 1.610–6.767 | 3/6 | 24 |
| Candidate | 5.453 / 6.102 | 0.900–3.672 | 6/6 | 9 |

The control is the archived batched-commitment prototype with its intermediate envelope and delivery cache.
It is not the previously selected generic-stock runtime.
Both arms use the same wallet context, approved temporary destinations, credentials, forwarding Router, and pool policy.
Canonical public keys match across both arms and recovery.
The online signing algorithm is identical between these arms.
Different rejection counts and runtime conditions prevent a causal signing-speed comparison.
This screen does not establish superiority over the earlier generic-stock runtime.

| Arm | Epoch | Key-independent preparation, s | Sum of registration and first-signing timers, s |
| --- | --- | --- | --- |
| Control | 1 | 78.230 | 12.348 |
| Control | 2 | 78.546 | 13.046 |
| Candidate | 1 | 67.735 | 9.125 |
| Candidate | 2 | 77.501 | 8.842 |

Prepared registration begins after key-independent material is ready and includes client custody verification.
Signing ends after HTTP response decoding. Independent signature verification follows that timer.
The summed timers exclude intervening test checks and user approval. They are not one complete user-flow timer.
Initial preparation includes key-generation material and sixteen signing candidates. It is not a four-candidate refill measurement.
Cooldown scheduling, empty-pool waits, browser login, UI, NEAR submission, and finality are outside these online timers.
This change establishes no preparation-throughput improvement.

## Lifecycle and integrity

All four candidate real-Worker campaigns pass: normal Gateway lifecycle, retirement, publication rollback, and delivery recovery.
The normal campaign covers admitted registration, public signing, canonical recovery, full-owner device signing, and participant restoration.
The retirement and rollback campaigns verify every selected input remains consumed after restart.
A publication failure cannot publish a combined registration result.

The delivery campaign loses one successful reply, restarts, and sends concurrent retries.
Retries preserve exact ciphertext and the two-pair delivery bound.
Changed binding rejects atomic installation. Changed ciphertext rejects replay after successful installation.
Consumed or finished operations remain refused.
The changed-ciphertext check verifies destination replay integrity. It does not test HPKE authentication before first installation.

The calibrated storage audit finds eight required committed source records per participant in both arms.
It finds eight duplicate delivery records on control and zero on candidate, for both creation and recovery.
The audit reads persisted records, so restart and transaction callback retries cannot inflate the count.
Primary publication remains required and nonzero. Zero duplicate records does not mean zero storage work.
The offline verifier rechecks 20 retained HTTP/transaction signatures and rejects every altered message.
Unchanged core cohort evidence comes from the previous screen, with matching core source hashes.
The three candidate release Worker builds pass.

## Measurement limits and failures

Worker-clock delivery-persistence intervals report zero on control despite eight persisted duplicate records.
Those clocks cannot measure the removed CPU or durability cost in isolation.
Provider CPU and wall clocks cover complete invocations.
Fresh sequential deployments do not control placement, host load, tiering, caches, or rejection counts.
No sustained refill, multi-wallet capacity, cold/warm tail, total memory peak, or production-security qualification follows from this screen.

Candidate harness setup first lacks the shared forwarding-Router artifact. Setup is corrected before deployment.
One queued local delivery test starts while the requested Git rebase temporarily removes its entry file.
That process executes no test. Its launch failure remains archived, followed by a passing repeat with clean fixture storage.
Neither correction changes production behavior.

One candidate A-pool invocation rejects an inactive preprocessing lease.
Its call ID is `00080ce3ad11bb3336fea5c200000020`. The exact command and trigger remain unresolved.
All measured signatures complete, but this capture establishes no lease-failure fix.
The same error appears in earlier screens. The current control reports no exception.

The implementation is committed and rebased onto local `dev` at `b94dddd7`.
The rebase changes no compiled Rust or final E2E source hashes.
`pnpm report:bloat --check` retains the inherited 13,972 Rust duplicate lines against the 13,754-line baseline.
The baseline remains unchanged.
Both arms' six temporary Workers are deleted.

## Facts and competing explanations

| Fact | Instrument | Checked scope |
| --- | --- | --- |
| Duplicate source records disappear | Real-Worker stored-record audit | Eight to zero, with eight primary records retained per participant |
| Exact replay survives a lost acknowledgement | Destination ciphertext hash and restart | Concurrent retries and changed-ciphertext refusal |
| Consumed inputs remain unusable | Retirement and publication rollback faults | Every selected input across restart |
| Canonical recovery survives | Client verification and independent signature verification | Both hosted ceremonies and local Gateway lifecycle |
| Registration still exceeds five seconds | Client timer | Both candidate ceremonies |

| Explanation | Evidence | Status |
| --- | --- | --- |
| Direct sealing removes duplicate cryptographic and storage work | Code path and calibrated record audit | Mechanism confirmed |
| It now guarantees five-second registration | Both candidate registrations exceed five seconds | Contradicted |
| It changes rejection sampling or online signing | Both arms run the same signing algorithm | Contradicted |
| Removed sealing alone explains the full observed timing difference | CPU, waits, placement, and caches are not isolated | Unresolved |
| Preparation and multi-wallet capacity are now qualified | No sustained capacity interval is measured | Unsupported |

## Preserved requirements and next work

Wallet-seed recovery, ordinary FIPS seed/key export, private commitments, and the passive honest-execution model remain unchanged.
Preparation remains on Workers. Four candidates are prepared together and two are consumed at a time.
Pool capacity remains thirty-two candidates. Admission requires sixteen ready candidates.
The hosted policy retains a sixty-second wallet cooldown, one active signing operation, and a thirty-second deadline.
GPU and UI work remain deferred.

Next, compare this complete design against the generic-stock runtime under a matched control.
Then isolate remaining registration CPU and dispatch waits with calibrated instruments.
Consistent five-second signing, sustained refill, cold/warm tails, lease failures, and release security review remain open.

The [summary](../evidence/ml-dsa-65-direct-sealing-20261024.json) links the compressed, sanitized evidence and its SHA-256 digest.
The archive includes source hashes, deployment receipts, lifecycle artifacts, analysis, and the offline verifier.
The [progress record](../evidence/ml-dsa-65-direct-sealing-progress-20261024.json) preserves the earlier commit-time status.

Reproduce the archived checks from the repository root:

```sh
python3 - docs/evidence/ml-dsa-65-direct-sealing-20261024-data.json.gz <<'VERIFY'
import gzip, json, sys
from pathlib import Path
archive = json.loads(gzip.decompress(Path(sys.argv[1]).read_bytes()))
context = {"__name__": "archived_verifier", "__file__": "archived_verifier.py"}
exec(compile(archive["scripts"]["verify.py"], "archived_verifier.py", "exec"), context)
print(json.dumps(context["verify"](archive), indent=2))
VERIFY
```
