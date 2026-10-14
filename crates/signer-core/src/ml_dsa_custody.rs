//! Protected ML-DSA owner-root delivery and authenticated key-generation results.
//!
//! Recipient public keys must come from authenticated Router admission. HPKE
//! base-mode inputs provide confidentiality, not client authorization or replay
//! control. Each holder must check its own admission before opening an input.

pub mod material;

use hpke_ng::{Aes256Gcm, DhKemX25519HkdfSha256, HkdfSha256, Hpke, Kem};
use rand_chacha::{rand_core::SeedableRng, ChaCha20Rng};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{
    error::{CoreResult, SignerCoreError},
    wallet_seed_derivation::{
        compute_ml_dsa65_application_binding_digest_v1, derive_ml_dsa65_owner_root_from_seed_v1,
        establish_wallet_key_set_manifest_v1, verify_registered_wallet_key_set_manifest_v1,
        VerifiedWalletKeySetManifestDigestV1, WalletKeySetManifestV1,
    },
};

type RoleHpke = Hpke<DhKemX25519HkdfSha256, HkdfSha256, Aes256Gcm>;
const INPUT_INFO: &[u8] = b"seams/ml-dsa-65/owner-root-delivery/v1";
const RESULT_INFO: &[u8] = b"seams/ml-dsa-65/keygen-result/v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MlDsaRoleV1 {
    A,
    B,
}

/// Validated public context. Stable key identity and operation identity stay separate.
#[derive(Clone, Serialize, Deserialize)]
#[serde(try_from = "BindingWire")]
pub struct MlDsaCeremonyBindingV1 {
    wallet_id: String,
    signing_key_id: String,
    operation_id: [u8; 32],
    material_epoch: u64,
    #[serde(skip)]
    application_binding_digest: [u8; 32],
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BindingWire {
    wallet_id: String,
    signing_key_id: String,
    operation_id: [u8; 32],
    material_epoch: u64,
}

impl TryFrom<BindingWire> for MlDsaCeremonyBindingV1 {
    type Error = SignerCoreError;
    fn try_from(wire: BindingWire) -> CoreResult<Self> {
        Self::new(
            wire.wallet_id,
            wire.signing_key_id,
            wire.operation_id,
            wire.material_epoch,
        )
    }
}

impl MlDsaCeremonyBindingV1 {
    pub fn new(
        wallet_id: String,
        signing_key_id: String,
        operation_id: [u8; 32],
        material_epoch: u64,
    ) -> CoreResult<Self> {
        let application_binding_digest =
            compute_ml_dsa65_application_binding_digest_v1(&wallet_id, &signing_key_id)?;
        if wallet_id.trim() != wallet_id
            || signing_key_id.trim() != signing_key_id
            || operation_id == [0; 32]
        {
            return Err(SignerCoreError::invalid_input(
                "ML-DSA binding requires canonical identifiers and a nonzero operation id",
            ));
        }
        Ok(Self {
            wallet_id,
            signing_key_id,
            operation_id,
            material_epoch,
            application_binding_digest,
        })
    }

    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }
    pub fn signing_key_id(&self) -> &str {
        &self.signing_key_id
    }
    pub fn operation_id(&self) -> &[u8; 32] {
        &self.operation_id
    }
    pub fn material_epoch(&self) -> u64 {
        self.material_epoch
    }

    fn aad(&self, role: MlDsaRoleV1) -> Vec<u8> {
        let mut aad = b"seams/ml-dsa-65/ceremony-binding/v1".to_vec();
        aad.extend_from_slice(&self.application_binding_digest);
        aad.extend_from_slice(&self.operation_id);
        aad.extend_from_slice(&self.material_epoch.to_be_bytes());
        aad.push(match role {
            MlDsaRoleV1::A => 0,
            MlDsaRoleV1::B => 1,
        });
        aad
    }
}

/// Public ciphertext received at the holder boundary. Opening validates its exact shape.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedMlDsaRoleInputV1 {
    encapsulated_key: [u8; 32],
    ciphertext: Vec<u8>,
}

/// Authenticated ciphertext received at the client boundary.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedMlDsaRoleResultV1 {
    encapsulated_key: [u8; 32],
    ciphertext: Vec<u8>,
}

/// Continuity is mandatory for recovery. It cannot be represented by a missing digest.
pub enum MlDsaKeyContinuityV1 {
    Create,
    Recover { recorded_manifest_digest: [u8; 32] },
}

/// Client completion state. Only ciphertext and public context can leave it.
pub struct PreparedMlDsaCustodyV1 {
    binding: MlDsaCeremonyBindingV1,
    continuity: MlDsaKeyContinuityV1,
    recipient_secret: Zeroizing<[u8; 32]>,
    role_public_keys: [[u8; 32]; 2],
    inputs: [SealedMlDsaRoleInputV1; 2],
}

