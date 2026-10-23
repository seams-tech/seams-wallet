//! Pinned public circuits. No benchmark key, root share, or nonce enters this module.
use super::*;
use ed25519_yao::ml_dsa_runtime::boolean_comparison::prepared::PublicTopologies;
use ed25519_yao::ml_dsa_runtime::TrustedMlDsaSchedule;
use std::sync::OnceLock;

// Hash of the ordered, pinned circuit digests. Participants validate the full circuits.
pub(super) const DIGEST: [u8; 32] = [247, 112, 70, 82, 98, 238, 136, 1, 220, 224, 124, 142, 51, 207, 97, 224, 103, 33, 181, 156, 87, 209, 167, 162, 96, 196, 166, 224, 10, 228, 25, 82];

static SCHEDULES: OnceLock<Result<Vec<TrustedMlDsaSchedule<'static>>>> = OnceLock::new();
thread_local! {
    static TOPOLOGIES: RefCell<PublicTopologies> = RefCell::new(PublicTopologies::default());
}

fn fork_topologies(cache: &RefCell<PublicTopologies>) -> PublicTopologies {
    cache.borrow().fork()
}
pub(super) fn public_topologies() -> PublicTopologies {
    TOPOLOGIES.with(fork_topologies)
}
pub(super) fn retain_public_topologies(topologies: &PublicTopologies) {
    TOPOLOGIES.replace(topologies.fork());
}

pub(super) fn is_loaded() -> bool {
    SCHEDULES.get().is_some()
}

pub(super) fn load() -> Result<&'static [TrustedMlDsaSchedule<'static>]> {
    match SCHEDULES.get_or_init(validate) {
        Ok(schedules) => Ok(schedules),
        Err(error) => Err(error.clone()),
    }
}

fn validate() -> Result<Vec<TrustedMlDsaSchedule<'static>>> {
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
                34, 216, 242, 37, 85, 236, 1, 73, 206, 21, 137, 19, 68, 54, 114, 21, 10, 80, 145,
                174, 140, 61, 146, 16, 241, 39, 247, 183, 208, 158, 4, 182,
            ],
        )
        .map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?,
    );
    schedules.push(TrustedMlDsaSchedule::parse(include_bytes!("../../../../ed25519-yao-cloudflare-bench/src/ml_dsa_schedules/low-response-check.bin"), [173, 99, 238, 145, 102, 21, 50, 176, 168, 76, 136, 63, 143, 40, 154, 138, 41, 15, 246, 246, 130, 232, 14, 146, 211, 190, 213, 51, 236, 76, 166, 135]).map_err(|_| invalid("Invalid pinned ML-DSA schedule"))?);
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
