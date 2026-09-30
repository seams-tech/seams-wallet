import RouterAbEcdsaDerivationBoundary.GeneratedVisibleBoundary
import RouterAbEcdsaDerivationBoundary.GeneratedHiddenEvalBoundary
import RouterAbEcdsaDerivationPrivacy.Goals

namespace RouterAbEcdsaDerivationPrivacy

open RouterAbEcdsaDerivationBoundary

def handwrittenStateOfGeneratedBoundary
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : ProtocolExecutionState :=
  {
    boundary := toHandwrittenRespondBoundary boundary persisted
    canonicalX32 := canonicalX32
    clientSecrets := clientSecrets
    serverSecrets := serverSecrets
  }

def clientVisibleBoundaryOfGeneratedBoundary
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary) : ClientVisibleBoundary :=
  clientVisibleBoundaryOfRespondBoundary (toHandwrittenRespondBoundary boundary persisted)

def clientObservableProfileOfGeneratedBoundary
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : ClientObservableProfile :=
  clientObservableProfile
    (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets)

def serverVisibleBoundaryOfGeneratedBoundary
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary) : ServerVisibleBoundary :=
  serverVisibleBoundaryOfRespondBoundary (toHandwrittenRespondBoundary boundary persisted)

def serverObservableProfileOfGeneratedBoundary
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : ServerObservableProfile :=
  serverObservableProfile
    (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets)

def nonExportClientViewOfGeneratedBoundary?
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : Option ClientObservableProfile :=
  nonExportClientView?
    (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets)

def explicitExportClientViewOfGeneratedBoundary?
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : Option ClientObservableProfile :=
  explicitExportClientView?
    (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets)

def nonExportServerViewOfGeneratedBoundary?
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : Option ServerObservableProfile :=
  nonExportServerView?
    (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets)

def explicitExportServerViewOfGeneratedBoundary?
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : Option ServerObservableProfile :=
  explicitExportServerView?
    (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets)

theorem clientVisibleBoundaryOfGeneratedBoundary_matches_handwritten_model
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary) :
    clientVisibleBoundaryOfGeneratedBoundary boundary persisted =
      clientVisibleBoundaryOfRespondBoundary (toHandwrittenRespondBoundary boundary persisted) := by
  rfl

theorem serverVisibleBoundaryOfGeneratedBoundary_matches_handwritten_model
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary) :
    serverVisibleBoundaryOfGeneratedBoundary boundary persisted =
      serverVisibleBoundaryOfRespondBoundary (toHandwrittenRespondBoundary boundary persisted) := by
  rfl

theorem nonExportClientViewOfGeneratedBoundary_matches_handwritten_projection
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) :
    nonExportClientViewOfGeneratedBoundary? boundary persisted canonicalX32 clientSecrets serverSecrets =
      nonExportClientView?
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets) := by
  rfl

theorem explicitExportClientViewOfGeneratedBoundary_matches_handwritten_projection
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) :
    explicitExportClientViewOfGeneratedBoundary? boundary persisted canonicalX32 clientSecrets serverSecrets =
      explicitExportClientView?
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets) := by
  rfl

theorem nonExportServerViewOfGeneratedBoundary_matches_handwritten_projection
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) :
    nonExportServerViewOfGeneratedBoundary? boundary persisted canonicalX32 clientSecrets serverSecrets =
      nonExportServerView?
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets) := by
  rfl

theorem explicitExportServerViewOfGeneratedBoundary_matches_handwritten_projection
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) :
    explicitExportServerViewOfGeneratedBoundary? boundary persisted canonicalX32 clientSecrets serverSecrets =
      explicitExportServerView?
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32 clientSecrets serverSecrets) := by
  rfl

