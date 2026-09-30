mod support {
    pub mod ui;
}

use ed25519_yao_generator::{
    evaluate_activation, evaluate_full_clear_reference_export_v1,
    reconstruct_host_only_client_scalar_output_v1, reconstruct_host_only_seed_export_v1,
    reconstruct_host_only_signing_worker_scalar_output_v1, share_host_only_activation_outputs_v1,
    share_host_only_export_seed_v1, ActivationOracleOutput, DeriverAContribution,
    DeriverBContribution, ExportOracleOutput, HostOnlyActivationOutputCoinsV1,
    HostOnlyClientScalarOutputCoinV1, HostOnlyDeriverAClientScalarShareV1,
    HostOnlyDeriverASeedExportShareV1, HostOnlyDeriverASigningWorkerScalarShareV1,
    HostOnlyDeriverBClientScalarShareV1, HostOnlyDeriverBSeedExportShareV1,
    HostOnlyDeriverBSigningWorkerScalarShareV1, HostOnlyOutputSharingErrorV1,
    HostOnlySeedOutputCoinV1, HostOnlySigningWorkerScalarOutputCoinV1, RawDeriverAContribution,
    RawDeriverBContribution,
};

use support::ui::{assert_compile_failure, UiHarness};

const SCALAR_ORDER_BYTES: [u8; 32] = [
    0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
];
const SCALAR_ORDER_MINUS_ONE_BYTES: [u8; 32] = [
    0xec, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
];
const SCALAR_ORDER_MINUS_TWO_BYTES: [u8; 32] = [
    0xeb, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
];

fn scalar_bytes(value: u64) -> [u8; 32] {
    let mut output = [0u8; 32];
    output[..8].copy_from_slice(&value.to_le_bytes());
    output
}

fn oracle_outputs() -> (ActivationOracleOutput, ExportOracleOutput) {
    let deriver_a = DeriverAContribution::try_from(RawDeriverAContribution {
        y_client: [0x11; 32],
        y_server: [0x22; 32],
        tau_client: scalar_bytes(3),
        tau_server: scalar_bytes(5),
    })
    .expect("valid Deriver A fixture contribution");
    let deriver_b = DeriverBContribution::try_from(RawDeriverBContribution {
        y_client: [0x33; 32],
        y_server: [0x44; 32],
        tau_client: scalar_bytes(7),
        tau_server: scalar_bytes(11),
    })
    .expect("valid Deriver B fixture contribution");

    (
        evaluate_activation(&deriver_a, &deriver_b),
        evaluate_full_clear_reference_export_v1(&deriver_a, &deriver_b),
    )
}

fn independent_wrapping_sub_le_256(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut output = [0u8; 32];
    let mut borrow = false;

    for index in 0..32 {
        let (without_borrow, value_borrow) = left[index].overflowing_sub(right[index]);
        let (difference, incoming_borrow) = without_borrow.overflowing_sub(u8::from(borrow));
        output[index] = difference;
        borrow = value_borrow || incoming_borrow;
    }

    output
}

fn accept_deriver_a_client_share(_: &HostOnlyDeriverAClientScalarShareV1) {}

fn accept_deriver_b_client_share(_: &HostOnlyDeriverBClientScalarShareV1) {}

fn accept_deriver_a_signing_worker_share(_: &HostOnlyDeriverASigningWorkerScalarShareV1) {}

fn accept_deriver_b_signing_worker_share(_: &HostOnlyDeriverBSigningWorkerScalarShareV1) {}

fn accept_deriver_a_seed_share(_: &HostOnlyDeriverASeedExportShareV1) {}

fn accept_deriver_b_seed_share(_: &HostOnlyDeriverBSeedExportShareV1) {}

