use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::schnorr::{Signature as Bip340Signature, VerifyingKey as Bip340VerifyingKey};
use k256::{ProjectivePoint, PublicKey, SecretKey};
use sha3::{Digest, Keccak256};

use crate::error::{CoreResult, SignerCoreError};

pub fn validate_secp256k1_public_key_33(public_key33: &[u8]) -> CoreResult<Vec<u8>> {
    if public_key33.len() != 33 {
        return Err(SignerCoreError::invalid_length(format!(
            "public_key33 must be 33 bytes (got {})",
            public_key33.len()
        )));
    }
    let key = PublicKey::from_sec1_bytes(public_key33)
        .map_err(|_| SignerCoreError::decode_error("invalid compressed secp256k1 public key"))?;
    let encoded = key.to_encoded_point(true);
    let bytes = encoded.as_bytes();
    if bytes.len() != 33 {
        return Err(SignerCoreError::invalid_length(format!(
            "compressed secp256k1 public key must encode to 33 bytes (got {})",
            bytes.len()
        )));
    }
    if bytes != public_key33 {
        return Err(SignerCoreError::decode_error(
            "compressed secp256k1 public key must use canonical SEC1 encoding",
        ));
    }
    Ok(bytes.to_vec())
}

pub fn add_secp256k1_public_keys_33(left33: &[u8], right33: &[u8]) -> CoreResult<Vec<u8>> {
    let left = PublicKey::from_sec1_bytes(left33).map_err(|_| {
        SignerCoreError::decode_error("left33 is not a valid compressed secp256k1 public key")
    })?;
    let right = PublicKey::from_sec1_bytes(right33).map_err(|_| {
        SignerCoreError::decode_error("right33 is not a valid compressed secp256k1 public key")
    })?;

    let sum = (ProjectivePoint::from(*left.as_affine())
        + ProjectivePoint::from(*right.as_affine()))
    .to_affine();
    let encoded = sum.to_encoded_point(true);
    let bytes = encoded.as_bytes();
    if bytes.len() != 33 {
        return Err(SignerCoreError::invalid_length(format!(
            "sum of secp256k1 public keys must encode to 33 bytes (got {})",
            bytes.len()
        )));
    }
    Ok(bytes.to_vec())
}

pub fn secp256k1_private_key_32_to_public_key_33(private_key32: &[u8]) -> CoreResult<Vec<u8>> {
    if private_key32.len() != 32 {
        return Err(SignerCoreError::invalid_length(format!(
            "private_key32 must be 32 bytes (got {})",
            private_key32.len()
        )));
    }
    let secret_key = SecretKey::from_slice(private_key32)
        .map_err(|_| SignerCoreError::crypto_error("invalid secp256k1 private key"))?;
    let encoded = secret_key.public_key().to_encoded_point(true);
    let bytes = encoded.as_bytes();
    if bytes.len() != 33 {
        return Err(SignerCoreError::invalid_length(format!(
            "compressed secp256k1 public key must encode to 33 bytes (got {})",
            bytes.len()
        )));
    }
    Ok(bytes.to_vec())
}

pub fn secp256k1_public_key_33_to_ethereum_address_20(public_key33: &[u8]) -> CoreResult<Vec<u8>> {
    if public_key33.len() != 33 {
        return Err(SignerCoreError::invalid_length(format!(
            "public_key33 must be 33 bytes (got {})",
            public_key33.len()
        )));
    }
    let key = PublicKey::from_sec1_bytes(public_key33)
        .map_err(|_| SignerCoreError::decode_error("invalid compressed secp256k1 public key"))?;
    let uncompressed = key.to_encoded_point(false);
    let uncompressed = uncompressed.as_bytes();
    if uncompressed.len() != 65 || uncompressed[0] != 0x04 {
        return Err(SignerCoreError::invalid_length(format!(
            "uncompressed secp256k1 public key must be 65 bytes with 0x04 prefix (got {})",
            uncompressed.len()
        )));
    }

    let mut hasher = Keccak256::new();
    hasher.update(&uncompressed[1..]);
    let digest = hasher.finalize();
    Ok(digest[digest.len() - 20..].to_vec())
}

