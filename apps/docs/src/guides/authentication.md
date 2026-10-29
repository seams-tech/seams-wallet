---
title: Authentication
description: Select passkey, Email OTP, optional VoiceID, and step-up authentication flows while preserving wallet and application trust boundaries.
---

# Authentication

Start with [Wallet setup and authentication](/examples/wallet-setup-and-authentication)
to configure the provider, register a wallet, and unlock it. Use this guide to choose an
authentication method and handle each resulting state.

## Choose a flow

- **Reuse Google login for settings** — a configured Google identity and an owner-authorized wallet association can open settings without another login.
  Call `seams.auth.authenticate({ method: 'google', walletId, idToken })` after the app's login.
  This grants settings reads. Signing and security changes still require wallet owner authentication.
  Apps that keep tokens on their backend use `prepareExternalAuth` and a bound handoff.
  Follow the [Google SSO guide](/guides/google-sso) for provider configuration, association, logout, and revocation.

- **Passkey** — primary registration and unlock on supported browsers. The
  wallet origin and relying party ID (RP ID) define where the credential can be used.
- **Google plus email OTP** — account discovery with a recoverable second
  factor. The application supplies the Google token. The wallet flow manages OTP
  and recovery state.
- **VoiceID** — optional browser enrollment, unlock, and reviewed transfer approval in SDK 0.28.0.
  Install `@seams/voiceid`, enable its descriptor, and prepare the Wallet host.
  See [VoiceID setup](/concepts/auth-methods/voiceid) for code examples and enrollment steps.

## Keep auth state explicit

- Preserve the same wallet identity when someone registers, unlocks, or adds
  a factor.
- Create an exact wallet session before signing. Authentication alone does not
  authorize an operation.
- Render cancellation, expiry, retryable delivery failure, and policy denial as
  separate outcomes.
- Keep passkeys, session tokens, and factor material out of application or agent
  storage.

Read [passkeys](/concepts/auth-methods/passkeys), [email
OTP](/concepts/auth-methods/email-otp), and [auth planes](/concepts/auth-planes)
for the boundaries behind each flow.
