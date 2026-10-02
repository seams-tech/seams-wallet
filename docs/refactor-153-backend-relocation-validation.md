# R153: backend relocation validation

Status: initial platform, source, and local-runtime validation, October 2, 2026.
Hosted placement and complete wallet relocation remain unverified.

The material and authorization bindings examined permit a role-preserving
server-side transfer with stable logical identities and keys. The storage
primitives can copy wallet data, and the production authorization service accepts
existing credentials against copied records in an independent D1 database.
Safe relocation still
needs an application-level ownership handover across several stores. There is
no documented Cloudflare operation that performs that complete handover.

This investigation supports the intent in
[R153](refactor-153-wallet-region-selection.md). Its
[implementation stages and parallel ownership](refactor-153-wallet-region-selection.md#implementation-stages)
turn these findings into work and acceptance gates; exact protocol decisions
are settled before parallel implementation. Existing wallets will be deleted
before rollout; these findings concern subsequent moves of newly created wallets.

## Evidence and limits

- Cloudflare documentation checked on October 2, 2026; sources appear beside
  the relevant claims below.
- Wallet source: `267efd5147fcb3245b858d927ac8a6fb0cf69c6d`.
- Private Console source: `f93c01599baa89cccdda3e9c3a1281ecd0f401d1`.
- Local workerd probe: Node `v26.4.0`, Miniflare `4.20260710.0`, compatibility
  date `2026-06-12`. Two independent D1 databases and two SQLite DO namespaces
  were exercised through Worker requests, then restarted with persisted data.
- All 41 signer migrations were applied to fresh Node SQLite to inspect the
  effective schema: 55 tables, 64 explicit indexes, and 30 triggers. This is a
  schema census, not a claim that every table has a live product consumer.

Reproduce from the Wallet repository root:

```sh
node tests/e2e/backend-storage-transfer.e2e.mjs
```

The [probe](../tests/e2e/backend-storage-transfer.e2e.mjs) writes
`.artifacts/r153/backend-storage-transfer.json`, including runtime versions,
runner/Worker hashes, migration hashes, the effective schema, and observations.
It uses disposable local storage and synthetic records. It does not run the
wallet signing protocol, prove actual geography, or measure regional latency.
Its fixture exposes raw SQL only inside this local test; it must never be
deployed as a hosted transfer service.

## Cloudflare capabilities

| Question | Established behavior | Consequence for relocation |
| --- | --- | --- |
| Can an existing DO be given a new location hint? | DOs currently retain their initial placement. Only the first `get()` respects a hint, and hints are best effort. [DO data location](https://developers.cloudflare.com/durable-objects/reference/data-location/) | Create a fresh physical object identity at the destination. Changing routing or a hint for the old identity does not move its data. Avoid accidentally creating the destination without its intended hint. |
| Does a DO class transfer solve this? | The documented operation transfers an entire namespace between Workers in the same account. [Class transfers](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) | It does not establish a per-wallet geographical relocation primitive. A regional Worker deployment alone also does not relocate an existing DO. |
| Can D1 change its write home in place? | Placement hints and jurisdictions are supplied at creation; the documented partial-update API changes read replication. No documented in-place primary relocation operation was found. [D1 location](https://developers.cloudflare.com/d1/configuration/data-location/), [update API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/edit/) | Use a destination database and copy the wallet-owned subset. With regional shared databases, moving the whole source database would affect other wallets. |
| Are replicas sufficient? | D1 replicas provide geographically distributed reads. [D1 location](https://developers.cloudflare.com/d1/configuration/data-location/) | Read replication does not transfer wallet write/signing ownership. Source snapshot and cutover decisions need authoritative reads. |
| Can SQL export capture the whole wallet? | D1 supports database/table SQL export; export blocks other database requests and has virtual-table and numeric precision limitations. [Import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) | Whole-database export is unsuitable as the default per-wallet move from a shared database. Application-owned extraction needs a complete ownership inventory and an exact value encoding. |
| Is DO SQL the entire DO? | KV values live in hidden `__cf_kv`, inaccessible through SQL. SQL, KV, alarms, and PITR have separate APIs. [DO storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | Extract user SQL and KV explicitly. Decide alarm handling separately. PITR restores the existing object's history; it is not a documented arbitrary-object clone API. |
| Can one transaction cover the move? | D1 `batch()` is transactional within one database; DO transactions apply to that object's storage. [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [DO storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | Neither covers source D1, destination D1, all role objects, and the directory together. Each stage must recover after partial completion. |

The user-facing US/WEUR/APAC choice must map explicitly to supported hints and
eligible infrastructure. DO and D1 hint sets differ. A preference for APAC does
not guarantee Tokyo or a particular data center. Jurisdictions are stronger,
distinct constraints; a wallet constrained to the EU cannot become APAC-eligible
just because its owner changes a preference.
[DO location](https://developers.cloudflare.com/durable-objects/reference/data-location/),
[D1 location](https://developers.cloudflare.com/d1/configuration/data-location/).

## Findings in the current wallet implementation

### 1. The relocation boundary spans multiple authorities

Gateway signer D1 contains wallet identity, authorities, factors, sessions,
quotas, authorized operations, replay records, and lifecycle journals. Some
records are indirect children identified by a session, credential, operation,
or structured key. Filtering every table by `wallet_id` cannot enumerate them.
`router_ab_yao_versioned_json_records` also mixes wallet-related families with
shared tenant capability and replay state. The historical
[ownership map](refactor-150-state-ownership-map.md) is useful context; the
effective schema in the probe is the current schema evidence.

R152 must finish defining which facts become wallet-local and how their atomic
relationships to shared policy and identity uniqueness are maintained. Copying
a shared uniqueness index into each region would create separate authorities.
Keep tenant roots, tenant policy, and shared identity constraints with their
shared owners. A wallet appearing in a row does not by itself establish that
the row can move independently.

The role stores add the following boundaries:

| Owner | Current storage and relocation-sensitive content | Source |
| --- | --- | --- |
| Router wallet object | KV owner binding, execution claims/leases, pinned requests, terminal outcomes, consumer bindings. Its operation generation is distinct from home ownership. | [DO adapter](../crates/router-ab-cloudflare/src/durable_object/router_wallet.rs), [domain store](../crates/router-ab-cloudflare/src/router_wallet.rs) |
| Deriver A and B wallet objects | Separate role-private SQL pair state, revisions, admission fences, and owner binding. | [A object](../crates/router-ab-cloudflare/src/durable_object/deriver_a_pair.rs), [B object](../crates/router-ab-cloudflare/src/durable_object/deriver_b_pair.rs) |
| SigningWorker wallet object | Registrations, retired activations, round-one records, ECDSA pool/effect records, activations, linked-device material, and terminal responses. | [Wallet object](../crates/router-ab-cloudflare/src/durable_object/signing_worker_wallet.rs), [ECDSA store](../crates/router-ab-cloudflare/src/signing_worker/wallet_ecdsa_store.rs) |
| SigningWorker presign session objects | Durable claims plus live MPC session memory and expiry alarms. These are additional objects outside the main wallet object. | [Session object](../crates/router-ab-cloudflare/src/durable_object/mod.rs), [owner presign](../crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs) |
| Shared role-root D1 | Root epochs, admissions, retirement authority, and references to wallet pair objects. Remains with the shared role authority. | [Role-root store](../crates/router-ab-cloudflare/src/tenant_root_role_d1.rs) |

### 2. Importing rows can execute authorization again

The effective signer schema contains active business triggers:

- `authorized_operation_owner_grant_claim_atomic` validates live session,
  authority, and factor state when a claimed operation is inserted. A reusable
  session claim decrements its quota. Importing such a row into already-copied
  quota state can charge a second use or reject the import.
  [Migration 0034](../packages/wallet-server/migrations/d1-signer/0034_r103f_exact_wallet_session_cutover.sql).
- `authorized_operation_step_up_claim_atomic` compares evidence expiry with
  the database's current clock. Importing a previously valid, still-claimed
  operation after its evidence expires can fail.
  [Migration 0041](../packages/wallet-server/migrations/d1-signer/0041_step_up_admission_expiry.sql).
- Claim insertion also creates an audit record; inserting copied audit rows
  separately can conflict. Lifecycle, uniqueness, and foreign-key constraints
  impose additional ordering requirements. The effective trigger definitions
  are included in the probe artifact.

These are source-confirmed import hazards, not failures reproduced against a
complete wallet transfer. The named claim triggers apply to `claimed` rows;
importing terminal rows does not automatically retrigger every claim action.
First establish whether every claimed operation can be reconciled to a terminal
state before moving. Then demonstrate an import that preserves history, quota,
and constraints exactly. Disabling triggers across a live shared destination
database would affect unrelated wallets and is unsuitable.

### 3. Copying usable signing material creates two usable copies

The ECDSA wallet store locally couples material consumption with effect claims
and recorded outcomes in `claim_and_consume_effect`. A second independent store
has a second independent consumption boundary. The local probe demonstrates
this storage property with a synthetic ready/consumed record in both D1 and DO.

Account for the entire lifecycle state: ready, reserved, claimed, consumed,
burned, revoked, and terminal records where those states exist. The owner accepts
invalidating ready presignatures and regenerating them after a move. Preserve
operation IDs, request digests, expiry times, quotas, consumption/tombstone history,
and exact recorded results. An unanswered request may already have consumed
material or produced an external effect. Absence of a response must never cause
a fresh attempt under the same identity.

Existing live presign memory cannot be recovered from a database snapshot.
Drain those sessions or terminate them through a defined protocol that retains
their consumed identities. The destination must not recreate abandoned live
MPC state from a pre-claim snapshot.

### 4. Physical routing and cryptographic identity are coupled in today's helpers

The wallet objects use deterministic names and fixed namespace bindings via
`get_by_name`. Their routing helpers currently have no wallet-placement
generation. Selecting another D1 resource leaves those DO calls unchanged.

SigningWorker encryption authenticates environment, purpose, schema, and row
identity. That identity includes the deterministic logical wallet object name.
Deriver pair encryption additionally binds role/root metadata; its record
identity also includes the logical object name. The examined bindings do not
directly include geographical region or Cloudflare's physical object ID.
[SigningWorker cipher](../crates/router-ab-cloudflare/src/signing_worker/wallet_cipher.rs),
[row identity](../crates/router-ab-cloudflare/src/signing_worker/wallet_ecdsa_store.rs),
[Deriver cipher](../crates/router-ab-cloudflare/src/ed25519_yao_role_d1.rs).

Consequently, a new physical destination can plausibly retain the logical
identity and open the same ciphertext with the correct role key and version.
Changing the existing logical-name function to include a move generation could
break decryption. Separate physical routing from the identity authenticated by
stored material. Changing storage schema labels also needs explicit handling.

Destination configuration is part of this validation: role KEKs, server signing
identity, recipient keys, environment labels, and accepted protocol identities
must remain compatible. The protocol checks the selected SigningWorker identity.
[Normal signing](../crates/router-ab-core/src/protocol/normal_signing.rs).
Copying ciphertext to a new deployment with unrelated keys is insufficient.
Preserve A/B/SigningWorker separation. Whether to provision the same role KEK or
perform a role-local rewrap remains a custody decision; a central transfer
process should not collect all roles' plaintext material.

Nothing examined requires every owner device to be online or a new custody
ceremony solely to change region. The focused binding validation below records
the exact preservation contract and the executable authorization evidence.
End-to-end proof of the assembled server-only handover is still required.

### 5. Shared root authority retains references to the old objects

`tenant_root_root_use_admissions` records `pair_object_name`. Root retirement
uses those references to reconcile or fence wallet pair state. A new namespace
with the same object name can resolve to a different physical object; changing
the name can leave the shared reference pointing at the old one.
[Admission storage](../crates/router-ab-cloudflare/src/tenant_root_role_d1.rs),
[retirement reconciliation](../crates/router-ab-cloudflare/src/tenant_root_role_runtime.rs).

Relocation must settle outstanding references before cutover or make their
resolution follow the correct authority. Test this during root refresh and
retirement. Successful wallet signing alone would miss this dependency.

### 6. A directory update cannot fence an already-running backend

The private Console's current `walletPlacement/home.ts` models reserved,
established, and cancelled assignments. Migration `0051_wallet_homes.sql`
prohibits changing or deleting an established home. Neither currently expresses
a relocation generation or handover. R153 must deliberately replace this
fixed-home rule.

A move must durably stop admissions and account for already-authorized work at
every participating writer before enabling its destination. Include direct role
requests, delayed internal messages, cleanup jobs, alarms, and old deployments.
Checking a generation only at the public Gateway leaves those paths exposed.
An old backend comparing a request against its own stale generation also fails
to establish exclusive authority.

The directory's conditional ownership switch must follow verifiable source
quiescence and complete destination preparation. If the source cannot be fenced,
relocation must wait. If the switch's response is lost, read its authoritative
outcome before enabling either side. After destination writes begin, reopening
the old snapshot would discard new operations and potentially revive consumed
material. Reversing the move requires another controlled handover.

## Material and authorization binding validation

Follow-up on October 2, 2026, against Wallet revision `f70f088a` and the same
private Console revision listed above. This answers whether identities can
survive a paused transfer. It does not claim that transfer/fencing is implemented.

**Yes at the binding-contract level:** the destination can serve the same wallet
and device identities when it preserves the logical custody deployment. A
physical location change does not require a cryptographic identity change.
The following conclusions come from the actual encoders, decryptors, and
credential readers; authorization acceptance additionally has executable evidence.

| Binding | What must stay stable | Finding and source |
| --- | --- | --- |
| SigningWorker at-rest wallet records, including linked-device records | Role KEK and exact key version; environment, purpose, schema, logical wallet/row identity | `SigningWorkerPrivateD1CipherV1::aad` authenticates these values. Physical database/DO IDs and region are absent. Copying bytes between physical wallet stores preserves this binding when these inputs match. [Cipher](../crates/router-ab-cloudflare/src/signing_worker/wallet_cipher.rs), [ECDSA store](../crates/router-ab-cloudflare/src/signing_worker/wallet_ecdsa_store.rs), [Ed25519/linked store](../crates/router-ab-cloudflare/src/durable_object/signing_worker_wallet.rs). |
| Deriver A/B pair records | Separate role KEKs/versions, environment, role, signer-set/root metadata, schema, logical object/session identity | `RolePairAadV1` and `RolePairCipherV1::open` bind these values. The physical Cloudflare object ID is absent. A and B remain separate owners. [Cipher and record identity](../crates/router-ab-cloudflare/src/ed25519_yao_role_d1.rs), [A logical identity](../crates/router-ab-cloudflare/src/durable_object/deriver_a_pair.rs), [B logical identity](../crates/router-ab-cloudflare/src/durable_object/deriver_b_pair.rs). |
| Activated material and protocol envelopes | Complete activation reference; logical SigningWorker ID, server key epoch and recipient key; signer-set/peer identities and keys; operation/lifecycle transcript and expiry | `NormalSigningScopeV1` requires the material's SigningWorker to match. ECDSA embeds `ServerIdentityV1`; role envelopes authenticate the selected server. These are logical identities, with no physical location field. [Scopes and activation](../crates/router-ab-core/src/protocol/lifecycle.rs), [ECDSA scope](../crates/router-ab-core/src/protocol/router_ab_ecdsa_derivation.rs), [server identity](../crates/router-ab-core/src/protocol/identity.rs), [envelope](../crates/router-ab-core/src/protocol/envelope.rs). |
| Primary Wallet Session | Opaque token digest, logical tenant/scope, session, authority, factor, capability subjects, quota, expiry and retirement state | `digestOpaqueValue` is SHA-256 of the token. The D1 reader resolves its digest and checks the live joined authority/method/quota records. No database ID, region, or deployment secret enters that digest. [Service](../packages/wallet-server/src/authorization/service.ts), [D1 reader](../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts). |
| Hosted credential and exchange | Parent session, token/code/nonce digests, app and wallet origins, expiry and consumed state | The production reader checks the request's wallet origin. A new physical D1 resource is acceptable; changing the public wallet origin rejects the credential. [Hosted reads and exchange](../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore.ts). |
| Linked-device credential delivery and local material | Logical namespace/org/project/environment, wallet/device authority, factor, session/quota, recipient key, activation and package digests | The delivery AAD and local material seal bind these values. Regional storage is absent. Preserve each device's existing binding rather than issuing a replacement credential or activation. [Delivery AAD](../packages/shared-ts/src/device-linking/walletSessionCredentialDelivery.ts), [local material seal](../packages/wallet/src/core/indexedDB/linkedAuthoritySignerMaterial.ts). |
| Custody and recovery envelopes | Wallet/envelope/factor ownership and revisions; passkey RP/credential or Email OTP enrollment binding; recovery wallet/key identity | The custody and recovery AAD encoders have no backend location input. These ciphertexts can remain byte-identical. The owner seed remains client custody. [Custody AAD](../crates/signer-core/src/passkey_custody.rs), [recovery AAD](../crates/signer-core/src/wallet_recovery_custody.rs). |
| Server-sealed session and Email OTP material | Existing server-seal root secret, algorithm/group, and required accepted key versions | The server lock derives from the secret and a protocol/version context, without region. Email OTP uses this cipher too. A destination with a freshly generated seal secret cannot open the existing material. [Server-seal cipher](../packages/wallet-server/src/threshold/session/signingSessionSeal/crypto/cipher.ts), [Email OTP runtime](../packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpServerSealRuntime.ts). |
| Client presign cache and saved session | Public relayer URL and existing material/pool identity | The ECDSA presign AAD contains its pool identity, which includes `relayerUrl`; saved sealed sessions also retain that URL. Keep the public endpoint stable and change internal routing. [Client presign records](../packages/wallet/src/core/indexedDB/seamsWalletDB/ecdsaClientPresignatures.ts), [saved sessions](../packages/shared-ts/src/utils/signingSessionSeal.ts). |

### Deployment changes required to preserve these bindings

The private deployment generator's `buildRegistrationTopology` currently uses
`configuration.signingWorkerName` as `selected_server.server_id` and the Router
Worker name as `routerId`. `scripts/deploy-backend.mjs` passes `lane.id` as
`SIGNING_WORKER_PRIVATE_D1_ENVIRONMENT` and `DERIVER_ROLE_PRIVATE_D1_ENVIRONMENT`.
The key generator creates fresh role KEKs, envelope/recipient keys, and peer keys;
Gateway setup also provisions a server-seal root secret. These are source findings
in `deployment/wallet-system/scripts/generate-github-env-values.mjs`,
`generate-deployment-keys.mjs`, and `scripts/deploy-backend.mjs` in the private repo.

A destination created as an unrelated deployment with new names, environment
labels, and keys would break these bindings. The proposed transfer should
preserve the existing logical configuration and provision the destination as
another physical location for those same roles. Keep resource names/locators
separate from protocol identities and authenticated encryption labels where the
tooling currently derives one from the other. This permits a storage/routing
change without a redesign of wallet key derivation or device identity.

The current role ciphers load one configured key/version, rather than selecting
arbitrary per-wallet deployment keys. The simple destination model therefore
shares the same logical role configuration across eligible regions. Moving into
an independently keyed custody deployment would require additional key/identity
handling and falls outside this paused, role-preserving transfer assumption.
Do not solve that different case by handing a central mover every role's secrets.

Placement generation must remain distinct from material activation epoch,
signing-root version, root-share epoch, revocation epoch, and operation lease
generation. Preserve the latter values. A physical home move alone provides no
reason to change them.

### Executed authorization transfer

Run from the Wallet repository root:

```sh
node tests/e2e/authorization-storage-transfer.e2e.mjs
```

The [probe](../tests/e2e/authorization-storage-transfer.e2e.mjs) applies all 41
signer migrations to two independent local workerd D1 databases. Shared canonical
fixtures provide the two device authorities; production statement builders and
`AuthorizationService` create their sessions and a hosted exchange/credential.
It copies six relevant tables into the destination and invokes the production
credential readers there with the original tokens. No tokens are reissued for
the destination, and no token or private material is included in the evidence.

Passed:

- Both devices' primary credentials return the identical authority, factor,
  capability subjects, session identities, and quota at the destination. The
  second device supplies no fresh authentication or participation in the copy.
- The existing hosted credential works with its original wallet origin; changing
  that origin rejects it. Changing tenant or organization also rejects access.
- The already-redeemed exchange remains consumed. Expiry is still enforced.
- Retiring the first device's session invalidates its primary and hosted
  credentials while the second device's session remains active.

The probe also reproduced `wallet_session_hosted_exchange_initial_state_rejected`
on a direct insert of consumed exchange history. Its lifecycle guard permits
only initially issued rows. For the binding experiment, the empty/inactive test
destination restores that terminal row in a transaction that temporarily removes
and reinstates this guard; a subsequent insert verifies the guard still rejects
it. This is a test-only restoration technique. Production import into a shared
regional database still needs a reviewed historical-state restore path.

Evidence is written to
`.artifacts/r153/authorization-storage-transfer/evidence.json`, with code/runtime
versions, production-bundle and migration hashes, table counts, and outcomes.
This verifies the authorization/storage boundary with fixture device authorities.
It does not execute MPC signing, browser unlock, WebAuthn, a real linked-device
enrollment, or a geographically distributed/fenced handover. Crypto portability
in this section is established from the actual binding contracts; assembled
signing and offline-browser continuity remain release gates.

## Presignature invalidation and compute limits

Follow-up source validation on October 2, 2026, at Wallet revision `c53bc02d`.
The owner accepts invalidation and regeneration of existing presignatures and
proposes a minimum interval of one to five minutes between region changes.
R153 adopts five minutes as the conservative working proposal. This relaxes
ready-pool continuity while retaining durable wallet/device identities and
one-use history. These findings are from production code; relocation-specific
invalidation and cooldown are still unimplemented.

| Question | Current evidence | Consequence for the plan |
| --- | --- | --- |
| Can the existing retirement command invalidate pools while preserving material identity? | `CloudflareSigningWorkerEcdsaPoolCommandV1::Retire` and the pool transition accept only `KeyEpochRetired` or `ActivationEpochRetired`. [Command validation](../crates/router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs), [pool transitions](../crates/router-ab-ecdsa-pool/src/lib.rs). | Add an explicit pool invalidation operation. Relocation must not claim a key or activation retired when its durable material remains active. |
| Is deleting usable rows sufficient? | `PutAvailable` admits an identity when no row exists; an existing consumed or tombstone row rejects replacement. [Lifecycle](../crates/router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs). | Burn usable secrets while retaining terminal identities. Fence delayed refill admissions as well as signing; a refill whose identity was never stored would evade an enumeration-only burn. |
| Does client cache invalidation cover all devices and restarts? | The coordinator checks a pool generation before publishing refill output, but stores that generation in a module-local `Map`. The durable pool identity contains no placement generation. [Coordinator](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts), [identity](../packages/wallet/src/core/signingEngine/workerManager/ecdsaPresignPoolIdentity.ts). | Reuse local cancellation behavior, and add authoritative placement reconciliation for cached durable and resident entries. Server rejection must work even when an offline device or another tab still has the old pool. |
| Can the server regenerate every device's paired presignatures by itself? | `runPresignHandshake` drives both the client signing-material port and server pool-fill rounds; client admission checks the matching `bigR`. [Handshake](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts), [server admission](../crates/router-ab-cloudflare/src/ecdsa_presign_session.rs). | Backend relocation can finish with empty pools. Fresh paired material needs client participation when each device reconnects or signs. No additional custody ceremony follows solely from this invalidation. |
| May a retry start signing again after the pools are cleared? | `claim_and_consume_effect` looks up the existing effect before consuming material and returns its terminal response or `InProgress`. [Wallet store](../crates/router-ab-cloudflare/src/signing_worker/wallet_ecdsa_store.rs). | Preserve effect claims and results. Reconciliation of unfinished claims remains a release gate; clearing usable pools cannot authorize a second effect or quota charge for the original request. |

The same audit includes the linked-device presign session's completed KV records
and one-use claims, in addition to the owner wallet's SQL pool. Cover them in the
freeze and invalidation inventory. Session memory cannot be copied into a new
object, and completing a delayed protocol round must not recreate usable
material under an obsolete home.
[Presign session object](../crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs).

Enforce the proposed five-minute minimum at wallet relocation admission in the
authoritative directory, across all devices and both placement modes. Serialize
moves, treat selecting the current home as a transfer no-op, and deduplicate
retries by the same move identity. Keep this state outside the data being moved.
Bound failed-attempt retries and regeneration too: a limit that records only
successful cutovers does not bound expensive failed attempts. Exact timing and
backoff semantics remain open.

Five minutes is a proposed rate limit, without measured compute-cost evidence.
It permits up to twelve new relocation admissions per hour per wallet, so normal
bounded pool depth, per-move deduplication, and demand-driven device refill still
matter. Measure compute per refill, number of active device pools, retry work,
and the first signing delay before settling that interval. R154's sustained-move
policy needs its own observation and benefit thresholds; the shared minimum
does not establish a useful automatic relocation cadence.

Both existing storage and authorization transfer probes passed again during
this follow-up and refreshed their repeatable artifacts. They continue to
establish copy/credential behavior, without executing relocation fencing,
presignature invalidation, regeneration after a move, or geographic placement.

## Operational issues to include in the transfer contract

| Issue | Required behavior / validation |
| --- | --- |
| Consistent snapshot | Pausing only browser requests leaves background work running. Establish a stable wallet snapshot across all participating stores. An online pre-copy also needs deletion tracking and a final consistent delta; start with a paused copy if measured sizes permit. |
| Partial import or schema mismatch | Keep incomplete destinations inactive. Resume the same move after a crash; verify expected schema, scope, record counts, revisions, and content digests before activation. Exercise a mid-batch failure and a repeated import. |
| Serialization | Preserve BLOBs, nulls, Unicode, integer precision, and exact signed/ciphertext bytes. The probe preserves an integer above JavaScript's safe range by transporting it as decimal text. Its JSON KV example covers JSON-compatible values only. |
| Alarms and expiry | Alarms can run at least once and retry; deleting an alarm does not stop an already-running handler. Source handlers need the same authority fence. Preserve deadlines without extending grants, and explicitly decide which work should resume at the destination. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/). |
| Cleanup and restore | `deleteAll()` erases the retirement marker too; with the tested compatibility date it also removes the alarm. Retain an authoritative fence that survives cleanup, restart, and restoring an old snapshot. Backup retention makes immediate erasure a separate claim. [Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [D1 retention](https://developers.cloudflare.com/d1/platform/limits/). |
| Offline devices and cached routes | Preserve wallet keys/addresses, device authority, revocations, session semantics, and operation IDs. A stale device must rediscover the current home before an effect and discard invalidated presignatures. Refill paired material when that device participates again. Verify token/key configuration, credential lookup before wallet resolution, and any endpoint identity bindings. |
| Shared load and limits | Bound transfer pages and transactions. D1 has statement/parameter/row limits and a 30-second query limit; each database serializes queries. DOs also impose object-size and CPU limits. Measure pause duration and interference with unrelated wallets. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/). |
| Transport and permissions | Restrict export/import to the authenticated move, wallet, role, destination, and expected generation. Reject another tenant's data and stale/repeated commands. Avoid ciphertext or secret dumps in evidence logs. Cross-account bindings and custody configurations require separate eligibility checks. |
| Repeated moves | Serialize competing device requests and enforce the proposed wallet-wide five-minute admission interval across manual and automatic mode. Bound failed attempts and deduplicate the same move's retries/refills. Moving back to a previous region must not reactivate its old state. Preserve monotonic ownership through cleanup, cancellation, and later moves. |
| Actual benefit | Verify destination D1 placement evidence and role-object routing separately from ingress Worker location. Measure the full signing path, including retained shared authorities, from representative regions. Successful copying alone says nothing about latency improvement. |

## Executed checks

All checks below passed in the local probe. Each is limited to the synthetic
storage scenario, except the explicitly identified schema census.

| Check | Observed result |
| --- | --- |
| Apply current signer migration chain | 41 migrations applied; effective schema and migration hashes recorded. |
| Select and transfer one wallet | Exact selected rows arrived in independent D1 and DO stores; the unrelated wallet was absent. |
| Transfer byte/value edge cases | BLOB bytes, null, Unicode, and text-encoded int64 survived. |
| Fail a local multi-statement mutation | D1 batch and DO SQL transaction rolled back the earlier write when a duplicate insert failed. |
| Consume after copying | Source and destination each consumed the copied ready record once. Source rejected its second consumption. This demonstrates why local single-use checks do not provide global exclusivity. |
| Copy only DO user SQL | Destination had neither the source KV records nor its alarm. Direct SQL access to `__cf_kv` was rejected. |
| Copy KV/alarm and restart | Destination rows, KV, alarm, and physical ID persisted. The in-memory request counter restarted. |
| Change a hint / use a separate namespace | Changing the hint retained the source ID; the other namespace had a different ID. Local execution makes no geographical claim. |
| Delete source DO state | The retirement marker and alarm were removed along with its storage. |

## Remaining validation gates

1. **Freeze the R152 ownership inventory.** Trace each supported operation to its
   wallet and shared writes, including indirect keys and presign session objects.
   Resolve cross-store atomicity before choosing export boundaries.
2. **Validate a disposable hosted placement probe.** Create separate WEUR/APAC
   D1 resources and fresh per-role DO identities with first-touch hints. Record
   resource IDs, code versions, placement evidence where available, and latency
   from representative client regions. Do not infer DO location from the ingress
   request's colo. Verify actual account/binding access and data round trips.
3. **Demonstrate an actual wallet move with a brief pause.** Preserve role and
   wallet identities; cover ECDSA and Ed25519, invalidated ready pools and
   preserved consumed-material history, completed retries, session quota,
   revoked factors, and an offline owner device. Verify signatures and unchanged
   addresses after transfer. Include
   interrupted presigning, stale cache restoration after a browser restart,
   delayed refill completion, and fresh paired regeneration on reconnect.
   Reconcile all claim/import-trigger cases.
4. **Inject faults at each handover boundary.** Crash after each source fence,
   during each copy, after destination verification, around directory commit,
   and during cleanup. Deliver delayed source requests and duplicate move
   commands. Evidence must show one current authority and no duplicate material
   consumption or quota charge, including after both services restart.
5. **Exercise shared-authority and repeat-move cases.** Refresh/retire tenant
   roots during relocation, keep a second wallet active, return the first wallet
   to its previous region, and restore a pre-move snapshot in an isolated test.
   Confirm stale state never authorizes work and the unrelated wallet is intact.
6. **Measure operational suitability.** Capture pause duration, bytes, database
   load, end-to-end latency, first-signature refill delay, regeneration compute,
   cooldown enforcement across devices/modes, and failed-move recovery.
   Establish supported custody/account/jurisdiction combinations before
   exposing the setting.

Each hosted scenario should produce a repeatable artifact containing revisions,
resource identities, move/generation transitions, record digests, operation IDs,
verification results, and fault injection points, with private material excluded.
No hosted resources or wallet data were changed in this investigation.

R153 is therefore a cross-cutting backend change before it is a region selector.
The smallest candidate is a paused, role-preserving copy with explicit fencing
and exact replay preservation. Live delta replication can wait for measurements
showing that a paused copy is insufficient. R154 can remain a small policy layer
over the same relocation operation once these gates pass.
