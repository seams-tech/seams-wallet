------------------------- MODULE RouterAbSigning -------------------------
EXTENDS Integers, FiniteSets

CONSTANTS Operations, ApprovedOperation, StartingBudgets, NoBinding, NoClaim, NoEffect

ASSUME /\ Cardinality(Operations) = 2
       /\ ApprovedOperation \in Operations
       /\ StartingBudgets \subseteq 0..2

Methods == {"passkey", "email_otp"}
FactorInputs == {"verified", "missing", "failed", "cancelled"}
NoResult == "no_result"
Results == {"signature", "signing_failure"}
Deadline == 1

BindingFields == {"operation", "wallet", "authority", "method", "signer",
                  "material", "curve", "chain", "purpose", "lane", "intent",
                  "display", "origin", "audience"}

VARIABLES startingUses, method, factorInput, clock, gateway, worker,
          volatile, audit, restarts, lastEvent

vars == <<startingUses, method, factorInput, clock, gateway, worker,
          volatile, audit, restarts, lastEvent>>

Binding(op) ==
    [operation |-> op, wallet |-> "wallet", authority |-> "authority",
     method |-> method, signer |-> "signer", material |-> "material",
     curve |-> "ecdsa", chain |-> "chain", purpose |-> "sign_transaction",
     lane |-> "lane", intent |-> op, display |-> op,
     origin |-> "origin", audience |-> "audience"]

Request(op, field) ==
    IF field = "exact" THEN Binding(op)
    ELSE [Binding(op) EXCEPT ![field] = "altered"]

ClaimSource(op) ==
    IF gateway.claims[op] = NoClaim THEN "none"
    ELSE gateway.claims[op].source

Eligible(op) ==
    /\ gateway.claims[op] # NoClaim
    /\ clock < Deadline
    /\ IF ClaimSource(op) = "step_up"
          THEN gateway.evidence = gateway.claims[op].binding
          ELSE TRUE

Init ==
    /\ startingUses \in StartingBudgets
    /\ method \in Methods
    /\ factorInput \in FactorInputs
    /\ clock = 0
    /\ gateway = [quota |-> [walletSessionId |-> "session", quotaId |-> "quota",
                            expiresAt |-> Deadline, remaining |-> startingUses],
                   claims |-> [op \in Operations |-> NoClaim],
                   evidence |-> NoBinding, emailGrantConsumed |-> FALSE]
    /\ worker = [material |-> [kind |-> "available", revision |-> 0,
                              binding |-> NoBinding],
                  effects |-> [op \in Operations |-> NoEffect]]
    /\ volatile = [approval |-> "idle", sampledAt |-> -1, forwarded |-> {},
                    active |-> {}, results |-> [op \in Operations |-> NoResult]]
    /\ audit = [debits |-> [op \in Operations |-> 0], takes |-> 0,
                 signs |-> [op \in Operations |-> 0],
                 firstWorker |-> [op \in Operations |-> NoResult],
                 firstGateway |-> [op \in Operations |-> NoResult],
                 received |-> [op \in Operations |-> NoResult],
                 terminalMaterial |-> FALSE]
    /\ restarts = {}
    /\ lastEvent = "none"

AdmitWarm(op) ==
    /\ gateway.claims[op] = NoClaim
    /\ clock < gateway.quota.expiresAt
    /\ gateway.quota.remaining > 0
    /\ gateway' = [gateway EXCEPT
          !.quota.remaining = @ - 1,
          !.claims[op] = [source |-> "warm", binding |-> Binding(op),
                          checkedAt |-> clock, admittedAt |-> clock,
                          result |-> NoResult]]
    /\ audit' = [audit EXCEPT !.debits[op] = @ + 1]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, worker, volatile,
                    restarts, lastEvent>>

BeginApproval ==
    /\ volatile.approval = "idle"
    /\ clock < Deadline
    /\ volatile' = [volatile EXCEPT !.approval = "started", !.sampledAt = clock]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    audit, restarts, lastEvent>>

VerifyFactor ==
    /\ volatile.approval = "started"
    /\ volatile' = [volatile EXCEPT
          !.approval = IF factorInput = "verified" THEN "verified" ELSE "rejected"]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    audit, restarts, lastEvent>>

ConsumeEmailGrant ==
    /\ method = "email_otp"
    /\ volatile.approval = "verified"
    /\ ~gateway.emailGrantConsumed
    /\ clock < Deadline
    /\ gateway' = [gateway EXCEPT !.emailGrantConsumed = TRUE]
    /\ volatile' = [volatile EXCEPT !.approval = "consumed"]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, worker, audit,
                    restarts, lastEvent>>

