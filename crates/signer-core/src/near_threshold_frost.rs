use curve25519_dalek::edwards::CompressedEdwardsY;
use curve25519_dalek::scalar::Scalar as CurveScalar;

use crate::error::{CoreResult, SignerCoreError};
use crate::near_threshold_ed25519;

fn decompress_verifying_share_point(
    bytes: [u8; 32],
    label: &str,
) -> CoreResult<curve25519_dalek::edwards::EdwardsPoint> {
    CompressedEdwardsY(bytes)
        .decompress()
        .ok_or_else(|| SignerCoreError::decode_error(format!("Invalid {label} point")))
}

fn validate_participant_ids(client_id: u16, relayer_id: u16) -> CoreResult<()> {
    if client_id == 0 {
        return Err(SignerCoreError::invalid_input(
            "clientParticipantId must be an integer in [1,65535]",
        ));
    }
    if relayer_id == 0 {
        return Err(SignerCoreError::invalid_input(
            "relayerParticipantId must be an integer in [1,65535]",
        ));
    }
    near_threshold_ed25519::validate_threshold_ed25519_participant_ids_2p(
        Some(client_id),
        Some(relayer_id),
        &[],
    )?;
    Ok(())
}

pub fn compute_threshold_ed25519_group_public_key_2p_from_verifying_shares(
    client_verifying_share_bytes: &[u8; 32],
    relayer_verifying_share_bytes: &[u8; 32],
    client_participant_id: u16,
    relayer_participant_id: u16,
) -> CoreResult<[u8; 32]> {
    validate_participant_ids(client_participant_id, relayer_participant_id)?;
    let client_point =
        decompress_verifying_share_point(*client_verifying_share_bytes, "client verifying share")?;
    let relayer_point = decompress_verifying_share_point(
        *relayer_verifying_share_bytes,
        "relayer verifying share",
    )?;

    let xc = CurveScalar::from(client_participant_id as u64);
    let xr = CurveScalar::from(relayer_participant_id as u64);
    let denom_c = xr - xc;
    let denom_r = xc - xr;
    if denom_c == CurveScalar::ZERO || denom_r == CurveScalar::ZERO {
        return Err(SignerCoreError::invalid_input(
            "clientParticipantId must differ from relayerParticipantId",
        ));
    }
    let lambda_c = xr * denom_c.invert();
    let lambda_r = xc * denom_r.invert();
    let group_point = client_point * lambda_c + relayer_point * lambda_r;
    Ok(group_point.compress().to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use curve25519_dalek::constants::ED25519_BASEPOINT_POINT;

    #[test]
    fn compute_group_public_key_interpolates_the_shares_at_zero() {
        // The shares 5 at x=1 and 7 at x=2 lie on 3 + 2x, so the group secret is 3.
        let client_bytes = (ED25519_BASEPOINT_POINT * CurveScalar::from(5u64))
            .compress()
            .to_bytes();
        let relayer_bytes = (ED25519_BASEPOINT_POINT * CurveScalar::from(7u64))
            .compress()
            .to_bytes();
        let group_bytes = compute_threshold_ed25519_group_public_key_2p_from_verifying_shares(
            &client_bytes,
            &relayer_bytes,
            1,
            2,
        )
        .expect("group public key");
        assert_eq!(
            group_bytes,
            (ED25519_BASEPOINT_POINT * CurveScalar::from(3u64))
                .compress()
                .to_bytes()
        );
    }

    #[test]
    fn compute_group_public_key_rejects_same_participant_ids() {
        let client_bytes = (ED25519_BASEPOINT_POINT * CurveScalar::from(2u64))
            .compress()
            .to_bytes();
        let relayer_bytes = (ED25519_BASEPOINT_POINT * CurveScalar::from(3u64))
            .compress()
            .to_bytes();
        let err = compute_threshold_ed25519_group_public_key_2p_from_verifying_shares(
            &client_bytes,
            &relayer_bytes,
            1,
            1,
        )
        .expect_err("same participant ids should fail");
        assert!(err.message.contains("must differ"));
    }
}
