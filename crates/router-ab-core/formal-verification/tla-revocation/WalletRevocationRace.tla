---------------------- MODULE WalletRevocationRace ----------------------
EXTENDS Integers, FiniteSets

CONSTANTS NoAnswer, DeniedAnswer

Methods == {"passkey", "email_otp"}
Requests == {"revoke_passkey", "revoke_email_otp"}
IdentityFields == {"wallet", "target", "operation", "proof", "answer_kind"}
Target(req) == IF req = "revoke_passkey" THEN "passkey" ELSE "email_otp"
Source(req) == IF req = "revoke_passkey" THEN "email_otp" ELSE "passkey"
Other(req) == IF req = "revoke_passkey" THEN "revoke_email_otp"
              ELSE "revoke_passkey"
InitialUses(method) == IF method = "passkey" THEN 1 ELSE 2

Identity(req, field) ==
    [wallet |-> IF field = "wallet" THEN "other_wallet" ELSE "wallet",
     target |-> IF field = "target" THEN Source(req) ELSE Target(req),
     operation |-> IF field = "operation" THEN Other(req) ELSE req,
     proof |-> IF field = "proof" THEN Other(req) ELSE req,
     answer_kind |-> IF field = "answer_kind" THEN "linked_device"
                    ELSE "auth_method"]

Answer(req) == [identity |-> Identity(req, "exact"), status |-> "revoked"]
Answers == {Answer(req) : req \in Requests}

VARIABLES delayedRequest, server, phases, replies, client, history

ActiveMethods == {method \in Methods : server.methods[method] = "active"}
ActiveEnvelopes == {method \in Methods : server.envelopes[method] = "active"}

ReplayMatches(req, field) ==
    /\ server.replays[req] # NoAnswer
    /\ server.replays[req].identity = Identity(req, field)

CanCommit(req) ==
    /\ server.authority = "active"
    /\ server.methods[Target(req)] = "active"
    /\ Cardinality(ActiveMethods) > 1
    /\ server.methods[Source(req)] = "active"
    /\ Cardinality(ActiveEnvelopes) > 1
    /\ server.replays[req] = NoAnswer
    /\ (Source(req) = "email_otp" => ~server.emailProofSpent)

Init ==
    /\ delayedRequest \in Requests
    /\ server = [authority |-> "active",
                   methods |-> [method \in Methods |-> "active"],
                   sessions |-> [method \in Methods |-> "active"],
                   quotaUses |-> [method \in Methods |-> InitialUses(method)],
                   hostedChildren |-> [method \in Methods |-> "active"],
                   envelopes |-> [method \in Methods |-> "active"],
                   emailProofSpent |-> FALSE,
                   replays |-> [req \in Requests |-> NoAnswer]]
    /\ phases = [req \in Requests |-> "idle"]
    /\ replies = [req \in Requests |-> [state |-> "none", answer |-> NoAnswer]]
    /\ client = [method \in Methods |-> "active"]
    /\ history = [prepared |-> {}, denied |-> {}, rolledBack |-> {},
                    retried |-> {}, lost |-> {}, observedRevoked |-> {},
                    retired |-> {}, commits |-> [req \in Requests |-> 0],
                    sourceAtCommit |-> [req \in Requests |-> "uncommitted"],
                    countAtCommit |-> [req \in Requests |-> 0],
                    firstAnswer |-> [req \in Requests |-> NoAnswer],
                    retryAnswer |-> [req \in Requests |-> NoAnswer],
                    alteredField |-> "none", alteredReplayed |-> FALSE]

\* Successful factor verification is trusted. It does not spend the Email code.
VerifySource(req) ==
    /\ phases[req] = "idle"
    /\ server.methods[Source(req)] = "active"
    /\ server.authority = "active"
    /\ phases' = [phases EXCEPT ![req] = "verified"]
    /\ UNCHANGED <<delayedRequest, server, replies, client, history>>

\* These preflight reads create no authority to bypass the later batch guards.
Prepare(req) ==
    /\ phases[req] = "verified"
    /\ server.methods[Target(req)] = "active"
    /\ server.authority = "active"
    /\ Cardinality(ActiveMethods) > 1
    /\ phases' = [phases EXCEPT ![req] = "prepared"]
    /\ history' = [history EXCEPT !.prepared = @ \cup {req}]
    /\ UNCHANGED <<delayedRequest, server, replies, client>>

