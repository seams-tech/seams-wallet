---------------------- MODULE CrossTabSessionRestore ----------------------
EXTENDS Integers, FiniteSets

CONSTANTS NoSession

Tabs == {"locking_tab", "restoring_tab"}
IdentityFields == {"wallet", "authority", "method", "authorization", "session", "quota"}

Identity(session) ==
    [wallet |-> "wallet", authority |-> "authority", method |-> "method",
     authorization |-> session, session |-> session, quota |-> session]

ResponseIdentity(field) ==
    IF field = "exact" THEN Identity("old")
    ELSE [Identity("old") EXCEPT ![field] = "altered"]

VARIABLES responseField, responseRevision, selection, credential, lockPhase, restore,
          serverBudgets, history

Init ==
    /\ responseField \in IdentityFields \cup {"exact"}
    /\ responseRevision \in 0..1
    /\ selection = [state |-> "unlocked", generation |-> 0]
    /\ credential = [identity |-> Identity("old"), revision |-> 0]
    /\ lockPhase = "idle"
    /\ restore = [phase |-> "idle", original |-> NoSession, response |-> NoSession]
    /\ serverBudgets = [old |-> 1, new |-> 2]
    /\ history = [oldRetired |-> FALSE, freshUnlocks |-> 0,
                    writes |-> 0, rejected |-> FALSE,
                    readWhileUnlocked |-> FALSE,
                    admitted |-> {}, admissionWhileLocked |-> FALSE,
                    admittedSession |-> [tab \in Tabs |-> NoSession],
                    admittedWrongIdentity |-> FALSE]

\* Tab B reads its exact local row before awaiting authoritative status.
StartRestore ==
    /\ restore.phase = "idle"
    /\ selection.state = "unlocked"
    /\ credential # NoSession
    /\ credential.identity = Identity("old")
    /\ restore' = [restore EXCEPT !.phase = "waiting",
          !.original = credential]
    /\ history' = [history EXCEPT !.readWhileUnlocked = TRUE]
    /\ UNCHANGED <<responseField, responseRevision, selection, credential, lockPhase, serverBudgets>>

\* Status may preserve or update the capability projection.
HoldStatusResponse ==
    /\ restore.phase = "waiting"
    /\ restore' = [restore EXCEPT !.phase = "held",
          !.response = [identity |-> ResponseIdentity(responseField), revision |-> responseRevision]]
    /\ UNCHANGED <<responseField, responseRevision, selection, credential, lockPhase, serverBudgets, history>>

DeliverStatusResponse ==
    /\ restore.phase = "held"
    /\ restore' = [restore EXCEPT !.phase = "received"]
    /\ UNCHANGED <<responseField, responseRevision, selection, credential, lockPhase, serverBudgets, history>>

ValidStatus == restore.response.identity = restore.original.identity
CanRefresh == credential = restore.original
StatusNeedsWrite == restore.response # restore.original

\* Compare and refresh share an IndexedDB transaction with lock's row deletion.
ApplyStatus ==
    /\ restore.phase = "received"
    /\ ValidStatus
    /\ StatusNeedsWrite
    /\ CanRefresh
    /\ credential' = restore.response
    /\ restore' = [restore EXCEPT !.phase = "finished"]
    /\ history' = [history EXCEPT !.writes = @ + 1]
    /\ UNCHANGED <<responseField, responseRevision, selection, lockPhase, serverBudgets>>

FinishUnchangedStatus ==
    /\ restore.phase = "received"
    /\ ValidStatus
    /\ ~StatusNeedsWrite
    /\ restore' = [restore EXCEPT !.phase = "finished"]
    /\ UNCHANGED <<responseField, responseRevision, selection, credential, lockPhase, serverBudgets, history>>

RejectStatus ==
    /\ restore.phase = "received"
    /\ (~ValidStatus \/ (StatusNeedsWrite /\ ~CanRefresh))
    /\ restore' = [restore EXCEPT !.phase = "finished"]
    /\ history' = [history EXCEPT !.rejected = TRUE]
    /\ UNCHANGED <<responseField, responseRevision, selection, credential, lockPhase, serverBudgets>>

\* Lock's shared generation write and credential deletion are separate transactions.
AdvanceLockGeneration ==
    /\ lockPhase = "idle"
    /\ selection' = [state |-> "locked", generation |-> selection.generation + 1]
    /\ lockPhase' = "retiring"
    /\ UNCHANGED <<responseField, responseRevision, credential, restore, serverBudgets, history>>

