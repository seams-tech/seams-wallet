---
title: Auth methods
description: Compare passkeys, email OTP, VoiceID, and other proofs across the same custody, policy, and session lifecycle.
---

# Auth methods

Owner authentication controls custody and signing. Google BYO auth provides a separate settings session for an associated wallet.

| Method | Availability | Role |
| --- | --- | --- |
| Passkeys | Released | Cryptographic authenticator and user-presence factor |
| Email OTP | Released | Server-verified channel challenge and worker-owned secret flow |
| Google BYO auth | 0.28.0 | Reuse app login for settings reads after an owner-approved association |
| VoiceID | 0.28.0 · optional package | Local speaker and phrase checks with device-bound unlock and reviewed approval |

VoiceID requires the optional `@seams/voiceid` package in the app and on the Wallet host.
The [VoiceID page](/concepts/auth-methods/voiceid) includes installation, enrollment, and unlock examples.

Read next:

- [Auth planes](/concepts/auth-planes)
- [Passkeys](/concepts/auth-methods/passkeys)
- [Email OTP](/concepts/auth-methods/email-otp)
- [VoiceID](/concepts/auth-methods/voiceid)
