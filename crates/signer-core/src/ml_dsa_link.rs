//! Key-specific ML-DSA root transfer. Wallet custody seeds never enter a package.
//! Authentication and exact-set admission belong to the existing device-link protocol.
use crate::{
    error::{CoreResult, SignerCoreError},
    ml_dsa_custody::{fresh_rng, hpke_error, random_secret},
    passkey_custody::{
        open_verified_passkey_custody_secret_v1, seal_custody_secret, sha256_digest,
        MlDsa65OwnerRootBindingV1, PasskeyCustodyEnvelopeBindingV1,
        PasskeyCustodyEnvelopeOwnershipV1, PasskeyCustodySecretBindingV1,
        SealedPasskeyCustodyEnvelopeV1, WalletCustodySeedFromSealedEnvelopeV1,
    },
    wallet_seed_derivation::{
        compute_ml_dsa65_application_binding_digest_v1, derive_ml_dsa65_owner_root_from_seed_v1,
        verify_registered_wallet_key_set_manifest_v1, WalletKeySetManifestV1,
    },
};
use base64ct::{Base64UrlUnpadded, Encoding};
use hpke_ng::{Aes256Gcm, DhKemX25519HkdfSha256, HkdfSha256, Hpke, Kem};
use serde::{Deserialize, Serialize};
use sha3::digest::{ExtendableOutput, Update, XofReader};
use zeroize::Zeroizing;

type RootHpke = Hpke<DhKemX25519HkdfSha256, HkdfSha256, Aes256Gcm>;
const TRANSFER_INFO: &[u8] = b"seams/ml-dsa-65/linked-owner-root/v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MlDsaRootTransferBindingV1 {
    pub wallet_id: String,
    pub wallet_auth_method_id: String,
    pub root: MlDsa65OwnerRootBindingV1,
    pub recipient_public_key_b64u: String,
}

