# Refactor sources to numbered Wallet specifications

Status: implemented documentation consolidation.

Source baseline: archived `seams-sdk` commit
`70d62b7c3e58385b5283790785bed7fc48c65fa2`.

## Result

Durable Wallet architecture from the historical `refactor-*.md` plans is now
consolidated into nine normative specifications directly under `docs/`:

[How the wallet works](../README.md) introduces the app, client, and server,
then links to these chapters by topic.

| Authority | Historical sources |
| --- | --- |
| [`spec-1-runtime-and-platform-boundaries.md`](../spec-1-runtime-and-platform-boundaries.md) | R51, R51 native readiness, R51b, R85, R86, R108, R110, R116, R119 |
| [`spec-2-auth-custody-and-credentials.md`](../spec-2-auth-custody-and-credentials.md) | R82B, R90 spec, R100, R103E/F, R109C/D, R113-R115 |
| [`spec-3-wallet-sessions-and-execution-lanes.md`](../spec-3-wallet-sessions-and-execution-lanes.md) | R90, R92, R100, R101, R103F, R104 |
| [`spec-4-persistence-and-durable-authority.md`](../spec-4-persistence-and-durable-authority.md) | Wallet portions of R82, R85, R89, R90, R93, R94C, R95B, R100, R103F, R120 |
| [`spec-5-router-ab-threshold-protocol.md`](../spec-5-router-ab-threshold-protocol.md) | R89, R93, R94C, R95, R96, R99B, R120 |
| [`spec-6-tenant-roots-recovery-and-portability.md`](../spec-6-tenant-roots-recovery-and-portability.md) | R120, R121 and focused follow-ups, R122, R122B |
| [`spec-7-hosted-surfaces-and-provider-boundaries.md`](../spec-7-hosted-surfaces-and-provider-boundaries.md) | R86, R108, R110, R112, R119, R122B, public R123 integration boundary |
| [`spec-8-agent-authority-spending-and-payment-rails.md`](../spec-8-agent-authority-spending-and-payment-rails.md) | R104, R130A-D, reusable safety rules from the historical card-on-file design |
| [`spec-9-behaviour-and-test-authority.md`](../spec-9-behaviour-and-test-authority.md) | R88, R88B, R98, final R105 test ownership |

The specifications explain the main flows, responsibilities, and security rules.
Detailed protocol requirements, behaviour contracts, and source definitions are
linked where needed. This document retains historical source lineage so readers
can learn the current system without following the refactor history.

## Authority order

1. [`docs/intended-behaviours.md`](../intended-behaviours.md) owns supported
   user-visible Wallet behaviour.
2. `docs/spec-1-*.md` through `docs/spec-8-*.md` own internal domain and
   architecture contracts. Spec 9 owns contributor and verification policy.
3. [`docs/router-ab/`](../router-ab/) owns detailed threshold protocol,
   deployment separation, and local composition.
4. `apps/docs/src/*` explains public SDK and operator interfaces.
5. Refactor documents are proposals or historical sources and carry no authority
   after integration into a numbered specification.

When authorities overlap, the more specific higher-ranked document controls. A
real contradiction is resolved in both documents rather than left to inference.

## Preserved proposals

The copied R130A-D documents remain as implementation proposals until the domain
and its intended-behaviour contracts land. Their durable target architecture is
owned by Spec 8. R130 delivers Wise transfer proposals and approvals for Japanese
businesses first, eligible Airwallex sandbox cards second, and traditional bank
transfers third. Wise execution and card API access require separate verification;
the first milestone needs no wallet funding. Each phase uses exact owner approval
when required and separately verified execution. Hosted payment services,
provider-account operations, and Console UI belong
to the private repository's implementation.

## Excluded private and historical material

- R99 Console organization, billing, and transactional-email product work.
- R105 migration ledgers beyond their final public/private repository boundary.
- R118 Console 2FA and R140 enterprise Console SSO.
- R123 DNS, OAuth-provider setup, deployment workflow, and cutover evidence.
- R93 production evidence, R103F phase-zero evidence, and R121 progress ledgers.
- R130C private Console implementation and R130D provider-account operations.

Those records remain in the archived source repository or their private owning
repository. They are not public Wallet architecture.

## Follow-through rule

New architecture work updates the owning numbered specification. A user-visible
behaviour change also updates `docs/intended-behaviours.md` and its contract test.
New refactor plans may cite these authorities but must not fork their definitions.
