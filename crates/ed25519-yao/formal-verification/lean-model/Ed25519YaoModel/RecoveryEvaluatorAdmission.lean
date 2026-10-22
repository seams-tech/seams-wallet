import Ed25519YaoModel.EvaluationUse
import Ed25519YaoModel.RecoveryCredentialTransition

/-!
Construction-independent structural model for recovery evaluator admission.
Same-root proof validity, selected-mechanism evidence validity, authenticated
store verification, durable replay, and production constant-time behavior
remain assumptions or later obligations.
-/

namespace Ed25519YaoModel

structure RecoveryAdmissionCommon where
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
  registeredIdentity : RecoveryIdentityBinding
  activeStateVersion : Nat
  activeCredential : Nat
  replacementCredential : Nat
  replacementIsDistinct : replacementCredential ≠ activeCredential
  sameRootEvidenceArtifact : Nat
  selectedMechanismAcceptanceEvidence : Nat
  selectedMechanismAcceptanceEvidenceIsNonzero :
    selectedMechanismAcceptanceEvidence ≠ 0
  currentActivationEpoch : Nat
  nextActivationEpoch : Nat
  activationEpochAdvances : currentActivationEpoch < nextActivationEpoch
  oneUseExecution : Nat
  oneUseExecutionIsNonzero : oneUseExecution ≠ 0
  checkedAtUnixMs : Nat
  checkedAtIsNonzero : checkedAtUnixMs ≠ 0
  requestExpiryUnixMs : Nat
  acceptedBeforeExpiry : checkedAtUnixMs ≤ requestExpiryUnixMs
  deriving Repr

structure TerminalRecoveryEvaluatorAdmission where
  common : RecoveryAdmissionCommon
  admissionDigest : Nat
  deriving Repr

def TerminalRecoveryEvaluatorAdmission.suspension
    (terminal : TerminalRecoveryEvaluatorAdmission) : SuspendedRecoveryCredentialState :=
  {
    identity := terminal.common.registeredIdentity
    oldCredential := terminal.common.activeCredential
    replacementCredential := terminal.common.replacementCredential
    activeStateVersion := terminal.common.activeStateVersion
    activeActivationEpoch := terminal.common.currentActivationEpoch
    replacementIsDistinct := terminal.common.replacementIsDistinct
  }

structure AcceptedRecoveryEvaluation where
  terminal : TerminalRecoveryEvaluatorAdmission
  deriving Repr

structure RecoveryEvaluationCandidate where
  terminal : TerminalRecoveryEvaluatorAdmission
  registeredPublicKey : Nat
  outputCommittedReceipt : Nat
  deriving Repr

structure RecoveryEvaluatorPendingActivation where
  candidate : RecoveryEvaluationCandidate
  deriving Repr

structure RecoveryEvaluatorMetadataConsumed where
  candidate : RecoveryEvaluationCandidate
  deriving Repr

structure RecoveryEvaluatorWorkerActivated where
  candidate : RecoveryEvaluationCandidate
  deriving Repr

structure RecoveryEvaluatorPromoted where
  terminal : TerminalRecoveryEvaluatorAdmission
  credentialState : PromotedRecoveryCredentialState

structure AbortedRecoveryEvaluation where
  terminal : TerminalRecoveryEvaluatorAdmission

def admitRecovery
    (used : UsedExecutions) (terminal : TerminalRecoveryEvaluatorAdmission) :
    Option (UsedExecutions × AcceptedRecoveryEvaluation) :=
  recordEvaluation used terminal.common.oneUseExecution { terminal := terminal }

def commitRecoveryCandidate
    (evaluation : AcceptedRecoveryEvaluation)
    (outputCommittedReceipt : Nat) : RecoveryEvaluatorPendingActivation :=
  { candidate := {
      terminal := evaluation.terminal
      registeredPublicKey :=
        evaluation.terminal.common.registeredIdentity.registeredPublicKey
      outputCommittedReceipt } }