\* The method CAS, source guard, retirement, proof spend and replay share a batch.
Commit(req) ==
    /\ phases[req] = "prepared"
    /\ CanCommit(req)
    /\ server' = [server EXCEPT
          !.methods[Target(req)] = "revoked",
          !.sessions[Target(req)] = "retired",
          !.quotaUses[Target(req)] = 0,
          !.hostedChildren[Target(req)] = "retired",
          !.envelopes[Target(req)] = "revoked",
          !.emailProofSpent = @ \/ Source(req) = "email_otp",
          !.replays[req] = Answer(req)]
    /\ phases' = [phases EXCEPT ![req] = "answered"]
    /\ replies' = [replies EXCEPT
          ![req] = [state |-> "pending", answer |-> Answer(req)]]
    /\ history' = [history EXCEPT
          !.retired = @ \cup {Target(req)},
          !.commits[req] = @ + 1,
          !.sourceAtCommit[req] = server.methods[Source(req)],
          !.countAtCommit[req] = Cardinality(ActiveMethods),
          !.firstAnswer[req] = Answer(req)]
    /\ UNCHANGED <<delayedRequest, client>>

Refuse(req) ==
    /\ \/ (phases[req] = "idle" /\ server.methods[Source(req)] # "active")
       \/ (phases[req] = "verified" /\
            (server.methods[Target(req)] # "active"
             \/ Cardinality(ActiveMethods) <= 1))
       \/ (phases[req] = "prepared" /\ ~CanCommit(req))
    /\ phases' = [phases EXCEPT ![req] = "answered"]
    /\ replies' = [replies EXCEPT
          ![req] = [state |-> "pending", answer |-> DeniedAnswer]]
    /\ history' = [history EXCEPT !.denied = @ \cup {req}]
    /\ UNCHANGED <<delayedRequest, server, client>>

Rollback(req) ==
    /\ phases[req] = "prepared"
    /\ req \notin history.rolledBack
    /\ phases' = [phases EXCEPT ![req] = "answered"]
    /\ replies' = [replies EXCEPT
          ![req] = [state |-> "pending", answer |-> DeniedAnswer]]
    /\ history' = [history EXCEPT !.rolledBack = @ \cup {req}]
    /\ UNCHANGED <<delayedRequest, server, client>>

\* Exactly one selected response waits until the competing request is answered.
MayDeliver(req) ==
    req # delayedRequest \/ replies[Other(req)].state \in {"delivered", "lost"}

Deliver(req) ==
    /\ replies[req].state = "pending"
    /\ MayDeliver(req)
    /\ replies' = [replies EXCEPT ![req].state = "delivered"]
    /\ client' = IF replies[req].answer = DeniedAnswer THEN client
                  ELSE [client EXCEPT ![Target(req)] = "revoked"]
    /\ history' = IF replies[req].answer = DeniedAnswer THEN history
                   ELSE [history EXCEPT !.observedRevoked = @ \cup {Target(req)}]
    /\ UNCHANGED <<delayedRequest, server, phases>>

LoseDelayedResponse ==
    /\ replies[delayedRequest].state = "pending"
    /\ delayedRequest \notin history.lost
    /\ replies' = [replies EXCEPT ![delayedRequest].state = "lost"]
    /\ history' = [history EXCEPT !.lost = @ \cup {delayedRequest}]
    /\ UNCHANGED <<delayedRequest, server, phases, client>>

ExactRetry(req) ==
    /\ phases[req] = "answered"
    /\ replies[req].state \in {"delivered", "lost"}
    /\ req \notin history.retried
    /\ ReplayMatches(req, "exact")
    /\ replies' = [replies EXCEPT
          ![req] = [state |-> "pending", answer |-> server.replays[req]]]
    /\ history' = [history EXCEPT !.retried = @ \cup {req},
          !.retryAnswer[req] = server.replays[req]]
    /\ UNCHANGED <<delayedRequest, server, phases, client>>

RetryRefused(req) ==
    /\ phases[req] = "answered"
    /\ replies[req].state \in {"delivered", "lost"}
    /\ replies[req].answer = DeniedAnswer
    /\ req \notin history.retried
    /\ phases' = [phases EXCEPT ![req] = "idle"]
    /\ replies' = [replies EXCEPT
          ![req] = [state |-> "none", answer |-> NoAnswer]]
    /\ history' = [history EXCEPT !.retried = @ \cup {req}]
    /\ UNCHANGED <<delayedRequest, server, client>>

