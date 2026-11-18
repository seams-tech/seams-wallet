---
title: Email OTP
description: Use email OTP as a server-verified challenge while keeping recovery and signing secrets on the wallet boundary.
---

# Email OTP

Email OTP uses a one-time password to check access to an email address. The server
verifies the challenge. A dedicated worker handles the secret material.

::: warning The server can recover the factor key today
Today, the hosted wallet server stores the Email OTP factor key under its own seal. It
can recover the key of an owner Email OTP wallet without the user's device. A planned
change keeps the sealed factor key on the user's device, so that the server needs that
device and a fresh email code. After that change, a new device needs device linking or a
recovery code. Google and an email code on a new device then give a sign-in only.
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
