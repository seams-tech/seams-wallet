import RouterAbEcdsaDerivation
import RouterAbEcdsaDerivationBoundary.Scope

namespace RouterAbEcdsaDerivationBoundary

open router_ab_ecdsa_derivation

abbrev GeneratedClientOutput := client.ClientOutput
abbrev GeneratedServerEvalOperation := wire.ServerEvalOperation
abbrev GeneratedAllowedOutputKind := wire.AllowedOutputKind
abbrev GeneratedFinalizeEnvelope := wire.FinalizeEnvelope
abbrev GeneratedRetainedServerState := server.RetainedServerState
abbrev GeneratedFinalizedServerSession := server.FinalizedServerSession
abbrev GeneratedRespondResponse := server.RespondResponse
abbrev GeneratedVisibleOperationBoundary :=
  server.boundary.VisibleOperationBoundary
abbrev GeneratedVisibleNonExportBoundary :=
  server.boundary.VisibleNonExportBoundary
abbrev GeneratedVisibleExplicitExportBoundary :=
  server.boundary.VisibleExplicitExportBoundary
abbrev GeneratedVisibleClientBoundary :=
  server.boundary.VisibleClientBoundary
abbrev GeneratedVisibleFinalizeBoundary :=
  server.boundary.VisibleFinalizeBoundary
abbrev GeneratedVisibleRespondBoundary :=
  server.boundary.VisibleRespondBoundary

def toHandwrittenOperationBoundary
    (boundary : GeneratedVisibleOperationBoundary) : OperationBoundaryModel :=
  {
    operation := boundary.operation
    allowedOutputKind := boundary.allowed_output_kind
  }

def toHandwrittenNonExportBoundary
    (boundary : GeneratedVisibleNonExportBoundary) : NonExportBoundaryModel :=
  {
    clientPublicKey33 := boundary.derivation_client_share_public_key33
    relayerPublicKey33 := boundary.relayer_public_key33
    thresholdPublicKey33 := boundary.threshold_public_key33
    thresholdEthereumAddress20 := boundary.threshold_ethereum_address20
    clientShareRetryCounter := boundary.client_share_retry_counter
    relayerShareRetryCounter := boundary.relayer_share_retry_counter
  }

def toHandwrittenExplicitExportBoundary
    (boundary : GeneratedVisibleExplicitExportBoundary) :
    ExplicitExportBoundaryModel :=
  {
    relayerExportShare32 := boundary.relayer_export_share32
    clientPublicKey33 := boundary.derivation_client_share_public_key33
    relayerPublicKey33 := boundary.relayer_public_key33
    thresholdPublicKey33 := boundary.threshold_public_key33
    thresholdEthereumAddress20 := boundary.threshold_ethereum_address20
    clientShareRetryCounter := boundary.client_share_retry_counter
    relayerShareRetryCounter := boundary.relayer_share_retry_counter
  }

def toHandwrittenClientBoundary
    (boundary : GeneratedVisibleClientBoundary) : ClientBoundaryModel :=
  match boundary with
  | server.boundary.VisibleClientBoundary.NonExport nonExport =>
    ClientBoundaryModel.nonExport (toHandwrittenNonExportBoundary nonExport)
  | server.boundary.VisibleClientBoundary.ExplicitExport explicitExport =>
    ClientBoundaryModel.explicitExport
      (toHandwrittenExplicitExportBoundary explicitExport)

def toHandwrittenFinalizeBoundary
    (boundary : GeneratedVisibleFinalizeBoundary) : FinalizeBoundaryModel :=
  {
    operation := boundary.operation
    rawRootMaterialDropped := boundary.raw_root_material_dropped
    relayerKeyId := boundary.relayer_key_id
    clientPublicKey33 := boundary.derivation_client_share_public_key33
    relayerPublicKey33 := boundary.relayer_public_key33
    thresholdPublicKey33 := boundary.threshold_public_key33
    thresholdEthereumAddress20 := boundary.threshold_ethereum_address20
    clientShareRetryCounter := boundary.client_share_retry_counter
    relayerShareRetryCounter := boundary.relayer_share_retry_counter
  }