RetireCredentials ==
    /\ lockPhase = "retiring"
    /\ credential' = NoSession
    /\ lockPhase' = "clearing_runtime"
    /\ history' = [history EXCEPT !.oldRetired = TRUE]
    /\ UNCHANGED <<responseField, responseRevision, selection, restore, serverBudgets>>

CompleteLock ==
    /\ lockPhase = "clearing_runtime"
    /\ lockPhase' = "completed"
    /\ UNCHANGED <<responseField, responseRevision, selection, credential, restore, serverBudgets, history>>

\* A fresh, successfully verified unlock may install a different exact session.
FreshUnlock ==
    /\ lockPhase = "completed"
    /\ selection.state = "locked"
    /\ history.freshUnlocks = 0
    /\ selection' = [selection EXCEPT !.state = "unlocked"]
    /\ credential' = [identity |-> Identity("new"), revision |-> 1]
    /\ history' = [history EXCEPT !.freshUnlocks = @ + 1]
    /\ UNCHANGED <<responseField, responseRevision, lockPhase, restore, serverBudgets>>

\* This is a local gate observation; already-started signing is outside the model.
ObservePrivilegedGate(tab) ==
    /\ tab \in Tabs
    /\ tab \notin history.admitted
    /\ selection.state = "unlocked"
    /\ credential # NoSession
    /\ history' = [history EXCEPT
          !.admitted = @ \cup {tab},
          !.admittedSession[tab] = credential.identity,
          !.admissionWhileLocked = @ \/ selection.state = "locked",
          !.admittedWrongIdentity = @ \/
              credential.identity # Identity(IF history.freshUnlocks = 0 THEN "old" ELSE "new")]
    /\ UNCHANGED <<responseField, responseRevision, selection, credential, lockPhase, restore, serverBudgets>>

Next == StartRestore \/ HoldStatusResponse \/ DeliverStatusResponse
        \/ ApplyStatus \/ FinishUnchangedStatus \/ RejectStatus \/ AdvanceLockGeneration
        \/ RetireCredentials \/ CompleteLock \/ FreshUnlock
        \/ \E tab \in Tabs : ObservePrivilegedGate(tab)

TypeOK ==
    /\ responseField \in IdentityFields \cup {"exact"}
    /\ responseRevision \in 0..1
    /\ selection \in [state : {"locked", "unlocked"}, generation : 0..1]
    /\ credential \in {NoSession} \cup
          [identity : {Identity("new")} \cup
              {ResponseIdentity(field) : field \in IdentityFields \cup {"exact"}},
           revision : 0..1]
    /\ lockPhase \in {"idle", "retiring", "clearing_runtime", "completed"}
    /\ restore.phase \in {"idle", "waiting", "held", "received", "finished"}
    /\ restore.original \in {NoSession, [identity |-> Identity("old"), revision |-> 0]}
    /\ restore.response \in {NoSession} \cup
          [identity : {ResponseIdentity(field) : field \in IdentityFields \cup {"exact"}},
           revision : 0..1]
    /\ serverBudgets \in [ {"old", "new"} -> 0..2]
    /\ history.oldRetired \in BOOLEAN
    /\ history.freshUnlocks \in 0..1
    /\ history.writes \in 0..1
    /\ history.rejected \in BOOLEAN
    /\ history.readWhileUnlocked \in BOOLEAN
    /\ history.admitted \subseteq Tabs
    /\ history.admittedSession \in [Tabs -> {NoSession, Identity("old"), Identity("new")}]
    /\ history.admissionWhileLocked \in BOOLEAN
    /\ history.admittedWrongIdentity \in BOOLEAN

LockGenerationPreserved ==
    selection.generation = IF lockPhase = "idle" THEN 0 ELSE 1

RestorationCannotUnlock ==
    (selection.state = "unlocked") = (lockPhase = "idle" \/ history.freshUnlocks = 1)

RetiredSessionStaysAbsent ==
    history.oldRetired =>
        IF credential = NoSession THEN TRUE ELSE credential.identity # Identity("old")

CompletedLockKeepsCredentialsAbsent ==
    lockPhase = "completed" /\ history.freshUnlocks = 0 => credential = NoSession

FreshSessionSurvivesLateRestore ==
    history.freshUnlocks = 1 =>
        /\ credential # NoSession
        /\ credential.identity = Identity("new")

ExactRestoreIdentity ==
    history.writes = 1 => responseField = "exact"

RestorePreservesBudget == serverBudgets = [old |-> 1, new |-> 2]

PrivilegedGateRequiresCurrentSession ==
    /\ ~history.admissionWhileLocked
    /\ ~history.admittedWrongIdentity

=============================================================================
