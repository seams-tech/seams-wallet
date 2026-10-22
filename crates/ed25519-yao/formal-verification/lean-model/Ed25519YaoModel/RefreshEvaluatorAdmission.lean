import Ed25519YaoModel.EvaluationUse
import Ed25519YaoModel.RecoveryEvaluatorAdmission

/-!
Construction-independent structural model for refresh evaluator admission.
Opposite-delta proof validity, refresh-delta entropy and anti-bias, selected-
mechanism evidence validity, authenticated store cryptography, durable replay,
selected-profile security, and production constant-time behavior remain
assumptions or later obligations.
-/

namespace Ed25519YaoModel

structure RefreshRoleStateBinding where
  roleRootRecord : Nat
  rootBindingArtifact : Nat
  roleRootEpoch : Nat
  stateRecord : Nat
  inputStateEpoch : Nat
  deriving DecidableEq, Repr

structure RefreshRegisteredIdentity where
  registeredPublicKey : Nat
  stableScope : Nat
  activeCredential : Nat
  activeActivationEpoch : Nat
  deriverA : RefreshRoleStateBinding
  deriverB : RefreshRoleStateBinding
  deriving DecidableEq, Repr

structure RefreshAdmissionCommon where
  durableIdentityScope : Nat
  request : Nat
  authorization : Nat
  transcript : Nat
  provenancePair : Nat
  deriverAStatement : Nat
  deriverBStatement : Nat
  signedStoreResolution : Nat
  storeAuthorityEpoch : Nat
  storeAuthorityDigest : Nat
  activeStateVersion : Nat
  currentIdentity : RefreshRegisteredIdentity
  nextDeriverA : RefreshRoleStateBinding
  nextDeriverB : RefreshRoleStateBinding
  continuityEvidenceArtifact : Nat
  selectedMechanismAcceptanceEvidence : Nat
  selectedMechanismAcceptanceEvidenceIsNonzero :
    selectedMechanismAcceptanceEvidence ≠ 0
  nextActivationEpoch : Nat
  activationEpochAdvances :
    currentIdentity.activeActivationEpoch < nextActivationEpoch
  deriverAEpochAdvances :
    currentIdentity.deriverA.inputStateEpoch < nextDeriverA.inputStateEpoch
  deriverBEpochAdvances :
    currentIdentity.deriverB.inputStateEpoch < nextDeriverB.inputStateEpoch
  oneUseExecution : Nat
  oneUseExecutionIsNonzero : oneUseExecution ≠ 0
  checkedAtUnixMs : Nat
  checkedAtIsNonzero : checkedAtUnixMs ≠ 0
  requestExpiryUnixMs : Nat
  acceptedBeforeExpiry : checkedAtUnixMs ≤ requestExpiryUnixMs
  deriving Repr

structure TerminalRefreshEvaluatorAdmission where
  common : RefreshAdmissionCommon
  admissionDigest : Nat
  deriving Repr

structure AcceptedRefreshEvaluation where
  terminal : TerminalRefreshEvaluatorAdmission
  deriving Repr

structure RefreshEvaluationCandidate where
  terminal : TerminalRefreshEvaluatorAdmission
  registeredPublicKey : Nat
  outputCommittedReceipt : Nat
  deriving Repr

structure RefreshEvaluatorPendingActivation where
  candidate : RefreshEvaluationCandidate
  deriving Repr

structure RefreshEvaluatorMetadataConsumed where
  candidate : RefreshEvaluationCandidate
  deriving Repr

structure RefreshEvaluatorWorkerActivated where
  candidate : RefreshEvaluationCandidate
  deriving Repr

structure RefreshPromotedIdentity where
  registeredPublicKey : Nat
  stableScope : Nat
  activeCredential : Nat
  activeActivationEpoch : Nat
  deriverA : RefreshRoleStateBinding
  deriverB : RefreshRoleStateBinding
  deriving DecidableEq, Repr

structure RefreshEvaluatorPromoted where
  terminal : TerminalRefreshEvaluatorAdmission
  identity : RefreshPromotedIdentity
  activeStateVersion : Nat
  stateVersionAdvances : terminal.common.activeStateVersion < activeStateVersion
  deriving Repr

structure AbortedRefreshEvaluation where
  terminal : TerminalRefreshEvaluatorAdmission
  deriving Repr

def admitRefresh
    (used : UsedExecutions) (terminal : TerminalRefreshEvaluatorAdmission) :
    Option (UsedExecutions × AcceptedRefreshEvaluation) :=
  recordEvaluation used terminal.common.oneUseExecution { terminal := terminal }