#[test]
fn scalar_output_coins_validate_their_independent_canonical_domains() {
    for bytes in [[0u8; 32], SCALAR_ORDER_MINUS_ONE_BYTES] {
        let client = HostOnlyClientScalarOutputCoinV1::from_canonical_fixture_bytes(bytes)
            .expect("canonical client coin");
        let signing_worker =
            HostOnlySigningWorkerScalarOutputCoinV1::from_canonical_fixture_bytes(bytes)
                .expect("canonical SigningWorker coin");
        assert_eq!(client.expose_fixture_bytes(), bytes);
        assert_eq!(signing_worker.expose_fixture_bytes(), bytes);
    }

    for bytes in [SCALAR_ORDER_BYTES, [0xff; 32]] {
        assert!(matches!(
            HostOnlyClientScalarOutputCoinV1::from_canonical_fixture_bytes(bytes),
            Err(HostOnlyOutputSharingErrorV1::NonCanonicalClientScalarOutputCoin)
        ));
        assert!(matches!(
            HostOnlySigningWorkerScalarOutputCoinV1::from_canonical_fixture_bytes(bytes),
            Err(HostOnlyOutputSharingErrorV1::NonCanonicalSigningWorkerScalarOutputCoin)
        ));
    }
}

#[test]
fn activation_shares_reconstruct_both_outputs_through_typed_role_views() {
    let (output, _) = oracle_outputs();

    for (client_bytes, signing_worker_bytes) in [
        ([0u8; 32], [0u8; 32]),
        (scalar_bytes(1), scalar_bytes(2)),
        (SCALAR_ORDER_MINUS_ONE_BYTES, SCALAR_ORDER_MINUS_TWO_BYTES),
    ] {
        let coins = HostOnlyActivationOutputCoinsV1::new(
            HostOnlyClientScalarOutputCoinV1::from_canonical_fixture_bytes(client_bytes)
                .expect("canonical client coin"),
            HostOnlySigningWorkerScalarOutputCoinV1::from_canonical_fixture_bytes(
                signing_worker_bytes,
            )
            .expect("canonical SigningWorker coin"),
        );
        assert_eq!(coins.client().expose_fixture_bytes(), client_bytes);
        assert_eq!(
            coins.signing_worker().expose_fixture_bytes(),
            signing_worker_bytes
        );

        let shares = share_host_only_activation_outputs_v1(&output, coins);
        accept_deriver_a_client_share(shares.deriver_a().client());
        accept_deriver_b_client_share(shares.deriver_b().client());
        accept_deriver_a_signing_worker_share(shares.deriver_a().signing_worker());
        accept_deriver_b_signing_worker_share(shares.deriver_b().signing_worker());
        assert_eq!(
            shares.deriver_a().client().expose_fixture_bytes(),
            client_bytes
        );
        assert_eq!(
            shares.deriver_a().signing_worker().expose_fixture_bytes(),
            signing_worker_bytes
        );
        assert_eq!(
            reconstruct_host_only_client_scalar_output_v1(
                shares.deriver_a().client(),
                shares.deriver_b().client(),
            )
            .expose_bytes(),
            output.material().x_client_base().expose_bytes()
        );
        assert_eq!(
            reconstruct_host_only_signing_worker_scalar_output_v1(
                shares.deriver_a().signing_worker(),
                shares.deriver_b().signing_worker(),
            )
            .expose_bytes(),
            output.material().x_server_base().expose_bytes()
        );
    }
}

#[test]
fn export_seed_shares_reconstruct_zero_one_and_wraparound_coins() {
    let (_, output) = oracle_outputs();
    let seed = output.seed().expose_bytes();

    for coin_bytes in [[0u8; 32], scalar_bytes(1), [0xff; 32]] {
        let coin = HostOnlySeedOutputCoinV1::from_fixture_bytes(coin_bytes);
        assert_eq!(coin.expose_fixture_bytes(), coin_bytes);

        let shares = share_host_only_export_seed_v1(&output, coin);
        accept_deriver_a_seed_share(shares.deriver_a());
        accept_deriver_b_seed_share(shares.deriver_b());
        assert_eq!(shares.deriver_a().expose_fixture_bytes(), coin_bytes);
        assert_eq!(
            shares.deriver_b().expose_fixture_bytes(),
            independent_wrapping_sub_le_256(seed, coin_bytes)
        );
        assert_eq!(
            reconstruct_host_only_seed_export_v1(shares.deriver_a(), shares.deriver_b())
                .expose_bytes(),
            seed
        );
    }
}

