# Spec 5: Router A/B threshold protocol

Normal wallet signing uses secret material held by the client and separate
server roles. They run a threshold protocol together to produce a signature.
The server roles never assemble the complete wallet key.

Router A/B is the part of the system that coordinates this cryptographic work.

## The roles

| Component | Its job |
| --- | --- |
| Gateway | Checks wallet permissions and usage limits, then records the operation |
| Router | Checks protocol admission and forwards messages to the private roles |
| Deriver A and Deriver B | Cooperate during key setup and other derivation operations; each holds its own secrets |
| SigningWorker | Holds prepared server material and participates in normal signing |
| Client cryptographic runtime | Holds the client material and performs the client side of the protocol |

The Router handles encrypted messages and public information. It has no
participant secret share or mutable store. Each private role saves only its own
material and progress.

## Preparing keys

Registration and recovery may need to derive and install signing material.
The Derivers cooperate, verify the result, and deliver encrypted output to the
client or SigningWorker that will use it. Each recipient opens only its own
output.

This setup also supports operations such as explicit key export and share
refresh. Those operations require their own authorization.

Ed25519 and ECDSA use different cryptographic protocols. They follow the same
separation of responsibilities, while keeping their cryptographic formats and
material distinct.

## Signing with prepared material

After setup, normal signing uses the client and SigningWorker through the
Router. The Derivers stay out of this path. This lets ordinary signing continue
without repeating key derivation.

A signature still needs the session and permission checks described in
[Spec 3](spec-3-wallet-sessions-and-execution-lanes.md). Having prepared material
does not grant permission to use it.

The protocols use one-use resources such as nonces and presignatures. Once
claimed for a signing attempt, those resources cannot be returned to the pool
after an uncertain result. A retry resumes the recorded operation.

## Keeping secrets separated

Production Derivers run in independent administrative environments with separate
credentials, stores, and encryption keys. Private commands authenticate the
sender and check the intended operation and recipient before opening material.

Normal signing keeps the complete key unassembled. Explicit owner export is a
separate, freshly authorized flow that delivers the supported key material to
the client. It does not expose server shares or lane holder shares.

Logs contain public identifiers and progress, never secret material. A timeout
preserves the existing operation until participant records resolve its outcome.

The [protocol reference](router-ab/protocol.md) defines the precise cryptographic
requirements and threat assumptions.
[Deployment](router-ab/deployment.md) covers role isolation, and
[local development](router-ab/local-development.md) shows how to run the roles.