pub fn sign_secp256k1_recoverable(digest32: &[u8], private_key32: &[u8]) -> CoreResult<Vec<u8>> {
    if digest32.len() != 32 {
        return Err(SignerCoreError::invalid_length("digest32 must be 32 bytes"));
    }
    if private_key32.len() != 32 {
        return Err(SignerCoreError::invalid_length(
            "privateKey must be 32 bytes",
        ));
    }

    let sk = SecretKey::from_slice(private_key32)
        .map_err(|_| SignerCoreError::crypto_error("invalid secp256k1 private key"))?;
    let signing_key: SigningKey = sk.into();
    let (sig, recid) = signing_key
        .sign_prehash_recoverable(digest32)
        .map_err(|_| SignerCoreError::crypto_error("secp256k1 signing failed"))?;

    // Ethereum requires low-s normalized signatures (EIP-2).
    // When normalizing s -> n-s, the recovery id flips parity.
    let (sig, recid) = match sig.normalize_s() {
        Some(normalized) => {
            let flipped = RecoveryId::from_byte(recid.to_byte() ^ 1)
                .ok_or_else(|| SignerCoreError::internal("invalid recovery id"))?;
            (normalized, flipped)
        }
        None => (sig, recid),
    };

    let r_bytes = sig.r().to_bytes();
    let s_bytes = sig.s().to_bytes();
    let mut out = Vec::with_capacity(65);
    out.extend_from_slice(&r_bytes);
    out.extend_from_slice(&s_bytes);
    out.push(recid.to_byte());
    Ok(out)
}

pub fn verify_secp256k1_recoverable_signature_against_public_key_33(
    digest32: &[u8],
    signature65: &[u8],
    public_key33: &[u8],
) -> CoreResult<Vec<u8>> {
    if digest32.len() != 32 {
        return Err(SignerCoreError::invalid_length("digest32 must be 32 bytes"));
    }
    if signature65.len() != 65 {
        return Err(SignerCoreError::invalid_length(
            "signature65 must be 65 bytes",
        ));
    }

    let expected_vk = VerifyingKey::from_sec1_bytes(public_key33)
        .map_err(|_| SignerCoreError::decode_error("invalid compressed secp256k1 public key"))?;
    let signature = Signature::from_slice(&signature65[0..64])
        .map_err(|_| SignerCoreError::decode_error("invalid secp256k1 signature scalars"))?;
    let recid = RecoveryId::from_byte(signature65[64])
        .ok_or_else(|| SignerCoreError::decode_error("invalid secp256k1 recovery id"))?;
    let recovered = VerifyingKey::recover_from_prehash(digest32, &signature, recid)
        .map_err(|_| SignerCoreError::crypto_error("secp256k1 signature recovery failed"))?;

    let recovered_bytes = recovered.to_encoded_point(true);
    let expected_bytes = expected_vk.to_encoded_point(true);
    if recovered_bytes.as_bytes() != expected_bytes.as_bytes() {
        return Err(SignerCoreError::crypto_error(
            "recovered secp256k1 public key did not match expected key",
        ));
    }
    Ok(recovered_bytes.as_bytes().to_vec())
}