def commitRefreshCandidate
    (evaluation : AcceptedRefreshEvaluation)
    (outputCommittedReceipt : Nat) : RefreshEvaluatorPendingActivation :=
  { candidate := {
      terminal := evaluation.terminal
      registeredPublicKey :=
        evaluation.terminal.common.currentIdentity.registeredPublicKey
      outputCommittedReceipt } }

def consumeRefreshEvaluatorMetadata
    (pending : RefreshEvaluatorPendingActivation) : RefreshEvaluatorMetadataConsumed :=
  { candidate := pending.candidate }

def activateRefreshEvaluatorWorker
    (consumed : RefreshEvaluatorMetadataConsumed) : RefreshEvaluatorWorkerActivated :=
  { candidate := consumed.candidate }

def promoteRefreshEvaluatorWorker
    (activated : RefreshEvaluatorWorkerActivated)
    (nextStateVersion : Nat)
    (stateVersionAdvances :
      activated.candidate.terminal.common.activeStateVersion < nextStateVersion) :
    RefreshEvaluatorPromoted :=
  let terminal := activated.candidate.terminal
  {
    terminal
    identity := {
      registeredPublicKey := terminal.common.currentIdentity.registeredPublicKey
      stableScope := terminal.common.currentIdentity.stableScope
      activeCredential := terminal.common.currentIdentity.activeCredential
      activeActivationEpoch := terminal.common.nextActivationEpoch
      deriverA := terminal.common.nextDeriverA
      deriverB := terminal.common.nextDeriverB }
    activeStateVersion := nextStateVersion
    stateVersionAdvances
  }

def abortRefreshEvaluation
    (evaluation : AcceptedRefreshEvaluation) : AbortedRefreshEvaluation :=
  {
    terminal := evaluation.terminal
  }

/-- Successful admission consumes this execution and preserves the exact input. -/
theorem admitRefreshConsumesExecution
    (used next : UsedExecutions) (terminal : TerminalRefreshEvaluatorAdmission)
    (accepted : AcceptedRefreshEvaluation)
    (admitted : admitRefresh used terminal = some (next, accepted)) :
    accepted.terminal = terminal ∧ admitRefresh next terminal = none := by
  have preserved := admittedEvaluationRecordsUseAndPreservesPayload
    used next terminal.common.oneUseExecution ({ terminal := terminal } : AcceptedRefreshEvaluation) accepted admitted
  constructor
  · exact congrArg AcceptedRefreshEvaluation.terminal preserved.2.2
  · exact admittedExecutionCannotBeAdmittedAgain used next terminal.common.oneUseExecution
      ({ terminal := terminal } : AcceptedRefreshEvaluation) accepted admitted _

theorem refreshPromotionPreservesIdentityAndAdvancesEpochs
    (activated : RefreshEvaluatorWorkerActivated) (nextVersion : Nat)
    (advances : activated.candidate.terminal.common.activeStateVersion < nextVersion) :
    let common := activated.candidate.terminal.common
    let promoted := promoteRefreshEvaluatorWorker activated nextVersion advances
    promoted.identity.registeredPublicKey = common.currentIdentity.registeredPublicKey ∧
      promoted.identity.stableScope = common.currentIdentity.stableScope ∧
      promoted.identity.activeCredential = common.currentIdentity.activeCredential ∧
      common.currentIdentity.activeActivationEpoch < promoted.identity.activeActivationEpoch ∧
      common.currentIdentity.deriverA.inputStateEpoch < promoted.identity.deriverA.inputStateEpoch ∧
      common.currentIdentity.deriverB.inputStateEpoch < promoted.identity.deriverB.inputStateEpoch ∧
      common.activeStateVersion < promoted.activeStateVersion := by
  exact ⟨rfl, rfl, rfl, activated.candidate.terminal.common.activationEpochAdvances,
    activated.candidate.terminal.common.deriverAEpochAdvances,
    activated.candidate.terminal.common.deriverBEpochAdvances, advances⟩

theorem refreshActivationAndAbortPreserveTerminal
    (evaluation : AcceptedRefreshEvaluation) (receipt : Nat) :
    let pending := commitRefreshCandidate evaluation receipt
    let activated := activateRefreshEvaluatorWorker (consumeRefreshEvaluatorMetadata pending)
    activated.candidate.terminal = evaluation.terminal ∧
      activated.candidate.registeredPublicKey =
        evaluation.terminal.common.currentIdentity.registeredPublicKey ∧
      (abortRefreshEvaluation evaluation).terminal = evaluation.terminal := by
  exact ⟨rfl, rfl, rfl⟩

end Ed25519YaoModel
