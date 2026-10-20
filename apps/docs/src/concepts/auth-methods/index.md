---
title: Auth methods
description: Compare passkeys, email OTP, VoiceID, and other proofs across the same custody, policy, and session lifecycle.
---

# Auth methods

Authentication methods use the same custody, policy, signing-lane, and session model.

| Method | Availability | Role |
| --- | --- | --- |
| Passkeys | Released | Cryptographic authenticator and user-presence factor |
| Email OTP | Released | Server-verified channel challenge and worker-owned secret flow |
| VoiceID | Proposed | Owner-presence and spoken-intent proof for device-bound flows |

The published SDK exposes no VoiceID enrollment or authentication API.
The [VoiceID page](/concepts/auth-methods/voiceid) describes its proposed model.

Read next:

- [Auth planes](/concepts/auth-planes)
- [Passkeys](/concepts/auth-methods/passkeys)
- [Email OTP](/concepts/auth-methods/email-otp)
- [VoiceID](/concepts/auth-methods/voiceid)