/// Verifies a canonical BIP340 signature over a prehashed digest against a
/// compressed SEC1 public key. The SEC1 prefix is validated before BIP340's
/// x-only verification so the challenge remains bound to the exact parity.
pub fn verify_secp256k1_bip340_signature_against_public_key_33(
    digest32: &[u8],
    signature64: &[u8],
    public_key33: &[u8],
) -> CoreResult<()> {
    if digest32.len() != 32 {
        return Err(SignerCoreError::invalid_length("digest32 must be 32 bytes"));
    }
    if signature64.len() != 64 {
        return Err(SignerCoreError::invalid_length(
            "signature64 must be 64 bytes",
        ));
    }
    if public_key33.len() != 33 {
        return Err(SignerCoreError::invalid_length(
            "public_key33 must be 33 bytes",
        ));
    }
    let expected_public_key = PublicKey::from_sec1_bytes(public_key33)
        .map_err(|_| SignerCoreError::decode_error("invalid compressed secp256k1 public key"))?;
    let expected_public_key_bytes = expected_public_key.to_encoded_point(true);
    if expected_public_key_bytes.as_bytes() != public_key33 {
        return Err(SignerCoreError::decode_error(
            "compressed secp256k1 public key must use canonical SEC1 encoding",
        ));
    }
    let verifying_key = Bip340VerifyingKey::from_bytes(&public_key33[1..])
        .map_err(|_| SignerCoreError::decode_error("invalid BIP340 x-only public key"))?;
    let signature = Bip340Signature::try_from(signature64)
        .map_err(|_| SignerCoreError::decode_error("invalid BIP340 signature"))?;
    verifying_key
        .verify_raw(digest32, &signature)
        .map_err(|_| SignerCoreError::crypto_error("BIP340 signature verification failed"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::{Signature, VerifyingKey};
    use k256::elliptic_curve::sec1::ToEncodedPoint;
    use k256::schnorr::SigningKey as Bip340SigningKey;
    use k256::SecretKey;

    #[test]
    fn add_secp256k1_public_keys_matches_scalar_sum() {
        let mut sk1_bytes = [0u8; 32];
        sk1_bytes[31] = 1;
        let mut sk2_bytes = [0u8; 32];
        sk2_bytes[31] = 2;
        let mut sk3_bytes = [0u8; 32];
        sk3_bytes[31] = 3;

        let sk1 = SecretKey::from_slice(&sk1_bytes).expect("sk1");
        let sk2 = SecretKey::from_slice(&sk2_bytes).expect("sk2");
        let sk3 = SecretKey::from_slice(&sk3_bytes).expect("sk3");

        let pk1 = sk1.public_key().to_encoded_point(true).as_bytes().to_vec();
        let pk2 = sk2.public_key().to_encoded_point(true).as_bytes().to_vec();
        let expected = sk3.public_key().to_encoded_point(true).as_bytes().to_vec();

        let summed = add_secp256k1_public_keys_33(&pk1, &pk2).expect("sum");
        assert_eq!(summed, expected);

        let validated = validate_secp256k1_public_key_33(&pk1).expect("validate");
        assert_eq!(validated.len(), 33);
    }

    #[test]
    fn private_key_32_to_public_key_33_matches_secret_key_derivation() {
        let mut sk_bytes = [0u8; 32];
        sk_bytes[31] = 7;

        let expected = SecretKey::from_slice(&sk_bytes)
            .expect("secret key")
            .public_key()
            .to_encoded_point(true)
            .as_bytes()
            .to_vec();
        let derived =
            secp256k1_private_key_32_to_public_key_33(&sk_bytes).expect("derive public key");
        assert_eq!(derived, expected);
    }

    #[test]
    fn sign_secp256k1_recoverable_produces_low_s_and_valid_recovery_id() {
        let mut sk_bytes = [0u8; 32];
        sk_bytes[31] = 7;
        let mut digest = [0u8; 32];
        digest[31] = 9;

        let out = sign_secp256k1_recoverable(digest.as_slice(), sk_bytes.as_slice()).expect("sign");
        assert_eq!(out.len(), 65);

        let sig = Signature::from_slice(&out[..64])
            .expect("signature bytes must decode into secp256k1 sig");
        let recid = RecoveryId::from_byte(out[64]).expect("recovery id");
        assert!(
            sig.normalize_s().is_none(),
            "signature should already be low-s normalized",
        );

        let recovered =
            VerifyingKey::recover_from_prehash(&digest, &sig, recid).expect("recover key from sig");
        let expected = SecretKey::from_slice(&sk_bytes)
            .expect("sk")
            .public_key()
            .to_encoded_point(true)
            .as_bytes()
            .to_vec();
        assert_eq!(
            recovered.to_encoded_point(true).as_bytes().to_vec(),
            expected,
            "recovered key must match signer key",
        );
    }

    #[test]
    fn verify_recoverable_signature_against_public_key_33_roundtrips() {
        let mut sk_bytes = [0u8; 32];
        sk_bytes[31] = 7;
        let mut digest = [0u8; 32];
        digest[0] = 1;
        digest[31] = 9;

        let signature65 =
            sign_secp256k1_recoverable(digest.as_slice(), sk_bytes.as_slice()).expect("sign");
        let public_key33 =
            secp256k1_private_key_32_to_public_key_33(&sk_bytes).expect("derive public key");

        let verified = verify_secp256k1_recoverable_signature_against_public_key_33(
            digest.as_slice(),
            signature65.as_slice(),
            public_key33.as_slice(),
        )
        .expect("verify");
        assert_eq!(verified, public_key33);
    }

    #[test]
    fn verify_bip340_signature_against_public_key_33_roundtrips() {
        let mut secret32 = [0u8; 32];
        secret32[31] = 7;
        let public_key33: [u8; 33] = SecretKey::from_slice(&secret32)
            .expect("secret key")
            .public_key()
            .to_encoded_point(true)
            .as_bytes()
            .try_into()
            .expect("compressed public key");
        let digest32 = [0x42; 32];
        let signature = Bip340SigningKey::from_bytes(&secret32)
            .expect("BIP340 signing key")
            .sign_prehash_with_aux_rand(&digest32, &[0x5a; 32])
            .expect("BIP340 signature");

        verify_secp256k1_bip340_signature_against_public_key_33(
            &digest32,
            &signature.to_bytes(),
            &public_key33,
        )
        .expect("BIP340 signature verifies");

        let mut wrong_digest = digest32;
        wrong_digest[0] ^= 1;
        assert!(verify_secp256k1_bip340_signature_against_public_key_33(
            &wrong_digest,
            &signature.to_bytes(),
            &public_key33,
        )
        .is_err());
    }
}