RecordEvidence ==
    /\ (method = "passkey" /\ volatile.approval = "verified")
        \/ (method = "email_otp" /\ volatile.approval = "consumed")
    /\ gateway.evidence \in {NoBinding, Binding(ApprovedOperation)}
    /\ gateway' = [gateway EXCEPT !.evidence = Binding(ApprovedOperation)]
    /\ volatile' = [volatile EXCEPT !.approval = "recorded"]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, worker, audit,
                    restarts, lastEvent>>

\* The route carries its earlier nowMs through verification and D1 admission.
AdmitStepUp(op, field) ==
    /\ volatile.approval = "recorded"
    /\ gateway.claims[op] = NoClaim
    /\ Request(op, field) = gateway.evidence
    /\ volatile.sampledAt < Deadline
    /\ gateway' = [gateway EXCEPT
          !.claims[op] = [source |-> "step_up", binding |-> Request(op, field),
                          checkedAt |-> volatile.sampledAt, admittedAt |-> clock,
                          result |-> NoResult]]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, worker, volatile,
                    audit, restarts, lastEvent>>

Forward(op) ==
    /\ Eligible(op)
    /\ op \notin volatile.forwarded
    /\ volatile' = [volatile EXCEPT !.forwarded = @ \cup {op}]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    audit, restarts, lastEvent>>

Reserve(op) ==
    /\ op \in volatile.forwarded
    /\ worker.material.kind = "available"
    /\ worker.material.revision = 0
    /\ clock < Deadline
    /\ worker' = [worker EXCEPT
          !.material = [kind |-> "reserved", revision |-> 1,
                         binding |-> gateway.claims[op].binding]]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, volatile,
                    audit, restarts, lastEvent>>

ClaimWorker(op) ==
    /\ op \in volatile.forwarded
    /\ worker.effects[op] = NoEffect
    /\ worker.material.kind = "reserved"
    /\ worker.material.revision = 1
    /\ worker.material.binding = gateway.claims[op].binding
    /\ clock < Deadline
    /\ worker' = [worker EXCEPT
          !.material.kind = "consumed", !.material.revision = 2,
          !.effects[op] = [binding |-> gateway.claims[op].binding, result |-> NoResult]]
    /\ volatile' = [volatile EXCEPT !.active = @ \cup {op}]
    /\ audit' = [audit EXCEPT !.takes = @ + 1, !.terminalMaterial = TRUE]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway,
                    restarts, lastEvent>>

Sign(op, result) ==
    /\ op \in volatile.active
    /\ volatile.results[op] = NoResult
    /\ volatile' = [volatile EXCEPT !.results[op] = result]
    /\ audit' = [audit EXCEPT !.signs[op] = @ + 1]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    restarts, lastEvent>>

CommitWorkerResult(op) ==
    /\ volatile.results[op] # NoResult
    /\ worker.effects[op] # NoEffect
    /\ worker.effects[op].result = NoResult
    /\ worker' = [worker EXCEPT !.effects[op].result = volatile.results[op]]
    /\ audit' = [audit EXCEPT !.firstWorker[op] = volatile.results[op]]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, volatile,
                    restarts, lastEvent>>

CompleteGateway(op) ==
    /\ gateway.claims[op] # NoClaim
    /\ worker.effects[op] # NoEffect
    /\ worker.effects[op].result # NoResult
    /\ gateway.claims[op].result = NoResult
    /\ gateway' = [gateway EXCEPT !.claims[op].result = worker.effects[op].result]
    /\ audit' = [audit EXCEPT !.firstGateway[op] = worker.effects[op].result]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, worker, volatile,
                    restarts, lastEvent>>

ExactRetry(op) ==
    /\ Eligible(op)
    /\ lastEvent' = "exact_retry"
    /\ audit' = [audit EXCEPT !.received[op] = gateway.claims[op].result]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    volatile, restarts>>

RejectChangedRequest(op, field) ==
    /\ gateway.claims[op] # NoClaim
    /\ Request(op, field) # gateway.claims[op].binding
    /\ lastEvent' = field
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    volatile, audit, restarts>>

RejectStaleRevision(op, revision) ==
    /\ op \in volatile.forwarded
    /\ worker.material.kind = "reserved"
    /\ revision # worker.material.revision
    /\ lastEvent' = "stale_revision"
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    volatile, audit, restarts>>

RollbackAdmission(op) ==
    /\ gateway.claims[op] = NoClaim
    /\ clock < Deadline
    /\ lastEvent' = "rollback"
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    volatile, audit, restarts>>

