import RouterAbEcdsaDerivationPrivacy.Model
import RouterAbEcdsaDerivationPrivacy.TrueBlind
import RouterAbEcdsaDerivationPrivacy.TrueBlindBoundary

open RouterAbEcdsaDerivationPrivacy.TrueBlind in
run_cmd do
  let allowed := [``propext, ``Classical.choice, ``Quot.sound,
    ``scalarToBytes32, ``scalarBaseMul, ``pointAdd, ``ethereumAddress,
    ``deriveClientShare, ``deriveServerShare, ``publicTranscriptDigest,
    ``exportAuthorizationDigest]
  for claim in [``invalidAuthorizationDigestCannotBindExport,
      ``different_context_prevents_bound_role_local_signing_session,
      ``boundExplicitExportSessionOfState_reconstruction_verifies_public_key] do
    let assumptions ← Lean.collectAxioms claim
    for assumption in assumptions do
      unless allowed.contains assumption do
        throwError "unexpected proof assumption in {claim}: {assumption}"
    Lean.logInfo m!"{claim} checked assumptions: {assumptions}"