/-- The retained server state is not part of the visible boundary; the server
persists it after an accepted finalize, as the hidden-eval persisted state. -/
def toHandwrittenRetainedStateBoundary
    (persisted : server.boundary.HiddenEvalPersistedStateBoundary) :
    RetainedStateBoundaryModel :=
  {
    rawRootMaterialDropped := persisted.raw_root_material_dropped
    relayerKeyId := persisted.relayer_key_id
    relayerShare32 := persisted.relayer_share32
    clientPublicKey33 := persisted.derivation_client_share_public_key33
    relayerPublicKey33 := persisted.relayer_public_key33
    thresholdPublicKey33 := persisted.threshold_public_key33
    thresholdEthereumAddress20 := persisted.threshold_ethereum_address20
    clientShareRetryCounter := persisted.client_share_retry_counter
    relayerShareRetryCounter := persisted.relayer_share_retry_counter
  }

def toHandwrittenRespondBoundary
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : server.boundary.HiddenEvalPersistedStateBoundary) :
    RespondBoundaryModel :=
  {
    operation := toHandwrittenOperationBoundary boundary.operation
    clientOutput := toHandwrittenClientBoundary boundary.client_output
    finalize := toHandwrittenFinalizeBoundary boundary.finalize
    retained := toHandwrittenRetainedStateBoundary persisted
  }

theorem operationBoundary_matchesHandwrittenModel
    (boundary : GeneratedVisibleOperationBoundary) :
    toHandwrittenOperationBoundary boundary =
      {
        operation := boundary.operation
        allowedOutputKind := boundary.allowed_output_kind
      } := by
  rfl

theorem nonExportBoundary_matchesHandwrittenModel
    (boundary : GeneratedVisibleNonExportBoundary) :
    toHandwrittenNonExportBoundary boundary =
      {
        clientPublicKey33 := boundary.derivation_client_share_public_key33
        relayerPublicKey33 := boundary.relayer_public_key33
        thresholdPublicKey33 := boundary.threshold_public_key33
        thresholdEthereumAddress20 := boundary.threshold_ethereum_address20
        clientShareRetryCounter := boundary.client_share_retry_counter
        relayerShareRetryCounter := boundary.relayer_share_retry_counter
      } := by
  rfl

theorem explicitExportBoundary_matchesHandwrittenModel
    (boundary : GeneratedVisibleExplicitExportBoundary) :
    toHandwrittenExplicitExportBoundary boundary =
      {
        relayerExportShare32 := boundary.relayer_export_share32
        clientPublicKey33 := boundary.derivation_client_share_public_key33
        relayerPublicKey33 := boundary.relayer_public_key33
        thresholdPublicKey33 := boundary.threshold_public_key33
        thresholdEthereumAddress20 := boundary.threshold_ethereum_address20
        clientShareRetryCounter := boundary.client_share_retry_counter
        relayerShareRetryCounter := boundary.relayer_share_retry_counter
      } := by
  rfl

theorem retainedStateBoundary_matchesHandwrittenModel
    (persisted : server.boundary.HiddenEvalPersistedStateBoundary) :
    toHandwrittenRetainedStateBoundary persisted =
      {
        rawRootMaterialDropped := persisted.raw_root_material_dropped
        relayerKeyId := persisted.relayer_key_id
        relayerShare32 := persisted.relayer_share32
        clientPublicKey33 := persisted.derivation_client_share_public_key33
        relayerPublicKey33 := persisted.relayer_public_key33
        thresholdPublicKey33 := persisted.threshold_public_key33
        thresholdEthereumAddress20 := persisted.threshold_ethereum_address20
        clientShareRetryCounter := persisted.client_share_retry_counter
        relayerShareRetryCounter := persisted.relayer_share_retry_counter
      } := by
  rfl

theorem respondBoundary_matchesHandwrittenModel
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : server.boundary.HiddenEvalPersistedStateBoundary) :
    toHandwrittenRespondBoundary boundary persisted =
      {
        operation := toHandwrittenOperationBoundary boundary.operation
        clientOutput := toHandwrittenClientBoundary boundary.client_output
        finalize := toHandwrittenFinalizeBoundary boundary.finalize
        retained := toHandwrittenRetainedStateBoundary persisted
      } := by
  rfl

end RouterAbEcdsaDerivationBoundary
