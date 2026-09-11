use crate::tenant_root_role_d1::{
    recovery::RecoveryAttemptStateV1, CloudflareTenantRootRoleShareStoreV1,
};
use crate::tenant_root_role_runtime::RefreshHpkeReplayRng;
use core::num::NonZeroU64;
use rand_core_06::SeedableRng;
use router_ab_core::*;
use sha2::{Digest, Sha256};
use threshold_prf::{RootShareRefreshCoefficient, SigningRootShareCommitment, TwoPartyDeriverRole};
use zeroize::Zeroizing;

pub(crate) const RECOVERY_RESHARE_PATH: &str = "/router-ab/deriver/tenant-root-recovery/reshare";

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryCommitmentsV1 {
    a: String,
    b: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryRoundV1 {
    commitments: RecoveryCommitmentsV1,
    peer_contribution: String,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum RecoveryRequestV1 {
    Prepare {
        command: String,
    },
    Contribute {
        command: String,
        commitments: RecoveryCommitmentsV1,
    },
    Derive {
        command: String,
        round: RecoveryRoundV1,
    },
    Prove {
        command: String,
        round: RecoveryRoundV1,
        peer_commitment: String,
    },
    Package {
        command: String,
        round: RecoveryRoundV1,
        evidence_a: String,
        evidence_b: String,
    },
}
impl RecoveryRequestV1 {
    fn command(&self) -> &str {
        match self {
            Self::Prepare { command }
            | Self::Contribute { command, .. }
            | Self::Derive { command, .. }
            | Self::Prove { command, .. }
            | Self::Package { command, .. } => command,
        }
    }
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum RecoveryResponseV1 {
    Prepared {
        commitment: String,
    },
    Contributed {
        contribution: String,
    },
    Derived {
        commitment: String,
    },
    Proved {
        evidence: String,
    },
    Packaged {
        package_digest: String,
        descriptor: String,
        package_length: u32,
    },
}

fn error(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}
fn crypto_error(value: RouterAbDerivationError) -> RouterAbProtocolError {
    error(value.message())
}
fn storage_error(value: worker::Error) -> RouterAbProtocolError {
    error(&value.to_string())
}
fn decode(value: &str) -> RouterAbProtocolResult<Vec<u8>> {
    if value.len() > 24 * 1024 {
        return Err(error("recovery artifact exceeds wire limit"));
    }
    let bytes = crate::decode_base64url_bytes_v1("recovery artifact", value)?;
    if crate::encode_base64url_bytes_v1(&bytes) != value {
        return Err(error("recovery artifact is not canonical base64url"));
    }
    Ok(bytes)
}
fn encode(bytes: &[u8]) -> String {
    crate::encode_base64url_bytes_v1(bytes)
}
fn fresh_rng() -> rand_chacha::ChaCha20Rng {
    let mut seed = Zeroizing::new([0; 32]);
    rand_core::RngCore::fill_bytes(
        &mut crate::hpke::CloudflareHpkeGetrandomRngV1,
        seed.as_mut(),
    );
    rand_chacha::ChaCha20Rng::from_seed(*seed)
}
fn hpke_key_id(key: TenantRootRecoveryReshareHpkePublicKeyV1) -> String {
    format!("recovery-{}", encode(&Sha256::digest(key.as_bytes())))
}

fn verify_commitments(
    command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    pair: &RecoveryCommitmentsV1,
    expected_local: &TenantRootSignedRecoveryReshareCommitmentV1,
    keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<(
    VerifiedTenantRootRecoveryReshareCommitmentV1,
    VerifiedTenantRootRecoveryReshareCommitmentV1,
)> {
    let context = command.context();
    let a = TenantRootSignedRecoveryReshareCommitmentV1::decode_and_verify_canonical_bytes(
        &decode(&pair.a)?,
        context,
        keys.for_role_and_key_id(
            TwoPartyDeriverRole::DeriverA,
            context.signing_key_id(TwoPartyDeriverRole::DeriverA),
        )?,
    )
    .map_err(crypto_error)?;
    let b = TenantRootSignedRecoveryReshareCommitmentV1::decode_and_verify_canonical_bytes(
        &decode(&pair.b)?,
        context,
        keys.for_role_and_key_id(
            TwoPartyDeriverRole::DeriverB,
            context.signing_key_id(TwoPartyDeriverRole::DeriverB),
        )?,
    )
    .map_err(crypto_error)?;
    let (own, peer) = match command.role() {
        TwoPartyDeriverRole::DeriverA => (a, b),
        TwoPartyDeriverRole::DeriverB => (b, a),
    };
    if own != *expected_local {
        return Err(error("recovery commitment changed after durable admission"));
    }
    Ok((
        own.verify(
            context,
            keys.for_role_and_key_id(command.role(), context.signing_key_id(command.role()))?,
        )
        .map_err(crypto_error)?,
        peer.verify(
            context,
            keys.for_role_and_key_id(
                command.role().peer(),
                context.signing_key_id(command.role().peer()),
            )?,
        )
        .map_err(crypto_error)?,
    ))
}

fn derive_pending(
    command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    round: &RecoveryRoundV1,
    local: &TenantRootSignedRecoveryReshareCommitmentV1,
    coefficient: &RootShareRefreshCoefficient,
    hpke: &TenantRootRecoveryReshareHpkeKeypairV1,
    share: &threshold_prf::SigningRootShare,
    keys: &crate::env::TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<PendingTenantRootRecoveryShareV1> {
    let (own, peer) = verify_commitments(command, &round.commitments, local, keys)?;
    let peer_key = keys.for_role_and_key_id(
        command.role().peer(),
        command.context().signing_key_id(command.role().peer()),
    )?;
    let contribution =
        TenantRootSignedRecoveryReshareContributionV1::decode_and_verify_canonical_bytes(
            &decode(&round.peer_contribution)?,
            command.context(),
            &peer_key,
        )
        .map_err(crypto_error)?;
    let opened = contribution
        .verify_and_open(
            command.context(),
            &peer,
            &hpke_key_id(hpke.public_key()),
            hpke,
            &peer_key,
        )
        .map_err(crypto_error)?;
    PendingTenantRootRecoveryShareV1::derive(command.context(), share, coefficient, &own, opened)
        .map_err(crypto_error)
}

pub(crate) async fn handle_recovery(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: RecoveryRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<RecoveryResponseV1> {
    let role = match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        crate::CloudflareWorkerRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
        _ => return Err(error("recovery sharing requires a Deriver")),
    };
    let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
    let issuers =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(&reader)?;
    let raw =
        TenantRootRecoveryReshareRoleCommandV1::decode_canonical_bytes(&decode(request.command())?)
            .map_err(crypto_error)?;
    let issuer = issuers
        .for_issuer_key_id(raw.issuer_key_id())
        .ok_or_else(|| error("recovery issuer is not trusted"))?;
    let command = raw
        .verify(role, raw.issuer_key_id(), issuer)
        .map_err(crypto_error)?;
    command
        .context()
        .validate_at(now_ms)
        .map_err(crypto_error)?;
    let (_, signer) =
        crate::env::load_cloudflare_tenant_root_creation_role_signing_key_v1(env, worker_role)?;
    let keys = crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(&reader)?;
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env).map_err(storage_error)?;
    let mut state = store
        .admit_recovery_attempt(&command, now_ms)
        .await
        .map_err(storage_error)?;
    if let RecoveryAttemptStateV1::Packaged {
        package_digest_b64u,
        descriptor_b64u,
        package_length,
        ..
    } = state
    {
        return Ok(RecoveryResponseV1::Packaged {
            package_digest: package_digest_b64u,
            descriptor: descriptor_b64u,
            package_length,
        });
    }
    if !matches!(
        state,
        RecoveryAttemptStateV1::Provisioning | RecoveryAttemptStateV1::Pending { .. }
    ) {
        return Err(error("recovery set is closed for generation"));
    }
    let id = router_ab_core::derivation::TenantRootRetentionKeyIdV1::new(
        command.context().recovery_set_id(),
        role,
        NonZeroU64::MIN,
    );
    let retention =
        crate::env::load_cloudflare_tenant_root_recovery_retention_key_v1(env, worker_role, id)?;
    let retention = retention.provision().await.map_err(crypto_error)?;
    if matches!(state, RecoveryAttemptStateV1::Provisioning) {
        let context = command.context();
        let active = store
            .load_epoch(
                context.identity(),
                context.source_custody_lineage(),
                context.active_epoch(),
            )
            .await
            .map_err(storage_error)?
            .ok_or_else(|| error("recovery source epoch is missing"))?;
        let sealed = active
            .into_online_role_share_artifact()
            .map_err(storage_error)?;
        let mut provider =
            crate::env::load_cloudflare_tenant_root_operational_rotation_provider_v1(
                env,
                worker_role,
            )?;
        let opened = crate::tenant_root_role_runtime::open_tenant_root_online_role_share_v1(
            sealed,
            &mut provider,
        )
        .map_err(crypto_error)?;
        let (_, wire) = opened.into_parts();
        let share = wire
            .to_share()
            .map_err(|_| error("invalid active recovery source share"))?;
        let mut seed = Zeroizing::new([0; 32]);
        rand_core::RngCore::fill_bytes(
            &mut crate::hpke::CloudflareHpkeGetrandomRngV1,
            seed.as_mut(),
        );
        let encrypted = retention
            .seal_recovery_attempt(&command, &seed, &share)
            .await
            .map_err(crypto_error)?;
        state = store
            .persist_recovery_material(&command, &encode(&encrypted))
            .await
            .map_err(storage_error)?;
    }
    let RecoveryAttemptStateV1::Pending {
        encrypted_material_b64u,
    } = state
    else {
        return Err(error("recovery attempt closed during provisioning"));
    };
    let encrypted =
        crate::decode_base64url_bytes_v1("recovery replay ciphertext", &encrypted_material_b64u)?;
    let material = retention
        .open_recovery_attempt(&command, &encrypted)
        .await
        .map_err(crypto_error)?;
    let mut deterministic = rand_chacha::ChaCha20Rng::from_seed(*material.replay_seed);
    let mut hpke_seed = Zeroizing::new([0; 32]);
    rand_core_06::RngCore::fill_bytes(&mut deterministic, hpke_seed.as_mut());
    let hpke = TenantRootRecoveryReshareHpkeKeypairV1::derive_from_ikm(*hpke_seed)
        .map_err(crypto_error)?;
    let coefficient = RootShareRefreshCoefficient::random(role, &mut deterministic);
    let local = signer
        .sign_recovery_commitment(&command, &coefficient, hpke.public_key())
        .map_err(crypto_error)?;
    let mut rng = fresh_rng();
    match request {
        RecoveryRequestV1::Prepare { .. } => Ok(RecoveryResponseV1::Prepared {
            commitment: encode(
                &local
                    .canonical_bytes(command.context())
                    .map_err(crypto_error)?,
            ),
        }),
        RecoveryRequestV1::Contribute { commitments, .. } => {
            let (own, peer) = verify_commitments(&command, &commitments, &local, &keys)?;
            let contribution = signer
                .seal_recovery_contribution(
                    &command,
                    &coefficient,
                    &own,
                    &peer,
                    &hpke_key_id(peer.hpke_public_key()),
                    &mut RefreshHpkeReplayRng(&mut rng),
                )
                .map_err(crypto_error)?;
            Ok(RecoveryResponseV1::Contributed {
                contribution: encode(&contribution.canonical_bytes().map_err(crypto_error)?),
            })
        }
        RecoveryRequestV1::Derive { round, .. } => {
            let pending = derive_pending(
                &command,
                &round,
                &local,
                &coefficient,
                &hpke,
                &material.active_share,
                &keys,
            )?;
            Ok(RecoveryResponseV1::Derived {
                commitment: encode(&pending.commitment().to_bytes()),
            })
        }
        RecoveryRequestV1::Prove {
            round,
            peer_commitment,
            ..
        } => {
            let pending = derive_pending(
                &command,
                &round,
                &local,
                &coefficient,
                &hpke,
                &material.active_share,
                &keys,
            )?;
            let peer = SigningRootShareCommitment::from_slice(&decode(&peer_commitment)?)
                .map_err(|_| error("invalid peer recovery share commitment"))?;
            let evidence = pending
                .prove(command.context(), peer, &mut rng)
                .map_err(crypto_error)?;
            let signed = signer
                .sign_recovery_evidence(&command, evidence)
                .map_err(crypto_error)?;
            Ok(RecoveryResponseV1::Proved {
                evidence: encode(
                    &signed
                        .canonical_bytes(command.context())
                        .map_err(crypto_error)?,
                ),
            })
        }
        RecoveryRequestV1::Package {
            round,
            evidence_a,
            evidence_b,
            ..
        } => {
            let pending = derive_pending(
                &command,
                &round,
                &local,
                &coefficient,
                &hpke,
                &material.active_share,
                &keys,
            )?;
            let context = command.context();
            let a_key = keys.for_role_and_key_id(
                TwoPartyDeriverRole::DeriverA,
                context.signing_key_id(TwoPartyDeriverRole::DeriverA),
            )?;
            let b_key = keys.for_role_and_key_id(
                TwoPartyDeriverRole::DeriverB,
                context.signing_key_id(TwoPartyDeriverRole::DeriverB),
            )?;
            let a = TenantRootSignedRecoveryShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(&decode(&evidence_a)?, context, &a_key).map_err(crypto_error)?;
            let b = TenantRootSignedRecoveryShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(&decode(&evidence_b)?, context, &b_key).map_err(crypto_error)?;
            let pair =
                VerifiedTenantRootRecoveryResharePairV1::verify(context, &a, &b, &a_key, &b_key)
                    .map_err(crypto_error)?;
            let share = pending.finalize(&pair).map_err(crypto_error)?;
            let time = worker::js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(
                context.issued_at_ms() as f64,
            ))
            .to_iso_string()
            .as_string()
            .ok_or_else(|| error("invalid recovery creation time"))?;
            let descriptor = TenantRootRecoveryDescriptorV1::from_verified_reshare(&pair, time)
                .map_err(crypto_error)?;
            let package = signer
                .seal_recovery_package(
                    &command,
                    &descriptor,
                    &share,
                    &mut RefreshHpkeReplayRng(&mut rng),
                )
                .map_err(crypto_error)?;
            let package_bytes = package.to_bytes().map_err(crypto_error)?;
            let package_length = package_bytes.len() as u32;
            let digest: [u8; 32] = Sha256::digest(&package_bytes).into();
            let encrypted = retention
                .wrap_package(&package)
                .await
                .map_err(crypto_error)?;
            match store
                .persist_recovery_package(
                    &command,
                    &encode(&encrypted),
                    &digest,
                    &descriptor,
                    package_length,
                )
                .await
                .map_err(storage_error)?
            {
                RecoveryAttemptStateV1::Packaged {
                    package_digest_b64u,
                    descriptor_b64u,
                    package_length,
                    ..
                } => Ok(RecoveryResponseV1::Packaged {
                    package_digest: package_digest_b64u,
                    descriptor: descriptor_b64u,
                    package_length,
                }),
                _ => Err(error("recovery cleanup prevented package publication")),
            }
        }
    }
}

pub(crate) const RECOVERY_ACCESS_PATH: &str = "/router-ab/deriver/tenant-root-recovery/access";

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryAccessRequestV1 {
    generation_command: String,
    access_grant: String,
}

pub(crate) async fn handle_recovery_access(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: RecoveryAccessRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<worker::Response> {
    let role = match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        crate::CloudflareWorkerRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
        _ => return Err(error("recovery access requires a Deriver")),
    };
    let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
    let issuers =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(&reader)?;
    let raw = TenantRootRecoveryReshareRoleCommandV1::decode_canonical_bytes(&decode(
        &request.generation_command,
    )?)
    .map_err(crypto_error)?;
    let key = issuers
        .for_issuer_key_id(raw.issuer_key_id())
        .ok_or_else(|| error("recovery generation issuer is not trusted"))?;
    let command = raw
        .verify(role, raw.issuer_key_id(), key)
        .map_err(crypto_error)?;
    let grant =
        TenantRootRecoveryAccessGrantV1::decode_canonical_bytes(&decode(&request.access_grant)?)
            .map_err(crypto_error)?;
    let key = issuers
        .for_issuer_key_id(grant.issuer_key_id())
        .ok_or_else(|| error("recovery access issuer is not trusted"))?;
    let operation = grant
        .verify(&command, grant.issuer_key_id(), key, now_ms)
        .map_err(crypto_error)?;
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env).map_err(storage_error)?;
    let state = store
        .load_recovery_attempt(&command)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| error("recovery set is missing"))?;
    let id = router_ab_core::derivation::TenantRootRetentionKeyIdV1::new(
        command.context().recovery_set_id(),
        role,
        NonZeroU64::MIN,
    );
    let retention =
        crate::env::load_cloudflare_tenant_root_recovery_retention_key_v1(env, worker_role, id)?;
    match operation {
        TenantRootRecoveryAccessOperationV1::DownloadPackage => {
            let RecoveryAttemptStateV1::Packaged {
                encrypted_package_b64u,
                package_digest_b64u,
                package_length,
                ..
            } = state
            else {
                return Err(error("recovery package is not downloadable"));
            };
            let ciphertext = crate::decode_base64url_bytes_v1(
                "retained recovery package",
                &encrypted_package_b64u,
            )?;
            let bytes = retention
                .open_package(&ciphertext)
                .await
                .map_err(crypto_error)?;
            if bytes.len() != package_length as usize
                || encode(&Sha256::digest(bytes.as_slice())) != package_digest_b64u
            {
                return Err(error("retained recovery package digest mismatch"));
            }
            // Cleanup may start while KMS decrypt is in flight.
            if !matches!(
                store
                    .load_recovery_attempt(&command)
                    .await
                    .map_err(storage_error)?,
                Some(RecoveryAttemptStateV1::Packaged { .. })
            ) {
                return Err(error("recovery cleanup closed this download"));
            }
            let mut response =
                worker::Response::from_bytes(bytes.to_vec()).map_err(storage_error)?;
            response
                .headers_mut()
                .set(
                    "Content-Type",
                    "application/vnd.seams.tenant-root-recovery-package.v1",
                )
                .map_err(storage_error)?;
            response
                .headers_mut()
                .set("Cache-Control", "no-store")
                .map_err(storage_error)?;
            response
                .headers_mut()
                .set("X-Content-Type-Options", "nosniff")
                .map_err(storage_error)?;
            response
                .headers_mut()
                .set(
                    "Content-Disposition",
                    &format!(
                        "attachment; filename=\"seams-recovery-{}-{}.bin\"",
                        command.context().recovery_set_id().to_base64url(),
                        role.as_str()
                    ),
                )
                .map_err(storage_error)?;
            Ok(response)
        }
        TenantRootRecoveryAccessOperationV1::DestroyRecoverySet => {
            store
                .begin_recovery_destruction(&command)
                .await
                .map_err(storage_error)?;
            let outcome = retention
                .schedule_destruction()
                .await
                .map_err(crypto_error)?;
            let state = store
                .record_recovery_destruction(&command, &outcome)
                .await
                .map_err(storage_error)?;
            let (status, receipt) = match state {
                RecoveryAttemptStateV1::DestructionScheduled { receipt } => {
                    ("destruction_scheduled", receipt)
                }
                RecoveryAttemptStateV1::Destroyed { receipt } => ("destroyed", receipt),
                _ => {
                    return Err(error(
                        "recovery destruction did not reach a recorded provider state",
                    ))
                }
            };
            worker::Response::from_json(&serde_json::json!({"status":status,"role":role.as_str(),"recovery_set_id":command.context().recovery_set_id().to_base64url(),"provider_receipt":receipt})).map_err(storage_error)
        }
    }
}


pub(crate) const SOURCE_RETIREMENT_PATH: &str =
    "/router-ab/deriver/tenant-root-recovery/retire-source";

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceRetirementRequestV1 {
    retirement_command_b64u: String,
}

pub(crate) async fn handle_source_retirement(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: SourceRetirementRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<serde_json::Value> {
    let role = match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        crate::CloudflareWorkerRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
        _ => return Err(error("source retirement requires a Deriver")),
    };
    let reader = crate::CloudflareWorkerEnvReaderV1::new(env);
    let issuers =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(&reader)?;
    let raw = TenantRootSourceRetirementCommandV1::decode_canonical_bytes(&decode(
        &request.retirement_command_b64u,
    )?)
    .map_err(crypto_error)?;
    let key = issuers
        .for_issuer_key_id(raw.issuer_key_id())
        .ok_or_else(|| error("source retirement issuer is not trusted"))?;
    let command = raw
        .verify(role, raw.issuer_key_id(), key, now_ms)
        .map_err(crypto_error)?;
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env).map_err(storage_error)?;
    let retired_at_ms = store
        .retire_source_lineage(&command, now_ms)
        .await
        .map_err(storage_error)?;
    Ok(serde_json::json!({
        "status": "local_material_removed",
        "role": role.as_str(),
        "identity_digest_b64u": encode(command.identity_digest().as_bytes()),
        "custody_lineage_b64u": command.custody_lineage().to_base64url(),
        "destination_activation_receipt_digest_b64u": encode(command.destination_receipt_digest().as_bytes()),
        "retired_at_ms": retired_at_ms,
        "provider_retirement": "unverified"
    }))
}
