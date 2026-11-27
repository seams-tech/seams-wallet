use super::admission_tests::*;
use super::live_execution_tests::test_provider_config;
use super::tests::InMemoryProvider;
use super::*;
use rand_chacha::ChaCha20Rng;
use rand_core_06::SeedableRng;

/// The progress enum derives Debug, so pin that the derive cannot print
/// share material: a future field that is not itself redacting would be
/// caught here rather than in a log.
#[test]
fn the_progress_debug_never_prints_share_material() {
    let mut online = InMemoryProvider::new();
    let mut backup = InMemoryProvider::new();
    let progress = futures::executor::block_on(execute_tenant_root_role_creation_v1(
        &package_bytes(TwoPartyDeriverRole::DeriverA, &ISSUER_KEY),
        None,
        TwoPartyDeriverRole::DeriverA,
        authority(),
        &trusted_issuer_keys(),
        &test_role_keys(),
        &signer(TwoPartyDeriverRole::DeriverA),
        &test_provider_config(),
        &mut online,
        &mut backup,
        ISSUED_AT_MS + 2,
        &mut ChaCha20Rng::from_seed([0x77; 32]),
    ))
    .expect("committed");
    let rendered = format!("{progress:?}");
    assert!(
        rendered.contains("[redacted]"),
        "the share must render redacted, got: {rendered}"
    );
}
