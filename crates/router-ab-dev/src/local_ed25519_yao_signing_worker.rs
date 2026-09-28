use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

use router_ab_cloudflare::{
    CloudflareSecretMaterial32V1, CloudflareServerOutputMaterialRecordV1,
    CloudflareSigningWorkerWalletScopeV1,
};
use router_ab_core::{
    ActiveSigningWorkerStateV1, Ed25519YaoCeremonyBindingV1, Ed25519YaoOperationV1,
    Ed25519YaoRefreshBindingV1, Ed25519YaoStateEpochV1, MpcMaterialActivationRefV1,
    NormalSigningScopeV1, OpenedShareKind, PublicDigest32, Role, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult, ServerIdentityV1,
};
use router_ab_ed25519_yao::recipient::signing_worker::{
    combine_signing_worker_activation_packages, SigningWorkerBaseScalar,
};
use router_ab_ed25519_yao::relay::{
    derive_registration_receipt, ActivationDeriverASigningWorkerPackage,
    ActivationDeriverBSigningWorkerPackage, ActivationPublicCommitments,
};
use serde::{Deserialize, Serialize};
use signer_core::near_threshold_ed25519::verifying_share_bytes_from_signing_share_bytes;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::{
    local_ed25519_yao_refresh::LocalEd25519YaoEffectiveIdentityV1,
    open_local_ed25519_yao_signing_worker_package_v1, Ed25519YaoDeriverRoleV1,
    Ed25519YaoEncryptedPackageV1, Ed25519YaoPackageKindV1, LocalEd25519YaoRecipientPrivateKeyV1,
    LocalSigningWorkerConfigV1,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalEd25519YaoSigningWorkerPackageDeliveryV1 {
    pub binding: Ed25519YaoCeremonyBindingV1,
    pub client_commitment: [u8; 32],
    pub signing_worker_commitment: [u8; 32],
    pub package: Ed25519YaoEncryptedPackageV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalEd25519YaoSigningWorkerPackagePairDeliveryV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub deriver_a: LocalEd25519YaoSigningWorkerPackageDeliveryV1,
    pub deriver_b: LocalEd25519YaoSigningWorkerPackageDeliveryV1,
    pub deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
    pub deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LocalEd25519YaoInitialRegistrationFinalizationV1 {
    Missing,
    Pending,
    Committed {
        receipt: LocalEd25519YaoSigningWorkerActivationReceiptV1,
    },
    Revoked,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoCommittedInitialRegistrationV1 {
    request: LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
    receipt: LocalEd25519YaoSigningWorkerActivationReceiptV1,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1 {
    pub binding: Ed25519YaoRefreshBindingV1,
    pub client_commitment: [u8; 32],
    pub signing_worker_commitment: [u8; 32],
    pub package: Ed25519YaoEncryptedPackageV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LocalEd25519YaoSigningWorkerActivationReceiptV1 {
    Staged {
        promotion: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
    },
    Active {
        session: [u8; 32],
        transcript: [u8; 32],
        registered_public_key: [u8; 32],
        joined_client_commitment: [u8; 32],
        joined_signing_worker_commitment: [u8; 32],
        signing_worker_verifying_share: [u8; 32],
        state_epoch: Ed25519YaoStateEpochV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1 {
    pub binding: Ed25519YaoCeremonyBindingV1,
    pub session: [u8; 32],
    pub transcript: [u8; 32],
    pub registered_public_key: [u8; 32],
    pub joined_client_commitment: [u8; 32],
    pub joined_signing_worker_commitment: [u8; 32],
    pub signing_worker_verifying_share: [u8; 32],
    pub state_epoch: Ed25519YaoStateEpochV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LocalEd25519YaoSigningWorkerRefreshReceiptV1 {
    Pending {
        accepted_deriver: Ed25519YaoDeriverRoleV1,
        session: [u8; 32],
        transcript: [u8; 32],
        current_epoch: Ed25519YaoStateEpochV1,
        next_epoch: Ed25519YaoStateEpochV1,
    },
    Active {
        session: [u8; 32],
        transcript: [u8; 32],
        registered_public_key: [u8; 32],
        signing_worker_verifying_share: [u8; 32],
        state_epoch: Ed25519YaoStateEpochV1,
    },
}

#[derive(Clone, PartialEq, Eq)]
struct PendingDelivery {
    binding: Ed25519YaoCeremonyBindingV1,
    client_commitment: [u8; 32],
    signing_worker_commitment: [u8; 32],
    package: Ed25519YaoEncryptedPackageV1,
}

#[derive(Clone)]
struct PendingRefreshDelivery {
    binding: Ed25519YaoRefreshBindingV1,
    client_commitment: [u8; 32],
    signing_worker_commitment: [u8; 32],
    package: Ed25519YaoEncryptedPackageV1,
}

#[derive(Zeroize, ZeroizeOnDrop)]
struct ActiveSigningShare {
    scalar: Zeroizing<[u8; 32]>,
    #[zeroize(skip)]
    binding: Ed25519YaoCeremonyBindingV1,
    #[zeroize(skip)]
    state_epoch: Ed25519YaoStateEpochV1,
    #[zeroize(skip)]
    activated_at_ms: u64,
    transcript: [u8; 32],
    registered_public_key: [u8; 32],
}

struct ActivationCandidate {
    next_active: ActiveSigningShare,
    promotion: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
    deriver_a: PendingDelivery,
    deriver_b: PendingDelivery,
}

enum RecoveryPromotionState {
    /// A recovery staged here: one candidate per attempt, kept apart, so no
    /// attempt's delivery displaces another's, as on Workers. Only the
    /// Gateway's current attempt promotes, and it finds its own candidate.
    Staged {
        candidates: Vec<ActivationCandidate>,
    },
    /// The recovery promoted here, with the deliveries that made it: the same
    /// deliveries answer again, and another attempt of it is stale.
    Promoted {
        promotion: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
        deriver_a: PendingDelivery,
        deriver_b: PendingDelivery,
    },
}

/// How many attempts of one recovery stay staged, as on Workers. A further
/// attempt drops the earliest staged one.
const LOCAL_SIGNING_WORKER_RECOVERY_STAGED_ATTEMPTS_MAX_V1: usize = 8;

#[derive(Default)]
pub struct LocalEd25519YaoSigningWorkerStateV1 {
    identities: BTreeMap<LocalEd25519YaoEffectiveIdentityV1, LocalEd25519YaoSigningIdentityStateV1>,
    /// Activations a recovery replaced. None signs again, though a signature
    /// one already made still answers.
    retired_activations: Vec<MpcMaterialActivationRefV1>,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub(crate) struct LocalEd25519YaoSigningWorkerDurableStateV1 {
    active_identities: Vec<LocalEd25519YaoSigningWorkerDurableActiveStateV1>,
    recoveries: Vec<LocalEd25519YaoSigningWorkerDurableRecoveryV1>,
    #[zeroize(skip)]
    retired_activations: Vec<MpcMaterialActivationRefV1>,
}

/// A recovery staged or promoted at one identity, kept across restarts: the
/// deliveries that made it, the promotion it answers, and, while it is still
/// staged, its candidate share.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoSigningWorkerDurableRecoveryV1 {
    #[zeroize(skip)]
    identity: LocalEd25519YaoEffectiveIdentityV1,
    #[zeroize(skip)]
    deriver_a: LocalEd25519YaoSigningWorkerPackageDeliveryV1,
    #[zeroize(skip)]
    deriver_b: LocalEd25519YaoSigningWorkerPackageDeliveryV1,
    #[zeroize(skip)]
    promotion: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
    staged: Option<LocalEd25519YaoSigningWorkerDurableShareV1>,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoSigningWorkerDurableShareV1 {
    scalar: [u8; 32],
    #[zeroize(skip)]
    binding: Ed25519YaoCeremonyBindingV1,
    #[zeroize(skip)]
    state_epoch: Ed25519YaoStateEpochV1,
    #[zeroize(skip)]
    activated_at_ms: u64,
    transcript: [u8; 32],
    registered_public_key: [u8; 32],
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct LocalEd25519YaoSigningWorkerDurableActiveStateV1 {
    scalar: [u8; 32],
    #[zeroize(skip)]
    identity: LocalEd25519YaoEffectiveIdentityV1,
    #[zeroize(skip)]
    binding: Ed25519YaoCeremonyBindingV1,
    #[zeroize(skip)]
    state_epoch: Ed25519YaoStateEpochV1,
    #[zeroize(skip)]
    activated_at_ms: u64,
    transcript: [u8; 32],
    registered_public_key: [u8; 32],
    #[zeroize(skip)]
    initial_registration: LocalEd25519YaoCommittedInitialRegistrationV1,
}

#[derive(Default)]
struct LocalEd25519YaoSigningIdentityStateV1 {
    pending_refresh_a: Option<PendingRefreshDelivery>,
    pending_refresh_b: Option<PendingRefreshDelivery>,
    active: Option<ActiveSigningShare>,
    initial_registration: Option<LocalEd25519YaoCommittedInitialRegistrationV1>,
    recovery_promotion: Option<RecoveryPromotionState>,
}

impl LocalEd25519YaoSigningWorkerStateV1 {
    pub(crate) fn durable_state_v1(
        &self,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerDurableStateV1> {
        let mut active_identities = Vec::new();
        let mut recoveries = Vec::new();
        for (identity, state) in &self.identities {
            match state.recovery_promotion.as_ref() {
                Some(RecoveryPromotionState::Staged { candidates }) => {
                    for candidate in candidates {
                        recoveries.push(LocalEd25519YaoSigningWorkerDurableRecoveryV1 {
                            identity: identity.clone(),
                            deriver_a: delivery_request(&candidate.deriver_a),
                            deriver_b: delivery_request(&candidate.deriver_b),
                            promotion: candidate.promotion.clone(),
                            staged: Some(LocalEd25519YaoSigningWorkerDurableShareV1 {
                                scalar: *candidate.next_active.scalar,
                                binding: candidate.next_active.binding.clone(),
                                state_epoch: candidate.next_active.state_epoch,
                                activated_at_ms: candidate.next_active.activated_at_ms,
                                transcript: candidate.next_active.transcript,
                                registered_public_key: candidate.next_active.registered_public_key,
                            }),
                        });
                    }
                }
                Some(RecoveryPromotionState::Promoted {
                    promotion,
                    deriver_a,
                    deriver_b,
                }) => {
                    recoveries.push(LocalEd25519YaoSigningWorkerDurableRecoveryV1 {
                        identity: identity.clone(),
                        deriver_a: delivery_request(deriver_a),
                        deriver_b: delivery_request(deriver_b),
                        promotion: promotion.clone(),
                        staged: None,
                    });
                }
                None => {}
            }
            if let Some(active) = state.active.as_ref() {
                let initial_registration = state.initial_registration.clone().ok_or_else(|| {
                    invalid_activation("active SigningWorker state has no initial registration")
                })?;
                active_identities.push(LocalEd25519YaoSigningWorkerDurableActiveStateV1 {
                    scalar: *active.scalar,
                    identity: identity.clone(),
                    binding: active.binding.clone(),
                    state_epoch: active.state_epoch,
                    activated_at_ms: active.activated_at_ms,
                    transcript: active.transcript,
                    registered_public_key: active.registered_public_key,
                    initial_registration,
                });
            }
        }
        Ok(LocalEd25519YaoSigningWorkerDurableStateV1 {
            active_identities,
            recoveries,
            retired_activations: self.retired_activations.clone(),
        })
    }

    pub(crate) fn from_durable_state_v1(
        mut state: LocalEd25519YaoSigningWorkerDurableStateV1,
    ) -> RouterAbProtocolResult<Self> {
        let mut identities = BTreeMap::new();
        for mut active in core::mem::take(&mut state.active_identities) {
            active.binding.validate()?;
            active.identity.validate_persisted_v1()?;
            validate_committed_initial_registration(&active.initial_registration)?;
            if active.identity != LocalEd25519YaoEffectiveIdentityV1::from_binding(&active.binding)
                || active.identity
                    != LocalEd25519YaoEffectiveIdentityV1::from_binding(
                        &active.initial_registration.request.deriver_a.binding,
                    )
                || !same_signing_identity(
                    &active.initial_registration.request.deriver_a.binding,
                    &active.binding,
                )
                || active.scalar.iter().all(|byte| *byte == 0)
                || active.activated_at_ms == 0
                || active.transcript.iter().all(|byte| *byte == 0)
                || active.registered_public_key.iter().all(|byte| *byte == 0)
            {
                return Err(invalid_activation(
                    "persisted SigningWorker active Yao state is invalid",
                ));
            }
            let identity = active.identity.clone();
            let identity_state = LocalEd25519YaoSigningIdentityStateV1 {
                active: Some(ActiveSigningShare {
                    scalar: Zeroizing::new(core::mem::take(&mut active.scalar)),
                    binding: active.binding.clone(),
                    state_epoch: active.state_epoch,
                    activated_at_ms: active.activated_at_ms,
                    transcript: active.transcript,
                    registered_public_key: active.registered_public_key,
                }),
                initial_registration: Some(active.initial_registration.clone()),
                ..Default::default()
            };
            if identities.insert(identity, identity_state).is_some() {
                return Err(invalid_activation(
                    "persisted SigningWorker state contains a duplicate Yao identity",
                ));
            }
        }
        for mut recovery in core::mem::take(&mut state.recoveries) {
            let deriver_a =
                validate_delivery(Ed25519YaoDeriverRoleV1::DeriverA, recovery.deriver_a.clone())?;
            let deriver_b =
                validate_delivery(Ed25519YaoDeriverRoleV1::DeriverB, recovery.deriver_b.clone())?;
            if deriver_a.binding != deriver_b.binding
                || deriver_a.binding.operation != Ed25519YaoOperationV1::Recovery
                || recovery.identity != LocalEd25519YaoEffectiveIdentityV1::from_binding(&deriver_a.binding)
            {
                return Err(invalid_activation(
                    "persisted SigningWorker recovery is invalid",
                ));
            }
            let identity_state = identities.get_mut(&recovery.identity).ok_or_else(|| {
                invalid_activation("persisted SigningWorker recovery has no active identity")
            })?;
            let promotion = recovery.promotion.clone();
            match (
                recovery.staged.as_mut(),
                identity_state.recovery_promotion.as_mut(),
            ) {
                (Some(share), staged) => {
                    if share.scalar.iter().all(|byte| *byte == 0) {
                        return Err(invalid_activation(
                            "persisted SigningWorker recovery candidate is invalid",
                        ));
                    }
                    let candidate = ActivationCandidate {
                        next_active: ActiveSigningShare {
                            scalar: Zeroizing::new(core::mem::take(&mut share.scalar)),
                            binding: share.binding.clone(),
                            state_epoch: share.state_epoch,
                            activated_at_ms: share.activated_at_ms,
                            transcript: share.transcript,
                            registered_public_key: share.registered_public_key,
                        },
                        promotion,
                        deriver_a,
                        deriver_b,
                    };
                    match staged {
                        None => {
                            identity_state.recovery_promotion =
                                Some(RecoveryPromotionState::Staged {
                                    candidates: vec![candidate],
                                });
                        }
                        Some(RecoveryPromotionState::Staged { candidates })
                            if candidates.len()
                                < LOCAL_SIGNING_WORKER_RECOVERY_STAGED_ATTEMPTS_MAX_V1
                                && candidates.iter().all(|staged| {
                                    staged.deriver_a.binding.lifecycle.lifecycle_id
                                        == candidate.deriver_a.binding.lifecycle.lifecycle_id
                                        && staged.deriver_a.binding.session_id
                                            != candidate.deriver_a.binding.session_id
                                }) =>
                        {
                            candidates.push(candidate);
                        }
                        Some(_) => {
                            return Err(invalid_activation(
                                "persisted SigningWorker recovery attempts are inconsistent",
                            ));
                        }
                    }
                }
                (None, None) => {
                    identity_state.recovery_promotion = Some(RecoveryPromotionState::Promoted {
                        promotion,
                        deriver_a,
                        deriver_b,
                    });
                }
                (None, Some(_)) => {
                    return Err(invalid_activation(
                        "persisted SigningWorker recovery attempts are inconsistent",
                    ));
                }
            }
        }
        let retired_activations = core::mem::take(&mut state.retired_activations);
        for retired in &retired_activations {
            retired.validate()?;
        }
        Ok(Self {
            identities,
            retired_activations,
        })
    }

    pub fn accept_package_pair(
        &mut self,
        config: &LocalSigningWorkerConfigV1,
        request: LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerActivationReceiptV1> {
        validate_activation_request(&request)?;
        let deriver_a =
            validate_delivery(Ed25519YaoDeriverRoleV1::DeriverA, request.deriver_a.clone())?;
        let deriver_b =
            validate_delivery(Ed25519YaoDeriverRoleV1::DeriverB, request.deriver_b.clone())?;
        if deriver_a.binding != deriver_b.binding {
            return Err(invalid_activation(
                "SigningWorker activation package pair must share one binding",
            ));
        }
        let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&deriver_a.binding);
        let state = self.activation_identity_state_mut(identity, deriver_a.binding.operation)?;
        if deriver_a.binding.operation == Ed25519YaoOperationV1::Registration
            && state.initial_registration.is_some()
        {
            return Err(invalid_activation(
                "initial registration finalization already exists",
            ));
        }
        let receipt = state.accept_package_pair(config, deriver_a, deriver_b)?;
        if request.deriver_a.binding.operation == Ed25519YaoOperationV1::Registration {
            state.initial_registration = Some(LocalEd25519YaoCommittedInitialRegistrationV1 {
                request,
                receipt: receipt.clone(),
            });
        }
        Ok(receipt)
    }

    pub fn read_initial_registration_finalization(
        &self,
        request: &LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoInitialRegistrationFinalizationV1> {
        validate_initial_registration_request(request)?;
        let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&request.deriver_a.binding);
        let Some(state) = self.identities.get(&identity) else {
            return Ok(LocalEd25519YaoInitialRegistrationFinalizationV1::Missing);
        };
        let Some(record) = state.initial_registration.as_ref() else {
            return Ok(if state.active.is_some() {
                LocalEd25519YaoInitialRegistrationFinalizationV1::Conflict
            } else {
                LocalEd25519YaoInitialRegistrationFinalizationV1::Pending
            });
        };
        if record.request != *request {
            return Ok(LocalEd25519YaoInitialRegistrationFinalizationV1::Conflict);
        }
        let Some(active) = state.active.as_ref() else {
            return Ok(LocalEd25519YaoInitialRegistrationFinalizationV1::Pending);
        };
        let LocalEd25519YaoSigningWorkerActivationReceiptV1::Active {
            registered_public_key,
            ..
        } = &record.receipt
        else {
            return Ok(LocalEd25519YaoInitialRegistrationFinalizationV1::Conflict);
        };
        if active.binding != request.deriver_a.binding
            || active.state_epoch != Ed25519YaoStateEpochV1::new(1)?
            || active.transcript != request.deriver_a.package.transcript()
            || active.registered_public_key != *registered_public_key
        {
            return Ok(LocalEd25519YaoInitialRegistrationFinalizationV1::Conflict);
        }
        Ok(
            LocalEd25519YaoInitialRegistrationFinalizationV1::Committed {
                receipt: record.receipt.clone(),
            },
        )
    }

    pub fn promote_recovery_candidate(
        &mut self,
        request: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerActivationReceiptV1> {
        let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&request.binding);
        let state = self.identities.get_mut(&identity).ok_or_else(|| {
            invalid_activation("SigningWorker has no active state for this recovery identity")
        })?;
        let previous = state
            .active
            .as_ref()
            .map(|active| active.binding.material_activation.clone());
        let receipt = state.promote_recovery_candidate(request)?;
        let promoted = state
            .active
            .as_ref()
            .map(|active| active.binding.material_activation.clone());
        if let Some(previous) = previous {
            if promoted.as_ref() != Some(&previous) && !self.retired_activations.contains(&previous)
            {
                self.retired_activations.push(previous);
            }
        }
        Ok(receipt)
    }

    pub fn accept_refresh_deriver_a(
        &mut self,
        config: &LocalSigningWorkerConfigV1,
        request: LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerRefreshReceiptV1> {
        let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(request.binding.ceremony());
        self.identities
            .get_mut(&identity)
            .ok_or_else(|| {
                invalid_activation("SigningWorker has no active state for this refresh identity")
            })?
            .accept_refresh_deriver_a(config, request)
    }

    pub fn accept_refresh_deriver_b(
        &mut self,
        config: &LocalSigningWorkerConfigV1,
        request: LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerRefreshReceiptV1> {
        let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(request.binding.ceremony());
        self.identities
            .get_mut(&identity)
            .ok_or_else(|| {
                invalid_activation("SigningWorker has no active state for this refresh identity")
            })?
            .accept_refresh_deriver_b(config, request)
    }

    pub fn normal_signing_material(
        &self,
        config: &LocalSigningWorkerConfigV1,
        scope: &NormalSigningScopeV1,
        pinned_wallet_scope: Option<&CloudflareSigningWorkerWalletScopeV1>,
        metadata: &router_ab_cloudflare::CloudflareRouterNormalSigningTrustedMetadataV1,
    ) -> RouterAbProtocolResult<(
        ActiveSigningWorkerStateV1,
        CloudflareServerOutputMaterialRecordV1,
    )> {
        if self
            .retired_activations
            .contains(&scope.material_activation)
        {
            return Err(router_ab_cloudflare::signing_worker_activation_retired_error_v1());
        }
        let identity = self.identity_for_scope(scope)?;
        let state = self
            .identities
            .get(&identity)
            .expect("normal-signing identity was selected from the same map");
        let active_state = state.active_normal_signing_state(config, scope)?;
        let registered_scope = &state
            .initial_registration
            .as_ref()
            .ok_or_else(|| invalid_normal_signing("SigningWorker has no registered wallet scope"))?
            .request
            .scope;
        router_ab_cloudflare::require_signing_worker_normal_signing_wallet_scope_v1(
            registered_scope,
            pinned_wallet_scope,
            metadata,
            &scope.account_id,
        )?;
        let active = state.active.as_ref().ok_or_else(|| {
            invalid_normal_signing("SigningWorker has no active Yao signing share")
        })?;
        let material = CloudflareServerOutputMaterialRecordV1::new(
            PublicDigest32::new(active.transcript),
            OpenedShareKind::XServerBase,
            Role::Server,
            config.signing_worker_id.clone(),
            CloudflareSecretMaterial32V1::new(*active.scalar),
        )?;
        Ok((active_state, material))
    }

    pub fn active_public_key(&self) -> Option<&[u8; 32]> {
        self.sole_identity_state()?.active_public_key()
    }

    pub fn active_signing_share(&self) -> Option<&[u8; 32]> {
        self.sole_identity_state()?.active_signing_share()
    }

    pub fn active_binding(&self) -> Option<&Ed25519YaoCeremonyBindingV1> {
        self.sole_identity_state()?.active_binding()
    }

    pub fn active_transcript(&self) -> Option<&[u8; 32]> {
        self.sole_identity_state()?.active_transcript()
    }

    pub fn active_state_epoch(&self) -> Option<Ed25519YaoStateEpochV1> {
        self.sole_identity_state()?.active_state_epoch()
    }

    fn activation_identity_state_mut(
        &mut self,
        identity: LocalEd25519YaoEffectiveIdentityV1,
        operation: Ed25519YaoOperationV1,
    ) -> RouterAbProtocolResult<&mut LocalEd25519YaoSigningIdentityStateV1> {
        match operation {
            Ed25519YaoOperationV1::Registration => Ok(self.identities.entry(identity).or_default()),
            Ed25519YaoOperationV1::Recovery => {
                self.identities.get_mut(&identity).ok_or_else(|| {
                    invalid_activation(
                        "SigningWorker recovery requires active state for this identity",
                    )
                })
            }
            Ed25519YaoOperationV1::Refresh
            | Ed25519YaoOperationV1::Export
            | Ed25519YaoOperationV1::LaneProvisioning
            | Ed25519YaoOperationV1::LaneRefresh => Err(invalid_activation(
                "SigningWorker activation operation is invalid",
            )),
        }
    }

    fn identity_for_scope(
        &self,
        scope: &NormalSigningScopeV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoEffectiveIdentityV1> {
        let mut selected = None;
        for (identity, state) in &self.identities {
            let Some(active) = state.active.as_ref() else {
                continue;
            };
            if active.binding.lifecycle.account_id != scope.account_id
                || active.binding.material_activation != scope.material_activation
                || active.binding.lifecycle.selected_server_id != scope.signing_worker_id
            {
                continue;
            }
            if selected.is_some() {
                return Err(invalid_normal_signing(
                    "normal-signing scope matches multiple Yao identities",
                ));
            }
            selected = Some(identity.clone());
        }
        selected.ok_or_else(|| {
            invalid_normal_signing("normal-signing scope does not match active Yao lifecycle")
        })
    }

    fn sole_identity_state(&self) -> Option<&LocalEd25519YaoSigningIdentityStateV1> {
        if self.identities.len() != 1 {
            return None;
        }
        self.identities.values().next()
    }
}

impl LocalEd25519YaoSigningIdentityStateV1 {
    fn accept_package_pair(
        &mut self,
        config: &LocalSigningWorkerConfigV1,
        deriver_a: PendingDelivery,
        deriver_b: PendingDelivery,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerActivationReceiptV1> {
        if deriver_a.binding.operation == Ed25519YaoOperationV1::Recovery {
            if let Some(receipt) = self.settle_recovery_delivery(&deriver_a, &deriver_b)? {
                return Ok(receipt);
            }
        }
        self.validate_activation_transition(&deriver_a.binding)?;
        let state_epoch = self.activation_state_epoch(&deriver_a.binding)?;
        let activated = activate(config, deriver_a, deriver_b, state_epoch)?;
        self.commit_activation_candidate(activated)
    }

    /// A recovery delivery against the recovery staged or promoted here, as
    /// the Workers SigningWorker settles it. The same deliveries answer again.
    /// Each attempt of a staged recovery keeps its own candidate, so a late
    /// delivery from a superseded attempt displaces none; another attempt of
    /// a promoted recovery is stale. A new attempt goes on to stage beside the
    /// others, and anything else is refused while a recovery is pending.
    fn settle_recovery_delivery(
        &mut self,
        deriver_a: &PendingDelivery,
        deriver_b: &PendingDelivery,
    ) -> RouterAbProtocolResult<Option<LocalEd25519YaoSigningWorkerActivationReceiptV1>> {
        let lifecycle_id = &deriver_a.binding.lifecycle.lifecycle_id;
        match &self.recovery_promotion {
            Some(RecoveryPromotionState::Staged { candidates }) => {
                if candidates.iter().any(|candidate| {
                    candidate.deriver_a.binding.lifecycle.lifecycle_id != *lifecycle_id
                }) {
                    return Err(invalid_activation(
                        "SigningWorker recovery promotion is pending",
                    ));
                }
                let session = deriver_a.binding.session_id.into_bytes();
                if let Some(candidate) = candidates.iter().find(|candidate| {
                    candidate.deriver_a.binding.session_id.into_bytes() == session
                }) {
                    if candidate.deriver_a == *deriver_a && candidate.deriver_b == *deriver_b {
                        return Ok(Some(
                            LocalEd25519YaoSigningWorkerActivationReceiptV1::Staged {
                                promotion: candidate.promotion.clone(),
                            },
                        ));
                    }
                    return Err(invalid_activation(
                        "SigningWorker recovery attempt delivered different packages",
                    ));
                }
                Ok(None)
            }
            Some(RecoveryPromotionState::Promoted {
                promotion,
                deriver_a: promoted_a,
                deriver_b: promoted_b,
            }) => {
                if promoted_a == deriver_a && promoted_b == deriver_b {
                    return Ok(Some(LocalEd25519YaoSigningWorkerActivationReceiptV1::Staged {
                        promotion: promotion.clone(),
                    }));
                }
                if promoted_a.binding.lifecycle.lifecycle_id == *lifecycle_id {
                    return Err(invalid_activation(
                        "SigningWorker recovery was already promoted by another attempt",
                    ));
                }
                Ok(None)
            }
            None => Ok(None),
        }
    }

    pub fn promote_recovery_candidate(
        &mut self,
        request: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerActivationReceiptV1> {
        validate_recovery_promotion_request(&request)?;
        let index = match self.recovery_promotion.as_ref() {
            None => {
                return Err(invalid_activation(
                    "SigningWorker has no staged recovery candidate",
                ))
            }
            Some(RecoveryPromotionState::Promoted { promotion, .. }) => {
                if promotion != &request {
                    return Err(invalid_activation(
                        "recovery promotion does not match the staged candidate",
                    ));
                }
                return Ok(active_activation_receipt(&request));
            }
            Some(RecoveryPromotionState::Staged { candidates }) => {
                let index = candidates
                    .iter()
                    .position(|candidate| candidate.promotion == request)
                    .ok_or_else(|| {
                        invalid_activation("recovery promotion does not match the staged candidate")
                    })?;
                self.validate_recovery_candidate(&candidates[index].next_active)?;
                index
            }
        };
        let Some(RecoveryPromotionState::Staged { mut candidates }) =
            self.recovery_promotion.take()
        else {
            unreachable!("recovery promotion state was checked above");
        };
        let ActivationCandidate {
            next_active,
            promotion,
            deriver_a,
            deriver_b,
        } = candidates.swap_remove(index);
        self.active = Some(next_active);
        self.recovery_promotion = Some(RecoveryPromotionState::Promoted {
            promotion,
            deriver_a,
            deriver_b,
        });
        Ok(active_activation_receipt(&request))
    }

    pub fn accept_refresh_deriver_a(
        &mut self,
        config: &LocalSigningWorkerConfigV1,
        request: LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerRefreshReceiptV1> {
        self.validate_refresh_transition(&request.binding)?;
        let pending = validate_refresh_delivery(Ed25519YaoDeriverRoleV1::DeriverA, request)?;
        if self.pending_refresh_a.is_some() {
            return Err(invalid_activation(
                "Deriver A refresh delivery slot is occupied",
            ));
        }
        let receipt = pending_refresh_receipt(Ed25519YaoDeriverRoleV1::DeriverA, &pending);
        if let Some(pending_b) = self.pending_refresh_b.as_ref() {
            let activated = activate_refresh(config, pending, pending_b.clone())?;
            let receipt = self.commit_refresh_candidate(activated)?;
            self.pending_refresh_b = None;
            return Ok(receipt);
        }
        self.pending_refresh_a = Some(pending);
        Ok(receipt)
    }

    pub fn accept_refresh_deriver_b(
        &mut self,
        config: &LocalSigningWorkerConfigV1,
        request: LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerRefreshReceiptV1> {
        self.validate_refresh_transition(&request.binding)?;
        let pending = validate_refresh_delivery(Ed25519YaoDeriverRoleV1::DeriverB, request)?;
        if self.pending_refresh_b.is_some() {
            return Err(invalid_activation(
                "Deriver B refresh delivery slot is occupied",
            ));
        }
        let receipt = pending_refresh_receipt(Ed25519YaoDeriverRoleV1::DeriverB, &pending);
        if let Some(pending_a) = self.pending_refresh_a.as_ref() {
            let activated = activate_refresh(config, pending_a.clone(), pending)?;
            let receipt = self.commit_refresh_candidate(activated)?;
            self.pending_refresh_a = None;
            return Ok(receipt);
        }
        self.pending_refresh_b = Some(pending);
        Ok(receipt)
    }

    pub fn active_public_key(&self) -> Option<&[u8; 32]> {
        self.active
            .as_ref()
            .map(|active| &active.registered_public_key)
    }

    pub fn active_signing_share(&self) -> Option<&[u8; 32]> {
        self.active.as_ref().map(|active| &*active.scalar)
    }

    pub fn active_binding(&self) -> Option<&Ed25519YaoCeremonyBindingV1> {
        self.active.as_ref().map(|active| &active.binding)
    }

    pub fn active_transcript(&self) -> Option<&[u8; 32]> {
        self.active.as_ref().map(|active| &active.transcript)
    }

    pub fn active_state_epoch(&self) -> Option<Ed25519YaoStateEpochV1> {
        self.active.as_ref().map(|active| active.state_epoch)
    }

    fn active_normal_signing_state(
        &self,
        config: &LocalSigningWorkerConfigV1,
        scope: &NormalSigningScopeV1,
    ) -> RouterAbProtocolResult<ActiveSigningWorkerStateV1> {
        let active = self.active.as_ref().ok_or_else(|| {
            invalid_normal_signing("SigningWorker has no active Yao signing share")
        })?;
        if active.binding.lifecycle.account_id != scope.account_id
            || active.binding.material_activation != scope.material_activation
            || active.binding.lifecycle.selected_server_id != scope.signing_worker_id
        {
            return Err(invalid_normal_signing(
                "normal-signing scope does not match active Yao lifecycle",
            ));
        }
        let public_key = format!(
            "ed25519:{}",
            bs58::encode(active.registered_public_key).into_string()
        );
        let state = ActiveSigningWorkerStateV1::new(
            scope.account_id.clone(),
            scope.material_activation.clone(),
            public_key,
            ServerIdentityV1::new(
                config.signing_worker_id.clone(),
                config.signing_worker_key_epoch.clone(),
                config.server_output_hpke_public_key.clone(),
            )?,
            PublicDigest32::new(active.transcript),
            PublicDigest32::new(active.registered_public_key),
            format!(
                "ed25519-yao/{}/{}",
                active.binding.lifecycle.lifecycle_id,
                active.state_epoch.get()
            ),
            active.activated_at_ms,
        )?;
        state.validate_for_scope(scope)?;
        Ok(state)
    }

    fn commit_activation_candidate(
        &mut self,
        candidate: ActivationCandidate,
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerActivationReceiptV1> {
        validate_activation_candidate(&candidate)?;
        match candidate.next_active.binding.operation {
            Ed25519YaoOperationV1::Registration => {
                if self.active.is_some()
                    || candidate.next_active.state_epoch != Ed25519YaoStateEpochV1::new(1)?
                {
                    return Err(invalid_activation(
                        "registration activation requires an empty state at epoch one",
                    ));
                }
                let receipt = active_activation_receipt(&candidate.promotion);
                self.active = Some(candidate.next_active);
                Ok(receipt)
            }
            Ed25519YaoOperationV1::Recovery => {
                self.validate_recovery_candidate(&candidate.next_active)?;
                let receipt = LocalEd25519YaoSigningWorkerActivationReceiptV1::Staged {
                    promotion: candidate.promotion.clone(),
                };
                match self.recovery_promotion.as_mut() {
                    Some(RecoveryPromotionState::Staged { candidates }) => {
                        if candidates.len() == LOCAL_SIGNING_WORKER_RECOVERY_STAGED_ATTEMPTS_MAX_V1
                        {
                            candidates.remove(0);
                        }
                        candidates.push(candidate);
                    }
                    Some(RecoveryPromotionState::Promoted { .. }) | None => {
                        self.recovery_promotion = Some(RecoveryPromotionState::Staged {
                            candidates: vec![candidate],
                        });
                    }
                }
                Ok(receipt)
            }
            _ => Err(invalid_activation(
                "SigningWorker activation candidate operation is invalid",
            )),
        }
    }

    fn commit_refresh_candidate(
        &mut self,
        candidate: (
            ActiveSigningShare,
            LocalEd25519YaoSigningWorkerRefreshReceiptV1,
        ),
    ) -> RouterAbProtocolResult<LocalEd25519YaoSigningWorkerRefreshReceiptV1> {
        if matches!(
            self.recovery_promotion,
            Some(RecoveryPromotionState::Staged { .. })
        ) {
            return Err(invalid_activation(
                "SigningWorker recovery promotion is pending",
            ));
        }
        let (next_active, receipt) = candidate;
        let current = self
            .active
            .as_ref()
            .ok_or_else(|| invalid_activation("refresh requires an active Yao signing share"))?;
        if next_active.registered_public_key != current.registered_public_key
            || next_active.state_epoch <= current.state_epoch
        {
            return Err(invalid_activation(
                "refresh candidate did not preserve the active public identity and advance epoch",
            ));
        }
        self.active = Some(next_active);
        Ok(receipt)
    }

    fn validate_activation_transition(
        &self,
        binding: &Ed25519YaoCeremonyBindingV1,
    ) -> RouterAbProtocolResult<()> {
        if let Some(RecoveryPromotionState::Staged { candidates }) = &self.recovery_promotion {
            let another_attempt = binding.operation == Ed25519YaoOperationV1::Recovery
                && candidates.iter().all(|candidate| {
                    candidate.deriver_a.binding.lifecycle.lifecycle_id
                        == binding.lifecycle.lifecycle_id
                });
            if !another_attempt {
                return Err(invalid_activation(
                    "SigningWorker recovery promotion is pending",
                ));
            }
        }
        if self.pending_refresh_a.is_some() || self.pending_refresh_b.is_some() {
            return Err(invalid_activation(
                "SigningWorker refresh package delivery is in progress",
            ));
        }
        match (&self.active, binding.operation) {
            (None, Ed25519YaoOperationV1::Registration) => Ok(()),
            (Some(active), Ed25519YaoOperationV1::Recovery)
                if same_signing_identity(&active.binding, binding) =>
            {
                Ok(())
            }
            (None, Ed25519YaoOperationV1::Recovery) => Err(invalid_activation(
                "recovery requires an active Yao signing share",
            )),
            (Some(_), Ed25519YaoOperationV1::Registration) => Err(invalid_activation(
                "SigningWorker already has an active Yao signing share",
            )),
            _ => Err(invalid_activation(
                "SigningWorker activation transition is invalid",
            )),
        }
    }

    fn validate_refresh_transition(
        &self,
        binding: &Ed25519YaoRefreshBindingV1,
    ) -> RouterAbProtocolResult<()> {
        binding.ceremony().validate()?;
        if matches!(
            self.recovery_promotion,
            Some(RecoveryPromotionState::Staged { .. })
        ) {
            return Err(invalid_activation(
                "SigningWorker recovery promotion is pending",
            ));
        }
        let active = self
            .active
            .as_ref()
            .ok_or_else(|| invalid_activation("refresh requires an active Yao signing share"))?;
        let transition = binding.epochs().signing_worker;
        if !same_signing_identity(&active.binding, binding.ceremony())
            || active.binding.material_activation != binding.ceremony().material_activation
            || binding.registered_public_key() != &active.registered_public_key
            || transition.current() != active.state_epoch
        {
            return Err(invalid_activation(
                "refresh binding does not match the active SigningWorker state",
            ));
        }
        Ok(())
    }

    fn activation_state_epoch(
        &self,
        binding: &Ed25519YaoCeremonyBindingV1,
    ) -> RouterAbProtocolResult<Ed25519YaoStateEpochV1> {
        match binding.operation {
            Ed25519YaoOperationV1::Registration => Ed25519YaoStateEpochV1::new(1),
            Ed25519YaoOperationV1::Recovery => self.next_recovery_state_epoch(),
            _ => Err(invalid_activation(
                "SigningWorker activation operation is invalid",
            )),
        }
    }

    fn next_recovery_state_epoch(&self) -> RouterAbProtocolResult<Ed25519YaoStateEpochV1> {
        let current = self
            .active
            .as_ref()
            .ok_or_else(|| invalid_activation("recovery requires an active Yao signing share"))?;
        let next =
            current.state_epoch.get().checked_add(1).ok_or_else(|| {
                invalid_activation("SigningWorker recovery state epoch is exhausted")
            })?;
        Ed25519YaoStateEpochV1::new(next)
    }

    fn validate_recovery_candidate(
        &self,
        candidate: &ActiveSigningShare,
    ) -> RouterAbProtocolResult<()> {
        let current = self
            .active
            .as_ref()
            .ok_or_else(|| invalid_activation("recovery requires an active Yao signing share"))?;
        if candidate.binding.operation != Ed25519YaoOperationV1::Recovery
            || !same_signing_identity(&current.binding, &candidate.binding)
            || candidate.registered_public_key != current.registered_public_key
            || candidate.state_epoch != self.next_recovery_state_epoch()?
        {
            return Err(invalid_activation(
                "recovery candidate does not preserve the public identity at the exact next epoch",
            ));
        }
        Ok(())
    }
}

fn same_signing_identity(
    active: &Ed25519YaoCeremonyBindingV1,
    recovery: &Ed25519YaoCeremonyBindingV1,
) -> bool {
    active.stable_key_context_binding == recovery.stable_key_context_binding
        && active.lifecycle.root_share_epoch == recovery.lifecycle.root_share_epoch
        && active.lifecycle.account_id == recovery.lifecycle.account_id
        && active.lifecycle.signer_set_id == recovery.lifecycle.signer_set_id
        && active.lifecycle.selected_server_id == recovery.lifecycle.selected_server_id
}

fn validate_activation_request(
    request: &LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
) -> RouterAbProtocolResult<()> {
    request.scope.validate()?;
    let a = &request.deriver_a;
    let b = &request.deriver_b;
    a.binding.validate()?;
    if !matches!(
        a.binding.operation,
        Ed25519YaoOperationV1::Registration | Ed25519YaoOperationV1::Recovery
    ) || a.binding != b.binding
        || request.scope.wallet_id != a.binding.lifecycle.account_id
    {
        return Err(invalid_activation(
            "activation scope or binding differs from its package pair",
        ));
    }
    for (delivery, client, role) in [
        (
            a,
            &request.deriver_a_client_package,
            Ed25519YaoDeriverRoleV1::DeriverA,
        ),
        (
            b,
            &request.deriver_b_client_package,
            Ed25519YaoDeriverRoleV1::DeriverB,
        ),
    ] {
        delivery.package.validate()?;
        client.validate()?;
        if delivery.package.kind() != Ed25519YaoPackageKindV1::ActivationSigningWorker
            || delivery.package.deriver() != role
            || client.kind() != Ed25519YaoPackageKindV1::ActivationClient
            || client.deriver() != role
            || delivery.package.session() != a.binding.session_id.into_bytes()
            || client.session() != a.binding.session_id.into_bytes()
            || delivery.package.transcript() != client.transcript()
        {
            return Err(invalid_activation(
                "activation package role or transcript is invalid",
            ));
        }
    }
    if a.package.transcript() != b.package.transcript() {
        return Err(invalid_activation("activation package transcripts differ"));
    }
    Ok(())
}

fn validate_initial_registration_request(
    request: &LocalEd25519YaoSigningWorkerPackagePairDeliveryV1,
) -> RouterAbProtocolResult<()> {
    validate_activation_request(request)?;
    if request.deriver_a.binding.operation != Ed25519YaoOperationV1::Registration {
        return Err(invalid_activation(
            "finalization lookup requires initial registration",
        ));
    }
    Ok(())
}

fn validate_committed_initial_registration(
    record: &LocalEd25519YaoCommittedInitialRegistrationV1,
) -> RouterAbProtocolResult<()> {
    validate_initial_registration_request(&record.request)?;
    let LocalEd25519YaoSigningWorkerActivationReceiptV1::Active {
        session,
        transcript,
        registered_public_key,
        joined_client_commitment,
        joined_signing_worker_commitment,
        signing_worker_verifying_share,
        state_epoch,
    } = &record.receipt
    else {
        return Err(invalid_activation(
            "initial registration finalization is not active",
        ));
    };
    let a = &record.request.deriver_a;
    let b = &record.request.deriver_b;
    let expected = derive_registration_receipt(ActivationPublicCommitments::new(
        a.client_commitment,
        b.client_commitment,
        a.signing_worker_commitment,
        b.signing_worker_commitment,
    ))
    .map_err(map_role_error)?;
    if *session != a.binding.session_id.into_bytes()
        || *transcript != a.package.transcript()
        || registered_public_key != expected.registered_public_key()
        || joined_client_commitment != expected.joined_client_commitment()
        || joined_signing_worker_commitment != expected.joined_signing_worker_commitment()
        || signing_worker_verifying_share != joined_signing_worker_commitment
        || *state_epoch != Ed25519YaoStateEpochV1::new(1)?
    {
        return Err(invalid_activation(
            "initial registration finalization differs from its packages",
        ));
    }
    Ok(())
}

fn delivery_request(delivery: &PendingDelivery) -> LocalEd25519YaoSigningWorkerPackageDeliveryV1 {
    LocalEd25519YaoSigningWorkerPackageDeliveryV1 {
        binding: delivery.binding.clone(),
        client_commitment: delivery.client_commitment,
        signing_worker_commitment: delivery.signing_worker_commitment,
        package: delivery.package.clone(),
    }
}

fn validate_delivery(
    expected_deriver: Ed25519YaoDeriverRoleV1,
    request: LocalEd25519YaoSigningWorkerPackageDeliveryV1,
) -> RouterAbProtocolResult<PendingDelivery> {
    request.binding.validate()?;
    if !matches!(
        request.binding.operation,
        Ed25519YaoOperationV1::Registration | Ed25519YaoOperationV1::Recovery
    ) {
        return Err(invalid_activation(
            "SigningWorker activation requires registration or recovery",
        ));
    }
    request.package.validate()?;
    if request.package.kind() != Ed25519YaoPackageKindV1::ActivationSigningWorker
        || request.package.deriver() != expected_deriver
        || request.package.session() != request.binding.session_id.into_bytes()
    {
        return Err(invalid_activation(
            "SigningWorker package role, family, or session is invalid",
        ));
    }
    Ok(PendingDelivery {
        binding: request.binding,
        client_commitment: request.client_commitment,
        signing_worker_commitment: request.signing_worker_commitment,
        package: request.package,
    })
}

fn validate_refresh_delivery(
    expected_deriver: Ed25519YaoDeriverRoleV1,
    request: LocalEd25519YaoSigningWorkerRefreshPackageDeliveryV1,
) -> RouterAbProtocolResult<PendingRefreshDelivery> {
    request.binding.ceremony().validate()?;
    request.package.validate()?;
    if request.package.kind() != Ed25519YaoPackageKindV1::ActivationSigningWorker
        || request.package.deriver() != expected_deriver
        || request.package.session() != request.binding.ceremony().session_id.into_bytes()
    {
        return Err(invalid_activation(
            "SigningWorker refresh package role, family, or session is invalid",
        ));
    }
    Ok(PendingRefreshDelivery {
        binding: request.binding,
        client_commitment: request.client_commitment,
        signing_worker_commitment: request.signing_worker_commitment,
        package: request.package,
    })
}

fn pending_refresh_receipt(
    accepted_deriver: Ed25519YaoDeriverRoleV1,
    pending: &PendingRefreshDelivery,
) -> LocalEd25519YaoSigningWorkerRefreshReceiptV1 {
    let transition = pending.binding.epochs().signing_worker;
    LocalEd25519YaoSigningWorkerRefreshReceiptV1::Pending {
        accepted_deriver,
        session: pending.package.session(),
        transcript: pending.package.transcript(),
        current_epoch: transition.current(),
        next_epoch: transition.next(),
    }
}

fn activate(
    config: &LocalSigningWorkerConfigV1,
    a: PendingDelivery,
    b: PendingDelivery,
    state_epoch: Ed25519YaoStateEpochV1,
) -> RouterAbProtocolResult<ActivationCandidate> {
    if a.binding != b.binding || a.package.transcript() != b.package.transcript() {
        return Err(invalid_activation(
            "SigningWorker activation package bindings do not match",
        ));
    }
    let private_key = parse_private_key(&config.server_output_hpke_private_key)?;
    let mut a_plaintext =
        open_local_ed25519_yao_signing_worker_package_v1(&a.package, &private_key)?;
    let mut b_plaintext =
        open_local_ed25519_yao_signing_worker_package_v1(&b.package, &private_key)?;
    let a_package =
        ActivationDeriverASigningWorkerPackage::from_bytes(core::mem::take(&mut *a_plaintext))
            .map_err(map_role_error)?;
    let b_package =
        ActivationDeriverBSigningWorkerPackage::from_bytes(core::mem::take(&mut *b_plaintext))
            .map_err(map_role_error)?;
    let session = a.binding.session_id.into_bytes();
    let transcript = a.package.transcript();
    let scalar =
        combine_signing_worker_activation_packages(session, transcript, a_package, b_package)
            .map_err(map_role_error)?;
    let scalar = signing_scalar(scalar);
    let commitments = ActivationPublicCommitments::new(
        a.client_commitment,
        b.client_commitment,
        a.signing_worker_commitment,
        b.signing_worker_commitment,
    );
    let public_receipt = derive_registration_receipt(commitments).map_err(map_role_error)?;
    let signing_worker_verifying_share = verifying_share_bytes_from_signing_share_bytes(&scalar);
    if &signing_worker_verifying_share != public_receipt.joined_signing_worker_commitment() {
        return Err(invalid_activation(
            "SigningWorker share does not match the public activation commitment",
        ));
    }
    let registered_public_key = *public_receipt.registered_public_key();
    let binding = a.binding.clone();
    let next_active = ActiveSigningShare {
        scalar,
        binding: binding.clone(),
        state_epoch,
        activated_at_ms: now_unix_ms()?,
        transcript,
        registered_public_key,
    };
    let promotion = LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1 {
        binding,
        session,
        transcript,
        registered_public_key,
        joined_client_commitment: *public_receipt.joined_client_commitment(),
        joined_signing_worker_commitment: *public_receipt.joined_signing_worker_commitment(),
        signing_worker_verifying_share,
        state_epoch,
    };
    Ok(ActivationCandidate {
        next_active,
        promotion,
        deriver_a: a,
        deriver_b: b,
    })
}

fn active_activation_receipt(
    promotion: &LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
) -> LocalEd25519YaoSigningWorkerActivationReceiptV1 {
    LocalEd25519YaoSigningWorkerActivationReceiptV1::Active {
        session: promotion.session,
        transcript: promotion.transcript,
        registered_public_key: promotion.registered_public_key,
        joined_client_commitment: promotion.joined_client_commitment,
        joined_signing_worker_commitment: promotion.joined_signing_worker_commitment,
        signing_worker_verifying_share: promotion.signing_worker_verifying_share,
        state_epoch: promotion.state_epoch,
    }
}

fn validate_activation_candidate(candidate: &ActivationCandidate) -> RouterAbProtocolResult<()> {
    let active = &candidate.next_active;
    let promotion = &candidate.promotion;
    if promotion.binding != active.binding
        || promotion.session != active.binding.session_id.into_bytes()
        || promotion.transcript != active.transcript
        || promotion.registered_public_key != active.registered_public_key
        || promotion.state_epoch != active.state_epoch
        || promotion.joined_signing_worker_commitment != promotion.signing_worker_verifying_share
        || candidate.deriver_a.binding != active.binding
        || candidate.deriver_b.binding != active.binding
    {
        return Err(invalid_activation(
            "SigningWorker activation candidate metadata is inconsistent",
        ));
    }
    Ok(())
}

fn validate_recovery_promotion_request(
    request: &LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1,
) -> RouterAbProtocolResult<()> {
    request.binding.validate()?;
    if request.binding.operation != Ed25519YaoOperationV1::Recovery
        || request.session != request.binding.session_id.into_bytes()
        || request.transcript.iter().all(|byte| *byte == 0)
        || request.registered_public_key.iter().all(|byte| *byte == 0)
        || request
            .joined_client_commitment
            .iter()
            .all(|byte| *byte == 0)
        || request
            .joined_signing_worker_commitment
            .iter()
            .all(|byte| *byte == 0)
        || request
            .signing_worker_verifying_share
            .iter()
            .all(|byte| *byte == 0)
        || request.joined_signing_worker_commitment != request.signing_worker_verifying_share
    {
        return Err(invalid_activation(
            "SigningWorker recovery promotion request is invalid",
        ));
    }
    Ok(())
}

fn activate_refresh(
    config: &LocalSigningWorkerConfigV1,
    a: PendingRefreshDelivery,
    b: PendingRefreshDelivery,
) -> RouterAbProtocolResult<(
    ActiveSigningShare,
    LocalEd25519YaoSigningWorkerRefreshReceiptV1,
)> {
    if a.binding != b.binding || a.package.transcript() != b.package.transcript() {
        return Err(invalid_activation(
            "SigningWorker refresh package bindings do not match",
        ));
    }
    let private_key = parse_private_key(&config.server_output_hpke_private_key)?;
    let mut a_plaintext =
        open_local_ed25519_yao_signing_worker_package_v1(&a.package, &private_key)?;
    let mut b_plaintext =
        open_local_ed25519_yao_signing_worker_package_v1(&b.package, &private_key)?;
    let a_package =
        ActivationDeriverASigningWorkerPackage::from_bytes(core::mem::take(&mut *a_plaintext))
            .map_err(map_role_error)?;
    let b_package =
        ActivationDeriverBSigningWorkerPackage::from_bytes(core::mem::take(&mut *b_plaintext))
            .map_err(map_role_error)?;
    let session = a.binding.ceremony().session_id.into_bytes();
    let transcript = a.package.transcript();
    let scalar =
        combine_signing_worker_activation_packages(session, transcript, a_package, b_package)
            .map_err(map_role_error)?;
    let scalar = signing_scalar(scalar);
    let commitments = ActivationPublicCommitments::new(
        a.client_commitment,
        b.client_commitment,
        a.signing_worker_commitment,
        b.signing_worker_commitment,
    );
    let public_receipt = derive_registration_receipt(commitments).map_err(map_role_error)?;
    let signing_worker_verifying_share = verifying_share_bytes_from_signing_share_bytes(&scalar);
    if &signing_worker_verifying_share != public_receipt.joined_signing_worker_commitment()
        || public_receipt.registered_public_key() != a.binding.registered_public_key()
    {
        return Err(invalid_activation(
            "SigningWorker refresh did not preserve the admitted public identity",
        ));
    }
    let registered_public_key = *public_receipt.registered_public_key();
    let state_epoch = a.binding.epochs().signing_worker.next();
    let active = ActiveSigningShare {
        scalar,
        binding: a.binding.ceremony().clone(),
        state_epoch,
        activated_at_ms: now_unix_ms()?,
        transcript,
        registered_public_key,
    };
    let receipt = LocalEd25519YaoSigningWorkerRefreshReceiptV1::Active {
        session,
        transcript,
        registered_public_key,
        signing_worker_verifying_share,
        state_epoch,
    };
    Ok((active, receipt))
}

fn signing_scalar(value: SigningWorkerBaseScalar) -> Zeroizing<[u8; 32]> {
    Zeroizing::new(value.into_bytes())
}

pub(crate) fn now_unix_ms() -> RouterAbProtocolResult<u64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| invalid_normal_signing("system clock precedes Unix epoch"))?
        .as_millis();
    u64::try_from(millis)
        .map_err(|_| invalid_normal_signing("system clock exceeds supported range"))
}

fn parse_private_key(value: &str) -> RouterAbProtocolResult<LocalEd25519YaoRecipientPrivateKeyV1> {
    let bytes = hex::decode(value).map_err(|_| {
        invalid_activation("SigningWorker recipient private key must be lowercase hex")
    })?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        invalid_activation("SigningWorker recipient private key must contain 32 bytes")
    })?;
    Ok(LocalEd25519YaoRecipientPrivateKeyV1::from_bytes(bytes))
}

fn map_role_error(_: router_ab_ed25519_yao::relay::BenchmarkRoleError) -> RouterAbProtocolError {
    invalid_activation("SigningWorker recipient package validation failed")
}

fn invalid_activation(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

fn invalid_normal_signing(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use router_ab_core::{
        Ed25519YaoEpochTransitionV1, Ed25519YaoRefreshEpochsV1, Ed25519YaoSessionIdV1,
        Ed25519YaoStableKeyContextBindingV1, MpcMaterialActivationRefV1,
        NormalSigningAuthorizationV1, RootShareEpoch, RouterAbEd25519YaoLifecycleScopeV1,
    };

    #[test]
    fn recovery_stages_exact_next_epoch_and_promotes_only_the_exact_candidate() {
        let mut state = LocalEd25519YaoSigningIdentityStateV1::default();
        let public_key = [0x71; 32];
        let registration = activation_candidate(
            ceremony_binding(Ed25519YaoOperationV1::Registration, 0x11),
            epoch(1),
            [0x21; 32],
            public_key,
            0x31,
        );
        let registration_receipt = state
            .commit_activation_candidate(registration)
            .expect("registration activation");
        assert!(matches!(
            registration_receipt,
            LocalEd25519YaoSigningWorkerActivationReceiptV1::Active { state_epoch, .. }
                if state_epoch == epoch(1)
        ));

        let recovery = activation_candidate(
            ceremony_binding(Ed25519YaoOperationV1::Recovery, 0x12),
            epoch(2),
            [0x22; 32],
            public_key,
            0x32,
        );
        let staged = state
            .commit_activation_candidate(recovery)
            .expect("stage recovery");
        let LocalEd25519YaoSigningWorkerActivationReceiptV1::Staged { promotion } = staged else {
            panic!("recovery must remain staged");
        };
        assert_eq!(state.active_state_epoch(), Some(epoch(1)));
        assert_eq!(state.active_signing_share(), Some(&[0x21; 32]));

        let mut conflicting = promotion.clone();
        conflicting.transcript[0] ^= 1;
        assert!(state.promote_recovery_candidate(conflicting).is_err());
        assert_eq!(state.active_state_epoch(), Some(epoch(1)));
        assert_eq!(state.active_signing_share(), Some(&[0x21; 32]));

        let promoted = state
            .promote_recovery_candidate(promotion.clone())
            .expect("promote exact recovery");
        assert!(matches!(
            promoted,
            LocalEd25519YaoSigningWorkerActivationReceiptV1::Active { state_epoch, .. }
                if state_epoch == epoch(2)
        ));
        assert_eq!(state.active_state_epoch(), Some(epoch(2)));
        assert_eq!(state.active_signing_share(), Some(&[0x22; 32]));
        assert_eq!(
            state
                .promote_recovery_candidate(promotion)
                .expect("exact promotion retry"),
            promoted
        );
    }

    #[test]
    fn recovery_rejects_stale_skipped_and_exhausted_epochs_without_mutation() {
        let mut state = active_state(epoch(4), [0x41; 32]);
        let public_key = state.active_public_key().copied().expect("public key");
        for invalid_epoch in [epoch(4), epoch(6)] {
            let candidate = activation_candidate(
                ceremony_binding(Ed25519YaoOperationV1::Recovery, 0x42),
                invalid_epoch,
                [0x42; 32],
                public_key,
                0x43,
            );
            assert!(state.commit_activation_candidate(candidate).is_err());
            assert_eq!(state.active_state_epoch(), Some(epoch(4)));
            assert_eq!(state.active_signing_share(), Some(&[0x41; 32]));
        }
        assert_eq!(
            state.next_recovery_state_epoch().expect("next epoch"),
            epoch(5)
        );

        let exhausted = active_state(epoch(u64::MAX), [0x51; 32]);
        assert!(exhausted.next_recovery_state_epoch().is_err());
    }

    #[test]
    fn worker_keeps_registration_and_recovery_state_isolated_by_full_identity() {
        let mut worker = LocalEd25519YaoSigningWorkerStateV1::default();
        for identity_tag in [1_u8, 2_u8] {
            let binding = ceremony_binding_for_identity(
                Ed25519YaoOperationV1::Registration,
                identity_tag,
                identity_tag,
            );
            let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&binding);
            let candidate = activation_candidate(
                binding,
                epoch(1),
                [identity_tag; 32],
                [identity_tag.wrapping_add(0x20); 32],
                identity_tag.wrapping_add(0x40),
            );
            worker
                .identities
                .entry(identity)
                .or_default()
                .commit_activation_candidate(candidate)
                .expect("independent registration");
        }
        assert_eq!(worker.identities.len(), 2);

        let recovery_binding = ceremony_binding_for_identity(Ed25519YaoOperationV1::Recovery, 3, 1);
        let recovery_identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&recovery_binding);
        let recovery =
            activation_candidate(recovery_binding, epoch(2), [0x31; 32], [0x21; 32], 0x51);
        let staged = worker
            .identities
            .get_mut(&recovery_identity)
            .expect("first identity")
            .commit_activation_candidate(recovery)
            .expect("first identity recovery");
        let LocalEd25519YaoSigningWorkerActivationReceiptV1::Staged { promotion } = staged else {
            panic!("recovery must be staged");
        };
        worker
            .promote_recovery_candidate(promotion)
            .expect("first identity recovery promotion");

        let first = worker
            .identities
            .get(&recovery_identity)
            .expect("first state");
        assert_eq!(first.active_state_epoch(), Some(epoch(2)));
        assert_eq!(first.active_signing_share(), Some(&[0x31; 32]));
        let second_identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(
            &ceremony_binding_for_identity(Ed25519YaoOperationV1::Registration, 2, 2),
        );
        let second = worker
            .identities
            .get(&second_identity)
            .expect("second state");
        assert_eq!(second.active_state_epoch(), Some(epoch(1)));
        assert_eq!(second.active_signing_share(), Some(&[2; 32]));
    }

    #[test]
    fn normal_signing_selects_the_exact_opaque_material_activation() {
        let binding = ceremony_binding_for_identity(Ed25519YaoOperationV1::Registration, 0x31, 1);
        assert_ne!(
            binding.lifecycle.session_id,
            binding.material_activation.activation_id
        );
        assert_ne!(
            binding.lifecycle.lifecycle_id,
            binding.material_activation.lifecycle_binding
        );
        let identity = LocalEd25519YaoEffectiveIdentityV1::from_binding(&binding);
        let mut worker = LocalEd25519YaoSigningWorkerStateV1::default();
        worker.identities.insert(
            identity.clone(),
            LocalEd25519YaoSigningIdentityStateV1 {
                active: Some(ActiveSigningShare {
                    scalar: Zeroizing::new([0x41; 32]),
                    binding: binding.clone(),
                    state_epoch: epoch(1),
                    activated_at_ms: 1,
                    transcript: [0x42; 32],
                    registered_public_key: [0x43; 32],
                }),
                ..Default::default()
            },
        );
        let exact_scope = NormalSigningScopeV1::new(
            "normal-signing-request-1",
            binding.lifecycle.account_id.clone(),
            NormalSigningAuthorizationV1::reusable_wallet_session("authorization-wallet-session-1")
                .expect("authorization"),
            binding.material_activation.clone(),
            binding.lifecycle.selected_server_id.clone(),
        )
        .expect("normal-signing scope");
        assert_eq!(
            worker
                .identity_for_scope(&exact_scope)
                .expect("exact activation selects active state"),
            identity
        );

        let mut substituted_scope = exact_scope;
        substituted_scope.material_activation.activation_id =
            "opaque-substituted-activation".to_owned();
        assert!(worker.identity_for_scope(&substituted_scope).is_err());
    }

    #[test]
    fn signing_worker_refresh_rejects_a_substituted_material_activation() {
        let state = active_state(epoch(1), [0x51; 32]);
        let active = state.active.as_ref().expect("active state");
        let exact_refresh = refresh_binding(
            &active.binding,
            active.binding.material_activation.clone(),
            active.registered_public_key,
        );
        state
            .validate_refresh_transition(&exact_refresh)
            .expect("exact activation refresh");

        let mut substituted_activation = active.binding.material_activation.clone();
        substituted_activation.activation_id = "opaque-substituted-activation".to_owned();
        let substituted_refresh = refresh_binding(
            &active.binding,
            substituted_activation,
            active.registered_public_key,
        );
        assert!(state
            .validate_refresh_transition(&substituted_refresh)
            .is_err());
    }

    fn refresh_binding(
        active: &Ed25519YaoCeremonyBindingV1,
        material_activation: MpcMaterialActivationRefV1,
        registered_public_key: [u8; 32],
    ) -> Ed25519YaoRefreshBindingV1 {
        let ceremony_activation = material_activation.clone();
        let scope = RouterAbEd25519YaoLifecycleScopeV1::new(
            "refresh-threshold-lifecycle-1",
            active.lifecycle.root_share_epoch.clone(),
            active.lifecycle.account_id.clone(),
            "refresh-threshold-session-1",
            active.lifecycle.signer_set_id.clone(),
            active.lifecycle.selected_server_id.clone(),
            material_activation,
        )
        .expect("refresh scope");
        let transition =
            Ed25519YaoEpochTransitionV1::new(epoch(1), epoch(2)).expect("refresh transition");
        Ed25519YaoRefreshBindingV1::new(
            Ed25519YaoCeremonyBindingV1::new(
                scope
                    .into_lifecycle(Ed25519YaoOperationV1::Refresh)
                    .expect("refresh lifecycle"),
                Ed25519YaoOperationV1::Refresh,
                Ed25519YaoSessionIdV1::new([0x61; 32]).expect("refresh session"),
                active.stable_key_context_binding,
                ceremony_activation,
            )
            .expect("refresh ceremony"),
            registered_public_key,
            Ed25519YaoRefreshEpochsV1 {
                deriver_a: transition,
                deriver_b: transition,
                signing_worker: transition,
            },
        )
        .expect("refresh binding")
    }

    fn active_state(
        state_epoch: Ed25519YaoStateEpochV1,
        scalar: [u8; 32],
    ) -> LocalEd25519YaoSigningIdentityStateV1 {
        LocalEd25519YaoSigningIdentityStateV1 {
            active: Some(ActiveSigningShare {
                scalar: Zeroizing::new(scalar),
                binding: ceremony_binding(Ed25519YaoOperationV1::Registration, 0x71),
                state_epoch,
                activated_at_ms: 1,
                transcript: [0x72; 32],
                registered_public_key: [0x73; 32],
            }),
            ..Default::default()
        }
    }

    fn activation_candidate(
        binding: Ed25519YaoCeremonyBindingV1,
        state_epoch: Ed25519YaoStateEpochV1,
        scalar: [u8; 32],
        registered_public_key: [u8; 32],
        tag: u8,
    ) -> ActivationCandidate {
        let transcript = [tag; 32];
        let signing_worker_verifying_share = [tag.wrapping_add(1); 32];
        ActivationCandidate {
            next_active: ActiveSigningShare {
                scalar: Zeroizing::new(scalar),
                binding: binding.clone(),
                state_epoch,
                activated_at_ms: 1,
                transcript,
                registered_public_key,
            },
            promotion: LocalEd25519YaoSigningWorkerRecoveryPromotionRequestV1 {
                binding: binding.clone(),
                session: binding.session_id.into_bytes(),
                transcript,
                registered_public_key,
                joined_client_commitment: [tag.wrapping_add(2); 32],
                joined_signing_worker_commitment: signing_worker_verifying_share,
                signing_worker_verifying_share,
                state_epoch,
            },
            deriver_a: pending_delivery(
                &binding,
                Ed25519YaoDeriverRoleV1::DeriverA,
                transcript,
                tag.wrapping_add(3),
            ),
            deriver_b: pending_delivery(
                &binding,
                Ed25519YaoDeriverRoleV1::DeriverB,
                transcript,
                tag.wrapping_add(4),
            ),
        }
    }

    fn pending_delivery(
        binding: &Ed25519YaoCeremonyBindingV1,
        deriver: Ed25519YaoDeriverRoleV1,
        transcript: [u8; 32],
        tag: u8,
    ) -> PendingDelivery {
        PendingDelivery {
            binding: binding.clone(),
            client_commitment: [tag; 32],
            signing_worker_commitment: [tag.wrapping_add(1); 32],
            package: Ed25519YaoEncryptedPackageV1::new(
                Ed25519YaoPackageKindV1::ActivationSigningWorker,
                deriver,
                binding.session_id.into_bytes(),
                transcript,
                [tag.wrapping_add(2); 32],
                vec![tag.wrapping_add(3); 16],
            )
            .expect("encrypted package"),
        }
    }

    fn ceremony_binding(
        operation: Ed25519YaoOperationV1,
        session_tag: u8,
    ) -> Ed25519YaoCeremonyBindingV1 {
        ceremony_binding_for_identity(operation, session_tag, 1)
    }

    fn ceremony_binding_for_identity(
        operation: Ed25519YaoOperationV1,
        session_tag: u8,
        identity_tag: u8,
    ) -> Ed25519YaoCeremonyBindingV1 {
        let scope = RouterAbEd25519YaoLifecycleScopeV1::new(
            format!("threshold-lifecycle-{session_tag}"),
            RootShareEpoch::new(format!("root-epoch-{identity_tag}")).expect("root epoch"),
            format!("account-{identity_tag}"),
            format!("threshold-session-{session_tag}"),
            format!("signer-set-{identity_tag}"),
            "signing-worker-1",
            MpcMaterialActivationRefV1::new(
                format!("opaque-activation-{session_tag}"),
                format!("capability-{identity_tag}"),
                format!("account-{identity_tag}"),
                format!("key-{identity_tag}"),
                format!("opaque-material-lifecycle-{session_tag}"),
                "signing-worker-1",
            )
            .expect("material activation"),
        )
        .expect("scope");
        let material_activation = scope.material_activation().clone();
        Ed25519YaoCeremonyBindingV1::new(
            scope.into_lifecycle(operation).expect("lifecycle"),
            operation,
            Ed25519YaoSessionIdV1::new([session_tag; 32]).expect("session"),
            Ed25519YaoStableKeyContextBindingV1::new([identity_tag; 32]),
            material_activation,
        )
        .expect("binding")
    }

    fn epoch(value: u64) -> Ed25519YaoStateEpochV1 {
        Ed25519YaoStateEpochV1::new(value).expect("state epoch")
    }
}
