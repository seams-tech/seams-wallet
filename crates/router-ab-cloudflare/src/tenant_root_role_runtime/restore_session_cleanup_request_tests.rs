use super::CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1;

#[test]
fn cleanup_request_is_typed_and_rejects_unknown_fields() {
    let request = CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1 {
        activation_receipt_b64u: "receipt".to_owned(),
    };
    let encoded = serde_json::to_string(&request).expect("cleanup request encoding");
    let decoded: CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1 =
        serde_json::from_str(&encoded).expect("cleanup request decoding");
    assert_eq!(decoded, request);
    assert_eq!(
        crate::paths::CLOUDFLARE_DERIVER_TENANT_ROOT_RESTORE_CLEANUP_PRIVATE_REQUEST_PATH,
        "/router-ab/internal/deriver/tenant-root/restore/v1/cleanup"
    );
    assert!(
        serde_json::from_str::<CloudflareDeriverTenantRootRestoreSessionCleanupRequestV1>(
            r#"{"activation_receipt_b64u":"receipt","identity_digest_b64u":"forbidden"}"#
        )
        .is_err()
    );
}
