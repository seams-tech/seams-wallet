---
title: Authentication
description: Select passkey, Email OTP, optional VoiceID, and step-up authentication flows while preserving wallet and application trust boundaries.
---

# Authentication

Start with [Wallet setup and authentication](/examples/wallet-setup-and-authentication)
to configure the provider, register a wallet, and unlock it. Use this guide to choose an
authentication method and handle each resulting state.

## Choose a flow

- **Application sessions** — follow [Application sessions and owner approval](/guides/application-auth)
  for trusted backend handoffs and fresh owner approval for each NEAR operation.

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
- **VoiceID** — follow [VoiceID setup](/concepts/auth-methods/voiceid)
  for optional browser enrollment, unlock, and reviewed transfer approval.

## Keep auth state explicit

- Preserve the same wallet identity when someone registers, unlocks, or adds
  a factor.
- Follow the selected signing API's authorization flow.
  Each operation needs its required owner proof and signing permissions.
- Render cancellation, expiry, retryable delivery failure, and policy denial as
  separate outcomes.
- Keep passkeys, session tokens, and factor material out of application or agent
  storage.

Read [passkeys](/concepts/auth-methods/passkeys), [email
OTP](/concepts/auth-methods/email-otp), and [auth planes](/concepts/auth-planes)
for the boundaries behind each flow.
