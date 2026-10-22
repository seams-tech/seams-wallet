namespace Ed25519YaoModel

/-- Executions already admitted in this model's transition history. -/
abbrev UsedExecutions := List Nat

/-- Admission returns the next ledger together with the accepted payload. -/
def recordEvaluation {α : Type}
    (used : UsedExecutions) (execution : Nat) (payload : α) :
    Option (UsedExecutions × α) :=
  if execution ∈ used then none else some (execution :: used, payload)

theorem evaluationAdmittedExactlyWhenUnused
    (used : UsedExecutions) (execution : Nat) (payload : α) :
    (recordEvaluation used execution payload).isSome ↔ execution ∉ used := by
  simp [recordEvaluation]

theorem admittedEvaluationRecordsUseAndPreservesPayload
    (used next : UsedExecutions) (execution : Nat) (payload accepted : α)
    (admitted : recordEvaluation used execution payload = some (next, accepted)) :
    execution ∈ next ∧ (∀ previous ∈ used, previous ∈ next) ∧ accepted = payload := by
  unfold recordEvaluation at admitted
  split at admitted
  · contradiction
  · cases admitted
    exact ⟨by simp, fun _ member => List.mem_cons_of_mem _ member, rfl⟩

theorem admittedExecutionCannotBeAdmittedAgain
    (used next : UsedExecutions) (execution : Nat) (payload accepted : α)
    (admitted : recordEvaluation used execution payload = some (next, accepted))
    (other : β) :
    recordEvaluation next execution other = none := by
  have recorded :=
    (admittedEvaluationRecordsUseAndPreservesPayload used next execution payload accepted admitted).1
  simp [recordEvaluation, recorded]

end Ed25519YaoModel