RollbackWorker(op) ==
    /\ op \in volatile.forwarded
    /\ worker.material.kind = "reserved"
    /\ worker.material.binding = gateway.claims[op].binding
    /\ lastEvent' = "worker_rollback"
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    volatile, audit, restarts>>

LoseGatewayResponse ==
    /\ volatile.forwarded # {}
    /\ volatile' = [volatile EXCEPT !.forwarded = {}]
    /\ lastEvent' = "response_lost"
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    audit, restarts>>

LoseMaterialDelivery ==
    /\ volatile.active # {}
    /\ \A op \in volatile.active : volatile.results[op] = NoResult
    /\ volatile' = [volatile EXCEPT !.active = {}]
    /\ lastEvent' = "material_delivery_lost"
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    audit, restarts>>

BurnMaterial(reason) ==
    /\ worker.material.kind \in {"available", "reserved"}
    /\ (reason = "expiry" /\ clock = Deadline)
        \/ (reason = "cancellation" /\ worker.material.kind = "reserved")
    /\ worker' = [worker EXCEPT !.material.kind = "tombstone",
                                 !.material.revision = @ + 1]
    /\ audit' = [audit EXCEPT !.terminalMaterial = TRUE]
    /\ lastEvent' = reason
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, volatile,
                    restarts>>

RestartGateway ==
    /\ "gateway" \notin restarts
    /\ restarts' = restarts \cup {"gateway"}
    /\ volatile' = [volatile EXCEPT !.approval = "idle", !.sampledAt = -1,
                                   !.forwarded = {}]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    audit, lastEvent>>

RestartWorker ==
    /\ "worker" \notin restarts
    /\ restarts' = restarts \cup {"worker"}
    /\ volatile' = [volatile EXCEPT !.active = {},
                                   !.results = [op \in Operations |-> NoResult]]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, worker,
                    audit, lastEvent>>

RecoverReservation ==
    /\ "worker" \in restarts
    /\ worker.material.kind = "reserved"
    /\ worker' = [worker EXCEPT !.material.kind = "tombstone", !.material.revision = 2]
    /\ audit' = [audit EXCEPT !.terminalMaterial = TRUE]
    /\ UNCHANGED <<startingUses, method, factorInput, clock, gateway, volatile,
                    restarts, lastEvent>>

Expire ==
    /\ clock = 0
    /\ clock' = Deadline
    /\ UNCHANGED <<startingUses, method, factorInput, gateway, worker, volatile,
                    audit, restarts, lastEvent>>

Next ==
    \/ \E op \in Operations : AdmitWarm(op) \/ Forward(op) \/ Reserve(op)
          \/ ClaimWorker(op) \/ CommitWorkerResult(op) \/ CompleteGateway(op)
          \/ ExactRetry(op) \/ RollbackAdmission(op) \/ RollbackWorker(op)
    \/ \E op \in Operations, field \in BindingFields \cup {"exact"} :
          AdmitStepUp(op, field)
    \/ \E op \in Operations, field \in BindingFields : RejectChangedRequest(op, field)
    \/ \E op \in Operations, revision \in {0, 2} : RejectStaleRevision(op, revision)
    \/ \E op \in Operations, result \in Results : Sign(op, result)
    \/ \E reason \in {"expiry", "cancellation"} : BurnMaterial(reason)
    \/ BeginApproval \/ VerifyFactor \/ ConsumeEmailGrant \/ RecordEvidence
    \/ LoseGatewayResponse \/ LoseMaterialDelivery
    \/ RestartGateway \/ RestartWorker \/ RecoverReservation \/ Expire

