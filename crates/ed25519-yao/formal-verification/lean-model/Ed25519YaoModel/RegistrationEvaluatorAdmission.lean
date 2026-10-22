import Ed25519YaoModel.EvaluationUse
import Ed25519YaoModel.EvaluatorAbortViews

/-!
Construction-independent structural model for registration evaluator admission.
Authenticated absence, durable uniqueness, input-opening consistency, selected-
profile security, and production constant-time behavior remain assumptions or
later obligations.
-/

namespace Ed25519YaoModel

structure RegistrationAdmissionCommon where
  durableIdentityScope : Nat
  request : Nat
  authorization : Nat
  transcript : Nat
  intent : Nat
  provenancePair : Nat
  provenanceSelectionArtifact : Nat
  selectedMechanismAcceptanceEvidence : Nat
  activationEpoch : Nat
  oneUseExecution : Nat
  checkedAtUnixMs : Nat
  requestExpiryUnixMs : Nat
  acceptedBeforeExpiry : checkedAtUnixMs ≤ requestExpiryUnixMs
  deriving Repr

structure TerminalRegistrationSelection where
  common : RegistrationAdmissionCommon
  selectionAttempt : Nat
  admissionDigest : Nat
  deriving Repr

structure AcceptedRegistrationEvaluation where
  selection : TerminalRegistrationSelection
  deriving Repr

structure RegistrationCandidate where
  selection : TerminalRegistrationSelection
  registeredPublicKey : Nat
  outputCommittedReceipt : Nat
  deriving Repr

structure RegistrationPendingActivation where
  candidate : RegistrationCandidate
  deriving Repr

structure MetadataConsumedRegistration where
  candidate : RegistrationCandidate
  deriving Repr

structure WorkerActivatedRegistration where
  candidate : RegistrationCandidate
  deriving Repr

structure AbortedRegistrationEvaluation where
  selection : TerminalRegistrationSelection
  deriving Repr

def admitRegistration
    (used : UsedExecutions) (selection : TerminalRegistrationSelection) :
    Option (UsedExecutions × AcceptedRegistrationEvaluation) :=
  recordEvaluation used selection.common.oneUseExecution { selection := selection }

def commitRegistrationCandidate
    (evaluation : AcceptedRegistrationEvaluation)
    (registeredPublicKey outputCommittedReceipt : Nat) : RegistrationPendingActivation :=
  { candidate := {
      selection := evaluation.selection
      registeredPublicKey
      outputCommittedReceipt } }

def consumeRegistrationMetadata
    (pending : RegistrationPendingActivation) : MetadataConsumedRegistration :=
  { candidate := pending.candidate }

def activateRegistrationWorker
    (consumed : MetadataConsumedRegistration) : WorkerActivatedRegistration :=
  { candidate := consumed.candidate }

def abortRegistration
    (evaluation : AcceptedRegistrationEvaluation) : AbortedRegistrationEvaluation :=
  { selection := evaluation.selection
  }

/-- Successful admission consumes this execution and preserves the exact input. -/
theorem admitRegistrationConsumesExecution
    (used next : UsedExecutions) (selection : TerminalRegistrationSelection)
    (accepted : AcceptedRegistrationEvaluation)
    (admitted : admitRegistration used selection = some (next, accepted)) :
    accepted.selection = selection ∧ admitRegistration next selection = none := by
  have preserved := admittedEvaluationRecordsUseAndPreservesPayload
    used next selection.common.oneUseExecution ({ selection := selection } : AcceptedRegistrationEvaluation) accepted admitted
  constructor
  · exact congrArg AcceptedRegistrationEvaluation.selection preserved.2.2
  · exact admittedExecutionCannotBeAdmittedAgain used next selection.common.oneUseExecution
      ({ selection := selection } : AcceptedRegistrationEvaluation) accepted admitted _

theorem registrationActivationAndAbortPreserveSelection
    (evaluation : AcceptedRegistrationEvaluation) (publicKey receipt : Nat) :
    let pending := commitRegistrationCandidate evaluation publicKey receipt
    let activated := activateRegistrationWorker (consumeRegistrationMetadata pending)
    activated.candidate.selection = evaluation.selection ∧
      activated.candidate.registeredPublicKey = publicKey ∧
      (abortRegistration evaluation).selection = evaluation.selection := by
  exact ⟨rfl, rfl, rfl⟩

end Ed25519YaoModel
