use core::{fmt, num::NonZeroU16};

use curve25519_dalek::scalar::Scalar;
use rand_core::{CryptoRng, RngCore};
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{ThresholdPrfError, ThresholdPrfResult};

const SIGNING_ROOT_SHARE_WIRE_LEN: usize = 34;
/// Maximum operational threshold share count for the public `t-of-N` API.
pub const MAX_SHARE_COUNT: u16 = 255;

/// Project-root scalar `k_org` in the PRF suite field.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SigningRootScalar(pub(crate) Scalar);

impl fmt::Debug for SigningRootScalar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SigningRootScalar([redacted])")
    }
}

impl SigningRootScalar {
    /// Parses canonical scalar bytes.
    pub fn from_canonical_bytes(bytes: [u8; 32]) -> ThresholdPrfResult<Self> {
        let scalar = Option::<Scalar>::from(Scalar::from_canonical_bytes(bytes))
            .ok_or(ThresholdPrfError::InvalidScalarEncoding)?;
        Self::from_scalar(scalar)
    }

    /// Returns canonical scalar bytes.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.0.to_bytes()
    }

    pub(crate) fn from_scalar(scalar: Scalar) -> ThresholdPrfResult<Self> {
        reject_zero_scalar(&scalar)?;
        Ok(Self(scalar))
    }
}

/// Generic threshold policy for the public `t-of-N` protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThresholdPolicy {
    threshold: NonZeroU16,
    share_count: NonZeroU16,
}

impl ThresholdPolicy {
    /// Creates a validated canonical threshold policy from non-zero values.
    pub fn new(threshold: NonZeroU16, share_count: NonZeroU16) -> ThresholdPrfResult<Self> {
        if threshold.get() > share_count.get() || share_count.get() > MAX_SHARE_COUNT {
            return Err(ThresholdPrfError::InvalidThresholdSubset);
        }
        Ok(Self {
            threshold,
            share_count,
        })
    }

    /// Parses a canonical threshold policy from raw boundary values.
    pub fn from_u16s(threshold: u16, share_count: u16) -> ThresholdPrfResult<Self> {
        let threshold =
            NonZeroU16::new(threshold).ok_or(ThresholdPrfError::InvalidThresholdSubset)?;
        let share_count =
            NonZeroU16::new(share_count).ok_or(ThresholdPrfError::InvalidThresholdSubset)?;
        Self::new(threshold, share_count)
    }

    /// Returns the policy threshold.
    pub fn threshold(&self) -> NonZeroU16 {
        self.threshold
    }

    /// Returns the policy share count.
    pub fn share_count(&self) -> NonZeroU16 {
        self.share_count
    }

    fn threshold_usize(self) -> usize {
        usize::from(self.threshold.get())
    }

    fn contains_share_id(self, id: ThresholdShareId) -> bool {
        id.get().get() <= self.share_count.get()
    }
}

/// Non-zero share identifier for the future public canonical `t-of-N` protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ThresholdShareId(NonZeroU16);

impl ThresholdShareId {
    /// Creates a canonical threshold share id from a non-zero value.
    pub fn new(value: NonZeroU16) -> Self {
        Self(value)
    }

    /// Parses a canonical threshold share id from a raw boundary value.
    pub fn from_u16(value: u16) -> ThresholdPrfResult<Self> {
        let value = NonZeroU16::new(value).ok_or(ThresholdPrfError::InvalidShareId)?;
        Ok(Self::new(value))
    }

    /// Returns the non-zero share id value.
    pub fn get(&self) -> NonZeroU16 {
        self.0
    }
}

/// Validated canonical threshold subset preserving caller order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedThresholdSet<T> {
    policy: ThresholdPolicy,
    values: Vec<T>,
}

impl<T> ValidatedThresholdSet<T> {
    /// Returns the threshold policy validated for this subset.
    pub fn policy(&self) -> &ThresholdPolicy {
        &self.policy
    }

