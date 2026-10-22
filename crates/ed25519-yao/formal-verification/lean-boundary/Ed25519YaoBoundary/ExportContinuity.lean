import Ed25519Yao

open Aeneas.Std
open router_ab_ed25519_yao_client

namespace Ed25519YaoBoundary

/-- Export accepts exactly the registered public key. -/
def exportContinuitySpec
    (reconstructed registered : Array U8 32#usize) :
    core.result.Result Unit error.ClientActivationError :=
  if reconstructed.val = registered.val then
    .Ok ()
  else
    .Err .PublicKeyContinuityMismatch

private theorem byteMismatch
    {α : Type} [DecidableEq α]
    (left right : List α)
    (sameLength : left.length = right.length) :
    List.anyM
        (fun pair => Result.ok (decide (pair.1 ≠ pair.2)))
        (left.zip right) =
      Result.ok (decide (left ≠ right)) := by
  induction left generalizing right with
  | nil =>
      cases right with
      | nil => rfl
      | cons => simp_all
  | cons head tail inductionHypothesis =>
      cases right with
      | nil => simp_all
      | cons other rest =>
          have tailLength : tail.length = rest.length := by simpa using sameLength
          simp only [List.zip_cons_cons, List.anyM_cons, bind_tc_ok]
          by_cases equalHeads : head = other
          · subst other
            simpa using inductionHypothesis rest tailLength
          · simp [equalHeads]
            rfl

/-- The extracted production check returns the specified success or rejection
    for every pair of keys. The outer `ok` excludes panic, other runtime failure,
    and divergence on both branches. -/
theorem exportContinuityBehavior
    (reconstructed registered : Array U8 32#usize) :
    export_continuity.validate_export_public_key reconstructed registered =
      Result.ok (exportContinuitySpec reconstructed registered) := by
  have sameLength : reconstructed.val.length = registered.val.length := by simp
  have comparison := byteMismatch reconstructed.val registered.val sameLength
  simp only [export_continuity.validate_export_public_key,
    core.array.equality.PartialEqArray.ne, Array.length, comparison]
  by_cases sameKey : reconstructed.val = registered.val <;>
    simp [exportContinuitySpec, sameKey]

run_cmd do
  let assumptions ← Lean.collectAxioms ``exportContinuityBehavior
  let allowed := [``propext, ``Classical.choice, ``Quot.sound]
  for assumption in assumptions do
    unless allowed.contains assumption do
      throwError "unexpected export-continuity proof assumption: {assumption}"
  Lean.logInfo m!"exportContinuityBehavior checked assumptions: {assumptions}"

end Ed25519YaoBoundary
