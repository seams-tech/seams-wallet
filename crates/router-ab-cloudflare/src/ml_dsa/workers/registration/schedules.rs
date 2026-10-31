use super::*;
use std::sync::OnceLock;

pub(super) use ml_dsa_threshold::circuits::KEY_GENERATION_DIGEST as DIGEST;

static SCHEDULES: OnceLock<Result<Vec<TrustedMlDsaSchedule<'static>>>> = OnceLock::new();

pub(super) fn load() -> Result<&'static [TrustedMlDsaSchedule<'static>]> {
    match SCHEDULES.get_or_init(validate) {
        Ok(schedules) => Ok(schedules),
        Err(error) => Err(error.clone()),
    }
}

fn validate() -> Result<Vec<TrustedMlDsaSchedule<'static>>> {
    ml_dsa_threshold::circuits::KEY_GENERATION
        .iter()
        .map(ml_dsa_threshold::circuits::Circuit::parse)
        .collect::<::core::result::Result<Vec<_>, _>>()
        .map_err(runtime_error)
}
