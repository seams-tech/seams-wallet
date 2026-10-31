//! Pinned public circuits. No benchmark key, root share, or nonce enters this module.
use super::*;
use ml_dsa_threshold::runtime::boolean_mpc::prepared::PublicTopologies;
use ml_dsa_threshold::runtime::TrustedMlDsaSchedule;
use std::sync::OnceLock;

pub(super) use ml_dsa_threshold::circuits::SIGNING_DIGEST as DIGEST;

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
    ml_dsa_threshold::circuits::SIGNING
        .iter()
        .map(ml_dsa_threshold::circuits::Circuit::parse)
        .collect::<core::result::Result<Vec<_>, _>>()
        .map_err(|_| invalid("Invalid pinned ML-DSA schedule"))
}
