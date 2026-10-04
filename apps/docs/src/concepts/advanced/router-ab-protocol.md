---
title: Router A/B protocol
description: Follow Router A/B transcript binding, role separation, derivation, signing, and verification invariants.
---

# Router A/B protocol

Router A/B binds each request and response to its participants, operation, and key
material. This page covers protocol requirements: transcript binding, role-specific
envelopes, replay digests, participant identities, output packages, and activation
receipts. Read [architecture](/concepts/architecture) first for roles, secret-material
boundaries, and operation paths.

## Protocol invariants

1. The protocol binds Router request context before decrypting role envelopes.
2. Deriver A and Deriver B receive role-specific encrypted envelopes.
3. SigningWorker activation is bound to selected worker identity and key epoch.
4. Replay digests and idempotency state prevent request reuse.
5. Response binding checks happen before SDK acceptance.

Ed25519 fixes its two-party-computation boundaries:

1. Deriver A is always the garbler and Deriver B is always the evaluator.
2. The circuit, role assignment, active-security suite, and request graph are
   fixed by the deployment manifest.
3. The shipped construction assumes honest Deriver execution. Malicious-secure
   OT, input consistency, and selective-failure resistance are requirements for
   a future active-security profile.
4. A and B use one-use preprocessing tickets. Failure, timeout, ambiguity, or
   replay burns the ticket.
5. The Router relays compact recipient ciphertexts and public receipts. It
   never handles garbled tables, wire labels, OT state, or plaintext outputs.
6. Recipients verify their private shares and the public output relation before
   accepting activation or export.

The shipped claim excludes malicious Deriver behavior, A+B collusion,
shared-account administrator compromise, platform-wide compromise, fairness,
and guaranteed output delivery. A stronger profile targeting the Router plus
at most one malicious Deriver requires separate evidence.

See [Streaming Yao A/B](/concepts/threshold-signing/streaming-yao-ab) for the
operation flow, round trips, compute model, and deployment comparison.