    /// Returns the validated values in caller order.
    pub fn values(&self) -> &[T] {
        &self.values
    }
}

impl ValidatedThresholdSet<SigningRootShare> {
    /// Validates canonical signing-root shares against a threshold policy.
    pub fn from_signing_root_shares(
        policy: ThresholdPolicy,
        shares: Vec<SigningRootShare>,
    ) -> ThresholdPrfResult<Self> {
        validate_threshold_set_values(policy, shares, SigningRootShare::id)
    }
}

pub(crate) fn validate_threshold_set_values<T>(
    policy: ThresholdPolicy,
    values: Vec<T>,
    share_id: impl Fn(&T) -> ThresholdShareId,
) -> ThresholdPrfResult<ValidatedThresholdSet<T>> {
    if values.len() != policy.threshold_usize() {
        return Err(ThresholdPrfError::InvalidThresholdSubset);
    }

    let mut seen_ids = Vec::with_capacity(values.len());
    for value in &values {
        let id = share_id(value);
        if !policy.contains_share_id(id) {
            return Err(ThresholdPrfError::InvalidShareId);
        }
        if seen_ids.contains(&id) {
            return Err(ThresholdPrfError::DuplicateShareId);
        }
        seen_ids.push(id);
    }

    Ok(ValidatedThresholdSet { policy, values })
}

/// One future canonical Shamir signing-root share.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SigningRootShare {
    #[zeroize(skip)]
    id: ThresholdShareId,
    pub(crate) value: Scalar,
}

/// Fixed-width canonical secret signing-root share encoding.
///
/// This encoding is for decrypted share material at the server SDK boundary.
/// It is not a public transport format.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SigningRootShareWire {
    bytes: [u8; SIGNING_ROOT_SHARE_WIRE_LEN],
}

impl fmt::Debug for SigningRootShare {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SigningRootShare")
            .field("id", &self.id)
            .field("value", &"[redacted]")
            .finish()
    }
}

impl fmt::Debug for SigningRootShareWire {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SigningRootShareWire([redacted])")
    }
}

impl SigningRootShare {
    /// Creates a canonical signing-root share from a validated id and canonical scalar bytes.
    pub fn from_canonical_bytes(id: ThresholdShareId, bytes: [u8; 32]) -> ThresholdPrfResult<Self> {
        let value = Option::<Scalar>::from(Scalar::from_canonical_bytes(bytes))
            .ok_or(ThresholdPrfError::InvalidScalarEncoding)?;
        Ok(Self { id, value })
    }

    /// Returns the canonical share id.
    pub fn id(&self) -> ThresholdShareId {
        self.id
    }

    /// Returns canonical share scalar bytes.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.value.to_bytes()
    }

    pub(crate) fn new_unchecked(id: ThresholdShareId, value: Scalar) -> Self {
        Self { id, value }
    }
}

impl SigningRootShareWire {
    /// Serialized canonical signing-root share length: two share-id bytes and 32-byte scalar.
    pub const LEN: usize = SIGNING_ROOT_SHARE_WIRE_LEN;

    /// Decodes and validates fixed-width canonical secret share bytes.
    pub fn decode(bytes: [u8; Self::LEN]) -> ThresholdPrfResult<Self> {
        let wire = Self { bytes };
        wire.to_share()?;
        Ok(wire)
    }

    /// Decodes and validates a fixed-width canonical secret share byte slice.
    pub fn decode_slice(bytes: &[u8]) -> ThresholdPrfResult<Self> {
        let bytes: [u8; Self::LEN] = bytes
            .try_into()
            .map_err(|_| ThresholdPrfError::InvalidShareEncoding)?;
        Self::decode(bytes)
    }

    /// Creates a fixed-width canonical secret share wire value from a signing-root share.
    pub fn from_share(share: &SigningRootShare) -> Self {
        let mut bytes = [0u8; Self::LEN];
        bytes[0..2].copy_from_slice(&share.id().get().get().to_be_bytes());
        bytes[2..].copy_from_slice(&share.to_bytes());
        Self { bytes }
    }

