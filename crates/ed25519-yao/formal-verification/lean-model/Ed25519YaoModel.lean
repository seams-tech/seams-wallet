import Lean.Elab.Command
import Ed25519YaoModel.Manifest
import Ed25519YaoModel.EvaluationUse
import Ed25519YaoModel.PartyViews
import Ed25519YaoModel.EvaluationInputs
import Ed25519YaoModel.UniformAbort
import Ed25519YaoModel.EvaluatorAbortViews
import Ed25519YaoModel.ExportDelivery
import Ed25519YaoModel.ActivationDelivery
import Ed25519YaoModel.ActivationRecipientPartyViews
import Ed25519YaoModel.RecoveryCredentialTransition
import Ed25519YaoModel.RecoveryEvaluatorAdmission
import Ed25519YaoModel.RefreshEvaluatorAdmission
import Ed25519YaoModel.SemanticFramePartyViews
import Ed25519YaoModel.ExportEvaluatorAuthorization
import Ed25519YaoModel.RegistrationEvaluatorAdmission
import Ed25519YaoModel.RuntimePublicShape
import Ed25519YaoModel.PassiveSecurity

-- Check dependencies of the main claims, including imported proofs.
run_cmd do
  let allowed := [``propext, ``Classical.choice, ``Quot.sound]
  for claim in [``Ed25519YaoModel.evaluationAdmittedExactlyWhenUnused,
      ``Ed25519YaoModel.admittedEvaluationRecordsUseAndPreservesPayload,
      ``Ed25519YaoModel.admittedExecutionCannotBeAdmittedAgain,
      ``Ed25519YaoModel.acceptExportEvaluationConsumesExecution,
      ``Ed25519YaoModel.exportReleaseRetainsBoundAuthorization,
      ``Ed25519YaoModel.admitRegistrationConsumesExecution,
      ``Ed25519YaoModel.admitRecoveryConsumesExecution,
      ``Ed25519YaoModel.admitRefreshConsumesExecution,
      ``Ed25519YaoModel.recoveryPromotionPreservesIdentityAndReplacesCredential,
      ``Ed25519YaoModel.refreshPromotionPreservesIdentityAndAdvancesEpochs,
      ``Ed25519YaoModel.passiveConditionalCompositionBound,
      ``Ed25519YaoModel.permutedObservationsHaveZeroDistance] do
    let assumptions ← Lean.collectAxioms claim
    for assumption in assumptions do
      unless allowed.contains assumption do
        throwError "unexpected proof assumption in {claim}: {assumption}"
    Lean.logInfo m!"{claim} checked assumptions: {assumptions}"
