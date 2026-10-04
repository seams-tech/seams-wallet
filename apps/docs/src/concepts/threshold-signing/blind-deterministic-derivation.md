---
title: Blind deterministic key derivation
description: Derive stable wallet identity through blind Router A/B ceremonies without exposing complete key material.
---

# Blind deterministic key derivation

Router A/B uses Streaming Yao to derive stable wallet keys jointly between two server
roles. Each role computes with shares without seeing the complete key. The Ed25519 key
seed and signing scalar remain shared outside an authorized export. The key remains
recoverable and exportable from durable roots. This Ed25519 seed is distinct from the
wallet custody seed retained by the wallet-origin custody flow.

The main properties are:

- The wallet uses 2-of-2 threshold Ed25519 signing.
- Two separate Deriver roles run deterministic, RFC 8032-compatible key derivation through garbled-circuit two-party computation (2PC).
- Normal signing uses client and SigningWorker shares.
- Authorized export reconstructs the Ed25519 seed inside the export flow on the wallet origin.

## The layered model

Three layers perform cryptographic work. Router coordinates their requests:

| Layer         | Mechanism                | Role                                                                                                                                                                                                                              |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custody       | Additive secret sharing  | The seed is defined as the sum of client and server contributions derived from durable roots. It is never assembled. Linear operations — share addition, blinding, refresh deltas — happen locally on shares with no interaction. |
| Derivation    | Fixed-function Yao 2PC   | Deriver A and Deriver B jointly compute `SHA-512 -> clamp -> mod l` on their shares. This non-linear step requires the garbled circuit to preserve RFC 8032 export compatibility.          |
| Signing       | 2-of-2 threshold signing | The client and SigningWorker receive blinded scalar shares. They perform all normal signing without calling the Derivers.                                                           |
| Orchestration | Router                   | Admission, authorization, replay protection, and envelope relay. Router carries only ciphertext, public metadata, and signed receipts.                                                                                            |

Derivers A and B compute the key shares. The client and SigningWorker hold the resulting
shares for signing. The Derivers participate only during derivation. The protocol
randomly splits the output so neither Deriver sees the complete derived key.

## How this differs from conventional threshold signers

Ordinary distributed key generation (DKG) creates a random key through interaction
between the eventual key holders. That process does not provide deterministic recovery
from derivation roots. This architecture instead derives the key with the following
properties:

### Nobody-blind key export and recovery

The key derives deterministically from committed roots. Recovery therefore preserves the
registered public key exactly. Export produces the exact standard RFC 8032 Ed25519 seed.
During an explicitly authorized export, the Derivers produce masked seed shares
encrypted only to the authorized client. The client combines them, recomputes the public
key, and verifies it against the registered identity. No server role — Router, Deriver
A, Deriver B, or SigningWorker — sees the seed at any point, including during export. A
DKG-based wallet has no derivation seed to export. Reconstructing a key on the server
for export would violate this custody model.

### Serverless deployment

The ceremony uses bounded streaming. The client and Router exchange compact envelopes
measured in kibibytes (KiB). The garbled-circuit stream spans several mebibytes (MiB).
It travels directly between Deriver A and Deriver B with bounded memory. The 0.8.0
hosted stack uses Cloudflare Workers, Durable Objects, regional D1, and Rust compute in
Containers. The selected same-account profile shares an administrative control plane.
Independently administered Deriver accounts remain a deferred deployment profile. See
[Serverless Threshold
Signing](/concepts/threshold-signing/serverless-threshold-signing).

### No TEE requirement

The confidentiality and correctness claims come from cryptography (the 2PC protocol,
one-use tickets, authenticated transcripts) and the actual role and administration
boundaries of the deployment. The protocol's trust model does not require hardware
attestation or depend on enclave security. It can run on Workers, containers, or virtual
machines that preserve the required role separation and release controls. A trusted
execution environment (TEE) can add isolation around the same protocol.

## Trust boundaries

The shipped construction assumes honest Deriver execution, non-colluding A/B
roles, and a trusted shared-account control plane:

- no single party — including the client, outside an authorized export — ever
  learns the joined seed or private scalar.
- Deriver A and Deriver B each see only their own role-local inputs and an
  output share that is useless alone.
- Router sees ciphertext, public metadata, and signed receipts.
- the client and SigningWorker hold blinded scalar shares whose combination is
  the intended 2-of-2 threshold boundary.

The claim excludes A+B collusion and client-plus-SigningWorker collusion. The client and
SigningWorker together form the designed threshold boundary. The claim also excludes
platform-wide hosting-provider compromise, fairness, and guaranteed output delivery.

## Status

Streaming Yao is implemented in the 0.8.0 lifecycle path. Its current claim does not
include malicious Deriver behavior. Active security and independently administered
Deriver deployments require their own implementation, review, and deployment evidence.
See [the current security
properties](/concepts/threshold-signing/streaming-yao-ab#security-properties).

Read next:

- [Router A/B](/concepts/threshold-signing/router-ab)
- [Streaming Yao A/B](/concepts/threshold-signing/streaming-yao-ab)
- [Recovery and Export](/concepts/custody/recovery-and-export)