def consumeRecoveryEvaluatorMetadata
    (pending : RecoveryEvaluatorPendingActivation) : RecoveryEvaluatorMetadataConsumed :=
  { candidate := pending.candidate }

def activateRecoveryEvaluatorWorker
    (consumed : RecoveryEvaluatorMetadataConsumed) : RecoveryEvaluatorWorkerActivated :=
  { candidate := consumed.candidate }

def promoteRecoveryEvaluatorWorker
    (activated : RecoveryEvaluatorWorkerActivated)
    (nextStateVersion : Nat)
    (stateVersionAdvances :
      activated.candidate.terminal.common.activeStateVersion < nextStateVersion) :
    RecoveryEvaluatorPromoted :=
  let terminal := activated.candidate.terminal
  let authority : VerifiedRecoveryPromotionAuthority :=
    {
      workerActivated := ⟨terminal.suspension⟩
      nextStateVersion
      nextActivationEpoch := terminal.common.nextActivationEpoch
      stateVersionAdvances
      activationEpochAdvances := terminal.common.activationEpochAdvances
    }
  {
    terminal
    credentialState := promoteVerifiedRecovery authority
  }

def abortRecoveryEvaluation
    (evaluation : AcceptedRecoveryEvaluation) : AbortedRecoveryEvaluation :=
  {
    terminal := evaluation.terminal
  }

/-- Successful admission consumes this execution and preserves the exact input. -/
theorem admitRecoveryConsumesExecution
    (used next : UsedExecutions) (terminal : TerminalRecoveryEvaluatorAdmission)
    (accepted : AcceptedRecoveryEvaluation)
    (admitted : admitRecovery used terminal = some (next, accepted)) :
    accepted.terminal = terminal ∧ admitRecovery next terminal = none := by
  have preserved := admittedEvaluationRecordsUseAndPreservesPayload
    used next terminal.common.oneUseExecution ({ terminal := terminal } : AcceptedRecoveryEvaluation) accepted admitted
  constructor
  · exact congrArg AcceptedRecoveryEvaluation.terminal preserved.2.2
  · exact admittedExecutionCannotBeAdmittedAgain used next terminal.common.oneUseExecution
      ({ terminal := terminal } : AcceptedRecoveryEvaluation) accepted admitted _

theorem recoveryPromotionPreservesIdentityAndReplacesCredential
    (activated : RecoveryEvaluatorWorkerActivated) (nextVersion : Nat)
    (advances : activated.candidate.terminal.common.activeStateVersion < nextVersion) :
    let common := activated.candidate.terminal.common
    let promoted := (promoteRecoveryEvaluatorWorker activated nextVersion advances).credentialState
    promoted.identity = common.registeredIdentity ∧
      promotedCredentialAdmission promoted common.activeCredential = .tombstoned ∧
      promotedCredentialAdmission promoted common.replacementCredential = .active ∧
      promoted.activeStateVersion = nextVersion ∧
      common.currentActivationEpoch < promoted.activeActivationEpoch := by
  have oldIsNotReplacement := Ne.symm activated.candidate.terminal.common.replacementIsDistinct
  simp [promoteRecoveryEvaluatorWorker, promoteVerifiedRecovery,
    TerminalRecoveryEvaluatorAdmission.suspension, promotedCredentialAdmission,
    oldIsNotReplacement, activated.candidate.terminal.common.activationEpochAdvances]

theorem recoveryActivationAndAbortPreserveTerminal
    (evaluation : AcceptedRecoveryEvaluation) (receipt : Nat) :
    let pending := commitRecoveryCandidate evaluation receipt
    let activated := activateRecoveryEvaluatorWorker (consumeRecoveryEvaluatorMetadata pending)
    activated.candidate.terminal = evaluation.terminal ∧
      activated.candidate.registeredPublicKey =
        evaluation.terminal.common.registeredIdentity.registeredPublicKey ∧
      (abortRecoveryEvaluation evaluation).terminal = evaluation.terminal := by
  exact ⟨rfl, rfl, rfl⟩

end Ed25519YaoModel
