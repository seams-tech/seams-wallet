//! Pinned public circuits. No benchmark key, root share, or nonce enters this module.
use super::*;
use ed25519_yao::ml_dsa_runtime::TrustedMlDsaSchedule;
pub(super) fn load() -> Result<Vec<TrustedMlDsaSchedule<'static>>> {
    let mut schedules = Vec::new();
    schedules.push(
        TrustedMlDsaSchedule::parse(
            include_bytes!(
                "../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/fresh-mask.bin"
            ),
            [
                249, 200, 2, 127, 189, 150, 141, 85, 250, 4, 24, 208, 71, 62, 17, 235, 81, 28, 25,
                178, 65, 141, 78, 163, 86, 167, 155, 210, 156, 114, 165, 237,
            ],
        )
        .map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?,
    );
    schedules.push(TrustedMlDsaSchedule::parse(include_bytes!("../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/prepared-commitment.bin"), [181, 121, 245, 123, 8, 158, 126, 211, 26, 190, 122, 150, 148, 14, 168, 120, 117, 2, 243, 2, 153, 114, 245, 67, 111, 102, 109, 91, 36, 64, 67, 46]).map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?);
    schedules.push(
        TrustedMlDsaSchedule::parse(
            include_bytes!(
                "../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/commitment-hash.bin"
            ),
            [
                92, 241, 146, 151, 32, 104, 19, 94, 151, 208, 202, 145, 115, 18, 30, 125, 218, 145,
                189, 73, 217, 243, 1, 182, 59, 37, 68, 199, 138, 72, 131, 97,
            ],
        )
        .map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?,
    );
    schedules.push(
        TrustedMlDsaSchedule::parse(
            include_bytes!(
                "../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/response-check.bin"
            ),
            [
                39, 133, 213, 242, 98, 147, 226, 38, 199, 65, 69, 230, 19, 39, 68, 198, 128, 151,
                98, 95, 196, 149, 236, 227, 69, 189, 105, 67, 56, 240, 53, 6,
            ],
        )
        .map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?,
    );
    schedules.push(TrustedMlDsaSchedule::parse(include_bytes!("../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/low-response-check.bin"), [194, 92, 145, 212, 134, 214, 252, 28, 82, 223, 212, 173, 60, 129, 83, 104, 20, 246, 8, 11, 148, 153, 5, 103, 207, 46, 217, 7, 215, 160, 86, 149]).map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?);
    schedules.push(
        TrustedMlDsaSchedule::parse(
            include_bytes!(
                "../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/bounds-decision.bin"
            ),
            [
                219, 233, 106, 178, 67, 85, 132, 195, 8, 46, 196, 242, 189, 223, 89, 187, 208, 89,
                175, 3, 148, 151, 209, 76, 243, 69, 0, 55, 134, 194, 20, 177,
            ],
        )
        .map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?,
    );
    Ok(schedules)
}
