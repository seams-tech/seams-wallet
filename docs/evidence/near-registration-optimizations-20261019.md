# NEAR registration optimizations — October 19, 2026

All three changes are committed on `dev`. No release was published or deployed.

- Combined respond reuses its committed admission. Credential, expiry, binding, and Router lifecycle checks remain.
- Custody and the completion receipt commit together. Reservation reads existing records beside remote work, replacing a separate serial write.
- The Router allocates eight address sets per batch. It retains at most seven unused sets for the same environment.

The local allocation comparison used control/candidate/candidate/control groups, with 32 requests per arm.
Its median fell from 4.48 ms to 0.94 ms. Role requests fell from 48 to 6 per 16 allocations.

Six combined-build registrations passed, with twelve verified first and warm signatures.
The SDK median was 627.0 ms, or 414.2 ms after subtracting each sample's virtual-passkey stage.
These local results have no matched registration control. Hosted savings remain unmeasured.

All five release Worker builds, four browser acceptance journeys, four regional journeys, fault tests, types, and bloat checks pass.
The custody fault test covers rollback, exact retry, and a lost committed reply. The allocation test covers concurrency, restart, failure, and generation isolation.

The [evidence record](near-registration-optimizations-20261019.json) contains measurements, limits, build hashes, and reproduction commands.
Raw records and frozen control binaries remain in `.artifacts/near-registration-optimizations-20261019/`.
Use the [benchmark instructions](../optimization-11-NEAR-local-breakdown.md) with a fresh runtime directory and `SEAMS_INTENDED_SIGNING_SESSION_DEBUG=1`.

Cloudflare permits reuse of an unchanged [environment object](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/#parameters).
The cache checks that identity before reuse. Cache hits are conditional; an environment change or eviction discards unused identifiers.
A release must update the Router, both Derivers, and Signing Worker together because their private allocation response now carries a batch.