    /// Decodes the validated canonical wire value into a signing-root share.
    pub fn to_share(&self) -> ThresholdPrfResult<SigningRootShare> {
        let id = ThresholdShareId::from_u16(u16::from_be_bytes(
            self.bytes[0..2]
                .try_into()
                .expect("fixed-width canonical signing-root share id slice"),
        ))?;
        let scalar_bytes = self.bytes[2..]
            .try_into()
            .expect("fixed-width canonical signing-root share scalar slice");
        SigningRootShare::from_canonical_bytes(id, scalar_bytes)
    }

    /// Returns the fixed-width canonical secret share bytes.
    pub fn to_bytes(&self) -> [u8; Self::LEN] {
        self.bytes
    }
}

/// Generates a non-zero signing-root scalar.
pub fn generate_signing_root<R>(rng: &mut R) -> SigningRootScalar
where
    R: RngCore + CryptoRng,
{
    loop {
        let scalar = Scalar::random(&mut *rng);
        if !bool::from(scalar.ct_eq(&Scalar::ZERO)) {
            return SigningRootScalar(scalar);
        }
    }
}

/// Splits a signing root into generic canonical `t-of-N` Shamir shares.
pub fn split_signing_root<R>(
    root: &SigningRootScalar,
    policy: ThresholdPolicy,
    rng: &mut R,
) -> ThresholdPrfResult<Vec<SigningRootShare>>
where
    R: RngCore + CryptoRng,
{
    let mut coefficients = Vec::with_capacity(policy.threshold_usize().saturating_sub(1));
    for _ in 1..policy.threshold_usize() {
        coefficients.push(random_nonzero_scalar(rng));
    }

    let mut shares = Vec::with_capacity(usize::from(policy.share_count().get()));
    for id in 1..=policy.share_count().get() {
        let id = ThresholdShareId::from_u16(id).expect("policy share ids are non-zero");
        shares.push(eval_share(root.0, &coefficients, id));
    }
    Ok(shares)
}

/// Reconstructs the signing root from a validated canonical threshold share set.
pub fn reconstruct_signing_root(
    shares: &ValidatedThresholdSet<SigningRootShare>,
) -> ThresholdPrfResult<SigningRootScalar> {
    let ids = shares
        .values()
        .iter()
        .map(|share| share.id().get().get())
        .collect::<Vec<_>>();
    let coefficients = lagrange_coefficients_at_zero_for_ids(&ids);
    let mut root = Scalar::ZERO;

    for (coefficient, share) in coefficients.iter().zip(shares.values()) {
        root += *coefficient * share.value;
    }

    SigningRootScalar::from_scalar(root)
}

fn eval_share(root: Scalar, coefficients: &[Scalar], id: ThresholdShareId) -> SigningRootShare {
    let x = Scalar::from(u64::from(id.get().get()));
    let mut value = root;
    let mut x_power = x;
    for coefficient in coefficients {
        value += *coefficient * x_power;
        x_power *= x;
    }
    SigningRootShare::new_unchecked(id, value)
}

fn random_nonzero_scalar<R>(rng: &mut R) -> Scalar
where
    R: RngCore + CryptoRng,
{
    loop {
        let candidate = Scalar::random(&mut *rng);
        if !is_zero_scalar(&candidate) {
            return candidate;
        }
    }
}

fn reject_zero_scalar(scalar: &Scalar) -> ThresholdPrfResult<()> {
    if is_zero_scalar(scalar) {
        Err(ThresholdPrfError::ZeroScalar)
    } else {
        Ok(())
    }
}

fn is_zero_scalar(scalar: &Scalar) -> bool {
    bool::from(scalar.ct_eq(&Scalar::ZERO))
}

