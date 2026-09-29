import RouterAbEcdsaDerivationBoundary.GeneratedVisibleBoundary

namespace RouterAbEcdsaDerivationBoundary

open router_ab_ecdsa_derivation

abbrev GeneratedHiddenEvalInputBoundary :=
  server.boundary.HiddenEvalInputBoundary
abbrev GeneratedHiddenEvalTransportBoundary :=
  server.boundary.HiddenEvalTransportBoundary
abbrev GeneratedHiddenEvalPersistedStateBoundary :=
  server.boundary.HiddenEvalPersistedStateBoundary
abbrev GeneratedHiddenEvalBoundary :=
  server.boundary.HiddenEvalBoundary

def toHandwrittenHiddenEvalInputBoundary
    (boundary : GeneratedHiddenEvalInputBoundary) :
    HiddenEvalInputBoundaryModel :=
  {
    operation := boundary.operation
    allowedOutputKind := boundary.allowed_output_kind
    context := boundary.context
    relayerKeyId := boundary.relayer_key_id
    clientPublicKey33 := boundary.derivation_client_share_public_key33
    clientShareRetryCounter := boundary.client_share_retry_counter
    expectedRelayerKeyId := boundary.expected_relayer_key_id
    yRelayer32Le := boundary.y_relayer32_le
  }

def toHandwrittenHiddenEvalTransportBoundary
    (boundary : GeneratedHiddenEvalTransportBoundary) :
    HiddenEvalTransportBoundaryModel :=
  {
    operation := toHandwrittenOperationBoundary boundary.operation
    clientOutput := toHandwrittenClientBoundary boundary.client_output
    finalize := toHandwrittenFinalizeBoundary boundary.finalize
  }

def toHandwrittenHiddenEvalPersistedStateBoundary
    (boundary : GeneratedHiddenEvalPersistedStateBoundary) :
    HiddenEvalPersistedStateBoundaryModel :=
  {
    operation := boundary.operation
    rawRootMaterialDropped := boundary.raw_root_material_dropped
    relayerKeyId := boundary.relayer_key_id
    relayerShare32 := boundary.relayer_share32
    clientPublicKey33 := boundary.derivation_client_share_public_key33
    relayerPublicKey33 := boundary.relayer_public_key33
    thresholdPublicKey33 := boundary.threshold_public_key33
    thresholdEthereumAddress20 := boundary.threshold_ethereum_address20
    clientShareRetryCounter := boundary.client_share_retry_counter
    relayerShareRetryCounter := boundary.relayer_share_retry_counter
  }

def toHandwrittenHiddenEvalBoundary
    (boundary : GeneratedHiddenEvalBoundary) : HiddenEvalBoundaryModel :=
  {
    input := toHandwrittenHiddenEvalInputBoundary boundary.input
    transport := toHandwrittenHiddenEvalTransportBoundary boundary.transport
    persisted := toHandwrittenHiddenEvalPersistedStateBoundary boundary.persisted
  }

theorem hiddenEvalInputBoundary_matchesHandwrittenModel
    (boundary : GeneratedHiddenEvalInputBoundary) :
    toHandwrittenHiddenEvalInputBoundary boundary =
      {
        operation := boundary.operation
        allowedOutputKind := boundary.allowed_output_kind
        context := boundary.context
        relayerKeyId := boundary.relayer_key_id
        clientPublicKey33 := boundary.derivation_client_share_public_key33
        clientShareRetryCounter := boundary.client_share_retry_counter
        expectedRelayerKeyId := boundary.expected_relayer_key_id
        yRelayer32Le := boundary.y_relayer32_le
      } := by
  rfl

/-- The extracted transport projection keeps the finalize envelope's context
binding, so the handwritten transport model holds the value on the wire. -/
theorem hiddenEvalTransportFromRespondResponse_preserves_context_binding
    (response : GeneratedRespondResponse)
    (boundary : GeneratedHiddenEvalTransportBoundary)
    (hExtracted :
      server.boundary.hidden_eval_transport_boundary_from_respond_response response =
        Aeneas.Std.Result.ok boundary) :
    (toHandwrittenHiddenEvalTransportBoundary boundary).finalize.contextBinding32 =
      response.finalize.context_binding32 := by
  unfold server.boundary.hidden_eval_transport_boundary_from_respond_response at hExtracted
  cases hVisible : server.boundary.visible_boundary_from_respond_response response with
  | ok visible =>
    simp only [hVisible, Aeneas.Std.bind_tc_ok, Aeneas.Std.Result.ok.injEq] at hExtracted
    subst hExtracted
    exact visibleBoundaryFromRespondResponse_preserves_context_binding response visible hVisible
  | fail _ => simp [hVisible] at hExtracted
  | div => simp [hVisible] at hExtracted

theorem hiddenEvalPersistedStateBoundary_matchesHandwrittenModel
    (boundary : GeneratedHiddenEvalPersistedStateBoundary) :
    toHandwrittenHiddenEvalPersistedStateBoundary boundary =
      {
        operation := boundary.operation
        rawRootMaterialDropped := boundary.raw_root_material_dropped
        relayerKeyId := boundary.relayer_key_id
        relayerShare32 := boundary.relayer_share32
        clientPublicKey33 := boundary.derivation_client_share_public_key33
        relayerPublicKey33 := boundary.relayer_public_key33
        thresholdPublicKey33 := boundary.threshold_public_key33
        thresholdEthereumAddress20 := boundary.threshold_ethereum_address20
        clientShareRetryCounter := boundary.client_share_retry_counter
        relayerShareRetryCounter := boundary.relayer_share_retry_counter
      } := by
  rfl

theorem hiddenEvalBoundary_matchesHandwrittenModel
    (boundary : GeneratedHiddenEvalBoundary) :
    toHandwrittenHiddenEvalBoundary boundary =
      {
        input := toHandwrittenHiddenEvalInputBoundary boundary.input
        transport := toHandwrittenHiddenEvalTransportBoundary boundary.transport
        persisted := toHandwrittenHiddenEvalPersistedStateBoundary boundary.persisted
      } := by
  rfl

end RouterAbEcdsaDerivationBoundary
