//! Cross-runtime fixtures for the console operation record.
//!
//! The console creates operation records in TypeScript and the control plane
//! consumes their digests in Rust. Both sides must produce identical canonical
//! bytes, so the exact records and digests are generated here and committed for
//! the TypeScript side to assert against.
//!
//! Regenerate with `UPDATE_TENANT_ROOT_OPERATION_FIXTURES=1`.

use std::path::{Path, PathBuf};

use base64ct::{Base64UrlUnpadded, Encoding};
use curve25519_dalek::scalar::Scalar;
use router_ab_core::{
    TenantRootCustodyLineageId, TenantRootIdentityV1, TenantRootOperationKindV1,
    TenantRootOperationNonceV1, TenantRootOperationRecordV1, TenantRootOperationSubjectV1,
    TenantRootRecoveryGovernanceV1, TenantRootRecoverySetId,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreSessionIdV1,
};
use threshold_prf::{
    SigningRootShare, TwoPartyDeriverRole, TwoPartyRootCommitment, TwoPartyRootShareCommitments,
};

const ISSUED_AT: &str = "2026-09-05T11:58:00.000Z";
const EXPIRES_AT: &str = "2026-09-05T12:05:00.000Z";
const DOWNLOAD_EXPIRES_AT: &str = "2026-09-05T12:02:00.000Z";
const RESTORE_EXPIRES_AT: &str = "2026-09-05T12:03:00.000Z";

fn fixture_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tenant-root-operation/records.json")
}

fn identity() -> TenantRootIdentityV1 {
    TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3").unwrap()
}

fn lineage() -> TenantRootCustodyLineageId {
    TenantRootCustodyLineageId::from_bytes([0x31; 16]).unwrap()
}

fn root_commitment() -> TwoPartyRootCommitment {
    let deriver_a = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverA.share_id(),
        Scalar::from(12_u64).to_bytes(),
    )
    .unwrap();
    let deriver_b = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverB.share_id(),
        Scalar::from(19_u64).to_bytes(),
    )
    .unwrap();
    TwoPartyRootShareCommitments::from_shares(&deriver_a, &deriver_b)
        .unwrap()
        .root()
}

fn governance() -> TenantRootRecoveryGovernanceV1 {
    TenantRootRecoveryGovernanceV1::two_person("owner-1", "2026-08-01T00:00:00.000Z").unwrap()
}

fn record(
    kind: TenantRootOperationKindV1,
    subject: TenantRootOperationSubjectV1,
    role: Option<TwoPartyDeriverRole>,
    expires_at: &str,
) -> TenantRootOperationRecordV1 {
    TenantRootOperationRecordV1::new(
        kind,
        &identity(),
        lineage(),
        7,
        &governance(),
        subject,
        role,
        "owner-1",
        "idempotency-1",
        ISSUED_AT,
        expires_at,
        root_commitment(),
    )
    .expect("record")
}

fn restore_record() -> TenantRootOperationRecordV1 {
    TenantRootOperationRecordV1::new_restore_role_import_key_issue(
        &identity(),
        lineage(),
        TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
        TwoPartyDeriverRole::DeriverA,
        "owner-1",
        "restore-operation-1",
        TenantRootOperationNonceV1::from_bytes([0x51; 32]).unwrap(),
        ISSUED_AT,
        RESTORE_EXPIRES_AT,
        [0x61; 32],
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x71; 32]).unwrap(),
        TenantRootRestoreSessionIdV1::from_bytes([0x81; 16]).unwrap(),
        "restore-import-key-1",
        1,
    )
    .expect("restore record")
}

#[test]
fn the_committed_operation_records_match_the_current_encoding() {
    let cases = vec![
        record(
            TenantRootOperationKindV1::OperationalShareRotation,
            TenantRootOperationSubjectV1::TenantRoot,
            None,
            EXPIRES_AT,
        ),
        record(
            TenantRootOperationKindV1::RecoveryRecipientPairEnroll,
            TenantRootOperationSubjectV1::RecipientPair {
                recipient_pair_digest: [0x9a; 32],
            },
            None,
            EXPIRES_AT,
        ),
        record(
            TenantRootOperationKindV1::RecoveryRolePackageDownload,
            TenantRootOperationSubjectV1::RecoverySet {
                recovery_set_id: TenantRootRecoverySetId::from_bytes([0x41; 16]).unwrap(),
            },
            Some(TwoPartyDeriverRole::DeriverB),
            DOWNLOAD_EXPIRES_AT,
        ),
        record(
            TenantRootOperationKindV1::SourceLineageRetire,
            TenantRootOperationSubjectV1::TenantRoot,
            None,
            EXPIRES_AT,
        ),
        restore_record(),
    ];

    let mut entries = Vec::new();
    for case in &cases {
        let canonical =
            String::from_utf8(case.canonical_json().expect("canonical")).expect("canonical utf-8");
        assert_eq!(
            TenantRootOperationRecordV1::from_canonical_json(canonical.as_bytes())
                .expect("record round-trip"),
            *case,
        );
        entries.push(format!(
            "    {{\n      \"operationKind\": \"{}\",\n      \"canonicalJson\": {},\n      \"digestB64u\": \"{}\"\n    }}",
            case.kind().as_str(),
            serde_json::to_string(&canonical).expect("json string"),
            Base64UrlUnpadded::encode_string(case.digest().expect("digest").as_bytes()),
        ));
    }
    let rendered = format!(
        "{{\n  \"formatVersion\": \"tenant_root_operation_record_v1\",\n  \"records\": [\n{}\n  ]\n}}\n",
        entries.join(",\n")
    );

    let path = fixture_path();
    if std::env::var("UPDATE_TENANT_ROOT_OPERATION_FIXTURES").is_ok() {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("fixture directory");
        std::fs::write(&path, rendered.as_bytes()).expect("write fixture");
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "missing fixture {}: {error}. Regenerate with \
             UPDATE_TENANT_ROOT_OPERATION_FIXTURES=1 cargo test -p router-ab-core \
             --test tenant_root_operation_fixtures",
            path.display()
        )
    });
    assert_eq!(
        committed, rendered,
        "operation record fixtures are stale; regenerate rather than editing by hand"
    );
}