pub(crate) fn lagrange_coefficients_for_share_ids(ids: &[ThresholdShareId]) -> Vec<Scalar> {
    let ids = ids.iter().map(|id| id.get().get()).collect::<Vec<_>>();
    lagrange_coefficients_at_zero_for_ids(&ids)
}

fn lagrange_coefficients_at_zero_for_ids(ids: &[u16]) -> Vec<Scalar> {
    let mut coefficients = vec![Scalar::ZERO; ids.len()];

    for (coefficient_index, coefficient) in coefficients.iter_mut().enumerate() {
        let x_i = Scalar::from(u64::from(ids[coefficient_index]));
        let mut numerator = Scalar::ONE;
        let mut denominator = Scalar::ONE;

        for (other_index, other_id) in ids.iter().copied().enumerate() {
            if coefficient_index == other_index {
                continue;
            }
            let x_j = Scalar::from(u64::from(other_id));
            numerator *= x_j;
            denominator *= x_j - x_i;
        }

        *coefficient = numerator * denominator.invert();
    }

    coefficients
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_chacha::ChaCha20Rng;
    use rand_core::SeedableRng;

    #[test]
    fn threshold_policy_accepts_valid_boundary_policies() {
        for (threshold, share_count) in [(1, 1), (1, 3), (2, 3), (3, 5), (7, 7)] {
            let policy =
                ThresholdPolicy::from_u16s(threshold, share_count).expect("valid canonical policy");

            assert_eq!(policy.threshold().get(), threshold);
            assert_eq!(policy.share_count().get(), share_count);
        }

        let policy = ThresholdPolicy::new(nonzero_u16(5), nonzero_u16(7))
            .expect("non-zero constructor accepts valid policy");
        assert_eq!(policy.threshold().get(), 5);
        assert_eq!(policy.share_count().get(), 7);
    }

    #[test]
    fn threshold_policy_rejects_invalid_boundary_policies() {
        assert_eq!(
            ThresholdPolicy::from_u16s(0, 1).unwrap_err(),
            ThresholdPrfError::InvalidThresholdSubset
        );
        assert_eq!(
            ThresholdPolicy::from_u16s(1, 0).unwrap_err(),
            ThresholdPrfError::InvalidThresholdSubset
        );
        assert_eq!(
            ThresholdPolicy::from_u16s(4, 3).unwrap_err(),
            ThresholdPrfError::InvalidThresholdSubset
        );
        assert_eq!(
            ThresholdPolicy::new(nonzero_u16(4), nonzero_u16(3)).unwrap_err(),
            ThresholdPrfError::InvalidThresholdSubset
        );
        assert_eq!(
            ThresholdPolicy::from_u16s(1, MAX_SHARE_COUNT + 1).unwrap_err(),
            ThresholdPrfError::InvalidThresholdSubset
        );
    }

    #[test]
    fn threshold_share_id_rejects_zero_at_boundary() {
        assert_eq!(
            ThresholdShareId::from_u16(0).unwrap_err(),
            ThresholdPrfError::InvalidShareId
        );

        let id = ThresholdShareId::new(nonzero_u16(7));
        assert_eq!(id.get().get(), 7);
        assert_eq!(
            ThresholdShareId::from_u16(MAX_SHARE_COUNT)
                .expect("max canonical share id")
                .get()
                .get(),
            MAX_SHARE_COUNT
        );
    }

    #[test]
    fn validated_threshold_set_accepts_valid_share_subsets_and_preserves_order() {
        let policy = ThresholdPolicy::from_u16s(2, 3).expect("valid canonical policy");
        let values = vec![signing_root_share(3, 30), signing_root_share(1, 10)];

        let set = ValidatedThresholdSet::from_signing_root_shares(policy, values)
            .expect("valid canonical threshold set");

        assert_eq!(set.policy(), &policy);
        assert_eq!(
            set.values()
                .iter()
                .map(|share| (share.id().get().get(), share.to_bytes()[0]))
                .collect::<Vec<_>>(),
            vec![(3, 30), (1, 10)]
        );
    }

    #[test]
    fn validated_threshold_set_accepts_boundary_policy_shapes() {
        for (policy, shares) in [
            (
                ThresholdPolicy::from_u16s(1, 1).expect("valid policy"),
                vec![signing_root_share(1, 1)],
            ),
            (
                ThresholdPolicy::from_u16s(1, 3).expect("valid policy"),
                vec![signing_root_share(3, 3)],
            ),
            (
                ThresholdPolicy::from_u16s(7, 7).expect("valid policy"),
                vec![
                    signing_root_share(7, 7),
                    signing_root_share(6, 6),
                    signing_root_share(5, 5),
                    signing_root_share(4, 4),
                    signing_root_share(3, 3),
                    signing_root_share(2, 2),
                    signing_root_share(1, 1),
                ],
            ),
        ] {
            ValidatedThresholdSet::from_signing_root_shares(policy, shares)
                .expect("boundary policy should validate");
        }
    }

    #[test]
    fn validated_threshold_set_rejects_invalid_share_subsets() {
        let policy = ThresholdPolicy::from_u16s(2, 3).expect("valid canonical policy");

        assert_eq!(
            ValidatedThresholdSet::from_signing_root_shares(
                policy,
                vec![signing_root_share(1, 10)]
            )
            .unwrap_err(),
            ThresholdPrfError::InvalidThresholdSubset
        );
        assert_eq!(
            ValidatedThresholdSet::from_signing_root_shares(
                policy,
                vec![
                    signing_root_share(1, 10),
                    signing_root_share(2, 20),
                    signing_root_share(3, 30),
                ],
            )
            .unwrap_err(),
            ThresholdPrfError::InvalidThresholdSubset
        );
        assert_eq!(
            ValidatedThresholdSet::from_signing_root_shares(
                policy,
                vec![signing_root_share(1, 10), signing_root_share(1, 11),],
            )
            .unwrap_err(),
            ThresholdPrfError::DuplicateShareId
        );
        assert_eq!(
            ValidatedThresholdSet::from_signing_root_shares(
                policy,
                vec![signing_root_share(1, 10), signing_root_share(4, 40),],
            )
            .unwrap_err(),
            ThresholdPrfError::InvalidShareId
        );
    }

    #[test]
    fn signing_root_share_wire_round_trips_u16_share_id_and_scalar() {
        let share = signing_root_share(258, 42);
        let wire = SigningRootShareWire::from_share(&share);
        let bytes = wire.to_bytes();

        assert_eq!(SigningRootShareWire::LEN, 34);
        assert_eq!(&bytes[0..2], &[1, 2]);
        assert_eq!(bytes[2], 42);

        let decoded = SigningRootShareWire::decode(bytes)
            .expect("canonical signing-root share wire should decode")
            .to_share()
            .expect("canonical signing-root share should convert");

        assert_eq!(decoded.id().get().get(), 258);
        assert_eq!(decoded.to_bytes(), share.to_bytes());
    }

    #[test]
    fn signing_root_share_wire_rejects_bad_boundary_inputs() {
        let mut zero_id_wire = [0u8; SigningRootShareWire::LEN];
        zero_id_wire[2..].copy_from_slice(&Scalar::from(7u64).to_bytes());
        assert_eq!(
            SigningRootShareWire::decode(zero_id_wire).unwrap_err(),
            ThresholdPrfError::InvalidShareId
        );

        let mut invalid_scalar_wire = [0u8; SigningRootShareWire::LEN];
        invalid_scalar_wire[1] = 1;
        invalid_scalar_wire[2..].copy_from_slice(&[0xff; 32]);
        assert_eq!(
            SigningRootShareWire::decode(invalid_scalar_wire).unwrap_err(),
            ThresholdPrfError::InvalidScalarEncoding
        );

        assert_eq!(
            SigningRootShareWire::decode_slice(&[1, 2, 3]).unwrap_err(),
            ThresholdPrfError::InvalidShareEncoding
        );
    }

    #[test]
    fn split_and_reconstruct_roundtrips_every_three_of_five_subset() {
        let policy = ThresholdPolicy::from_u16s(3, 5).expect("valid canonical policy");
        let root = signing_root_scalar(11);
        let mut rng = ChaCha20Rng::from_seed([0x61u8; 32]);
        let shares = split_signing_root(&root, policy, &mut rng).expect("canonical split succeeds");

        assert_eq!(shares.len(), 5);
        assert_eq!(
            shares
                .iter()
                .map(|share| share.id().get().get())
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5]
        );

        for ids in [
            [1u16, 2, 3],
            [1, 2, 4],
            [1, 2, 5],
            [1, 3, 4],
            [1, 3, 5],
            [1, 4, 5],
            [2, 3, 4],
            [2, 3, 5],
            [2, 4, 5],
            [3, 4, 5],
        ] {
            let set = share_set(policy, &shares, ids);
            let reversed_set = share_set(policy, &shares, [ids[2], ids[1], ids[0]]);
            assert_eq!(
                reconstruct_signing_root(&set)
                    .expect("valid subset reconstructs")
                    .to_bytes(),
                root.to_bytes()
            );
            assert_eq!(
                reconstruct_signing_root(&reversed_set)
                    .expect("valid reversed subset reconstructs")
                    .to_bytes(),
                root.to_bytes()
            );
        }
    }

    #[test]
    fn split_and_reconstruct_supports_boundary_threshold_policies() {
        let root = signing_root_scalar(17);

        let one_of_three = ThresholdPolicy::from_u16s(1, 3).expect("valid canonical policy");
        let mut one_rng = ChaCha20Rng::from_seed([0x62u8; 32]);
        let one_shares = split_signing_root(&root, one_of_three, &mut one_rng)
            .expect("canonical split succeeds");
        for id in [[1u16], [2], [3]] {
            let set = share_set(one_of_three, &one_shares, id);
            assert_eq!(
                reconstruct_signing_root(&set).unwrap().to_bytes(),
                root.to_bytes()
            );
        }

        let all_of_five = ThresholdPolicy::from_u16s(5, 5).expect("valid canonical policy");
        let mut all_rng = ChaCha20Rng::from_seed([0x63u8; 32]);
        let all_shares =
            split_signing_root(&root, all_of_five, &mut all_rng).expect("canonical split succeeds");
        for ids in [[1u16, 2, 3, 4, 5], [5u16, 4, 3, 2, 1]] {
            let set = share_set(all_of_five, &all_shares, ids);
            assert_eq!(
                reconstruct_signing_root(&set).unwrap().to_bytes(),
                root.to_bytes()
            );
        }
    }

    fn nonzero_u16(value: u16) -> NonZeroU16 {
        NonZeroU16::new(value).expect("non-zero test value")
    }

    fn signing_root_share(id: u16, value: u64) -> SigningRootShare {
        SigningRootShare::from_canonical_bytes(
            ThresholdShareId::from_u16(id).expect("valid canonical share id"),
            Scalar::from(value).to_bytes(),
        )
        .expect("valid canonical signing-root share")
    }

    fn signing_root_scalar(value: u64) -> SigningRootScalar {
        SigningRootScalar::from_scalar(Scalar::from(value)).expect("non-zero signing root")
    }

    fn share_set<const T: usize>(
        policy: ThresholdPolicy,
        shares: &[SigningRootShare],
        ids: [u16; T],
    ) -> ValidatedThresholdSet<SigningRootShare> {
        let values = ids
            .into_iter()
            .map(|id| {
                shares
                    .iter()
                    .find(|share| share.id().get().get() == id)
                    .expect("share id exists")
                    .clone()
            })
            .collect();
        ValidatedThresholdSet::from_signing_root_shares(policy, values)
            .expect("valid canonical share set")
    }
}
