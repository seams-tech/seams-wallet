# R153B: simple, fast wallet relocation

Status: implementation and scoped hosted acceptance complete. Package publication and adoption remain separate.
Date: October 7, 2026.

## Goal

A representative wallet must unlock and sign in its new region within **60 seconds
of source pause**, including fresh authentication. Aim for 30 seconds. Source cleanup
must not delay signing. Measure the result before declaring completion.

This plan replaces R153's per-record transfer and scheduler-driven normal execution.
Keep R153's ownership safety, physical routing, and existing storage owners.

## Problem

Hosted R153 paused signing for 513 seconds outbound and 744 seconds returning.
The D1 exporter creates at least one chunk per row. It does not pack small rows.
The coordinator moves one chunk per advance and repeats authorization and progress
requests. Execution uses 20-second work windows with a once-per-minute cron fallback.
Freeze also repeats sequential participant calls. Small transfers incur hundreds of
coordination operations and long idle gaps.

The 33 and 47 chunk counts are not evidence of large payloads. Measure actual bytes.

## Scope: two localized changes

Change the D1 snapshot transfer and the existing relocation driver. This is a
performance correction, not a new relocation architecture. Reuse existing custody
formats, role handlers, journal states, ownership rules, routing, and UI. Do not
rewrite the Rust custody protocol or reorganize modules.

Do not expand the change because adjacent code could be cleaner. If these two
changes miss the target, identify the measured bottleneck before proposing more work.

## One design

1. **Prepare before pause.** Resolve and pin destination locators. Verify placement,
   role identity, schema, and capacity. Keep source signing available during this work.
2. **Freeze once.** Stop new operations and settle admitted work. Invalidate relocation
   sessions and usable presignatures. Save one immutable snapshot per storage owner.
3. **Copy immediately.** Send the complete D1 snapshot in one request. Run existing
   independent custody transfers concurrently without scheduler gaps. Keep their
   formats and protocol intact. Each destination stays inactive until the wallet is ready.
4. **Activate once.** Require verified receipts from every participant. Commit the
   new ownership generation through the existing directory. Complete destination
   activation, then permit fresh unlock and signing.
5. **Clean up afterward.** Retain the source fence. Retry source deletion independently.
   Keep another move disabled until cleanup completes.

A storage owner means the existing regional authorization D1 or a custody role's
wallet storage. Keep secrets with their current role. Do not merge custody roles
or leave wallet data in the old region while relocating execution.

## Exact retries without per-row transfers

Use the existing move identity, scope, generations, and pinned target identities.
Bind each participant's receipt to its immutable snapshot digest.

The destination validates the complete payload before import. Commit imported data
and its receipt in one local transaction, using the existing D1 batch or custody
storage transaction. Preserve exact integer values, cryptographic identities, and
retired history. Import must not reissue sessions, quota, or one-use material.

An identical retry returns the stored receipt. Different content for the same move
is rejected. A lost reply cannot cause a second import. A restart resumes the same
move and sends only snapshots whose verified receipts are missing.

Local transactions do not make the whole move atomic across stores. The existing
source fences, inactive destinations, and directory commit provide that boundary.

## Remove the overhead

- Replace per-row D1 export and intake requests with whole-snapshot operations.
  Reuse the existing encoded records. Delete superseded D1 transport cursors and
  endpoints; retain internal encoding details that still serve the snapshot.
- Keep one driver progressing the admitted move immediately. Use the existing
  dispatch and journal. If an invocation must yield, continue promptly through
  existing dispatch. Cron recovers interrupted work; healthy moves never wait for it.
- Persist participant completion and skip completed work. Parallelize independent
  freeze/capture operations after their required fences and settlement checks.
- Resolve invariant move metadata once per invocation. Preserve authentication and
  generation checks at request boundaries without repeating preparation per row.

Keep explicit payload and transaction bounds. Choose them from measured wallet
snapshots and the deployed platform limits. Reject wallets that exceed supported
capacity before pause. Do not add a second streaming protocol for hypothetical
large wallets. If realistic wallets exceed a limit, record that concrete blocker.

No new Worker, database, queue, workflow framework, secret, environment variable,
feature flag, or compatibility path. No changes to routine signing/refill routing.
Ordinary locking must still preserve valid durable presignatures.

## Three implementation steps

- [x] **Replace D1 transport.** Measure snapshot bytes. Send the existing immutable
  D1 snapshot as one bounded payload and import it transactionally. Reuse existing
  encodings, digests, and receipts. Leave custody transport formats unchanged.
- [x] **Remove scheduling gaps.** Make the existing driver advance continuously.
  Skip completed participants and run independent work concurrently. Preserve exact
  retry identities, fences, and activation-before-cleanup behavior.
- [x] **Prove the result and delete leftovers.** Extend the existing relocation E2E
  and hosted timing scenario. Remove superseded code and reconcile the R153 checklist.

Change the current modules in place: private `walletPlacement/` owns coordination;
public D1 wallet relocation modules own the D1 snapshot and import. Existing Rust
custody stores retain their current responsibilities.
Create no new package or parallel implementation.

## Completion evidence

Use the existing round-trip scenario with both signing curves and meaningful wallet
history. Exercise a lost import reply and a coordinator restart in composed coverage.
Verify that retries preserve keys and history, old sources reject writes, and both
curves sign after fresh destination authentication. Hold cleanup pending while signing
to prove cleanup is outside the pause.

The hosted artifact must record snapshot bytes, request counts, stage durations,
pause-to-first-signature duration, and deployed revisions for both directions.
Both directions must meet the 60-second target. Report preparation and cleanup
separately. Automated authentication time must remain visible in the measurement.

Use existing E2Es, affected type checks/builds, and the required bloat check. Add no
unit tests, source-text guards, benchmark framework, or duplicate verification suite.
A safe but multi-minute transfer does not satisfy this plan.

## Completion record — October 7, 2026

The hosted APAC → US → APAC round trip passed. Pause through fresh unlock and
first signature measured **47,496 ms outbound** and **57,926 ms returning**.
Both signing curves passed in both destinations. Source cleanup completed, including
an independent transport retry while destination signing remained available.

D1 snapshot payloads measured 153,194 and 216,706 bytes. Each attempt used one
whole-snapshot export and import. Cron overlap caused one exact retry per direction.
Admission enforces a 512 KiB payload limit and 80 encoded chunks before pause.
The internal segments remain encoding details inside one request.

The existing relocation driver runs independent custody transfers and presignature
settlement concurrently. It skips completed work and advances from acknowledged
cursors. A lost reply or restart resumes from durable destination state. The SDK
uses its existing interactive request policy for relocation, including preparation
and owner confirmation. Routine signing/refill routing and Rust custody formats
remain unchanged.

Existing D1, composed relocation, and hosted E2Es pass. Affected builds, the hosted
test type check, and public bloat checks pass. The aggregate private type check
retains six unrelated existing errors. No unit tests or source-text guards were added.

The private repository records exact measurements, deployed revisions, commands,
and artifact hashes in `docs/evidence/r153b-20261007.md` and its JSON receipt.
The staging backend is deployed. Hosted verification used frozen candidate SDK assets.
Package publication and application adoption remain separate release work.