/// The client derives and splits the owner root here. It never derives the FIPS seed.
pub fn prepare_ml_dsa_custody_v1(
    wallet_seed: &[u8],
    binding: MlDsaCeremonyBindingV1,
    role_public_keys: [[u8; 32]; 2],
    continuity: MlDsaKeyContinuityV1,
) -> CoreResult<PreparedMlDsaCustodyV1> {
    if role_public_keys[0] == role_public_keys[1]
        || role_public_keys.iter().any(|key| *key == [0; 32])
    {
        return Err(SignerCoreError::invalid_input(
            "ML-DSA holders require distinct nonzero recipient keys",
        ));
    }
    let digest = binding.application_binding_digest;
    let root = derive_ml_dsa65_owner_root_from_seed_v1(wallet_seed, &digest)?;
    let share_a = random_secret()?;
    let mut share_b = Zeroizing::new([0; 32]);
    for index in 0..32 {
        share_b[index] = root[index] ^ share_a[index];
    }
    let recipient_entropy = random_secret()?;
    let (secret, public) =
        DhKemX25519HkdfSha256::derive_key_pair(recipient_entropy.as_ref()).map_err(hpke_error)?;
    let private_bytes = Zeroizing::new(DhKemX25519HkdfSha256::sk_to_bytes(&secret));
    let recipient_secret = Zeroizing::new(
        private_bytes
            .as_slice()
            .try_into()
            .map_err(|_| shape_error())?,
    );
    let public_bytes = DhKemX25519HkdfSha256::pk_to_bytes(&public);
    let reply_key: [u8; 32] = public_bytes
        .as_slice()
        .try_into()
        .map_err(|_| shape_error())?;
    let inputs = [
        seal_input(
            &binding,
            MlDsaRoleV1::A,
            &role_public_keys[0],
            &share_a,
            &reply_key,
        )?,
        seal_input(
            &binding,
            MlDsaRoleV1::B,
            &role_public_keys[1],
            &share_b,
            &reply_key,
        )?,
    ];
    Ok(PreparedMlDsaCustodyV1 {
        binding,
        continuity,
        recipient_secret,
        role_public_keys,
        inputs,
    })
}

impl PreparedMlDsaCustodyV1 {
    pub fn binding(&self) -> &MlDsaCeremonyBindingV1 {
        &self.binding
    }
    pub fn input(&self, role: MlDsaRoleV1) -> &SealedMlDsaRoleInputV1 {
        match role {
            MlDsaRoleV1::A => &self.inputs[0],
            MlDsaRoleV1::B => &self.inputs[1],
        }
    }

    /// Authenticates both holder results, checks agreement, then verifies continuity.
    pub fn complete(
        self,
        a: &SealedMlDsaRoleResultV1,
        b: &SealedMlDsaRoleResultV1,
    ) -> CoreResult<VerifiedMlDsaKeyV1> {
        let key_a = self.open_result(MlDsaRoleV1::A, &self.role_public_keys[0], a)?;
        let key_b = self.open_result(MlDsaRoleV1::B, &self.role_public_keys[1], b)?;
        if key_a != key_b {
            return Err(SignerCoreError::invalid_input(
                "ML-DSA holders returned different public keys",
            ));
        }
        let manifest = WalletKeySetManifestV1::NearMlDsa65 {
            wallet_id: self.binding.wallet_id.clone(),
            ml_dsa65_signing_key_id: self.binding.signing_key_id.clone(),
            registered_public_key: key_a.clone(),
        };
        let verified_manifest = match self.continuity {
            MlDsaKeyContinuityV1::Create => establish_wallet_key_set_manifest_v1(&manifest)?,
            MlDsaKeyContinuityV1::Recover {
                recorded_manifest_digest,
            } => {
                verify_registered_wallet_key_set_manifest_v1(&manifest, &recorded_manifest_digest)?
            }
        };
        Ok(VerifiedMlDsaKeyV1 {
            public_key: key_a,
            binding: self.binding,
            verified_manifest,
        })
    }

    fn open_result(
        &self,
        role: MlDsaRoleV1,
        sender_key: &[u8; 32],
        sealed: &SealedMlDsaRoleResultV1,
    ) -> CoreResult<Box<[u8; 1952]>> {
        if sealed.ciphertext.len() != 1968 {
            return Err(shape_error());
        }
        let enc =
            DhKemX25519HkdfSha256::enc_from_bytes(&sealed.encapsulated_key).map_err(hpke_error)?;
        let secret = DhKemX25519HkdfSha256::sk_from_bytes(self.recipient_secret.as_ref())
            .map_err(hpke_error)?;
        let public = DhKemX25519HkdfSha256::pk_from_bytes(sender_key).map_err(hpke_error)?;
        let bytes = RoleHpke::open_auth(
            &enc,
            &secret,
            RESULT_INFO,
            &self.binding.aad(role),
            &sealed.ciphertext,
            &public,
        )
        .map_err(hpke_error)?;
        bytes
            .into_boxed_slice()
            .try_into()
            .map_err(|_| shape_error())
    }
}

pub struct VerifiedMlDsaKeyV1 {
    public_key: Box<[u8; 1952]>,
    binding: MlDsaCeremonyBindingV1,
    verified_manifest: VerifiedWalletKeySetManifestDigestV1,
}
impl VerifiedMlDsaKeyV1 {
    pub fn public_key(&self) -> &[u8; 1952] {
        &self.public_key
    }
    pub fn binding(&self) -> &MlDsaCeremonyBindingV1 {
        &self.binding
    }
    pub fn manifest(&self) -> &VerifiedWalletKeySetManifestDigestV1 {
        &self.verified_manifest
    }
}