#[test]
fn compile_fail_guards_reject_role_recipient_and_request_family_mixups() {
    let harness = UiHarness::create("output-sharing");
    let control = harness.check(
        "use ed25519_yao_generator::{HostOnlyClientScalarOutputCoinV1, HostOnlySigningWorkerScalarOutputCoinV1};\n\
         fn main() {\n\
             let _ = HostOnlyClientScalarOutputCoinV1::from_canonical_fixture_bytes([0; 32]).unwrap();\n\
             let _ = HostOnlySigningWorkerScalarOutputCoinV1::from_canonical_fixture_bytes([0; 32]).unwrap();\n\
         }",
    );
    assert!(
        control.status.success(),
        "UI control failed:\n{}",
        String::from_utf8_lossy(&control.stderr)
    );

    for (body, code) in [
        (
            "use ed25519_yao_generator::*;\n\
             fn invalid(client: HostOnlyClientScalarOutputCoinV1, signing_worker: HostOnlySigningWorkerScalarOutputCoinV1) {\n\
                 let _ = HostOnlyActivationOutputCoinsV1::new(signing_worker, client);\n\
             }\nfn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::*;\n\
             fn invalid(a: &HostOnlyDeriverASigningWorkerScalarShareV1, b: &HostOnlyDeriverBClientScalarShareV1) {\n\
                 let _ = reconstruct_host_only_client_scalar_output_v1(a, b);\n\
             }\nfn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::*;\n\
             fn invalid(a: &HostOnlyDeriverBClientScalarShareV1, b: &HostOnlyDeriverBClientScalarShareV1) {\n\
                 let _ = reconstruct_host_only_client_scalar_output_v1(a, b);\n\
             }\nfn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::*;\n\
             fn invalid(output: &ActivationOracleOutput, coin: HostOnlySeedOutputCoinV1) {\n\
                 let _ = share_host_only_export_seed_v1(output, coin);\n\
             }\nfn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::*;\n\
             fn invalid(output: &ExportOracleOutput, coins: HostOnlyActivationOutputCoinsV1) {\n\
                 let _ = share_host_only_activation_outputs_v1(output, coins);\n\
             }\nfn main() {}",
            "E0308",
        ),
        (
            "use ed25519_yao_generator::HostOnlyActivationOutputSharesV1;\n\
             fn invalid(shares: &HostOnlyActivationOutputSharesV1) { let _ = shares.seed(); }\nfn main() {}",
            "E0599",
        ),
        (
            "use ed25519_yao_generator::HostOnlySeedExportSharesV1;\n\
             fn invalid(shares: &HostOnlySeedExportSharesV1) { let _ = shares.signing_worker(); }\nfn main() {}",
            "E0599",
        ),
    ] {
        assert_compile_failure(&harness, body, code);
    }

    let private_constructors = harness.check(
        "use ed25519_yao_generator::{\n\
             HostOnlyDeriverAClientScalarShareV1, HostOnlyDeriverBClientScalarShareV1,\n\
             HostOnlyDeriverASigningWorkerScalarShareV1, HostOnlyDeriverBSigningWorkerScalarShareV1,\n\
             HostOnlyDeriverASeedExportShareV1, HostOnlyDeriverBSeedExportShareV1,\n\
         };\n\
         fn main() {\n\
             let _ = HostOnlyDeriverAClientScalarShareV1;\n\
             let _ = HostOnlyDeriverBClientScalarShareV1;\n\
             let _ = HostOnlyDeriverASigningWorkerScalarShareV1;\n\
             let _ = HostOnlyDeriverBSigningWorkerScalarShareV1;\n\
             let _ = HostOnlyDeriverASeedExportShareV1;\n\
             let _ = HostOnlyDeriverBSeedExportShareV1;\n\
         }",
    );
    assert!(
        !private_constructors.status.success(),
        "private share constructors unexpectedly compiled"
    );
    let stderr = String::from_utf8_lossy(&private_constructors.stderr);
    assert!(
        stderr.contains("E0423"),
        "missing private-field error:\n{stderr}"
    );
    for share_type in [
        "HostOnlyDeriverAClientScalarShareV1",
        "HostOnlyDeriverBClientScalarShareV1",
        "HostOnlyDeriverASigningWorkerScalarShareV1",
        "HostOnlyDeriverBSigningWorkerScalarShareV1",
        "HostOnlyDeriverASeedExportShareV1",
        "HostOnlyDeriverBSeedExportShareV1",
    ] {
        assert!(
            stderr.contains(share_type),
            "UI diagnostics did not cover private constructor {share_type}:\n{stderr}"
        );
    }
}
