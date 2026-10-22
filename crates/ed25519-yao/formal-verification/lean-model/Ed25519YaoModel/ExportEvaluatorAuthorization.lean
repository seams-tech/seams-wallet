import Ed25519YaoModel.EvaluationUse
import Ed25519YaoModel.ExportDelivery

/-!
Construction-independent structural model for role-pinned A/B export
authorization acceptance. Signature unforgeability, trusted key distribution,
clock trust, durable replay, and protocol security remain TCB assumptions.
-/

namespace Ed25519YaoModel

inductive ExportAcceptanceRole where
  | deriverA
  | deriverB
  deriving DecidableEq, Repr

structure ExportAcceptanceCommon where
  request : Nat
  authorization : Nat
  transcript : Nat
  provenancePair : Nat
  storeResolution : Nat
  activeStateVersion : Nat
  registeredIdentity : Nat
  oneUseExecution : Nat
  deriving DecidableEq, Repr

structure VerifiedExportAcceptance (role : ExportAcceptanceRole) where
  authority : Nat
  common : ExportAcceptanceCommon
  checkedAt : Nat
  requestExpiry : Nat
  acceptedBeforeExpiry : checkedAt ≤ requestExpiry

structure VerifiedExportAcceptancePair where
  deriverA : VerifiedExportAcceptance .deriverA
  deriverB : VerifiedExportAcceptance .deriverB
  sameCommon : deriverA.common = deriverB.common
  authoritiesDistinct : deriverA.authority ≠ deriverB.authority
  digest : Nat

structure AcceptedExportEvaluation where
  acceptance : VerifiedExportAcceptancePair

structure ExportOutputCommitted where
  evaluation : AcceptedExportEvaluation

structure ExportReleased where
  committed : ExportOutputCommitted

def acceptExportEvaluation
    (used : UsedExecutions) (pair : VerifiedExportAcceptancePair) :
    Option (UsedExecutions × AcceptedExportEvaluation) :=
  recordEvaluation used pair.deriverA.common.oneUseExecution { acceptance := pair }

def commitAcceptedExport
    (evaluation : AcceptedExportEvaluation) : ExportOutputCommitted :=
  { evaluation }

def releaseAcceptedExport (committed : ExportOutputCommitted) : ExportReleased :=
  { committed }

/-- Successful admission consumes this execution and preserves the exact input. -/
theorem acceptExportEvaluationConsumesExecution
    (used next : UsedExecutions) (pair : VerifiedExportAcceptancePair)
    (accepted : AcceptedExportEvaluation)
    (admitted : acceptExportEvaluation used pair = some (next, accepted)) :
    accepted.acceptance = pair ∧ acceptExportEvaluation next pair = none := by
  have preserved := admittedEvaluationRecordsUseAndPreservesPayload
    used next pair.deriverA.common.oneUseExecution ({ acceptance := pair } : AcceptedExportEvaluation) accepted admitted
  constructor
  · exact congrArg AcceptedExportEvaluation.acceptance preserved.2.2
  · exact admittedExecutionCannotBeAdmittedAgain used next pair.deriverA.common.oneUseExecution
      ({ acceptance := pair } : AcceptedExportEvaluation) accepted admitted _

theorem exportReleaseRetainsBoundAuthorization
    (evaluation : AcceptedExportEvaluation) :
    let released := releaseAcceptedExport (commitAcceptedExport evaluation)
    released.committed.evaluation.acceptance = evaluation.acceptance ∧
      evaluation.acceptance.deriverA.common = evaluation.acceptance.deriverB.common ∧
      evaluation.acceptance.deriverA.authority ≠ evaluation.acceptance.deriverB.authority := by
  exact ⟨rfl, evaluation.acceptance.sameCommon, evaluation.acceptance.authoritiesDistinct⟩

end Ed25519YaoModel
