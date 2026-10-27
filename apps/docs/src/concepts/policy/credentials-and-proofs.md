---
title: Credentials and proofs
description: Bind credential proofs to exact actors, operations, targets, freshness, and policy decisions.
---

# Credentials and proofs

Proof inputs support exact authorization. They answer who is acting, what
authority they have, which intent they approved, and whether that authority is
still usable.

## Proof inputs

The released wallet uses passkeys, Email OTP, Wallet Sessions, and linked-device
proofs. SDK 0.25.0 adds optional [VoiceID](/concepts/auth-methods/voiceid) authentication.
Organization roles belong to Console authorization. External biometric proofs remain proposed inputs.
This list describes their intended policy role, rather than public enrollment APIs:

1. Passkey/WebAuthn presence.
2. Email OTP verification.
3. VoiceID owner-presence verification.
4. Wallet Session, quota, and operation-capability state.
5. Device or linked-device proof.
6. Org role proof.
7. External identity, biometric, or credential proof where configured.

## Authorization questions

```text
Who is acting?
What authority do they have?
Which intent did they approve?
Can that authority still be used right now?
```

Policy evaluates proofs before it permits execution. Wallet signatures, payments, agent
tool calls, and merchant API calls happen only after the relevant proof and policy
checks pass.
