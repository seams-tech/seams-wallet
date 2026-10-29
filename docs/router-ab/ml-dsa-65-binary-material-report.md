# ML-DSA binary prepared-material delivery

The bounded binary-delivery prototype passes the native lifecycle campaign and the complete real local Worker campaign.
Six retained standard signatures verify independently, and six altered messages fail verification.
Hosted latency improvement remains unmeasured at this checkpoint.

## Measured reason for the prototype

The preceding hosted outlier takes 7.699 seconds and consumes ten pairs, or twenty candidates.
Both roles have warm schedule caches and zero topology builds.
Nine later material acquisitions account for 5.865 and 6.193 seconds of reported A/B take-caller spans.
Those spans include scheduling, transfer, and processing. They do not isolate database latency or JSON cost.
A different ten-pair operation takes 4.642 seconds. Its module instances and execution costs differ.
Refill cryptographic lifetimes end too early to explain every later long take in the outlier.

The original path converts sealed ciphertext to base64 inside a JSON value, then serializes that value for delivery.
The role caller parses the JSON and decodes the ciphertext.
The prototype removes those conversions for bulk consumed material. Its hypothesis requires a matched hosted comparison.

## Boundary and invariants

Only successful private Take and LoadSigningInputs responses change.
Metadata commands retain JSON. There is no content-based fallback or production format switch.
A typed RoleOutput retains the prepared pair until its storage transaction commits.
HTTP response construction occurs afterward. Each call still consumes one pair exactly once.
The initial load still consumes its first pair exactly once.

The binary frame contains:

1. A four-byte, little-endian JSON metadata length.
2. Strict typed metadata, bounded at 128 KiB.
3. The existing 32-byte HPKE encapsulated key.
4. The existing sealed ciphertext, bounded from sixteen bytes through sixteen MiB plus sixteen bytes.

The receiver bounds cumulative bytes while reading the stream.
It requires the expected content type and checks lengths before slicing.
The existing key, role, batch, epoch, expiry, and wrapping-key checks still precede opening the prepared envelope.
The metadata contains the same encrypted role material and public bindings. No plaintext-secret buffer is added.
Malformed delivery fails the admitted operation and cannot restore its consumed pair.

Interparticipant MPC messages, encryption suites, cryptographic domains, and stored formats remain unchanged.
Wallet-seed recovery and canonical FIPS export remain unchanged.
Preparation stays on Workers. It prepares four candidates and consumes two at a time.
The reserve remains thirty-two candidates, with sixteen required for admission.

## Local validation

The real Worker campaign truncates the first consumed response after storage commits.
The operation fails in 249 ms, requests peer closure, and rejects the old permit.
Fifteen unopened pairs remain. A fresh operation signs with matching retained takes from both participants.
The lost-reply interruption case, producer restart, publication recovery, rollover, parallel refill, and replay checks also pass.

The first campaign exposes a valid evidence-checker gap.
The old checker recognizes durable publication proof only for its interrupted-producer scenario.
A consumed pair instead belongs to the existing lost-publication-reply scenario, which independently proves both roles Ready.
Classify this failure as valid_test_needs_update.
The corrected checker accepts only those two exact job ID sets and their paired Ready snapshots.
It still requires private commitments before the relevant snapshot. There is no unrestricted missing-log fallback.
The initial failed artifact remains in the evidence.

All three strict Worker builds pass. Independent review finds no blocking defect in the response boundary or evidence correction.
The inherited bloat check remains at 13,992 Rust duplicated lines against 13,754. The baseline is unchanged.

## Hosted comparison

Both proposed hosted arms use the same updated load driver.
It follows the existing public Gateway's 500 ms service-capacity cap and exact retry times for other reasons.
This differs from the preceding benchmark's generic one-to-five-second retry bounds.
Public Gateway and SDK code remain unchanged. Private Router timings still exclude their actual execution and network overhead.

The eight temporary destinations and synthetic credential payloads have explicit user approval.
Setup and canonical recovery precede the timed comparison.
Compare equal candidate counts, preparation CPU, complete reserve restoration, request waits, and final signing calls.
The implementation remains a prototype until that comparison establishes a useful benefit.

[Local replay evidence](../evidence/ml-dsa-65-binary-material-local-20261030.json) records source and Wasm hashes, the complete campaign, retained failed case, and archive member hashes.
The scan finds zero matches for the generated synthetic credential values.