/// Holds one role's decrypted root share. No constructor accepts a raw share.
pub struct OpenedMlDsaRoleInputV1 {
    own_root_share: Zeroizing<[u8; 32]>,
    reply: MlDsaRoleReplyV1,
}

pub struct MlDsaRoleReplyV1 {
    reply_public_key: [u8; 32],
    binding: MlDsaCeremonyBindingV1,
    role: MlDsaRoleV1,
}
impl OpenedMlDsaRoleInputV1 {
    pub fn into_parts(self) -> (Zeroizing<[u8; 32]>, MlDsaRoleReplyV1) {
        (self.own_root_share, self.reply)
    }
}

impl MlDsaRoleReplyV1 {
    /// Authenticates the result under the holder key pinned by the client.
    /// The adapter must supply only the public key returned by this operation.
    pub fn seal_result(
        self,
        holder_secret: &[u8; 32],
        public_key: &[u8; 1952],
    ) -> CoreResult<SealedMlDsaRoleResultV1> {
        let public =
            DhKemX25519HkdfSha256::pk_from_bytes(&self.reply_public_key).map_err(hpke_error)?;
        let secret = DhKemX25519HkdfSha256::sk_from_bytes(holder_secret).map_err(hpke_error)?;
        let (enc, ciphertext) = RoleHpke::seal_auth(
            &mut fresh_rng()?,
            &public,
            RESULT_INFO,
            &self.binding.aad(self.role),
            public_key,
            &secret,
        )
        .map_err(hpke_error)?;
        Ok(SealedMlDsaRoleResultV1 {
            encapsulated_key: enc.as_ref().try_into().map_err(|_| shape_error())?,
            ciphertext,
        })
    }
}

/// Expected context and holder role come from admission, never from the ciphertext.
pub fn open_ml_dsa_role_input_v1(
    sealed: &SealedMlDsaRoleInputV1,
    expected_binding: &MlDsaCeremonyBindingV1,
    role: MlDsaRoleV1,
    holder_secret: &[u8; 32],
) -> CoreResult<OpenedMlDsaRoleInputV1> {
    if sealed.ciphertext.len() != 80 {
        return Err(shape_error());
    }
    let enc =
        DhKemX25519HkdfSha256::enc_from_bytes(&sealed.encapsulated_key).map_err(hpke_error)?;
    let secret = DhKemX25519HkdfSha256::sk_from_bytes(holder_secret).map_err(hpke_error)?;
    let bytes = Zeroizing::new(
        RoleHpke::open_base(
            &enc,
            &secret,
            INPUT_INFO,
            &expected_binding.aad(role),
            &sealed.ciphertext,
        )
        .map_err(hpke_error)?,
    );
    if bytes.len() != 64 {
        return Err(shape_error());
    }
    Ok(OpenedMlDsaRoleInputV1 {
        own_root_share: Zeroizing::new(bytes[..32].try_into().map_err(|_| shape_error())?),
        reply: MlDsaRoleReplyV1 {
            reply_public_key: bytes[32..].try_into().map_err(|_| shape_error())?,
            binding: expected_binding.clone(),
            role,
        },
    })
}

fn seal_input(
    binding: &MlDsaCeremonyBindingV1,
    role: MlDsaRoleV1,
    recipient: &[u8; 32],
    share: &[u8; 32],
    reply_key: &[u8; 32],
) -> CoreResult<SealedMlDsaRoleInputV1> {
    let public = DhKemX25519HkdfSha256::pk_from_bytes(recipient).map_err(hpke_error)?;
    let mut plaintext = Zeroizing::new([0; 64]);
    plaintext[..32].copy_from_slice(share);
    plaintext[32..].copy_from_slice(reply_key);
    let (enc, ciphertext) = RoleHpke::seal_base(
        &mut fresh_rng()?,
        &public,
        INPUT_INFO,
        &binding.aad(role),
        plaintext.as_ref(),
    )
    .map_err(hpke_error)?;
    Ok(SealedMlDsaRoleInputV1 {
        encapsulated_key: enc.as_ref().try_into().map_err(|_| shape_error())?,
        ciphertext,
    })
}
fn random_secret() -> CoreResult<Zeroizing<[u8; 32]>> {
    let mut bytes = Zeroizing::new([0; 32]);
    getrandom::getrandom(bytes.as_mut())
        .map_err(|_| SignerCoreError::crypto_error("ML-DSA custody randomness unavailable"))?;
    Ok(bytes)
}
fn fresh_rng() -> CoreResult<ChaCha20Rng> {
    Ok(ChaCha20Rng::from_seed(*random_secret()?))
}
fn hpke_error(_: hpke_ng::HpkeError) -> SignerCoreError {
    SignerCoreError::crypto_error("ML-DSA custody HPKE authentication failed")
}
fn shape_error() -> SignerCoreError {
    SignerCoreError::invalid_length("ML-DSA custody envelope has an invalid length")
}
