# Refactor 190a — Adaptive VoiceID enrollment

Status: proposed, 2026-10-26. Planning only; implementation requires a subsequent request.

This work belongs to VoiceID stabilization. EVM support follows stabilization, then
[cross-method transaction approval](refactor-190-voiceid-cross-method-step-up-plan.md).

## Recommendation

Evaluate adaptive enrollment. It could improve recognition when the original
enrollment poorly represents natural speech. The benefit remains unproved for our
model, microphone pipeline, and users.

Start with passkey-confirmed samples and a controlled comparison. Enable automatic
learning only after separate evaluation. Keep the speaker threshold at **0.500**,
the phrase gap limit at **8**, and prompts at **6–7 words**.

Changing the reference can change false acceptance even with a fixed threshold.
Measure both genuine-user rejection and other-speaker acceptance before release.
Phrase recognition remains a separate stabilization task.

## Reference and current implementation

Apple documents temporary additions to Face ID representations after sufficiently
good successful matches. It also describes another capture after a close match
followed by passcode confirmation. Apple does not publish an averaging rate or a
voice-specific implementation in this document.
[Source: Apple Platform Security](https://support.apple.com/guide/security/facial-matching-security-sece151358d1/web).

Current source boundaries:

| Boundary | Current behavior | Implementation work |
| --- | --- | --- |
| `browser/enrollment.ts` | Stores a normalized mean of three embeddings under one browser-wide key. An embedding is a numerical voice representation. | Preserve an immutable baseline; add precisely scoped, bounded supplemental representations. |
| `browser/model.ts` | Computes embeddings and cosine similarity against the template. | Keep the model and acceptance threshold fixed during evaluation. |
| `browser/phrase.ts` | Checks the randomized phrase independently. | Require the existing phrase check for every admitted sample. |
| `activation/addVoiceId.ts` | Resolves an owner session before enrollment or activation. | Reuse the authorization boundary for an explicit improvement action. |
| `browser/deviceStore.ts` | Binds device credentials to a wallet and authentication method. | Bind adaptation to the corresponding enrollment and device identity. |
| `capture/*`, `session/unlock.ts` | Capture, authorize, and install a session through separate stages. | Keep candidate learning separate from authorization and final operation completion. |

Paths above are relative to `packages/wallet/src/plugins/voiceid/`.

## Scope and invariants

- Preserve the original template until explicit re-enrollment replaces it.
- Keep embeddings local to the trusted Wallet origin. Discard raw audio after inference.
- Do not put embeddings in DOM diagnostics, logs, analytics, or committed test artifacts.
- A sample cannot alter the decision that produced it. Score against the preceding enrollment snapshot.
- A voice rejection cannot authorize an update. Passkey confirmation permits a separate, explicit improvement capture.
- Adaptation cannot grant a session, change budgets, approve a transaction, or renew an authorization deadline.
- No new models, background recording, server biometric storage, or cross-method signing behavior are included.
- Browser-held representations do not acquire Face ID's Secure Enclave guarantees through this change.

## Implementation sequence

### 1. Establish a controlled evaluation

Extend the existing model-evaluation workflow. Compare the unchanged baseline and
candidate adaptation on the same recordings. Run this comparison in an evaluation
harness; do not add a production shadow-mode flag or a second authorization path.

Use consenting human speakers across separate sessions and days. Include normal
speech, quiet rooms, background noise, and microphone changes. Reserve speakers
and later recordings for evaluation before selecting adaptation parameters.

Include an explicitly owner-confirmed improvement session for the affected user.
Keep its samples separate from later evaluation attempts. Do not silently overwrite
the existing enrollment or infer successful outcomes from ready-state screenshots.

Record speaker and phrase results separately, alongside input duration and capture
settings. The current background estimate is a heuristic, not calibrated acoustic SNR.
Export personal audio or embeddings only with explicit consent.

Deliverable: a repeatable comparison with fixed corpus references, model hashes,
capture settings, sample order, parameters, and aggregate results. Establish whether
the evaluation reproduces the live speaker failures before claiming a cause.

### 2. Define one bounded matching rule

Evaluate one simple candidate: retain the immutable baseline plus at most three
supplemental embeddings. Compute one normalized, weighted template for matching.
The baseline retains most of the weight. Avoid accepting the maximum score across
an expanding set of templates.

Choose the total supplemental weight, maximum deviation from the baseline, quality
requirements, and expiration limits on development data. Specify both an absolute
lifetime and a maximum number of uses. Do not renew a sample's lifetime when used.
Freeze these values before held-out evaluation. They are release blockers until measured.

Bound the effective template's deviation from the original baseline after every
change. Reject updates that exceed this bound. Recompute from the baseline and
current supplemental set; do not recursively average an already adapted template.

Passkey-confirmed samples must pass phrase and quality checks and the measured
baseline-consistency bound. If they cannot, direct the owner to explicit re-enrollment.
Do not expand the bound automatically to make a sample pass.

Deliverable: one documented scoring and admission rule with measured parameters.
If this rule does not improve held-out results, stop this work before production integration.

### 3. Bind persistence and lifecycle to the correct enrollment

Introduce one precise enrollment record with a baseline, model identity, generation,
revision, and a bounded supplemental set. Require wallet, authority, method, and
device identity for all adaptation operations. Reuse existing domain identifiers.

The browser-wide template cannot be silently assigned to every wallet. At the
persistence boundary, allow an explicitly owner-authorized import into the selected
method. Preserve its baseline exactly. Resolve all existing consumers during this
migration and remove the old path when no longer needed. Core matching accepts
only the new normalized record.

Use discriminated unions for collected, eligible, committed, and discarded candidates.
Carry required attempt, enrollment-generation, and authorization bindings. Keep
embeddings inside the trusted Wallet runtime. Diagnostic strings never authorize learning.

Commit with an IndexedDB transaction and revision check. Concurrent tabs cannot
overwrite newer updates. Cancellation, locking, method disablement, removal, or
re-enrollment invalidate pending candidates. A cancelled operation cannot resurrect
deleted enrollment state.

Expire supplemental data before scoring. Missing supplemental data uses the baseline.
Invalid baseline data fails closed. Define corrupt supplemental records at the
parser boundary and discard them without treating them as valid enrollment.

Deliverable: scoped persistence, atomic updates, and type fixtures for invalid
identity and lifecycle combinations.

### 4. Ship explicit, passkey-confirmed improvement first

Add **Improve voice recognition** in Authentication methods for an eligible local
VoiceID method. Require fresh passkey confirmation bound to this action and wallet.
An unrelated successful login or an old unlocked session is insufficient evidence.

Then collect a small batch of three natural-paced recordings through the existing
prompt. Admit only samples that satisfy the frozen rules. Commit the batch atomically
after explicit completion. Cancellation preserves the previous enrollment.

Retain **Re-record voice** as an explicit baseline replacement. Provide **Reset voice
improvements** to remove supplemental data while preserving the baseline. Method
removal deletes its scoped data. Disablement prevents learning and keeps existing
enrollment under the current enable/disable contract; expiration still applies.

This action does not authorize an earlier failed unlock or pending transaction.
The user must start that operation again through its normal flow.

Deliverable: an owner can improve or reset the reference without changing session
selection or weakening operation authorization.

### 5. Evaluate automatic learning as a separate release

Only consider samples after both phrase and speaker checks pass. Require a learning
threshold stricter than 0.500, measured against the immutable baseline, plus the
quality and deviation limits. Adapted-only matches cannot reinforce themselves.

Initially admit automatic candidates only from completed wallet unlocks. Commit
after session installation succeeds, with the original attempt and enrollment
generation still valid. Permit at most one candidate per successful unlock and
enforce a measured minimum interval between updates.

Rejected, cancelled, expired, replayed, or server-failed attempts never update data.
Signing captures do not train this first version. Learning failure must not revoke
a completed valid unlock; discard the candidate and retain the preceding record.

Deliverable: automatic learning passes the same evaluation and lifecycle criteria
as explicit improvement. Otherwise, retain only explicit improvement.

## Verification and release criteria

Use browser E2E tests and domain type fixtures. Add no unit or source-snapshot tests.
Separate mocked lifecycle tests from real-model accuracy evaluation in all reports.

One composed E2E scenario must cover passkey confirmation, improvement capture,
reload, natural-paced VoiceID unlock, and existing VoiceID NEAR signing. Verify
the signature and unchanged session/budget rules. Also cover rejection, expiry,
reset, cross-wallet isolation, concurrent tabs, and removal during a pending commit.
Produce repeatable JSON evidence and screenshots without private embeddings or audio.

Accuracy gates:

- Predeclare the corpus, genuine-user improvement target, and acceptable false-acceptance bound before held-out evaluation.
- Demonstrate lower genuine-user rejection across later sessions without weakening the fixed thresholds.
- Report sample counts, paired results, per-speaker outcomes, and uncertainty. Zero observed false accepts is not proof of zero risk.
- Evaluate other speakers, repeated borderline samples, noisy captures, and long update sequences for drift.
- Reject release if adaptation increases false acceptance beyond the declared bound or the dataset cannot support that conclusion.
- Report phrase failures separately. Speaker improvement alone cannot establish reliable end-to-end VoiceID.

Update the intended-behavior specification and its contracts with implementation.
Run the relevant browser contracts, type checks, static asset checks, and
`pnpm report:bloat --check`. Finish with live owner use across separate sessions.

## Size and completion

This is a medium-sized change. The main work is enrollment scope, authorization,
atomic lifecycle handling, and evaluation. Updating a numerical average is a small part.

Complete the explicit-improvement release only after its accuracy and lifecycle
gates pass. Treat automatic learning as independently gated work. If adaptation
does not help, preserve the baseline implementation and continue model/capture investigation.