impl MlDsaRootTransferBindingV1 {
    pub fn aad(&self) -> CoreResult<Vec<u8>> {
        validate_root_identity(&self.wallet_id, &self.root)?;
        canonical_id(&self.wallet_auth_method_id)?;
        let public = decode_fixed::<32>(&self.recipient_public_key_b64u)?;
        if public == [0; 32] {
            return Err(invalid("The ML-DSA root recipient is zero"));
        }
        serde_json::to_vec(self).map_err(|_| invalid("Invalid ML-DSA transfer binding"))
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SealedMlDsaRootTransferV1 {
    pub encapsulated_key_b64u: String,
    pub ciphertext_b64u: String,
    pub binding_digest_b64u: String,
    pub ciphertext_digest_b64u: String,
}

/// A recipient is consumed on every opening attempt, including authentication failure.
pub struct MlDsaRootTransferRecipientV1 {
    secret: Zeroizing<[u8; 32]>,
    public: [u8; 32],
}
impl MlDsaRootTransferRecipientV1 {
    pub fn generate() -> CoreResult<Self> {
        let entropy = random_secret()?;
        let (secret, public) =
            DhKemX25519HkdfSha256::derive_key_pair(entropy.as_ref()).map_err(hpke_error)?;
        let private = Zeroizing::new(DhKemX25519HkdfSha256::sk_to_bytes(&secret));
        Ok(Self {
            secret: Zeroizing::new(
                private
                    .as_slice()
                    .try_into()
                    .map_err(|_| invalid("Invalid recipient secret"))?,
            ),
            public: DhKemX25519HkdfSha256::pk_to_bytes(&public)
                .as_slice()
                .try_into()
                .map_err(|_| invalid("Invalid recipient public key"))?,
        })
    }
    pub fn public_key_b64u(&self) -> String {
        Base64UrlUnpadded::encode_string(&self.public)
    }
    pub fn open(
        self,
        binding: MlDsaRootTransferBindingV1,
        package: &SealedMlDsaRootTransferV1,
    ) -> CoreResult<MlDsaRootFromTransferV1> {
        let aad = binding.aad()?;
        if decode_fixed::<32>(&binding.recipient_public_key_b64u)? != self.public {
            return Err(invalid("The ML-DSA package names a different recipient"));
        }
        let ciphertext = decode_ciphertext(package)?;
        if decode_fixed::<32>(&package.binding_digest_b64u)? != sha256_digest(&aad)
            || decode_fixed::<32>(&package.ciphertext_digest_b64u)? != sha256_digest(&ciphertext)
        {
            return Err(invalid("The ML-DSA package digest differs"));
        }
        let encapsulated = DhKemX25519HkdfSha256::enc_from_bytes(&decode_fixed::<32>(
            &package.encapsulated_key_b64u,
        )?)
        .map_err(hpke_error)?;
        let secret =
            DhKemX25519HkdfSha256::sk_from_bytes(self.secret.as_ref()).map_err(hpke_error)?;
        let plaintext = Zeroizing::new(
            RootHpke::open_base(&encapsulated, &secret, TRANSFER_INFO, &aad, &ciphertext)
                .map_err(hpke_error)?,
        );
        let root = Zeroizing::new(
            plaintext
                .as_slice()
                .try_into()
                .map_err(|_| invalid("Invalid ML-DSA root length"))?,
        );
        Ok(MlDsaRootFromTransferV1 { root, binding })
    }
}

/// A received root may only be verified and sealed under the approved target factor.
pub struct MlDsaRootFromTransferV1 {
    root: Zeroizing<[u8; 32]>,
    binding: MlDsaRootTransferBindingV1,
}
impl MlDsaRootFromTransferV1 {
    pub fn seed_for_public_key_verification(&self) -> Zeroizing<[u8; 32]> {
        canonical_seed(&self.root)
    }
    pub fn expected_public_key_b64u(&self) -> &str {
        &self.binding.root.registered_public_key_b64u
    }
    pub fn seal_under_factor(
        self,
        factor: &[u8],
        envelope: &PasskeyCustodyEnvelopeBindingV1,
        nonce: &[u8],
    ) -> CoreResult<SealedPasskeyCustodyEnvelopeV1> {
        if envelope.wallet_id != self.binding.wallet_id
            || envelope.binding
                != (PasskeyCustodySecretBindingV1::MlDsa65OwnerRoot {
                    root: self.binding.root,
                })
            || !matches!(&envelope.ownership, PasskeyCustodyEnvelopeOwnershipV1::MethodBound { wallet_auth_method_id } if wallet_auth_method_id == &self.binding.wallet_auth_method_id)
        {
            return Err(invalid(
                "The ML-DSA target envelope differs from its approved recipient",
            ));
        }
        seal_custody_secret(factor, envelope, nonce, self.root.as_ref())
    }
}

/// A factor-authenticated root can export this key or forward it to a newly approved link.
pub struct MlDsaRootFromFactorV1 {
    root: Zeroizing<[u8; 32]>,
    wallet_id: String,
    identity: MlDsa65OwnerRootBindingV1,
}
impl MlDsaRootFromFactorV1 {
    pub fn open(
        factor: &[u8],
        envelope: &PasskeyCustodyEnvelopeBindingV1,
        nonce: &[u8],
        ciphertext: &[u8],
        aad_hash: &[u8],
        ciphertext_digest: &[u8],
    ) -> CoreResult<Self> {
        let PasskeyCustodySecretBindingV1::MlDsa65OwnerRoot { root: identity } = &envelope.binding
        else {
            return Err(invalid("An ML-DSA root envelope is required"));
        };
        if !matches!(
            envelope.ownership,
            PasskeyCustodyEnvelopeOwnershipV1::MethodBound { .. }
        ) {
            return Err(invalid("The root envelope must name its exact auth method"));
        }
        validate_root_identity(&envelope.wallet_id, identity)?;
        let plaintext = open_verified_passkey_custody_secret_v1(
            factor,
            envelope,
            nonce,
            ciphertext,
            aad_hash,
            ciphertext_digest,
        )?;
        Ok(Self {
            root: Zeroizing::new(
                plaintext
                    .as_slice()
                    .try_into()
                    .map_err(|_| invalid("Invalid ML-DSA root length"))?,
            ),
            wallet_id: envelope.wallet_id.clone(),
            identity: identity.clone(),
        })
    }
    pub fn seed_for_export(
        self,
        wallet_id: &str,
        signing_key_id: &str,
        public_key: &str,
    ) -> CoreResult<Zeroizing<[u8; 32]>> {
        if self.wallet_id != wallet_id
            || self.identity.ml_dsa_signing_key_id != signing_key_id
            || self.identity.registered_public_key_b64u != public_key
        {
            return Err(invalid("The export names a different ML-DSA key"));
        }
        Ok(canonical_seed(&self.root))
    }
    pub fn seal_for_link(
        &self,
        target: &MlDsaRootTransferBindingV1,
    ) -> CoreResult<SealedMlDsaRootTransferV1> {
        if self.wallet_id != target.wallet_id
            || self.identity.wallet_key_id != target.root.wallet_key_id
            || self.identity.ml_dsa_signing_key_id != target.root.ml_dsa_signing_key_id
            || self.identity.application_binding_digest_b64u
                != target.root.application_binding_digest_b64u
            || self.identity.registered_public_key_b64u != target.root.registered_public_key_b64u
            || self.identity.key_manifest_digest_b64u != target.root.key_manifest_digest_b64u
        {
            return Err(invalid("A linked root cannot forward another key"));
        }
        seal_root(&self.root, target)
    }
}

pub fn seal_ml_dsa_root_from_wallet_seed_v1(
    admitted: &WalletCustodySeedFromSealedEnvelopeV1,
    wallet_seed: &[u8],
    target: &MlDsaRootTransferBindingV1,
) -> CoreResult<SealedMlDsaRootTransferV1> {
    if admitted.wallet_id() != target.wallet_id {
        return Err(invalid("The ML-DSA transfer names another wallet"));
    }
    let application = compute_ml_dsa65_application_binding_digest_v1(
        &target.wallet_id,
        &target.root.ml_dsa_signing_key_id,
    )?;
    let root = derive_ml_dsa65_owner_root_from_seed_v1(wallet_seed, &application)?;
    seal_root(&root, target)
}

fn seal_root(
    root: &[u8; 32],
    binding: &MlDsaRootTransferBindingV1,
) -> CoreResult<SealedMlDsaRootTransferV1> {
    let aad = binding.aad()?;
    let public = DhKemX25519HkdfSha256::pk_from_bytes(&decode_fixed::<32>(
        &binding.recipient_public_key_b64u,
    )?)
    .map_err(hpke_error)?;
    let (encapsulated, ciphertext) =
        RootHpke::seal_base(&mut fresh_rng()?, &public, TRANSFER_INFO, &aad, root)
            .map_err(hpke_error)?;
    Ok(SealedMlDsaRootTransferV1 {
        encapsulated_key_b64u: Base64UrlUnpadded::encode_string(encapsulated.as_ref()),
        ciphertext_b64u: Base64UrlUnpadded::encode_string(&ciphertext),
        binding_digest_b64u: Base64UrlUnpadded::encode_string(&sha256_digest(&aad)),
        ciphertext_digest_b64u: Base64UrlUnpadded::encode_string(&sha256_digest(&ciphertext)),
    })
}

/// Frozen canonical FIPS seed derivation, shared by ordinary and linked exports.
pub fn canonical_seed(root: &[u8; 32]) -> Zeroizing<[u8; 32]> {
    let mut hash = sha3::Shake256::default();
    hash.update(b"seams/ml-dsa-65/canonical-seed/v1");
    hash.update(root);
    let mut seed = Zeroizing::new([0; 32]);
    hash.finalize_xof().read(seed.as_mut());
    seed
}
fn validate_root_identity(wallet_id: &str, root: &MlDsa65OwnerRootBindingV1) -> CoreResult<()> {
    for value in [
        wallet_id,
        &root.link_session_id,
        &root.wallet_key_id,
        &root.ml_dsa_signing_key_id,
        &root.enrollment_id,
        &root.device_id,
    ] {
        canonical_id(value)?;
    }
    if root.wallet_key_id
        != format!(
            "wallet-key:ml-dsa:{wallet_id}:{}",
            root.ml_dsa_signing_key_id
        )
    {
        return Err(invalid("The ML-DSA wallet-key identity differs"));
    }
    if decode_fixed::<32>(&root.application_binding_digest_b64u)?
        != compute_ml_dsa65_application_binding_digest_v1(wallet_id, &root.ml_dsa_signing_key_id)?
    {
        return Err(invalid("The ML-DSA application binding differs"));
    }
    let public = decode_fixed::<1952>(&root.registered_public_key_b64u)?;
    verify_registered_wallet_key_set_manifest_v1(
        &WalletKeySetManifestV1::NearMlDsa65 {
            wallet_id: wallet_id.to_owned(),
            ml_dsa65_signing_key_id: root.ml_dsa_signing_key_id.clone(),
            registered_public_key: Box::new(public),
        },
        &decode_fixed::<32>(&root.key_manifest_digest_b64u)?,
    )?;
    Ok(())
}
fn canonical_id(value: &str) -> CoreResult<()> {
    if value.is_empty()
        || value.len() > 512
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(invalid("Invalid ML-DSA transfer identity"));
    }
    Ok(())
}
fn decode_fixed<const N: usize>(value: &str) -> CoreResult<[u8; N]> {
    if value.len() > N.div_ceil(3) * 4 {
        return Err(invalid("Invalid ML-DSA binding length"));
    }
    Base64UrlUnpadded::decode_vec(value)
        .map_err(|_| invalid("Invalid ML-DSA base64url"))?
        .try_into()
        .map_err(|_| invalid("Invalid ML-DSA binding length"))
}
fn decode_ciphertext(package: &SealedMlDsaRootTransferV1) -> CoreResult<[u8; 48]> {
    decode_fixed(&package.ciphertext_b64u)
}
fn invalid(message: &str) -> SignerCoreError {
    SignerCoreError::invalid_input(message)
}
