# Application Auth Provider Integrations

Applications can reuse a configured provider's login to open wallet settings.
Google ID tokens are the first supported external credentials.
The server verifies the token and an explicit, owner-authorized wallet association.
The resulting session grants settings reads and has no signing permission or custody material.

Use the [Google integration](./google-oidc.md) for browser tokens and backend handoffs.
Other providers, app-issued tokens, and arbitrary WebAuthn responses do not yet have external-session adapters.
Those integrations continue to use wallet passkey or Email OTP authentication for wallet access.

Signing, key export, recovery, and security changes retain their wallet authorization requirements.
An app session cookie or an API secret alone cannot establish a user's wallet association.