WarmOperations == {op \in Operations : ClaimSource(op) = "warm"}
StepUpOperations == {op \in Operations : ClaimSource(op) = "step_up"}
EffectOperations == {op \in Operations : worker.effects[op] # NoEffect}

TypeOK ==
    /\ startingUses \in StartingBudgets
    /\ method \in Methods
    /\ factorInput \in FactorInputs
    /\ clock \in {0, Deadline}
    /\ gateway.quota.remaining \in 0..2
    /\ gateway.evidence \in {NoBinding, Binding(ApprovedOperation)}
    /\ gateway.emailGrantConsumed \in BOOLEAN
    /\ DOMAIN gateway.claims = Operations
    /\ \A op \in Operations : gateway.claims[op] = NoClaim \/
          gateway.claims[op] \in [source : {"warm", "step_up"},
            binding : {Request(op, field) : field \in BindingFields \cup {"exact"}},
            checkedAt : {0, Deadline}, admittedAt : {0, Deadline},
            result : Results \cup {NoResult}]
    /\ worker.material.kind \in {"available", "reserved", "consumed", "tombstone"}
    /\ worker.material.revision \in 0..2
    /\ worker.material.binding \in {NoBinding} \cup {Binding(op) : op \in Operations}
    /\ DOMAIN worker.effects = Operations
    /\ \A op \in Operations : worker.effects[op] = NoEffect \/
          worker.effects[op] \in [binding : {Binding(op)}, result : Results \cup {NoResult}]
    /\ volatile.approval \in {"idle", "started", "verified", "rejected", "consumed", "recorded"}
    /\ volatile.sampledAt \in {-1, 0, Deadline}
    /\ volatile.forwarded \subseteq Operations
    /\ volatile.active \subseteq Operations
    /\ volatile.results \in [Operations -> Results \cup {NoResult}]
    /\ audit.debits \in [Operations -> 0..2]
    /\ audit.takes \in 0..2
    /\ audit.signs \in [Operations -> 0..2]
    /\ audit.firstWorker \in [Operations -> Results \cup {NoResult}]
    /\ audit.firstGateway \in [Operations -> Results \cup {NoResult}]
    /\ audit.received \in [Operations -> Results \cup {NoResult}]
    /\ audit.terminalMaterial \in BOOLEAN
    /\ restarts \subseteq {"gateway", "worker"}
    /\ lastEvent \in BindingFields \cup {"none", "exact_retry", "stale_revision",
          "rollback", "worker_rollback", "response_lost", "material_delivery_lost",
          "expiry", "cancellation"}

BudgetConservation ==
    /\ gateway.quota.remaining = startingUses - Cardinality(WarmOperations)
    /\ gateway.quota.remaining \in 0..startingUses

AtomicAdmissionAndRetry ==
    \A op \in Operations : audit.debits[op] = IF op \in WarmOperations THEN 1 ELSE 0

SessionIdentityAndStepUpNeutrality ==
    /\ gateway.quota.walletSessionId = "session"
    /\ gateway.quota.quotaId = "quota"
    /\ gateway.quota.expiresAt = Deadline
    /\ \A op \in StepUpOperations : audit.debits[op] = 0

OneUseMaterial ==
    /\ audit.takes <= 1
    /\ audit.takes = Cardinality(EffectOperations)
    /\ \A op \in EffectOperations :
          /\ worker.material.kind = "consumed"
          /\ worker.material.binding = worker.effects[op].binding
          /\ worker.material.revision = 2

TerminalMaterial ==
    audit.terminalMaterial => worker.material.kind \in {"consumed", "tombstone"}

ReservationRevisionAndBinding ==
    /\ (worker.material.kind = "available" =>
          /\ worker.material.revision = 0
          /\ worker.material.binding = NoBinding)
    /\ (worker.material.kind = "reserved" =>
          /\ worker.material.revision = 1
          /\ worker.material.binding # NoBinding)

SigningRequiresAdmission ==
    \A op \in Operations :
      /\ audit.signs[op] <= 1
      /\ (worker.effects[op] # NoEffect =>
            /\ gateway.claims[op] # NoClaim
            /\ worker.effects[op].binding = gateway.claims[op].binding)
      /\ (audit.signs[op] > 0 => op \in EffectOperations)

ExactStepUpBinding ==
    \A op \in StepUpOperations : gateway.claims[op].binding = Binding(ApprovedOperation)

OneOperationStepUp == Cardinality(StepUpOperations) <= 1

StepUpEligibility ==
    /\ (gateway.evidence # NoBinding => factorInput = "verified")
    /\ \A op \in StepUpOperations :
          /\ factorInput = "verified"
          /\ gateway.claims[op].checkedAt < Deadline
          /\ (method = "email_otp" => gateway.emailGrantConsumed)

LiveStepUpEligibility ==
    \A op \in StepUpOperations : gateway.claims[op].admittedAt < Deadline

ResultsImmutableAndReplayExact ==
    \A op \in Operations :
      /\ (audit.firstWorker[op] # NoResult =>
            worker.effects[op].result = audit.firstWorker[op])
      /\ (audit.firstGateway[op] # NoResult =>
            /\ gateway.claims[op].result = audit.firstGateway[op]
            /\ audit.firstGateway[op] = audit.firstWorker[op])
      /\ (audit.received[op] # NoResult =>
            audit.received[op] = audit.firstGateway[op])

=============================================================================
