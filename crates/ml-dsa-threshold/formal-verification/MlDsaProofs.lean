import MlDsa
open Aeneas Aeneas.Std
open ml_dsa_threshold

namespace MlDsaProofs
set_option maxHeartbeats 2000000

private theorem reduce_bits (x : BitVec 32) (h : x.toNat < 16760834) :
  (x - 8380417#32) + (8380417#32 &&& (0#32 - ((x - 8380417#32) >>> 31))) =
    if x.toNat < 8380417 then x else x - 8380417#32 := by
  by_cases small : x.toNat < 8380417
  · have shift : ((x - 8380417#32) >>> 31) = 1#32 := by
      apply BitVec.eq_of_toNat_eq
      simp [BitVec.toNat_sub, Nat.shiftRight_eq_div_pow]
      omega
    simp only [shift, if_pos small]
    change (x - 8380417#32) + 8380417#32 = x
    simp
  · have shift : ((x - 8380417#32) >>> 31) = 0#32 := by
      apply BitVec.eq_of_toNat_eq
      simp [BitVec.toNat_sub, Nat.shiftRight_eq_div_pow]
      omega
    simp only [shift, if_neg small]
    change (x - 8380417#32) + 0#32 = x - 8380417#32
    simp

theorem reduce_once_spec (x : U32) (h : x.val < 2 * 8380417) :
  modular.reduce_once x ⦃ y => y.val = x.val % 8380417 ∧ y.val < 8380417 ⦄ := by
  unfold modular.reduce_once
  simp only [modular.Q]
  step*
  have bits := reduce_bits x.bv h
  have out : (core.num.U32.wrapping_add difference i1).bv =
      if x.val < 8380417 then x.bv else x.bv - 8380417#32 := by
    simpa only [core.num.U32.wrapping_add, UScalar.wrapping_add, i1_post2,
      borrow_mask_post, core.num.U32.wrapping_sub, UScalar.wrapping_sub,
      i_post2, difference_post] using bits
  change (core.num.U32.wrapping_add difference i1).bv.toNat = _ ∧
    (core.num.U32.wrapping_add difference i1).bv.toNat < _
  rw [out]
  by_cases small : x.val < 8380417
  · simp [small, Nat.mod_eq_of_lt small]
  · simp only [if_neg small, BitVec.toNat_sub, BitVec.toNat_ofNat]
    norm_num only [Nat.reducePow, Nat.reduceMod]
    have values : x.bv.toNat = x.val := rfl
    omega


theorem add_mod_spec (x y : U32) (hx : x.val < 8380417) (hy : y.val < 8380417) :
  modular.add_mod x y ⦃ z => z.val = (x.val + y.val) % 8380417 ∧ z.val < 8380417 ⦄ := by
  unfold modular.add_mod
  step
  step with reduce_once_spec
  simp_all only
  constructor <;> trivial

theorem subtract_mod_spec (x y : U32) (hx : x.val < 8380417) (hy : y.val < 8380417) :
  modular.subtract_mod x y ⦃ z => z.val = (x.val + 8380417 - y.val) % 8380417 ∧ z.val < 8380417 ⦄ := by
  unfold modular.subtract_mod
  simp only [modular.Q]
  step
  step
  step with reduce_once_spec
  simp_all only
  constructor <;> trivial


@[local step] private theorem widen_spec (x : U32) :
    lift (core.convert.num.FromU64U32.from x) ⦃ y => y.val = x.val ⦄ := by
  simp only [lift, WP.spec_ok, core.convert.num.FromU64U32.from_val_eq]

@[local step] private theorem low_mask_spec (x : U64) :
    lift (x &&& 8388607#u64) ⦃ y => y.val = x.val % 8388608 ∧ y.val < 8388608 ⦄ := by
  simp only [lift, WP.spec_ok, UScalar.val]
  change x.val &&& (2^23 - 1) = x.val % (2^23) ∧ x.val &&& (2^23 - 1) < 2^23
  rw [Nat.and_two_pow_sub_one_eq_mod]
  exact ⟨rfl, Nat.mod_lt _ (by decide)⟩

private theorem low_mask_constant : modular.multiply_mod.LOW_MASK = Result.ok 8388607#u64 := by
  unfold modular.multiply_mod.LOW_MASK
  rfl

private def foldValue (n : Nat) : Nat := n % 8388608 + n / 8388608 * 8191

private theorem fold_mod (n : Nat) :
    foldValue n % 8380417 = n % 8380417 := by
  unfold foldValue
  have division := Nat.mod_add_div n 8388608
  calc
    (n % 8388608 + n / 8388608 * 8191) % 8380417 =
        ((n % 8388608 + n / 8388608 * 8191) + n / 8388608 * 8380417) % 8380417 := by simp
    _ = n % 8380417 := by congr 1; omega

theorem multiply_mod_spec (x y : U32) (hx : x.val < 8380417) (hy : y.val < 8380417) :
  modular.multiply_mod x y ⦃ z => z.val = (x.val * y.val) % 8380417 ∧ z.val < 8380417 ⦄ := by
  have productBound : x.val * y.val ≤ 70231372333056 :=
    Nat.mul_le_mul (by omega : x.val ≤ 8380416) (by omega : y.val ≤ 8380416)
  unfold modular.multiply_mod
  rw [low_mask_constant]
  step*
  all_goals simp_all only [Nat.shiftRight_eq_div_pow, Nat.reducePow]
  all_goals try scalar_tac
  have foldedBound : folded2.val < 2 * 8380417 := by omega
  have castValue : (UScalar.cast .U32 folded2).val = folded2.val := by
    rw [UScalar.cast_val_eq]
    apply Nat.mod_eq_of_lt
    scalar_tac
  have preserved : folded2.val % 8380417 = (x.val * y.val) % 8380417 := by
    have foldedEq : folded2.val = foldValue (foldValue (foldValue (x.val * y.val))) := by
      exact folded2_post
    rw [foldedEq, fold_mod, fold_mod, fold_mod]
  step with reduce_once_spec as ⟨result, resultMod, resultBound⟩
  exact ⟨by simpa only [castValue, preserved] using resultMod, resultBound⟩


run_cmd do
  let theorems := [``reduce_once_spec, ``add_mod_spec, ``subtract_mod_spec, ``multiply_mod_spec]
  let allowed := [``propext, ``Classical.choice, ``Quot.sound]
  for theoremName in theorems do
    let assumptions ← Lean.collectAxioms theoremName
    for assumption in assumptions do
      unless allowed.contains assumption do
        throwError "unexpected arithmetic proof assumption: {assumption}"
    Lean.logInfo m!"{theoremName} checked assumptions: {assumptions}"

end MlDsaProofs
