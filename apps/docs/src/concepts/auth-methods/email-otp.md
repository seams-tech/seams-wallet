---
title: Email OTP
description: Use email OTP as a server-verified challenge while keeping recovery and signing secrets on the wallet boundary.
---

# Email OTP

Email OTP uses a one-time password to check access to an email address. The server
verifies the challenge. A dedicated worker handles the secret material.

::: info Each device holds its own factor
The server cannot open an Email OTP wallet alone. Each device keeps a random input, and
the server keeps that device's factor encrypted under the RFC 9497 POPRF output for the
input. An unlock needs the device and a fresh email code. A new device gets its own factor
by device linking, or by Google recovery with the recovery code. On a device with no
factor, a Google or email sign-in sends no code. It fails with
`email_otp_device_factor_missing`, and the hosted menu offers "Link this device" and
"Recover wallet".
:::

## Role in the model

Email OTP can:

1. prove control of a verified email channel.
2. authorize worker-owned Email OTP secret reconstruction.
3. create or restore signing capabilities under Wallet Session policy.
4. step up exhausted or expired Email OTP Wallet Session quotas.
5. authorize export or recovery only through fresh operation-specific policy.

Secret-bearing Email OTP material belongs in the dedicated Email OTP worker or
encrypted storage. App-origin code should not receive recovered Email OTP
secrets or derived signing shares.

## Start a login

Exchange a Google ID token for a typed login flow. Then submit the code the user
entered. The registration branch is handled separately because it carries its own wallet
selection and recovery-code backup ceremony.

::: details Runnable TypeScript example

<<< ../../examples/email-otp.ts

:::
