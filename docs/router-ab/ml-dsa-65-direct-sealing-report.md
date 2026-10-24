# Direct sealing for ML-DSA registration

Date: October 24, 2026. Branch: `ml-dsa`.

The implementation removes the intermediate committed-stock envelope and duplicate delivery cache.
Final candidate validation and hosted latency results remain pending.
The five-second target is not qualified.

Registration commits independent prepared pairs in bounded cohorts.
It seals each output against its final participant-pool binding before publishing the local registration result.
The same immutable source ciphertext supplies exact retries after a lost acknowledgement.
Delivery compares the complete persisted binding before sending ciphertext.
Destination admission, atomic installation, and permanent consumption records remain unchanged.
A wrapping-key version change fails closed.

Source storage uses explicit Generic, Committing, and Committed states with a v4 sealing domain.
Every selected input burns durably before private state opens.
Publication requires a live consumed preparation and all selected Committing markers.
The new format requires fresh preparation. Existing preparation must be retired and regenerated.
No compatibility execution path is added.

The three release Worker builds pass.
Independent review finds no custody or atomic-publication blocker.
The real-Worker retirement campaign passes, including restart and canonical recovery.
The archived batched control detects eight required source records and eight duplicate delivery records per participant.
The audit counts stored records, rather than storage calls or sealing operations.
Candidate delivery, publication rollback, Gateway lifecycle, and hosted measurements are still running.

Wallet-seed recovery, ordinary FIPS seed/key export, and private commitments remain required.
Preparation remains on Workers. Four candidates are prepared together and two are consumed at a time.
Pool capacity remains thirty-two candidates. Admission requires sixteen ready candidates.
GPU and UI work remain deferred.

The [progress evidence](../evidence/ml-dsa-65-direct-sealing-progress-20261024.json) retains source hashes and the completed retirement scenario.
The previous [batched screen](ml-dsa-65-batched-commitments-report.md) supplies the unchanged core evaluator evidence.
The active experiment directory is `/private/tmp/ml-dsa-direct-sealing-20261024`.
Final validation must record full registration, first signing, all failures, exact replay, and unchanged capacity before selecting this runtime.

`pnpm report:bloat --check` still fails at 13,972 Rust duplicate lines against the inherited 13,754-line baseline.
The baseline remains unchanged.
