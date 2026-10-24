//! Scalar operations on reduced ML-DSA residues.

/// ML-DSA prime modulus.
pub const Q: u32 = 8_380_417;

/// Adds two reduced residues modulo the ML-DSA modulus.
pub fn add_mod(left: u32, right: u32) -> u32 {
    reduce_once(left + right)
}

/// Subtracts two reduced residues modulo the ML-DSA modulus.
pub fn subtract_mod(left: u32, right: u32) -> u32 {
    reduce_once(left + Q - right)
}

/// Multiplies two reduced residues modulo Q.
pub fn multiply_mod(left: u32, right: u32) -> u32 {
    // Q = 2^23 - 8191, so replacing each high part by 8191 preserves the residue.
    // Reduced operands give a product <= 70_231_372_333_056. Three folds bound
    // the result by 68_585_340_919, 75_358_223, and 8_454_135, respectively.
    // The last bound is below 2*Q and fits the single-subtraction contract.
    const LOW_MASK: u64 = (1 << 23) - 1;
    let product = u64::from(left) * u64::from(right);
    let folded = (product & LOW_MASK) + (product >> 23) * 8191;
    let folded = (folded & LOW_MASK) + (folded >> 23) * 8191;
    let folded = (folded & LOW_MASK) + (folded >> 23) * 8191;
    reduce_once(folded as u32)
}

// The input is below 2*Q < 2^24. Its wrapped difference has the top bit set
// exactly when subtraction borrowed. Restore Q with a mask in that case.
pub fn reduce_once(value: u32) -> u32 {
    let difference = value.wrapping_sub(Q);
    let borrow_mask = 0_u32.wrapping_sub(difference >> 31);
    difference.wrapping_add(Q & borrow_mask)
}
