use super::*;
pub(super) fn load() -> Result<Vec<TrustedMlDsaSchedule<'static>>> {
    Ok(vec![
        TrustedMlDsaSchedule::parse(include_bytes!("../../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/wallet-seed.bin"), [7, 80, 9, 109, 60, 227, 11, 4, 223, 96, 55, 70, 127, 47, 80, 96, 69, 253, 91, 16, 157, 163, 146, 37, 154, 110, 91, 164, 222, 12, 79, 169]).map_err(runtime_error)?,
        TrustedMlDsaSchedule::parse(include_bytes!("../../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/seed.bin"), [26, 116, 97, 234, 191, 125, 35, 215, 129, 69, 114, 17, 224, 53, 212, 207, 179, 16, 161, 66, 43, 6, 228, 52, 145, 190, 33, 172, 8, 34, 246, 87]).map_err(runtime_error)?,
        TrustedMlDsaSchedule::parse(include_bytes!("../../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/sampling-two-blocks.bin"), [56, 221, 72, 167, 68, 67, 247, 57, 62, 72, 242, 116, 165, 122, 101, 206, 221, 245, 121, 255, 81, 70, 61, 15, 236, 15, 65, 103, 128, 79, 185, 110]).map_err(runtime_error)?,
        TrustedMlDsaSchedule::parse(include_bytes!("../../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/sampling-three-blocks.bin"), [36, 242, 79, 44, 207, 206, 136, 173, 61, 155, 162, 169, 118, 9, 217, 250, 36, 180, 104, 100, 197, 54, 26, 45, 102, 222, 135, 119, 201, 177, 113, 255]).map_err(runtime_error)?,
        TrustedMlDsaSchedule::parse(include_bytes!("../../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/sampling-final-bound.bin"), [168, 78, 20, 93, 214, 36, 54, 24, 108, 123, 95, 98, 0, 165, 152, 26, 239, 109, 129, 1, 251, 245, 19, 2, 111, 29, 30, 138, 211, 77, 70, 214]).map_err(runtime_error)?,
    ])
}
