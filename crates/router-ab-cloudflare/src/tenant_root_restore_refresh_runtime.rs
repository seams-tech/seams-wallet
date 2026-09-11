#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use rand_core_06::SeedableRng;
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use router_ab_core::{
    RouterAbDerivationError, TenantRootCeremonyContextV1, TenantRootRefreshContributionAadV1,
    TenantRootRefreshHpkeKeypairV1, TenantRootRestoreRefreshRoleCommandV1,
    TenantRootSignedRefreshCommitmentV1, TenantRootSignedRefreshContributionV1,
    TwoPartyDeriverRole, VerifiedTenantRootRefreshCommitmentPairV1,
    VerifiedTenantRootRestoreRefreshRoleCommandV1,
};
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use sha2::{Digest, Sha256};
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use zeroize::Zeroizing;

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use crate::env::TenantRootCreationRoleVerifyingKeysV1;
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use crate::tenant_root_role_d1::{
    CloudflareTenantRootRestoreImportKeyRecordV1, CloudflareTenantRootRoleShareStoreV1,
};
use crate::tenant_root_role_runtime::CloudflareTenantRootCreateRoleV1;
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use crate::tenant_root_role_runtime::RefreshHpkeReplayRng;
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
use crate::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareDeriverTenantRootRestoreRefreshRequestV1 {
    Prepare {
        role_refresh_command_b64u: String,
    },
    Contribute {
        role_refresh_command_b64u: String,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
    },
    Finalize {
        role_refresh_command_b64u: String,
        deriver_a_commitment_b64u: String,
        deriver_b_commitment_b64u: String,
        peer_contribution_b64u: String,
    },
    Promote {
        identity: router_ab_core::TenantRootIdentityV1,
        role_refresh_command_b64u: String,
        authority_id_b64u: String,
    },
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
impl CloudflareDeriverTenantRootRestoreRefreshRequestV1 {
    fn command_b64u(&self) -> &str {
        match self {
            Self::Prepare {
                role_refresh_command_b64u,
            }
            | Self::Contribute {
                role_refresh_command_b64u,
                ..
            }
            | Self::Finalize {
                role_refresh_command_b64u,
                ..
            }
            | Self::Promote {
                role_refresh_command_b64u,
                ..
            } => role_refresh_command_b64u,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum CloudflareDeriverTenantRootRestoreRefreshResponseV1 {
    Prepared {
        role: CloudflareTenantRootCreateRoleV1,
        command_digest_b64u: String,
        signed_commitment_b64u: String,
    },
    Contributed {
        role: CloudflareTenantRootCreateRoleV1,
        command_digest_b64u: String,
        signed_contribution_b64u: String,
    },
    Refreshed {
        role: CloudflareTenantRootCreateRoleV1,
        command_digest_b64u: String,
        signed_installation_evidence_b64u: String,
    },
    Promoted {
        role: CloudflareTenantRootCreateRoleV1,
        restore_refresh_role_command_b64u: String,
        command_digest_b64u: String,
        signed_installation_evidence_b64u: String,
        installation_evidence_digest_b64u: String,
        provider_canary_receipt_b64u: String,
        provider_canary_receipt_digest_b64u: String,
        completed_at_ms: u64,
    },
}

impl CloudflareDeriverTenantRootRestoreRefreshResponseV1 {
    pub(crate) const fn role(&self) -> CloudflareTenantRootCreateRoleV1 {
        match self {
            Self::Prepared { role, .. }
            | Self::Contributed { role, .. }
            | Self::Refreshed { role, .. }
            | Self::Promoted { role, .. } => *role,
        }
    }
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn derivation_error(error: RouterAbDerivationError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        error.to_string(),
    )
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn storage_error(error: worker::Error) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        error.to_string(),
    )
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn binding_error(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, message)
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn decode_wire(value: &str) -> RouterAbProtocolResult<Vec<u8>> {
    if value.len() > 32 * 1024 {
        return Err(binding_error(
            "restore refresh artifact exceeds its size limit",
        ));
    }
    let bytes = crate::decode_base64url_bytes_v1("restore refresh artifact", value)?;
    if crate::encode_base64url_bytes_v1(&bytes) != value {
        return Err(binding_error(
            "restore refresh artifact must use canonical base64url",
        ));
    }
    Ok(bytes)
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn protocol_role(
    worker_role: crate::CloudflareWorkerRoleV1,
) -> RouterAbProtocolResult<TwoPartyDeriverRole> {
    match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => Ok(TwoPartyDeriverRole::DeriverA),
        crate::CloudflareWorkerRoleV1::DeriverB => Ok(TwoPartyDeriverRole::DeriverB),
        _ => Err(binding_error("restore refresh requires a Deriver")),
    }
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn verify_pair(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    expected_local_commitment: &[u8],
    a: &str,
    b: &str,
    keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootRefreshCommitmentPairV1> {
    let a_bytes = decode_wire(a)?;
    let b_bytes = decode_wire(b)?;
    let local_bytes = match role {
        TwoPartyDeriverRole::DeriverA => &a_bytes,
        TwoPartyDeriverRole::DeriverB => &b_bytes,
    };
    if local_bytes != expected_local_commitment {
        return Err(binding_error(
            "restore refresh pair changed the admitted local commitment",
        ));
    }
    let a_role = TwoPartyDeriverRole::DeriverA;
    let b_role = TwoPartyDeriverRole::DeriverB;
    let a = TenantRootSignedRefreshCommitmentV1::decode_and_verify_restore_canonical_bytes(
        &a_bytes,
        context,
        a_role,
        context.signing_key_id(a_role),
        keys.for_role_and_key_id(a_role, context.signing_key_id(a_role))?,
    )
    .map_err(derivation_error)?;
    let b = TenantRootSignedRefreshCommitmentV1::decode_and_verify_restore_canonical_bytes(
        &b_bytes,
        context,
        b_role,
        context.signing_key_id(b_role),
        keys.for_role_and_key_id(b_role, context.signing_key_id(b_role))?,
    )
    .map_err(derivation_error)?;
    VerifiedTenantRootRefreshCommitmentPairV1::new(a, b).map_err(derivation_error)
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn contribution_aad(
    pair: &VerifiedTenantRootRefreshCommitmentPairV1,
    source: TwoPartyDeriverRole,
) -> RouterAbProtocolResult<TenantRootRefreshContributionAadV1> {
    match source {
        TwoPartyDeriverRole::DeriverA => TenantRootRefreshContributionAadV1::deriver_a_to_b(pair),
        TwoPartyDeriverRole::DeriverB => TenantRootRefreshContributionAadV1::deriver_b_to_a(pair),
    }
    .map_err(derivation_error)
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
fn validate_import_binding(
    record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
) -> RouterAbProtocolResult<()> {
    let binding = record.binding();
    let role = command.role();
    if binding.identity_digest() != command.identity_digest()
        || binding.custody_lineage() != command.custody_lineage()
        || binding.restore_session_id() != command.restore_session_id()
        || binding.destination_fingerprint() != command.destination_fingerprint()
        || binding.manifest_digest() != command.manifest_digest()
        || binding.stable_root_commitment() != command.stable_root_commitment()
        || binding.share_commitment().as_slice() != command.imported_commitment(role).as_bytes()
        || record.receipt_digest() != Some(*command.acceptance_receipt(role).as_bytes())
    {
        return Err(binding_error(
            "restore refresh does not match the accepted role import",
        ));
    }
    Ok(())
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    all(test, feature = "workers-rs")
))]
pub(crate) async fn handle_restore_refresh(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootRestoreRefreshRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRefreshResponseV1> {
    let role = protocol_role(worker_role)?;
    if let CloudflareDeriverTenantRootRestoreRefreshRequestV1::Promote {
        identity,
        role_refresh_command_b64u,
        authority_id_b64u,
    } = &request
    {
        let response = crate::tenant_root_role_runtime::handle_cloudflare_deriver_tenant_root_restore_refresh_promotion_v1(
            env,
            worker_role,
            identity.clone(),
            role_refresh_command_b64u.clone(),
            authority_id_b64u.clone(),
            now_ms,
        )
        .await?;
        return Ok(
            CloudflareDeriverTenantRootRestoreRefreshResponseV1::Promoted {
                role: response.role,
                restore_refresh_role_command_b64u: response.restore_refresh_role_command_b64u,
                command_digest_b64u: response.command_digest_b64u,
                signed_installation_evidence_b64u: response.signed_installation_evidence_b64u,
                installation_evidence_digest_b64u: response.installation_evidence_digest_b64u,
                provider_canary_receipt_b64u: response.provider_canary_receipt_b64u,
                provider_canary_receipt_digest_b64u: response.provider_canary_receipt_digest_b64u,
                completed_at_ms: response.completed_at_ms,
            },
        );
    }
    let command_bytes = decode_wire(request.command_b64u())?;
    let raw = TenantRootRestoreRefreshRoleCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(derivation_error)?;
    let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(&reader)?;
    let issuer_key = issuer_keys
        .for_issuer_key_id(raw.issuer_key_id())
        .ok_or_else(|| binding_error("restore refresh issuer is not trusted"))?;
    let command = raw
        .verify(raw.issuer_key_id(), issuer_key)
        .map_err(derivation_error)?;
    if command.role() != role {
        return Err(binding_error(
            "restore refresh command belongs to the other Deriver",
        ));
    }
    let context = command.context().clone();
    let command_digest = *command.digest().as_bytes();
    let command_digest_b64u = crate::encode_base64url_bytes_v1(&command_digest);
    let response_role = CloudflareTenantRootCreateRoleV1::from_protocol(role);
    let keys = crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(&reader)?;
    let (_, signer) =
        crate::env::load_cloudflare_tenant_root_creation_role_signing_key_v1(env, worker_role)?;
    if context.signing_key_id(role) != signer.signing_key_id() {
        return Err(binding_error(
            "restore refresh context does not name the local role signer",
        ));
    }
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env).map_err(storage_error)?;
    if store
        .restore_import_session_is_closed(
            command.identity_digest(),
            command.custody_lineage(),
            command.restore_session_id(),
        )
        .await
        .map_err(storage_error)?
    {
        return Err(binding_error("restore refresh session is closed"));
    }
    let accepted = store
        .load_current_restore_import_key(
            command.identity_digest(),
            command.custody_lineage(),
            command.restore_session_id(),
        )
        .await
        .map_err(storage_error)?
        .ok_or_else(|| binding_error("restore refresh has no accepted local import"))?;
    validate_import_binding(&accepted, &command)?;
    let share = store
        .open_restore_imported_share(&accepted)
        .map_err(storage_error)?;
    let admission = store
        .admit_restore_refresh(
            &accepted,
            command_digest,
            context.issued_at_ms(),
            context.expires_at_ms(),
            now_ms,
        )
        .await
        .map_err(storage_error)?;
    let admitted_at_ms = admission.admitted_at_ms();
    let mut rng = rand_chacha::ChaCha20Rng::from_seed(**admission.seed());
    let mut hpke_ikm = Zeroizing::new([0_u8; 32]);
    rand_core_06::RngCore::fill_bytes(&mut rng, hpke_ikm.as_mut());
    let recipient =
        TenantRootRefreshHpkeKeypairV1::derive_from_ikm(*hpke_ikm).map_err(derivation_error)?;
    let key_digest = Sha256::digest(recipient.public_key().as_bytes());
    let recipient_key_id = format!(
        "restore-refresh-{}",
        crate::encode_base64url_bytes_v1(&key_digest[..16])
    );
    let pending = signer
        .begin_restore_refresh_role_attempt(
            command,
            share,
            recipient_key_id,
            recipient.public_key(),
            admitted_at_ms,
            &mut rng,
        )
        .map_err(derivation_error)?;
    match request {
        CloudflareDeriverTenantRootRestoreRefreshRequestV1::Prepare { .. } => Ok(
            CloudflareDeriverTenantRootRestoreRefreshResponseV1::Prepared {
                role: response_role,
                command_digest_b64u,
                signed_commitment_b64u: crate::encode_base64url_bytes_v1(
                    pending.commitment_bytes(),
                ),
            },
        ),
        CloudflareDeriverTenantRootRestoreRefreshRequestV1::Contribute {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            ..
        } => {
            let pair = verify_pair(
                &context,
                role,
                pending.commitment_bytes(),
                &deriver_a_commitment_b64u,
                &deriver_b_commitment_b64u,
                &keys,
            )?;
            let aad = contribution_aad(&pair, role)?;
            let envelope = router_ab_core::seal_tenant_root_refresh_contribution_v1(
                &aad,
                &pending.contribution_for_peer(),
                &mut RefreshHpkeReplayRng(&mut rng),
            )
            .map_err(derivation_error)?;
            let signed = signer
                .sign_refresh_contribution(&aad, envelope)
                .map_err(derivation_error)?;
            Ok(
                CloudflareDeriverTenantRootRestoreRefreshResponseV1::Contributed {
                    role: response_role,
                    command_digest_b64u,
                    signed_contribution_b64u: crate::encode_base64url_bytes_v1(
                        &signed.canonical_bytes().map_err(derivation_error)?,
                    ),
                },
            )
        }
        CloudflareDeriverTenantRootRestoreRefreshRequestV1::Finalize {
            deriver_a_commitment_b64u,
            deriver_b_commitment_b64u,
            peer_contribution_b64u,
            ..
        } => {
            let pair = verify_pair(
                &context,
                role,
                pending.commitment_bytes(),
                &deriver_a_commitment_b64u,
                &deriver_b_commitment_b64u,
                &keys,
            )?;
            // Keep the proof RNG after the same HPKE randomness consumed by Contribute.
            let local_aad = contribution_aad(&pair, role)?;
            router_ab_core::seal_tenant_root_refresh_contribution_v1(
                &local_aad,
                &pending.contribution_for_peer(),
                &mut RefreshHpkeReplayRng(&mut rng),
            )
            .map_err(derivation_error)?;
            let peer_aad = contribution_aad(&pair, role.peer())?;
            let signed_peer = TenantRootSignedRefreshContributionV1::decode_canonical_bytes(
                &decode_wire(&peer_contribution_b64u)?,
            )
            .map_err(derivation_error)?;
            let peer_contribution = signed_peer
                .verify_and_open(
                    &peer_aad,
                    keys.for_role_and_key_id(role.peer(), context.signing_key_id(role.peer()))?,
                    &recipient,
                )
                .map_err(derivation_error)?;
            let finalized = pending
                .finalize(pair, peer_contribution, &mut rng)
                .map_err(derivation_error)?;
            let (_, share_wire, evidence) = finalized.into_parts();
            let evidence_bytes = store
                .finalize_restore_refresh(
                    &accepted,
                    command_digest,
                    &share_wire,
                    evidence.canonical_bytes(),
                    now_ms,
                )
                .await
                .map_err(storage_error)?;
            Ok(
                CloudflareDeriverTenantRootRestoreRefreshResponseV1::Refreshed {
                    role: response_role,
                    command_digest_b64u,
                    signed_installation_evidence_b64u: crate::encode_base64url_bytes_v1(
                        &evidence_bytes,
                    ),
                },
            )
        }
        CloudflareDeriverTenantRootRestoreRefreshRequestV1::Promote { .. } => {
            unreachable!("restore refresh promotion was handled before refresh phases")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promote_wire_carries_identity_command_and_authority() {
        let request = CloudflareDeriverTenantRootRestoreRefreshRequestV1::Promote {
            identity: router_ab_core::TenantRootIdentityV1::new(
                "org-1",
                "project-2",
                "production",
                "root-main",
                "v3",
            )
            .expect("identity"),
            role_refresh_command_b64u: "command".to_owned(),
            authority_id_b64u: "authority".to_owned(),
        };
        let value = serde_json::to_value(&request).expect("promotion request JSON");
        assert_eq!(value["kind"], "promote");
        assert_eq!(value["role_refresh_command_b64u"], "command");
        assert_eq!(value["authority_id_b64u"], "authority");
        let decoded: CloudflareDeriverTenantRootRestoreRefreshRequestV1 =
            serde_json::from_value(value).expect("promotion request roundtrip");
        assert_eq!(decoded, request);

        let mut with_extra = serde_json::to_value(request).expect("promotion request JSON");
        with_extra["scope"] = serde_json::json!("unexpected");
        assert!(
            serde_json::from_value::<CloudflareDeriverTenantRootRestoreRefreshRequestV1>(
                with_extra
            )
            .is_err()
        );
    }
}