theorem generatedBoundary_clientCannotDeriveServerSecrets :
    ∀
      (boundary : GeneratedVisibleRespondBoundary)
      (persisted : GeneratedHiddenEvalPersistedStateBoundary)
      (canonicalX32₁ canonicalX32₂ : Bytes32)
      (clientSecrets₁ clientSecrets₂ : ClientSecretState)
      (serverSecrets₁ serverSecrets₂ : ServerSecretState),
      statesVaryOnlyInServerSecrets
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂)
      →
      ClientViewsIndistinguishable
        (clientObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
        (clientObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂) := by
  intro boundary persisted canonicalX32₁ canonicalX32₂ clientSecrets₁ clientSecrets₂ serverSecrets₁ serverSecrets₂
  intro hVariation
  exact clientViewsIndistinguishable_of_eq
    (clientObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
    (clientObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂)
    (clientObservableProfile_eq_of_shared_client_boundary
      (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
      (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂)
      hVariation)

theorem generatedBoundary_serverCannotDeriveClientSecrets :
    ∀
      (boundary : GeneratedVisibleRespondBoundary)
      (persisted : GeneratedHiddenEvalPersistedStateBoundary)
      (canonicalX32₁ canonicalX32₂ : Bytes32)
      (clientSecrets₁ clientSecrets₂ : ClientSecretState)
      (serverSecrets₁ serverSecrets₂ : ServerSecretState),
      statesVaryOnlyInClientSecrets
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
        (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂)
      →
      ServerViewsIndistinguishable
        (serverObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
        (serverObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂) := by
  intro boundary persisted canonicalX32₁ canonicalX32₂ clientSecrets₁ clientSecrets₂ serverSecrets₁ serverSecrets₂
  intro hVariation
  exact serverViewsIndistinguishable_of_eq
    (serverObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
    (serverObservableProfileOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂)
    (serverObservableProfile_eq_of_shared_server_boundary
      (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
      (handwrittenStateOfGeneratedBoundary boundary persisted canonicalX32₂ clientSecrets₂ serverSecrets₂)
      hVariation)

theorem generatedBoundary_serverCannotSeeClientOutputPayloads
    (leftBoundary rightBoundary : GeneratedVisibleRespondBoundary)
    (leftPersisted rightPersisted : GeneratedHiddenEvalPersistedStateBoundary)
    (canonicalX32₁ canonicalX32₂ : Bytes32)
    (clientSecrets₁ clientSecrets₂ : ClientSecretState)
    (serverSecrets₁ serverSecrets₂ : ServerSecretState)
    (hBoundary :
      serverVisibleBoundaryOfGeneratedBoundary leftBoundary leftPersisted =
        serverVisibleBoundaryOfGeneratedBoundary rightBoundary rightPersisted) :
    serverObservableProfileOfGeneratedBoundary leftBoundary leftPersisted canonicalX32₁ clientSecrets₁ serverSecrets₁ =
      serverObservableProfileOfGeneratedBoundary rightBoundary rightPersisted canonicalX32₂ clientSecrets₂ serverSecrets₂ := by
  exact serverObservableProfile_eq_of_shared_server_boundary
    (handwrittenStateOfGeneratedBoundary leftBoundary leftPersisted canonicalX32₁ clientSecrets₁ serverSecrets₁)
    (handwrittenStateOfGeneratedBoundary rightBoundary rightPersisted canonicalX32₂ clientSecrets₂ serverSecrets₂)
    hBoundary

theorem generatedBoundary_explicitExportIsOnlyCanonicalSecretDisclosureException
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary) :
    BoundaryRespectsFrozenDisclosurePolicy (toHandwrittenRespondBoundary boundary persisted) →
    ¬ clientBoundaryRevealsCanonicalX
        (toHandwrittenRespondBoundary boundary persisted).clientOutput := by
  intro hPolicy
  exact explicitExportIsOnlyCanonicalSecretDisclosureException_proved
    (toHandwrittenRespondBoundary boundary persisted) hPolicy

/-- Both parties' views of the generated boundary carry the context binding that
the extracted Rust projection copied from the finalize envelope. -/
theorem generatedBoundary_views_expose_context_binding
    (response : GeneratedRespondResponse)
    (boundary : GeneratedVisibleRespondBoundary)
    (persisted : GeneratedHiddenEvalPersistedStateBoundary)
    (hExtracted :
      router_ab_ecdsa_derivation.server.boundary.visible_boundary_from_respond_response response =
        Aeneas.Std.Result.ok boundary) :
    (clientVisibleBoundaryOfGeneratedBoundary boundary persisted).contextBinding32 =
        response.finalize.context_binding32 ∧
      (serverVisibleBoundaryOfGeneratedBoundary boundary persisted).contextBinding32 =
        response.finalize.context_binding32 := by
  have hBinding :=
    visibleBoundaryFromRespondResponse_preserves_context_binding response boundary hExtracted
  exact ⟨hBinding, hBinding⟩

def hiddenEvalExecutionStateOfGeneratedBoundary
    (boundary : GeneratedHiddenEvalBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState) : HiddenEvalExecutionState :=
  {
    hiddenEvalBoundary := toHandwrittenHiddenEvalBoundary boundary
    canonicalX32 := canonicalX32
    clientSecrets := clientSecrets
    serverSecrets := serverSecrets
  }

def hiddenEvalBoundaryOfGeneratedBoundary
    (boundary : GeneratedHiddenEvalBoundary) : HiddenEvalBoundaryModel :=
  toHandwrittenHiddenEvalBoundary boundary

def hiddenEvalTransportBoundaryOfGeneratedBoundary
    (boundary : GeneratedHiddenEvalBoundary) : HiddenEvalTransportBoundaryModel :=
  (toHandwrittenHiddenEvalBoundary boundary).transport

def hiddenEvalPersistedStateBoundaryOfGeneratedBoundary
    (boundary : GeneratedHiddenEvalBoundary) :
    HiddenEvalPersistedStateBoundaryModel :=
  (toHandwrittenHiddenEvalBoundary boundary).persisted

theorem hiddenEvalBoundaryOfGeneratedBoundary_matches_handwritten_model
    (boundary : GeneratedHiddenEvalBoundary) :
    hiddenEvalBoundaryOfGeneratedBoundary boundary =
      toHandwrittenHiddenEvalBoundary boundary := by
  rfl

theorem generatedHiddenEvalBoundary_matches_privacy_model
    (boundary : GeneratedHiddenEvalBoundary) :
    hiddenEvalBoundaryOfGeneratedBoundary boundary = toHandwrittenHiddenEvalBoundary boundary := by
  exact hiddenEvalBoundaryOfGeneratedBoundary_matches_handwritten_model boundary

theorem generatedHiddenEvalBoundary_indistinguishable_under_client_secret_variation
    (left right : GeneratedHiddenEvalBoundary)
    (canonicalX32₁ canonicalX32₂ : Bytes32)
    (clientSecrets₁ clientSecrets₂ : ClientSecretState)
    (serverSecrets₁ serverSecrets₂ : ServerSecretState)
    (hBoundary : left = right) :
    hiddenEvalBoundaryOfState
        (hiddenEvalExecutionStateOfGeneratedBoundary left canonicalX32₁ clientSecrets₁ serverSecrets₁)
      =
      hiddenEvalBoundaryOfState
        (hiddenEvalExecutionStateOfGeneratedBoundary right canonicalX32₂ clientSecrets₂ serverSecrets₂) := by
  cases hBoundary
  rfl

theorem generatedHiddenEvalNonExportTransportExcludesCanonicalSecret
    (boundary : GeneratedHiddenEvalBoundary)
    (hAllowed :
      (toHandwrittenHiddenEvalBoundary boundary).transport.operation.allowedOutputKind =
        router_ab_ecdsa_derivation.wire.AllowedOutputKind.ThresholdMaterialOnly) :
    transportBoundaryRevealsCanonicalX?
        (hiddenEvalTransportBoundaryOfGeneratedBoundary boundary) = none := by
  exact hiddenEvalNonExportTransportExcludesCanonicalSecret_proved
    (hiddenEvalTransportBoundaryOfGeneratedBoundary boundary) hAllowed

theorem generatedPersistedStateNeverRevealsCanonicalSecret
    (boundary : GeneratedHiddenEvalBoundary) :
    ¬ persistedStateRevealsCanonicalX
        (hiddenEvalPersistedStateBoundaryOfGeneratedBoundary boundary) := by
  exact persistedStateNeverRevealsCanonicalSecret_proved
    (hiddenEvalPersistedStateBoundaryOfGeneratedBoundary boundary)

theorem generatedAcceptedPersistedStateExcludesForbiddenRootMaterial
    (boundary : GeneratedHiddenEvalBoundary)
    (hDropped :
      (hiddenEvalPersistedStateBoundaryOfGeneratedBoundary boundary).rawRootMaterialDropped = true) :
    ¬ persistedStateCarriesForbiddenRootMaterial
        (hiddenEvalPersistedStateBoundaryOfGeneratedBoundary boundary) := by
  exact acceptedPersistedStateExcludesForbiddenRootMaterial_proved
    (hiddenEvalPersistedStateBoundaryOfGeneratedBoundary boundary) hDropped

theorem generatedHiddenEvalTransportExplicitExportIsOnlyCanonicalSecretDisclosureException
    (boundary : GeneratedHiddenEvalBoundary) :
    BoundaryRespectsFrozenDisclosurePolicy
        (respondBoundaryOfHiddenEvalBoundary (toHandwrittenHiddenEvalBoundary boundary)) →
    ¬ transportBoundaryRevealsCanonicalX
        (hiddenEvalTransportBoundaryOfGeneratedBoundary boundary) := by
  intro hPolicy
  exact hiddenEvalTransportExplicitExportIsOnlyCanonicalSecretDisclosureException_proved
    (toHandwrittenHiddenEvalBoundary boundary) hPolicy

/-- Both parties' views of a generated hidden-eval state carry the context
binding that the extracted transport projection kept from the finalize envelope. -/
theorem generatedHiddenEvalBoundary_views_expose_context_binding
    (response : GeneratedRespondResponse)
    (boundary : GeneratedHiddenEvalBoundary)
    (canonicalX32 : Bytes32)
    (clientSecrets : ClientSecretState)
    (serverSecrets : ServerSecretState)
    (hExtracted :
      router_ab_ecdsa_derivation.server.boundary.hidden_eval_transport_boundary_from_respond_response
          response =
        Aeneas.Std.Result.ok boundary.transport) :
    (clientVisibleBoundaryOfHiddenEvalState
        (hiddenEvalExecutionStateOfGeneratedBoundary
          boundary canonicalX32 clientSecrets serverSecrets)).contextBinding32 =
        response.finalize.context_binding32 ∧
      (serverVisibleBoundaryOfHiddenEvalState
        (hiddenEvalExecutionStateOfGeneratedBoundary
          boundary canonicalX32 clientSecrets serverSecrets)).contextBinding32 =
        response.finalize.context_binding32 := by
  have hBinding :=
    hiddenEvalTransportFromRespondResponse_preserves_context_binding
      response boundary.transport hExtracted
  exact ⟨hBinding, hBinding⟩

end RouterAbEcdsaDerivationPrivacy
