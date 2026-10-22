# Ed25519 Yao Lean Model

This workspace checks handwritten policy models and conditional composition.
Production cryptographic privacy remains unproved.

The retained models cover manifest shape, role-local inputs and outputs,
uniform abort views, delivery, credential replacement, semantic frame views,
export authorization, and evaluator admission. These claims describe the
modeled fields and transitions. They do not establish production custody,
authenticated storage, transport security, timing, or erasure.

## Evaluator admission

`EvaluationUse.lean` records each admitted execution in a used-execution ledger.
Admission succeeds exactly when that execution is absent. A successful step
preserves its input and all previous ledger entries. The same execution cannot
be admitted again using the returned ledger, even with another payload.

Export, registration, recovery, and refresh admission all use this transition.
Their proofs connect admission to exact input retention and replay rejection.
State is represented by the lifecycle type; overrideable count and state-label
fields have been removed. Abort results retain the original admission, so
execution and identity bindings have one source.

Export requires distinct A/B authorities with equal common bindings. Recovery
promotion preserves the complete registered identity, tombstones the old
credential, and activates its distinct replacement. Refresh promotion preserves
the public key, scope, and credential while advancing activation and role epochs.

These guarantees apply to transitions that thread the returned ledger. Durable
atomic storage and the production use of that ledger remain unproved. Reusing
an old ledger snapshot is outside this guarantee. Typed stage wrappers can be
constructed directly in Lean; they are specification values, not runtime
capabilities or evidence that an external ceremony occurred.

## Passive composition

`PassiveSecurity.lean` uses an explicit nonempty finite distribution for each
protocol family and corrupted role. It samples uniformly over list positions;
repeated outcomes represent repeated probability mass. The same distribution
is used for every hybrid and every distinguisher.

`StatisticalDistanceBound` bounds the acceptance-count difference for all
Boolean distinguishers. Dividing its numerator by the fixed outcome count gives
the probability bound. Five supplied adjacent bounds compose additively.
`permutedObservationsHaveZeroDistance` checks distributional equality even when
paired samples produce different observations.

No production transition bound is discharged. Production randomness, payload
semantics, primitive reductions, and computational security remain open. The
export-A simulator input and generated public shape provide only the narrower
link documented in [passive security](../docs/passive-security-real-ideal-v1.md).

## Gate

```sh
cargo yao-fv lean-check
cargo yao-fv passive-security-check
```

The gate builds `Ed25519YaoModel`, requires its `.olean` output, and checks the
transitive assumptions of the main named claims. Only Lean's standard logical
axioms are permitted for those claims. It enforces no theorem-count quota.
`RuntimePublicShape.lean` is regenerated from production executions in memory
and compared byte for byte. The separate Aeneas export-continuity proof covers
an actual production guard's output, error, and panic behavior.