AlteredReplay(req, field) ==
    /\ server.replays[req] # NoAnswer
    /\ field \in IdentityFields
    /\ history.alteredField = "none"
    /\ history' = [history EXCEPT !.alteredField = field,
          !.alteredReplayed = ReplayMatches(req, field)]
    /\ UNCHANGED <<delayedRequest, server, phases, replies, client>>

Next ==
    \/ \E req \in Requests : VerifySource(req) \/ Prepare(req) \/ Commit(req)
                              \/ Refuse(req) \/ Rollback(req) \/ Deliver(req)
                              \/ ExactRetry(req) \/ RetryRefused(req)
    \/ \E req \in Requests, field \in IdentityFields : AlteredReplay(req, field)
    \/ LoseDelayedResponse

TypeOK ==
    /\ delayedRequest \in Requests
    /\ server.authority = "active"
    /\ server.methods \in [Methods -> {"active", "revoked"}]
    /\ server.sessions \in [Methods -> {"active", "retired"}]
    /\ server.quotaUses \in [Methods -> 0..2]
    /\ server.hostedChildren \in [Methods -> {"active", "retired"}]
    /\ server.envelopes \in [Methods -> {"active", "revoked"}]
    /\ server.emailProofSpent \in BOOLEAN
    /\ server.replays \in [Requests -> Answers \cup {NoAnswer}]
    /\ phases \in [Requests -> {"idle", "verified", "prepared", "answered"}]
    /\ replies \in [Requests -> [state : {"none", "pending", "delivered", "lost"},
                                  answer : Answers \cup {NoAnswer, DeniedAnswer}]]
    /\ client \in [Methods -> {"active", "revoked"}]
    /\ history.prepared \subseteq Requests
    /\ history.denied \subseteq Requests
    /\ history.rolledBack \subseteq Requests
    /\ history.retried \subseteq Requests
    /\ history.lost \subseteq {delayedRequest}
    /\ history.observedRevoked \subseteq Methods
    /\ history.retired \subseteq Methods
    /\ history.commits \in [Requests -> 0..1]
    /\ history.sourceAtCommit \in [Requests -> {"uncommitted", "active", "revoked"}]
    /\ history.countAtCommit \in [Requests -> 0..2]
    /\ history.firstAnswer \in [Requests -> Answers \cup {NoAnswer}]
    /\ history.retryAnswer \in [Requests -> Answers \cup {NoAnswer}]
    /\ history.alteredField \in IdentityFields \cup {"none"}
    /\ history.alteredReplayed \in BOOLEAN

LastMethodSurvives == Cardinality(ActiveMethods) >= 1

LiveSourceAtCommit ==
    \A req \in Requests : history.commits[req] = 1 =>
        /\ history.sourceAtCommit[req] = "active"
        /\ history.countAtCommit[req] > 1

AtomicRetirement ==
    \A method \in Methods :
        IF server.methods[method] = "revoked" THEN
            /\ server.sessions[method] = "retired"
            /\ server.quotaUses[method] = 0
            /\ server.hostedChildren[method] = "retired"
            /\ server.envelopes[method] = "revoked"
        ELSE
            /\ server.sessions[method] = "active"
            /\ server.quotaUses[method] = InitialUses(method)
            /\ server.hostedChildren[method] = "active"
            /\ server.envelopes[method] = "active"

ProofSpendMatchesCommit ==
    server.emailProofSpent = (history.commits["revoke_passkey"] = 1)

ReplayMatchesCommit ==
    \A req \in Requests :
        /\ (server.replays[req] # NoAnswer) = (history.commits[req] = 1)
        /\ server.replays[req] = history.firstAnswer[req]
        /\ (history.commits[req] = 1 => server.replays[req] = Answer(req))
        /\ (history.retryAnswer[req] # NoAnswer =>
             history.retryAnswer[req] = history.firstAnswer[req])

AlteredInputsCannotReplay == ~history.alteredReplayed

TerminalRevocation ==
    /\ history.retired = {method \in Methods : server.methods[method] = "revoked"}
    /\ \A method \in history.observedRevoked : client[method] = "revoked"
    /\ \A method \in Methods : client[method] = "revoked" => method \in history.retired

=============================================================================
