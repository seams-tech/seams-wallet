# R150 Deriver A pair-store boundary

This is the narrow storage contract for the new-wallet Deriver A Yao path. The
authoritative pair record is scoped to one trusted `(org, project, environment,
wallet, role, session)` identity. The role is fixed to Deriver A by its deployment and VM
process. The complete record and its monotonically increasing revision are one
atomic storage unit. The encrypted input and role-private execution context
remain in that record; the shared transition treats them as opaque payload.

`router-ab-core` owns `Ed25519YaoPairRecordV1` and the preparation, claim,
completion, expiry, and burn decisions. The adapters own serialization,
host-specific at-rest protection, storage transactions, and peer transport. The existing
signed-readiness and start-acceptance verification remains mandatory before a
claim. A record equality check never substitutes for signature verification.

| Operation | Atomic write precondition | Durable result |
| --- | --- | --- |
| Prepare | No row for the exact session | Prepared record; return readiness only after commit |
| Claim | Selected Prepared revision and exact signed bindings | Running record with execution ID and claim identity; peer effects only after commit |
| Complete | Selected Running revision and same execution ID | Completed record containing the entire replayable outcome |
| Expire | Selected Prepared revision at or after expiry | Expired tombstone |
| Burn | Selected Running revision and same execution ID | Burned tombstone |
| Read outcome | Trusted scope and exact pair identity | Existing terminal result; no write |

An identical request against Prepared/Running/Completed returns the existing
claim or outcome without a new revision. Changed pair binding, receipt,
acceptance, or execution identity is rejected. Expired and burned tombstones
are never prepared again. A conditional write that affects no row is a stale
version and must re-read before any effect. If commit acknowledgement is
uncertain, the caller reads the exact scoped row from primary storage. It may
replay an existing outcome or resume only the same durable claim; it must not
allocate a replacement execution. A Running record after restart with an
unknown peer-effect state needs explicit reconciliation or safe burn.

VM SQLite uses an immediate transaction and a conditional revision write on
the role-private database. The wallet DO uses one SQLite-backed object in
Deriver A's deployment, with conditional single-statement writes. Both run the
shared transition against the row selected inside their atomic boundary.
The DO name is derived from stable server-resolved org/project/environment and
wallet identity. A tenant-root identity digest includes root ID/version and is
bound to the operation; it is not a stable wallet routing key. The DO pins its
owner scope and encrypts each full record with role/environment/root/session
AAD. New-wallet traffic remains on D1 until the internal authenticated route
and execution handler use these adapters and pass the retirement review gate.
Network calls and signing work occur after the claim commits and before the
completion write. The D1 path stays authoritative for current wallets until
the separately coordinated clean reset and DO-only route activation. No
existing-wallet conversion or compatibility reader is required for the
production test wallets.

## Root-retirement review gate

The role-D1 tenant-root retirement barrier and a wallet DO pair claim are in
different databases. A read of the root fence immediately before the DO claim
does not make them atomic: retirement can commit between that read and the DO
write, while the newly claimed execution can still emit peer effects. An
epoch-bound signature authenticates the earlier admission but does not revoke
it. No production DO routing is allowed until an operation-level admission and
retirement drain/reconciliation protocol is reviewed. The bounded DO/VM
adapter tests must state this exclusion; their equivalence alone cannot prove
retirement safety.
