use router_ab_core::{
    ActiveSigningWorkerStateV1, Ed25519YaoCeremonyBindingV1, Ed25519YaoDeriverRoleV1,
    Ed25519YaoEncryptedPackageV1, Ed25519YaoOperationV1, Ed25519YaoPackageKindV1,
    Ed25519YaoRecoveryAttemptV1, Ed25519YaoSessionIdV1, OpenedShareKind, PublicDigest32, Role,
    RouterAbEd25519YaoActivationPublicReceiptV1, RouterAbProtocolError, RouterAbProtocolErrorCode,
    RouterAbProtocolResult, ServerIdentityV1,
};
use router_ab_ed25519_yao::{
    combine_ed25519_yao_signing_worker_packages_source_preserving_v1,
    combine_ed25519_yao_signing_worker_packages_v1, Ed25519YaoActiveSigningMaterialV1,
    Ed25519YaoRecipientPrivateKeyV1, Ed25519YaoSigningWorkerActivationCandidateV1,
    Ed25519YaoSigningWorkerActivationReceiptV1, Ed25519YaoSigningWorkerPackageDeliveryV1,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(feature = "workers-rs")]
use worker::{Env, Request, Response};

#[cfg(feature = "workers-rs")]
use crate::{
    cloudflare_now_unix_ms_v1, compare_and_set_cloudflare_signing_worker_private_d1_secret_v1,
    delete_cloudflare_signing_worker_output_activation_by_active_key_v1,
    load_cloudflare_server_output_hpke_private_key_bytes_v1,
    load_cloudflare_signing_worker_private_d1_secret_v1,
    put_cloudflare_signing_worker_output_activation_record_v1,
    read_cloudflare_signing_worker_initial_registration_finalization_v1,
};
use crate::{
    CloudflareSecretMaterial32V1, CloudflareServerOutputMaterialRecordV1,
    CloudflareSigningWorkerOutputActivationRecordV1, CloudflareSigningWorkerRuntimeV1,
    CloudflareSigningWorkerWalletScopeV1,
};

pub const CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_PACKAGES_PATH: &str =
    "/router-ab/signing-worker/ed25519-yao/activation/packages";
pub const CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RECOVERY_PROMOTE_PATH: &str =
    "/router-ab/signing-worker/ed25519-yao/recovery/promote";
pub const CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_PATH: &str =
    "/router-ab/signing-worker/ed25519-yao/reserve-inactive";
pub const CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_RESERVE_INACTIVE_SOURCE_PRESERVING_PATH: &str =
    "/router-ab/signing-worker/ed25519-yao/reserve-inactive-source-preserving";
pub const CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_ACTIVATE_RESERVATION_PATH: &str =
    "/router-ab/signing-worker/ed25519-yao/activate-reservation";
pub const CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_DEACTIVATE_RESERVATION_PATH: &str =
    "/router-ab/signing-worker/ed25519-yao/deactivate-reservation";
pub const CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_INITIAL_REGISTRATION_FINALIZATION_LOOKUP_PATH:
    &str = "/router-ab/signing-worker/ed25519-yao/initial-registration/finalization";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareEd25519YaoOutputActivationPutV1 {
    pub record: CloudflareSigningWorkerOutputActivationRecordV1,
}

impl CloudflareEd25519YaoOutputActivationPutV1 {
    fn new(
        record: CloudflareSigningWorkerOutputActivationRecordV1,
    ) -> RouterAbProtocolResult<Self> {
        let request = Self { record };
        request.validate()?;
        Ok(request)
    }

    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.record.validate()?;
        match &self.record {
            CloudflareSigningWorkerOutputActivationRecordV1::Ed25519Yao { .. } => Ok(()),
            CloudflareSigningWorkerOutputActivationRecordV1::RecipientProofBundle { .. } => Err(
                invalid_lifecycle("Ed25519 Yao output activation requires Ed25519 Yao material"),
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoRecoveryPromotionRequestV1 {
    pub binding: Ed25519YaoCeremonyBindingV1,
    pub public_receipt: RouterAbEd25519YaoActivationPublicReceiptV1,
}

impl CloudflareEd25519YaoRecoveryPromotionRequestV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.binding.validate()?;
        if self.binding.operation != Ed25519YaoOperationV1::Recovery {
            return Err(invalid_lifecycle(
                "Ed25519 Yao recovery promotion requires a recovery binding",
            ));
        }
        Ok(())
    }
}

/// A recovery promotion addressed to the SigningWorker that holds its wallet:
/// the Router derives the scope from the tenant root the recovery was
/// admitted under, as it does for the recovery's delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareScopedEd25519YaoRecoveryPromotionRequestV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub promotion: CloudflareEd25519YaoRecoveryPromotionRequestV1,
}

impl CloudflareScopedEd25519YaoRecoveryPromotionRequestV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.scope.validate()?;
        self.promotion.validate()?;
        if self.scope.wallet_id != self.promotion.binding.lifecycle.account_id {
            return Err(invalid_lifecycle(
                "SigningWorker recovery promotion differs from its wallet scope",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoPackagePairDeliveryV1 {
    pub deriver_a: Ed25519YaoSigningWorkerPackageDeliveryV1,
    pub deriver_b: Ed25519YaoSigningWorkerPackageDeliveryV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareScopedEd25519YaoPackagePairDeliveryV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
    /// The Gateway's attempt a recovery's packages come from, as the Router
    /// executed it. A recovery delivery carries one; no other delivery does.
    pub recovery_attempt: Option<Ed25519YaoRecoveryAttemptV1>,
}

impl CloudflareScopedEd25519YaoPackagePairDeliveryV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.scope.validate()?;
        self.delivery.validate()?;
        if self.scope.wallet_id != self.delivery.deriver_a.binding.lifecycle.account_id {
            return Err(invalid_lifecycle(
                "SigningWorker package pair differs from its wallet scope",
            ));
        }
        validate_recovery_attempt_presence(&self.delivery, self.recovery_attempt)
    }
}

/// A recovery delivery names its attempt, and no other delivery does.
fn validate_recovery_attempt_presence(
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    recovery_attempt: Option<Ed25519YaoRecoveryAttemptV1>,
) -> RouterAbProtocolResult<()> {
    let recovery = delivery.deriver_a.binding.operation == Ed25519YaoOperationV1::Recovery;
    if recovery != recovery_attempt.is_some() {
        return Err(invalid_lifecycle(
            "SigningWorker package pair must name a recovery attempt exactly when it recovers",
        ));
    }
    Ok(())
}

impl CloudflareEd25519YaoPackagePairDeliveryV1 {
    fn validate(&self) -> RouterAbProtocolResult<()> {
        self.deriver_a
            .validate_for_deriver(Ed25519YaoDeriverRoleV1::DeriverA)?;
        self.deriver_b
            .validate_for_deriver(Ed25519YaoDeriverRoleV1::DeriverB)?;
        if self.deriver_a.binding != self.deriver_b.binding {
            return Err(invalid_lifecycle(
                "Signing Worker package pair must share one ceremony binding",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
    pub deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
    pub deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
}

impl CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.scope.validate()?;
        self.delivery.validate()?;
        let binding = &self.delivery.deriver_a.binding;
        if self.scope.wallet_id != binding.lifecycle.account_id {
            return Err(invalid_lifecycle(
                "initial-registration lookup differs from its wallet scope",
            ));
        }
        require_operation(binding, Ed25519YaoOperationV1::Registration)?;
        validate_client_package_v1(
            &self.deriver_a_client_package,
            binding,
            Ed25519YaoDeriverRoleV1::DeriverA,
        )?;
        validate_client_package_v1(
            &self.deriver_b_client_package,
            binding,
            Ed25519YaoDeriverRoleV1::DeriverB,
        )?;
        let transcript = self.deriver_a_client_package.transcript();
        if transcript != self.deriver_b_client_package.transcript()
            || transcript != self.delivery.deriver_a.package.transcript()
            || transcript != self.delivery.deriver_b.package.transcript()
        {
            return Err(invalid_lifecycle(
                "initial-registration lookup packages have different transcripts",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1 {
    Missing,
    Pending,
    Committed {
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
    },
    Revoked,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoInactiveReservationRequestV1 {
    pub delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
    pub participant_ids: [u16; 2],
    pub deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
    pub deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
}

impl CloudflareEd25519YaoInactiveReservationRequestV1 {
    fn validate(&self) -> RouterAbProtocolResult<()> {
        validate_inactive_reservation_parts_v1(
            &self.delivery,
            self.participant_ids,
            &self.deriver_a_client_package,
            &self.deriver_b_client_package,
            Ed25519YaoOperationV1::Registration,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1 {
    /// The wallet whose material the reservation is made from. The Router
    /// derives it from the tenant root the execution was admitted under.
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub source_binding: Ed25519YaoCeremonyBindingV1,
    pub delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
    pub participant_ids: [u16; 2],
    pub deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
    pub deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
}

impl CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.source_binding.validate()?;
        if self.source_binding.operation != Ed25519YaoOperationV1::Registration {
            return Err(invalid_lifecycle(
                "source-preserving ordinary activation requires a registration source binding",
            ));
        }
        validate_inactive_reservation_parts_v1(
            &self.delivery,
            self.participant_ids,
            &self.deriver_a_client_package,
            &self.deriver_b_client_package,
            Ed25519YaoOperationV1::Registration,
        )?;
        if self.delivery.deriver_a.binding.material_activation
            == self.source_binding.material_activation
        {
            return Err(invalid_lifecycle(
                "source-preserving ordinary activation requires a fresh material activation",
            ));
        }
        self.scope.validate()?;
        if self.scope.wallet_id != self.source_binding.lifecycle.account_id
            || self.scope.wallet_id != self.delivery.deriver_a.binding.lifecycle.account_id
        {
            return Err(invalid_lifecycle(
                "source-preserving ordinary activation differs from its wallet scope",
            ));
        }
        require_same_stable_identity(&self.source_binding, &self.delivery.deriver_a.binding)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoActivateReservationRequestV1 {
    /// The wallet the reserved material belongs to, from the Gateway's
    /// authorized installation.
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub binding: Ed25519YaoCeremonyBindingV1,
    pub reservation_id: String,
}

impl CloudflareEd25519YaoActivateReservationRequestV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.binding.validate()?;
        if self.binding.operation != Ed25519YaoOperationV1::Registration {
            return Err(invalid_lifecycle(
                "ordinary Ed25519 reservation activation requires a registration binding",
            ));
        }
        self.scope.validate()?;
        if self.scope.wallet_id != self.binding.lifecycle.account_id {
            return Err(invalid_lifecycle(
                "ordinary Ed25519 reservation activation differs from its wallet scope",
            ));
        }
        require_non_empty_reservation_id(&self.reservation_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoDeactivateReservationRequestV1 {
    /// The wallet the reserved material belongs to, from the Gateway's
    /// authorized revocation.
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub material_activation: router_ab_core::MpcMaterialActivationRefV1,
}

impl CloudflareEd25519YaoDeactivateReservationRequestV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        self.material_activation.validate()?;
        self.scope.validate()?;
        if self.scope.wallet_id != self.material_activation.material_owner {
            return Err(invalid_lifecycle(
                "ordinary Ed25519 deactivation differs from its wallet scope",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum SigningWorkerYaoCommandV1 {
    DeliverPackages {
        delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
        recovery_attempt: Option<Ed25519YaoRecoveryAttemptV1>,
    },
    PromoteRecovery {
        request: CloudflareEd25519YaoRecoveryPromotionRequestV1,
    },
}

impl SigningWorkerYaoCommandV1 {
    fn stable_context_binding(&self) -> [u8; 32] {
        match self {
            Self::DeliverPackages { delivery, .. } => delivery
                .deriver_a
                .binding
                .stable_key_context_binding
                .into_bytes(),
            Self::PromoteRecovery { request } => {
                request.binding.stable_key_context_binding.into_bytes()
            }
        }
    }

    fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::DeliverPackages {
                delivery,
                recovery_attempt,
            } => {
                delivery.validate()?;
                validate_recovery_attempt_presence(delivery, *recovery_attempt)
            }
            Self::PromoteRecovery { request } => request.validate(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum SigningWorkerYaoDurableStateV1 {
    RegistrationStaged {
        deriver_a: Ed25519YaoSigningWorkerPackageDeliveryV1,
        deriver_b: Ed25519YaoSigningWorkerPackageDeliveryV1,
        candidate: Ed25519YaoActiveSigningMaterialV1,
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
    },
    Active {
        deriver_a: Ed25519YaoSigningWorkerPackageDeliveryV1,
        deriver_b: Ed25519YaoSigningWorkerPackageDeliveryV1,
        material: Ed25519YaoActiveSigningMaterialV1,
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
    },
    /// A recovery staged over the active material, holding the candidate of
    /// the highest attempt delivered here. The Gateway numbers each attempt
    /// and promotes only its latest, so a lower attempt can never promote.
    RecoveryStaged {
        active_material: Ed25519YaoActiveSigningMaterialV1,
        active_receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
        staged: SigningWorkerYaoStagedRecoveryAttemptV1,
    },
}

/// One attempt's candidate, and the deliveries that staged it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SigningWorkerYaoStagedRecoveryAttemptV1 {
    attempt: Ed25519YaoRecoveryAttemptV1,
    deriver_a: Ed25519YaoSigningWorkerPackageDeliveryV1,
    deriver_b: Ed25519YaoSigningWorkerPackageDeliveryV1,
    candidate: Ed25519YaoActiveSigningMaterialV1,
    receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
}

impl SigningWorkerYaoDurableStateV1 {
    fn stable_context_binding(&self) -> [u8; 32] {
        match self {
            Self::RegistrationStaged { deriver_a, .. } => {
                deriver_a.binding.stable_key_context_binding.into_bytes()
            }
            Self::RecoveryStaged {
                active_material, ..
            } => active_material
                .binding()
                .stable_key_context_binding
                .into_bytes(),
            Self::Active { material, .. } => {
                material.binding().stable_key_context_binding.into_bytes()
            }
        }
    }

    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        match self {
            Self::RegistrationStaged {
                deriver_a,
                deriver_b,
                candidate,
                receipt,
            } => validate_staged_candidate(
                deriver_a,
                deriver_b,
                candidate,
                receipt,
                Ed25519YaoOperationV1::Registration,
            ),
            Self::Active {
                deriver_a,
                deriver_b,
                material,
                receipt,
            } => validate_staged_candidate(
                deriver_a,
                deriver_b,
                material,
                receipt,
                material.binding().operation,
            ),
            Self::RecoveryStaged {
                active_material,
                active_receipt,
                staged,
            } => {
                validate_material_receipt(active_material, active_receipt)?;
                require_same_stable_identity(active_material.binding(), &staged.deriver_a.binding)?;
                validate_staged_candidate(
                    &staged.deriver_a,
                    &staged.deriver_b,
                    &staged.candidate,
                    &staged.receipt,
                    Ed25519YaoOperationV1::Recovery,
                )
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case", deny_unknown_fields)]
enum SigningWorkerYaoCommandResponseV1 {
    Active {
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
    },
    Staged {
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerYaoReservationStateV1 {
    Inactive {
        delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
        participant_ids: [u16; 2],
        deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
        deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
        candidate: Ed25519YaoActiveSigningMaterialV1,
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
        reservation_id: String,
    },
    Activating {
        delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
        participant_ids: [u16; 2],
        deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
        deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
        candidate: Ed25519YaoActiveSigningMaterialV1,
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
        reservation_id: String,
    },
    Active {
        delivery: CloudflareEd25519YaoPackagePairDeliveryV1,
        participant_ids: [u16; 2],
        deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
        deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
        candidate: Ed25519YaoActiveSigningMaterialV1,
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
        reservation_id: String,
    },
    Revoked {
        binding: Ed25519YaoCeremonyBindingV1,
        reservation_id: String,
        revoked_at_ms: u64,
    },
    Deactivating {
        binding: Ed25519YaoCeremonyBindingV1,
        reservation_id: String,
        revoked_at_ms: u64,
    },
}

impl SigningWorkerYaoReservationStateV1 {
    pub fn validate(&self) -> RouterAbProtocolResult<()> {
        let (delivery, participant_ids, candidate, receipt, reservation_id) = match self {
            Self::Inactive {
                delivery,
                participant_ids,
                candidate,
                receipt,
                reservation_id,
                ..
            }
            | Self::Active {
                delivery,
                participant_ids,
                candidate,
                receipt,
                reservation_id,
                ..
            }
            | Self::Activating {
                delivery,
                participant_ids,
                candidate,
                receipt,
                reservation_id,
                ..
            } => {
                validate_participant_ids_v1(*participant_ids)?;
                (
                    delivery,
                    participant_ids,
                    candidate,
                    receipt,
                    reservation_id,
                )
            }
            Self::Revoked {
                binding,
                reservation_id,
                revoked_at_ms,
            }
            | Self::Deactivating {
                binding,
                reservation_id,
                revoked_at_ms,
            } => {
                binding.validate()?;
                if binding.operation != Ed25519YaoOperationV1::Registration {
                    return Err(invalid_lifecycle(
                        "ordinary Ed25519 revoked reservation requires a registration binding",
                    ));
                }
                require_non_empty_reservation_id(reservation_id)?;
                if *revoked_at_ms == 0 {
                    return Err(invalid_lifecycle(
                        "ordinary Ed25519 reservation transition timestamp is invalid",
                    ));
                }
                return Ok(());
            }
        };
        let (deriver_a_client_package, deriver_b_client_package) = match self {
            Self::Inactive {
                deriver_a_client_package,
                deriver_b_client_package,
                ..
            }
            | Self::Active {
                deriver_a_client_package,
                deriver_b_client_package,
                ..
            }
            | Self::Activating {
                deriver_a_client_package,
                deriver_b_client_package,
                ..
            } => (deriver_a_client_package, deriver_b_client_package),
            Self::Revoked { .. } | Self::Deactivating { .. } => {
                return Err(invalid_lifecycle(
                    "ordinary Ed25519 revoked reservation cannot contain client packages",
                ))
            }
        };
        CloudflareEd25519YaoInactiveReservationRequestV1 {
            delivery: delivery.clone(),
            participant_ids: *participant_ids,
            deriver_a_client_package: deriver_a_client_package.clone(),
            deriver_b_client_package: deriver_b_client_package.clone(),
        }
        .validate()?;
        validate_staged_candidate(
            &delivery.deriver_a,
            &delivery.deriver_b,
            candidate,
            receipt,
            Ed25519YaoOperationV1::Registration,
        )?;
        validate_client_package_v1(
            deriver_a_client_package,
            &delivery.deriver_a.binding,
            Ed25519YaoDeriverRoleV1::DeriverA,
        )?;
        validate_client_package_v1(
            deriver_b_client_package,
            &delivery.deriver_b.binding,
            Ed25519YaoDeriverRoleV1::DeriverB,
        )?;
        if deriver_a_client_package.transcript() != receipt.transcript
            || deriver_b_client_package.transcript() != receipt.transcript
        {
            return Err(invalid_lifecycle(
                "ordinary Ed25519 client packages do not match the activation transcript",
            ));
        }
        require_non_empty_reservation_id(reservation_id)
    }
}

#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_ed25519_yao_packages_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let scoped =
        parse_request::<CloudflareScopedEd25519YaoPackagePairDeliveryV1>(&mut request).await?;
    scoped.validate()?;
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    return crate::durable_object::call_signing_worker_wallet_do_v1(
        env,
        crate::durable_object::SigningWorkerWalletDoRequestV1::DeliverPackages(scoped),
    )
    .await;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    let response = execute_signing_worker_yao_command(
        env,
        SigningWorkerYaoCommandV1::DeliverPackages {
            delivery: scoped.delivery,
            recovery_attempt: scoped.recovery_attempt,
        },
    )
    .await?;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    json_response(&http_response_from_command(response)?)
}

#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_ed25519_yao_initial_registration_finalization_lookup_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let lookup =
        parse_request::<CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1>(
            &mut request,
        )
        .await?;
    lookup.validate()?;
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    return crate::durable_object::call_signing_worker_wallet_do_v1(
        env,
        crate::durable_object::SigningWorkerWalletDoRequestV1::LookupRegistration(lookup),
    )
    .await;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    let response = read_initial_registration_finalization_v1(env, &lookup).await?;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    json_response(&response)
}

#[cfg(feature = "workers-rs")]
async fn read_initial_registration_finalization_v1(
    env: &Env,
    request: &CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1> {
    let binding = &request.delivery.deriver_a.binding;
    let record_key = encode_hex(binding.stable_key_context_binding.into_bytes());
    let active_key = active_output_key_v1(binding.material_activation());
    let snapshot = read_cloudflare_signing_worker_initial_registration_finalization_v1::<
        SigningWorkerYaoDurableStateV1,
    >(env, &record_key, &active_key)
    .await?;
    evaluate_initial_registration_finalization_v1(request, snapshot)
}

#[cfg(feature = "workers-rs")]
pub(crate) fn evaluate_initial_registration_finalization_v1(
    request: &CloudflareEd25519YaoInitialRegistrationFinalizationLookupRequestV1,
    snapshot: crate::CloudflareSigningWorkerInitialRegistrationFinalizationSnapshotV1<
        SigningWorkerYaoDurableStateV1,
    >,
) -> RouterAbProtocolResult<CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1> {
    let binding = &request.delivery.deriver_a.binding;
    let Some(lifecycle) = snapshot.lifecycle else {
        return Ok(if snapshot.fenced {
            CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Revoked
        } else if snapshot.activation.is_some() {
            CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Conflict
        } else {
            CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Missing
        });
    };
    lifecycle.validate()?;
    let (deriver_a, deriver_b, receipt, active) = match lifecycle {
        SigningWorkerYaoDurableStateV1::RegistrationStaged {
            deriver_a,
            deriver_b,
            receipt,
            ..
        } => (deriver_a, deriver_b, receipt, false),
        SigningWorkerYaoDurableStateV1::Active {
            deriver_a,
            deriver_b,
            material,
            receipt,
        } if material.binding().operation == Ed25519YaoOperationV1::Registration => {
            (deriver_a, deriver_b, receipt, true)
        }
        SigningWorkerYaoDurableStateV1::Active { .. }
        | SigningWorkerYaoDurableStateV1::RecoveryStaged { .. } => {
            return Ok(
                CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Conflict,
            )
        }
    };
    if deriver_a != request.delivery.deriver_a
        || deriver_b != request.delivery.deriver_b
        || receipt.transcript != request.deriver_a_client_package.transcript()
    {
        return Ok(CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Conflict);
    }
    if snapshot.fenced {
        return Ok(CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Revoked);
    }
    if !active {
        return Ok(CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Pending);
    }
    match snapshot.activation {
        Some(CloudflareSigningWorkerOutputActivationRecordV1::Ed25519Yao {
            binding: output_binding,
            receipt: output_receipt,
            active_signing_worker_state,
            ..
        }) if output_binding == *binding
            && output_receipt == receipt
            && active_signing_worker_state.account_id == binding.lifecycle.account_id
            && active_signing_worker_state.material_activation
                == *binding.material_activation() =>
        {
            Ok(
                CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Committed {
                    receipt,
                },
            )
        }
        _ => Ok(CloudflareEd25519YaoInitialRegistrationFinalizationLookupResponseV1::Conflict),
    }
}

#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_ed25519_yao_recovery_promote_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let scoped =
        parse_request::<CloudflareScopedEd25519YaoRecoveryPromotionRequestV1>(&mut request).await?;
    scoped.validate()?;
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    return crate::durable_object::call_signing_worker_wallet_do_v1(
        env,
        crate::durable_object::SigningWorkerWalletDoRequestV1::PromoteRecovery(scoped),
    )
    .await;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    let response = execute_signing_worker_yao_command(
        env,
        SigningWorkerYaoCommandV1::PromoteRecovery {
            request: scoped.promotion,
        },
    )
    .await?;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    json_response(&http_response_from_command(response)?)
}

#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_ed25519_yao_reserve_inactive_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let reservation =
        parse_request::<CloudflareEd25519YaoInactiveReservationRequestV1>(&mut request).await?;
    reservation.validate()?;
    let (
        reservation_id,
        participant_ids,
        activation_receipt,
        deriver_a_client_package,
        deriver_b_client_package,
    ) = reserve_inactive_ed25519_yao_v1(env, &reservation).await?;
    json_response(&CloudflareEd25519YaoInactiveReservationResponseV1 {
        state: "inactive".to_owned(),
        reservation_id,
        participant_ids,
        activation_receipt,
        deriver_a_client_package,
        deriver_b_client_package,
    })
}

#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_ed25519_yao_reserve_inactive_source_preserving_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let reservation = parse_request::<
        CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1,
    >(&mut request)
    .await?;
    reservation.validate()?;
    // A linked device's material is reserved, activated and revoked with the
    // wallet's own material, in the wallet object.
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    return crate::durable_object::call_signing_worker_wallet_do_v1(
        env,
        crate::durable_object::SigningWorkerWalletDoRequestV1::ReserveLinkedEd25519(reservation),
    )
    .await;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    let (
        reservation_id,
        participant_ids,
        activation_receipt,
        deriver_a_client_package,
        deriver_b_client_package,
    ) = reserve_source_preserving_inactive_ed25519_yao_v1(env, &reservation).await?;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    json_response(&CloudflareEd25519YaoInactiveReservationResponseV1 {
        state: "inactive".to_owned(),
        reservation_id,
        participant_ids,
        activation_receipt,
        deriver_a_client_package,
        deriver_b_client_package,
    })
}

#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_ed25519_yao_activate_reservation_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let activation =
        parse_request::<CloudflareEd25519YaoActivateReservationRequestV1>(&mut request).await?;
    activation.validate()?;
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    return crate::durable_object::call_signing_worker_wallet_do_v1(
        env,
        crate::durable_object::SigningWorkerWalletDoRequestV1::ActivateLinkedEd25519(activation),
    )
    .await;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    let receipt = activate_ed25519_yao_reservation_v1(env, &activation).await?;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    json_response(&CloudflareEd25519YaoReservationActivationResponseV1 { receipt })
}

#[cfg(feature = "workers-rs")]
pub async fn handle_cloudflare_signing_worker_ed25519_yao_deactivate_reservation_v1(
    mut request: Request,
    env: &Env,
) -> RouterAbProtocolResult<Response> {
    let deactivation =
        parse_request::<CloudflareEd25519YaoDeactivateReservationRequestV1>(&mut request).await?;
    deactivation.validate()?;
    #[cfg(feature = "wallet-do-signing-worker-harness")]
    return crate::durable_object::call_signing_worker_wallet_do_v1(
        env,
        crate::durable_object::SigningWorkerWalletDoRequestV1::DeactivateLinkedEd25519(
            deactivation,
        ),
    )
    .await;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    let response = deactivate_ed25519_yao_reservation_v1(env, &deactivation).await?;
    #[cfg(not(feature = "wallet-do-signing-worker-harness"))]
    json_response(&response)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoInactiveReservationResponseV1 {
    pub state: String,
    pub reservation_id: String,
    pub participant_ids: [u16; 2],
    pub activation_receipt: RouterAbEd25519YaoActivationPublicReceiptV1,
    pub deriver_a_client_package: Ed25519YaoEncryptedPackageV1,
    pub deriver_b_client_package: Ed25519YaoEncryptedPackageV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoReservationActivationResponseV1 {
    pub receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloudflareEd25519YaoReservationDeactivationResponseV1 {
    pub state: &'static str,
    pub reservation_id: String,
    pub material_activation: router_ab_core::MpcMaterialActivationRefV1,
    pub revoked_at_ms: u64,
}

/// A reservation of a device's Ed25519 material settled against what its
/// record holds. Every SigningWorker store settles it this way, then writes
/// what it decides.
pub enum LinkedEd25519ReservationV1 {
    /// The same reservation again: the stored reservation answers.
    Answer(CloudflareEd25519YaoInactiveReservationResponseV1),
    /// Nothing is reserved here yet: the store combines the packages.
    Reserve,
}

/// Settles one reservation of `reservation_id`. The same request answers
/// from what is stored while the material is not yet active; an active or
/// revoked reservation, or any other record, refuses it.
pub fn settle_linked_ed25519_reservation_v1(
    current: Option<&SigningWorkerYaoReservationStateV1>,
    reservation_id: &str,
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    participant_ids: [u16; 2],
    deriver_a_client_package: &Ed25519YaoEncryptedPackageV1,
    deriver_b_client_package: &Ed25519YaoEncryptedPackageV1,
) -> RouterAbProtocolResult<LinkedEd25519ReservationV1> {
    let Some(current) = current else {
        return Ok(LinkedEd25519ReservationV1::Reserve);
    };
    current.validate()?;
    match current {
        SigningWorkerYaoReservationStateV1::Inactive {
            delivery: stored_delivery,
            participant_ids: stored_participant_ids,
            deriver_a_client_package: stored_a,
            deriver_b_client_package: stored_b,
            receipt,
            reservation_id: stored_id,
            ..
        }
        | SigningWorkerYaoReservationStateV1::Activating {
            delivery: stored_delivery,
            participant_ids: stored_participant_ids,
            deriver_a_client_package: stored_a,
            deriver_b_client_package: stored_b,
            receipt,
            reservation_id: stored_id,
            ..
        } if stored_id == reservation_id
            && stored_delivery == delivery
            && *stored_participant_ids == participant_ids
            && stored_a == deriver_a_client_package
            && stored_b == deriver_b_client_package =>
        {
            Ok(LinkedEd25519ReservationV1::Answer(
                CloudflareEd25519YaoInactiveReservationResponseV1 {
                    state: "inactive".to_owned(),
                    reservation_id: stored_id.clone(),
                    participant_ids: *stored_participant_ids,
                    activation_receipt: public_activation_receipt_v1(
                        &stored_delivery.deriver_a.binding,
                        receipt,
                    )?,
                    deriver_a_client_package: stored_a.clone(),
                    deriver_b_client_package: stored_b.clone(),
                },
            ))
        }
        SigningWorkerYaoReservationStateV1::Active {
            delivery: stored_delivery,
            participant_ids: stored_participant_ids,
            deriver_a_client_package: stored_a,
            deriver_b_client_package: stored_b,
            reservation_id: stored_id,
            ..
        } if stored_delivery == delivery
            && stored_id == reservation_id
            && *stored_participant_ids == participant_ids
            && stored_a == deriver_a_client_package
            && stored_b == deriver_b_client_package =>
        {
            Err(invalid_lifecycle(
                "ordinary Ed25519 material reservation is already active",
            ))
        }
        SigningWorkerYaoReservationStateV1::Revoked {
            binding: stored_binding,
            reservation_id: stored_id,
            ..
        } if stored_binding.material_activation
            == delivery.deriver_a.binding.material_activation
            && stored_id == reservation_id =>
        {
            Err(invalid_lifecycle(
                "ordinary Ed25519 material reservation is revoked",
            ))
        }
        _ => Err(invalid_lifecycle(
            "ordinary Ed25519 material reservation conflicts with the exact activation ref",
        )),
    }
}

/// An activation of reserved Ed25519 material settled against its record.
pub enum LinkedEd25519ActivationV1 {
    /// Active already, for this request: its receipt answers.
    Answer(Ed25519YaoSigningWorkerActivationReceiptV1),
    /// Reserved and not yet active: the store activates it.
    Activate,
}

/// Settles one activation: only the exact reservation activates, a revoked
/// one never does, and an active one answers again.
pub fn settle_linked_ed25519_activation_v1(
    current: &SigningWorkerYaoReservationStateV1,
    request: &CloudflareEd25519YaoActivateReservationRequestV1,
) -> RouterAbProtocolResult<LinkedEd25519ActivationV1> {
    current.validate()?;
    let conflict = || {
        invalid_lifecycle(
            "ordinary Ed25519 reservation activation conflicts with the exact reservation",
        )
    };
    match current {
        SigningWorkerYaoReservationStateV1::Active {
            delivery,
            receipt,
            reservation_id,
            ..
        } => {
            if *reservation_id != request.reservation_id
                || delivery.deriver_a.binding != request.binding
            {
                return Err(conflict());
            }
            Ok(LinkedEd25519ActivationV1::Answer(receipt.clone()))
        }
        SigningWorkerYaoReservationStateV1::Inactive {
            delivery,
            reservation_id,
            ..
        }
        | SigningWorkerYaoReservationStateV1::Activating {
            delivery,
            reservation_id,
            ..
        } => {
            if *reservation_id != request.reservation_id
                || delivery.deriver_a.binding != request.binding
            {
                return Err(conflict());
            }
            Ok(LinkedEd25519ActivationV1::Activate)
        }
        SigningWorkerYaoReservationStateV1::Deactivating {
            binding,
            reservation_id,
            ..
        } => {
            if *reservation_id != request.reservation_id || *binding != request.binding {
                return Err(conflict());
            }
            Err(invalid_lifecycle(
                "ordinary Ed25519 material reservation is being deactivated",
            ))
        }
        SigningWorkerYaoReservationStateV1::Revoked {
            binding,
            reservation_id,
            ..
        } => {
            if *reservation_id != request.reservation_id || *binding != request.binding {
                return Err(conflict());
            }
            Err(invalid_lifecycle(
                "ordinary Ed25519 material reservation is revoked",
            ))
        }
    }
}

/// A revocation of reserved Ed25519 material settled against its record.
pub enum LinkedEd25519DeactivationV1 {
    /// Revoked already: the stored revocation answers.
    Revoked {
        binding: Ed25519YaoCeremonyBindingV1,
        reservation_id: String,
        revoked_at_ms: u64,
    },
    /// A revocation begun here and not yet finished: the store finishes it.
    Resume {
        binding: Ed25519YaoCeremonyBindingV1,
        reservation_id: String,
        revoked_at_ms: u64,
    },
    /// Reserved or active: the store revokes it now.
    Revoke {
        binding: Ed25519YaoCeremonyBindingV1,
        reservation_id: String,
    },
}

/// Settles one revocation of the exact activation `material_activation`.
pub fn settle_linked_ed25519_deactivation_v1(
    current: &SigningWorkerYaoReservationStateV1,
    material_activation: &router_ab_core::MpcMaterialActivationRefV1,
) -> RouterAbProtocolResult<LinkedEd25519DeactivationV1> {
    current.validate()?;
    let matches = |binding: &Ed25519YaoCeremonyBindingV1, reservation_id: &str| {
        reservation_id_matches_material_activation_v1(reservation_id, material_activation)
            && binding.material_activation == *material_activation
    };
    let conflict = || {
        invalid_lifecycle("ordinary Ed25519 deactivation conflicts with the exact activation ref")
    };
    match current {
        SigningWorkerYaoReservationStateV1::Revoked {
            binding,
            reservation_id,
            revoked_at_ms,
        } => {
            if !matches(binding, reservation_id) {
                return Err(conflict());
            }
            Ok(LinkedEd25519DeactivationV1::Revoked {
                binding: binding.clone(),
                reservation_id: reservation_id.clone(),
                revoked_at_ms: *revoked_at_ms,
            })
        }
        SigningWorkerYaoReservationStateV1::Deactivating {
            binding,
            reservation_id,
            revoked_at_ms,
        } => {
            if !matches(binding, reservation_id) {
                return Err(conflict());
            }
            Ok(LinkedEd25519DeactivationV1::Resume {
                binding: binding.clone(),
                reservation_id: reservation_id.clone(),
                revoked_at_ms: *revoked_at_ms,
            })
        }
        SigningWorkerYaoReservationStateV1::Inactive {
            delivery,
            reservation_id,
            ..
        }
        | SigningWorkerYaoReservationStateV1::Activating {
            delivery,
            reservation_id,
            ..
        }
        | SigningWorkerYaoReservationStateV1::Active {
            delivery,
            reservation_id,
            ..
        } => {
            if !matches(&delivery.deriver_a.binding, reservation_id) {
                return Err(conflict());
            }
            Ok(LinkedEd25519DeactivationV1::Revoke {
                binding: delivery.deriver_a.binding.clone(),
                reservation_id: reservation_id.clone(),
            })
        }
    }
}

#[cfg(feature = "workers-rs")]
async fn reserve_inactive_ed25519_yao_v1(
    env: &Env,
    request: &CloudflareEd25519YaoInactiveReservationRequestV1,
) -> RouterAbProtocolResult<(
    String,
    [u16; 2],
    RouterAbEd25519YaoActivationPublicReceiptV1,
    Ed25519YaoEncryptedPackageV1,
    Ed25519YaoEncryptedPackageV1,
)> {
    request.validate()?;
    let delivery = &request.delivery;
    let record_key = reservation_record_key_v1(delivery)?;
    let reservation_id = format!(
        "ordinary-ed25519-inactive-v1:{}",
        record_key.trim_start_matches("ed25519/")
    );
    reserve_inactive_ed25519_yao_parts_v1(
        env,
        delivery,
        request.participant_ids,
        &request.deriver_a_client_package,
        &request.deriver_b_client_package,
        &record_key,
        reservation_id,
        None,
    )
    .await
}

#[cfg(not(feature = "wallet-do-signing-worker-harness"))]
#[cfg(feature = "workers-rs")]
async fn reserve_source_preserving_inactive_ed25519_yao_v1(
    env: &Env,
    request: &CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1,
) -> RouterAbProtocolResult<(
    String,
    [u16; 2],
    RouterAbEd25519YaoActivationPublicReceiptV1,
    Ed25519YaoEncryptedPackageV1,
    Ed25519YaoEncryptedPackageV1,
)> {
    request.validate()?;
    let delivery = &request.delivery;
    let record_key = reservation_record_key_v1(delivery)?;
    let reservation_id = source_preserving_reservation_id_v1(&request.source_binding, delivery)?;
    reserve_inactive_ed25519_yao_parts_v1(
        env,
        delivery,
        request.participant_ids,
        &request.deriver_a_client_package,
        &request.deriver_b_client_package,
        &record_key,
        reservation_id,
        Some(&request.source_binding),
    )
    .await
}

#[cfg(feature = "workers-rs")]
async fn reserve_inactive_ed25519_yao_parts_v1(
    env: &Env,
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    target_participant_ids: [u16; 2],
    deriver_a_client_package: &Ed25519YaoEncryptedPackageV1,
    deriver_b_client_package: &Ed25519YaoEncryptedPackageV1,
    record_key: &str,
    reservation_id: String,
    source_binding: Option<&Ed25519YaoCeremonyBindingV1>,
) -> RouterAbProtocolResult<(
    String,
    [u16; 2],
    RouterAbEd25519YaoActivationPublicReceiptV1,
    Ed25519YaoEncryptedPackageV1,
    Ed25519YaoEncryptedPackageV1,
)> {
    for _ in 0..3 {
        let current = load_cloudflare_signing_worker_private_d1_secret_v1::<
            SigningWorkerYaoReservationStateV1,
        >(env, "ed25519_yao_reservations", &record_key)
        .await?;
        if let LinkedEd25519ReservationV1::Answer(answer) = settle_linked_ed25519_reservation_v1(
            current.as_ref().map(|current| &current.value),
            &reservation_id,
            delivery,
            target_participant_ids,
            deriver_a_client_package,
            deriver_b_client_package,
        )? {
            return Ok((
                answer.reservation_id,
                answer.participant_ids,
                answer.activation_receipt,
                answer.deriver_a_client_package,
                answer.deriver_b_client_package,
            ));
        }
        let candidate = match source_binding {
            Some(source_binding) => {
                let source = load_source_active_material_v1(env, source_binding).await?;
                combine_signing_worker_yao_packages_v1(env, delivery, Some(&source))?
            }
            None => combine_signing_worker_yao_packages_v1(env, delivery, None)?,
        };
        let (candidate, receipt) = candidate.into_parts();
        let state = SigningWorkerYaoReservationStateV1::Inactive {
            delivery: delivery.clone(),
            participant_ids: target_participant_ids,
            deriver_a_client_package: deriver_a_client_package.clone(),
            deriver_b_client_package: deriver_b_client_package.clone(),
            candidate,
            receipt: receipt.clone(),
            reservation_id: reservation_id.clone(),
        };
        match compare_and_set_cloudflare_signing_worker_private_d1_secret_v1(
            env,
            "ed25519_yao_reservations",
            &record_key,
            None,
            &state,
            cloudflare_now_unix_ms_v1()?,
        )
        .await
        {
            Err(error) if error.code() == RouterAbProtocolErrorCode::ConflictingPair => continue,
            Ok(()) => {
                return Ok((
                    reservation_id.clone(),
                    target_participant_ids,
                    public_activation_receipt_v1(&delivery.deriver_a.binding, &receipt)?,
                    deriver_a_client_package.clone(),
                    deriver_b_client_package.clone(),
                ))
            }
            Err(error) => return Err(error),
        }
    }
    Err(invalid_lifecycle(
        "ordinary Ed25519 material reservation changed concurrently",
    ))
}

#[cfg(not(feature = "wallet-do-signing-worker-harness"))]
#[cfg(feature = "workers-rs")]
async fn activate_ed25519_yao_reservation_v1(
    env: &Env,
    request: &CloudflareEd25519YaoActivateReservationRequestV1,
) -> RouterAbProtocolResult<Ed25519YaoSigningWorkerActivationReceiptV1> {
    request.validate()?;
    let record_key = reservation_record_key_from_binding_v1(&request.binding)?;
    let active_key = active_output_key_v1(&request.binding.material_activation);
    for _ in 0..3 {
        let Some(current) = load_cloudflare_signing_worker_private_d1_secret_v1::<
            SigningWorkerYaoReservationStateV1,
        >(env, "ed25519_yao_reservations", &record_key)
        .await?
        else {
            let ecdsa_record_key = format!("ecdsa/{}", record_key.trim_start_matches("ed25519/"));
            if load_cloudflare_signing_worker_private_d1_secret_v1::<serde_json::Value>(
                env,
                "ecdsa_inactive_reservations",
                &ecdsa_record_key,
            )
            .await?
            .is_some()
            {
                return Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::ConflictingPair,
                    "ordinary Ed25519 deactivation conflicts with an ECDSA activation",
                ));
            }
            return Err(invalid_lifecycle(
                "ordinary Ed25519 material reservation is missing",
            ));
        };
        if let LinkedEd25519ActivationV1::Answer(receipt) =
            settle_linked_ed25519_activation_v1(&current.value, request)?
        {
            return Ok(receipt);
        }
        match current.value {
            SigningWorkerYaoReservationStateV1::Inactive {
                delivery,
                participant_ids,
                deriver_a_client_package,
                deriver_b_client_package,
                candidate,
                receipt,
                reservation_id,
            } => {
                let activating = SigningWorkerYaoReservationStateV1::Activating {
                    delivery,
                    participant_ids,
                    deriver_a_client_package,
                    deriver_b_client_package,
                    candidate,
                    receipt: receipt.clone(),
                    reservation_id,
                };
                match compare_and_set_cloudflare_signing_worker_private_d1_secret_v1(
                    env,
                    "ed25519_yao_reservations",
                    &record_key,
                    Some(current.version),
                    &activating,
                    cloudflare_now_unix_ms_v1()?,
                )
                .await
                {
                    Err(error) if error.code() == RouterAbProtocolErrorCode::ConflictingPair => {
                        continue
                    }
                    Ok(()) => continue,
                    Err(error) => return Err(error),
                }
            }
            SigningWorkerYaoReservationStateV1::Activating {
                delivery,
                participant_ids,
                deriver_a_client_package,
                deriver_b_client_package,
                candidate,
                receipt,
                reservation_id,
            } => {
                persist_signing_worker_yao_active_output_v1(env, &candidate, &receipt).await?;
                let active = SigningWorkerYaoReservationStateV1::Active {
                    delivery,
                    participant_ids,
                    deriver_a_client_package,
                    deriver_b_client_package,
                    candidate,
                    receipt: receipt.clone(),
                    reservation_id,
                };
                match compare_and_set_cloudflare_signing_worker_private_d1_secret_v1(
                    env,
                    "ed25519_yao_reservations",
                    &record_key,
                    Some(current.version),
                    &active,
                    cloudflare_now_unix_ms_v1()?,
                )
                .await
                {
                    Err(error) if error.code() == RouterAbProtocolErrorCode::ConflictingPair => {
                        let Some(latest) = load_cloudflare_signing_worker_private_d1_secret_v1::<
                            SigningWorkerYaoReservationStateV1,
                        >(
                            env, "ed25519_yao_reservations", &record_key
                        )
                        .await?
                        else {
                            continue;
                        };
                        latest.value.validate()?;
                        match latest.value {
                            SigningWorkerYaoReservationStateV1::Active {
                                delivery,
                                receipt,
                                reservation_id,
                                ..
                            } if reservation_id == request.reservation_id
                                && delivery.deriver_a.binding == request.binding =>
                            {
                                return Ok(receipt);
                            }
                            SigningWorkerYaoReservationStateV1::Deactivating {
                                binding,
                                reservation_id,
                                ..
                            }
                            | SigningWorkerYaoReservationStateV1::Revoked {
                                binding,
                                reservation_id,
                                ..
                            } => {
                                if reservation_id != request.reservation_id
                                    || binding != request.binding
                                {
                                    return Err(invalid_lifecycle(
                                        "ordinary Ed25519 reservation activation conflicts with the exact reservation",
                                    ));
                                }
                                delete_cloudflare_signing_worker_output_activation_by_active_key_v1(
                                    env,
                                    &active_key,
                                    &request.binding.material_activation,
                                )
                                .await?;
                                return Err(invalid_lifecycle(
                                    "ordinary Ed25519 material reservation is revoked",
                                ));
                            }
                            _ => continue,
                        }
                    }
                    Ok(()) => return Ok(receipt),
                    Err(error) => return Err(error),
                }
            }
            _ => {
                return Err(invalid_lifecycle(
                    "ordinary Ed25519 reservation activation changed concurrently",
                ))
            }
        }
    }
    Err(invalid_lifecycle(
        "ordinary Ed25519 reservation activation changed concurrently",
    ))
}

#[cfg(not(feature = "wallet-do-signing-worker-harness"))]
#[cfg(feature = "workers-rs")]
async fn deactivate_ed25519_yao_reservation_v1(
    env: &Env,
    request: &CloudflareEd25519YaoDeactivateReservationRequestV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoReservationDeactivationResponseV1> {
    request.validate()?;
    let record_key =
        reservation_record_key_from_material_activation_v1(&request.material_activation)?;
    let active_key = active_output_key_v1(&request.material_activation);
    for _ in 0..3 {
        let current = load_cloudflare_signing_worker_private_d1_secret_v1::<
            SigningWorkerYaoReservationStateV1,
        >(env, "ed25519_yao_reservations", &record_key)
        .await?
        .ok_or_else(|| invalid_lifecycle("ordinary Ed25519 material reservation is missing"))?;
        let (binding, reservation_id, revoked_at_ms) = match settle_linked_ed25519_deactivation_v1(
            &current.value,
            &request.material_activation,
        )? {
            LinkedEd25519DeactivationV1::Revoked {
                binding,
                reservation_id,
                revoked_at_ms,
            } => {
                delete_cloudflare_signing_worker_output_activation_by_active_key_v1(
                    env,
                    &active_key,
                    &request.material_activation,
                )
                .await?;
                (binding, reservation_id, revoked_at_ms)
            }
            LinkedEd25519DeactivationV1::Resume {
                binding,
                reservation_id,
                revoked_at_ms,
            } => {
                delete_cloudflare_signing_worker_output_activation_by_active_key_v1(
                    env,
                    &active_key,
                    &request.material_activation,
                )
                .await?;
                let revoked = SigningWorkerYaoReservationStateV1::Revoked {
                    binding: binding.clone(),
                    reservation_id: reservation_id.clone(),
                    revoked_at_ms,
                };
                match compare_and_set_cloudflare_signing_worker_private_d1_secret_v1(
                    env,
                    "ed25519_yao_reservations",
                    &record_key,
                    Some(current.version),
                    &revoked,
                    revoked_at_ms,
                )
                .await
                {
                    Err(error) if error.code() == RouterAbProtocolErrorCode::ConflictingPair => {
                        continue
                    }
                    Ok(()) => (binding, reservation_id, revoked_at_ms),
                    Err(error) => return Err(error),
                }
            }
            LinkedEd25519DeactivationV1::Revoke {
                binding,
                reservation_id,
            } => {
                let revoked_at_ms = cloudflare_now_unix_ms_v1()?;
                let deactivating = SigningWorkerYaoReservationStateV1::Deactivating {
                    binding,
                    reservation_id,
                    revoked_at_ms,
                };
                match compare_and_set_cloudflare_signing_worker_private_d1_secret_v1(
                    env,
                    "ed25519_yao_reservations",
                    &record_key,
                    Some(current.version),
                    &deactivating,
                    revoked_at_ms,
                )
                .await
                {
                    Err(error) if error.code() == RouterAbProtocolErrorCode::ConflictingPair => {
                        continue
                    }
                    Ok(()) => continue,
                    Err(error) => return Err(error),
                }
            }
        };
        return Ok(CloudflareEd25519YaoReservationDeactivationResponseV1 {
            state: "revoked",
            reservation_id,
            material_activation: binding.material_activation,
            revoked_at_ms,
        });
    }
    Err(invalid_lifecycle(
        "ordinary Ed25519 material deactivation changed concurrently",
    ))
}

#[cfg(feature = "workers-rs")]
pub(crate) async fn require_ed25519_material_active_v1(
    env: &Env,
    material_activation: &router_ab_core::MpcMaterialActivationRefV1,
) -> RouterAbProtocolResult<()> {
    let record_key = reservation_record_key_from_material_activation_v1(material_activation)?;
    let Some(current) = load_cloudflare_signing_worker_private_d1_secret_v1::<
        SigningWorkerYaoReservationStateV1,
    >(env, "ed25519_yao_reservations", &record_key)
    .await?
    else {
        return Ok(());
    };
    current.value.validate()?;
    match current.value {
        SigningWorkerYaoReservationStateV1::Active { delivery, .. }
            if delivery.deriver_a.binding.material_activation == *material_activation =>
        {
            Ok(())
        }
        SigningWorkerYaoReservationStateV1::Inactive { delivery, .. }
        | SigningWorkerYaoReservationStateV1::Activating { delivery, .. }
            if delivery.deriver_a.binding.material_activation == *material_activation =>
        {
            Err(invalid_lifecycle(
                "ordinary Ed25519 material reservation is not active",
            ))
        }
        SigningWorkerYaoReservationStateV1::Deactivating { binding, .. }
        | SigningWorkerYaoReservationStateV1::Revoked { binding, .. }
            if binding.material_activation == *material_activation =>
        {
            Err(invalid_lifecycle(
                "ordinary Ed25519 material reservation is revoked",
            ))
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "ordinary Ed25519 material activation identity conflicts with the reservation",
        )),
    }
}

fn reservation_record_key_v1(
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
) -> RouterAbProtocolResult<String> {
    reservation_record_key_from_binding_v1(&delivery.deriver_a.binding)
}

pub fn reservation_record_key_from_binding_v1(
    binding: &Ed25519YaoCeremonyBindingV1,
) -> RouterAbProtocolResult<String> {
    reservation_record_key_from_material_activation_v1(binding.material_activation())
}

pub fn reservation_record_key_from_material_activation_v1(
    material_activation: &router_ab_core::MpcMaterialActivationRefV1,
) -> RouterAbProtocolResult<String> {
    let canonical = serde_json::to_vec(material_activation).map_err(|_| {
        invalid_lifecycle("ordinary Ed25519 reservation identity could not be encoded")
    })?;
    let digest = Sha256::digest(canonical);
    Ok(format!("ed25519/{}", encode_hex_slice(&digest)))
}

#[cfg(feature = "workers-rs")]
async fn load_source_active_material_v1(
    env: &Env,
    source_binding: &Ed25519YaoCeremonyBindingV1,
) -> RouterAbProtocolResult<Ed25519YaoActiveSigningMaterialV1> {
    let record_key = reservation_record_key_from_binding_v1(source_binding)?;
    let current = load_cloudflare_signing_worker_private_d1_secret_v1::<
        SigningWorkerYaoReservationStateV1,
    >(env, "ed25519_yao_reservations", &record_key)
    .await?;
    let Some(current) = current else {
        return load_source_active_material_from_lifecycle_v1(env, source_binding).await;
    };
    current.value.validate()?;
    match current.value {
        SigningWorkerYaoReservationStateV1::Active {
            delivery,
            candidate,
            ..
        } if delivery.deriver_a.binding == *source_binding
            && candidate.binding() == source_binding =>
        {
            Ok(candidate)
        }
        SigningWorkerYaoReservationStateV1::Inactive { delivery, .. }
        | SigningWorkerYaoReservationStateV1::Activating { delivery, .. }
            if delivery.deriver_a.binding == *source_binding =>
        {
            Err(invalid_lifecycle(
                "source Ed25519 material reservation is not active",
            ))
        }
        SigningWorkerYaoReservationStateV1::Deactivating { binding, .. }
        | SigningWorkerYaoReservationStateV1::Revoked { binding, .. }
            if binding == *source_binding =>
        {
            Err(invalid_lifecycle(
                "source Ed25519 material reservation is revoked",
            ))
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "source Ed25519 material activation identity conflicts with the reservation",
        )),
    }
}

#[cfg(feature = "workers-rs")]
async fn load_source_active_material_from_lifecycle_v1(
    env: &Env,
    source_binding: &Ed25519YaoCeremonyBindingV1,
) -> RouterAbProtocolResult<Ed25519YaoActiveSigningMaterialV1> {
    let record_key = encode_hex(source_binding.stable_key_context_binding.into_bytes());
    let current = load_cloudflare_signing_worker_private_d1_secret_v1::<
        SigningWorkerYaoDurableStateV1,
    >(env, "ed25519_yao_lifecycle", &record_key)
    .await?
    .ok_or_else(|| invalid_lifecycle("source Ed25519 material reservation is missing"))?;
    current.value.validate()?;
    match current.value {
        SigningWorkerYaoDurableStateV1::Active { material, .. }
            if material.binding() == source_binding =>
        {
            Ok(material)
        }
        SigningWorkerYaoDurableStateV1::Active { .. } => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "source Ed25519 material activation identity conflicts with the lifecycle state",
        )),
        SigningWorkerYaoDurableStateV1::RegistrationStaged { .. }
        | SigningWorkerYaoDurableStateV1::RecoveryStaged { .. } => Err(invalid_lifecycle(
            "source Ed25519 material reservation is not active",
        )),
    }
}

pub fn source_preserving_reservation_id_v1(
    source_binding: &Ed25519YaoCeremonyBindingV1,
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
) -> RouterAbProtocolResult<String> {
    let target_record_key = reservation_record_key_v1(delivery)?;
    let source_bytes = serde_json::to_vec(source_binding).map_err(|_| {
        invalid_lifecycle("source Ed25519 reservation identity could not be encoded")
    })?;
    let source_digest = Sha256::digest(source_bytes);
    Ok(format!(
        "ordinary-ed25519-source-preserving-inactive-v1:{}:{}",
        target_record_key.trim_start_matches("ed25519/"),
        encode_hex_slice(&source_digest),
    ))
}

fn reservation_id_matches_material_activation_v1(
    reservation_id: &str,
    material_activation: &router_ab_core::MpcMaterialActivationRefV1,
) -> bool {
    let Ok(record_key) = reservation_record_key_from_material_activation_v1(material_activation)
    else {
        return false;
    };
    let target_digest = record_key.trim_start_matches("ed25519/");
    reservation_id == format!("ordinary-ed25519-inactive-v1:{target_digest}")
        || reservation_id.starts_with(&format!(
            "ordinary-ed25519-source-preserving-inactive-v1:{target_digest}:"
        ))
}

pub(crate) fn active_output_key_v1(
    material_activation: &router_ab_core::MpcMaterialActivationRefV1,
) -> String {
    format!(
        "active-signing-worker/{}/{}/{}",
        material_activation.material_owner,
        material_activation.activation_id,
        material_activation.signing_worker,
    )
}

fn validate_client_package_v1(
    package: &Ed25519YaoEncryptedPackageV1,
    binding: &Ed25519YaoCeremonyBindingV1,
    expected_deriver: Ed25519YaoDeriverRoleV1,
) -> RouterAbProtocolResult<()> {
    package.validate()?;
    if package.kind() != Ed25519YaoPackageKindV1::ActivationClient
        || package.deriver() != expected_deriver
        || package.session() != binding.session_id.into_bytes()
    {
        return Err(invalid_lifecycle(
            "ordinary Ed25519 client package does not match its activation binding",
        ));
    }
    Ok(())
}

fn validate_inactive_reservation_parts_v1(
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    participant_ids: [u16; 2],
    deriver_a_client_package: &Ed25519YaoEncryptedPackageV1,
    deriver_b_client_package: &Ed25519YaoEncryptedPackageV1,
    operation: Ed25519YaoOperationV1,
) -> RouterAbProtocolResult<()> {
    delivery.validate()?;
    require_operation(&delivery.deriver_a.binding, operation)?;
    validate_participant_ids_v1(participant_ids)?;
    validate_client_package_v1(
        deriver_a_client_package,
        &delivery.deriver_a.binding,
        Ed25519YaoDeriverRoleV1::DeriverA,
    )?;
    validate_client_package_v1(
        deriver_b_client_package,
        &delivery.deriver_b.binding,
        Ed25519YaoDeriverRoleV1::DeriverB,
    )
}

fn require_non_empty_reservation_id(value: &str) -> RouterAbProtocolResult<()> {
    if value.is_empty() || value.chars().any(|character| character.is_ascii_control()) {
        return Err(invalid_lifecycle(
            "ordinary Ed25519 reservation id is invalid",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum CloudflareEd25519YaoSigningWorkerHttpResponseV1 {
    Active {
        session: [u8; 32],
        transcript: [u8; 32],
        registered_public_key: [u8; 32],
        joined_client_commitment: [u8; 32],
        joined_signing_worker_commitment: [u8; 32],
        signing_worker_verifying_share: [u8; 32],
        state_epoch: u64,
    },
    Staged {
        session: [u8; 32],
        transcript: [u8; 32],
        registered_public_key: [u8; 32],
        joined_client_commitment: [u8; 32],
        joined_signing_worker_commitment: [u8; 32],
        signing_worker_verifying_share: [u8; 32],
        state_epoch: u64,
    },
}

fn http_response_from_command(
    response: SigningWorkerYaoCommandResponseV1,
) -> RouterAbProtocolResult<CloudflareEd25519YaoSigningWorkerHttpResponseV1> {
    match response {
        SigningWorkerYaoCommandResponseV1::Active { receipt } => Ok(http_active_receipt(receipt)),
        SigningWorkerYaoCommandResponseV1::Staged { receipt } => Ok(http_staged_receipt(receipt)),
    }
}

pub(crate) fn http_active_receipt(
    receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
) -> CloudflareEd25519YaoSigningWorkerHttpResponseV1 {
    CloudflareEd25519YaoSigningWorkerHttpResponseV1::Active {
        session: receipt.session,
        transcript: receipt.transcript,
        registered_public_key: receipt.registered_public_key,
        joined_client_commitment: receipt.joined_client_commitment,
        joined_signing_worker_commitment: receipt.joined_signing_worker_commitment,
        signing_worker_verifying_share: receipt.signing_worker_verifying_share,
        state_epoch: receipt.state_epoch.get(),
    }
}

pub(crate) fn http_staged_receipt(
    receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
) -> CloudflareEd25519YaoSigningWorkerHttpResponseV1 {
    CloudflareEd25519YaoSigningWorkerHttpResponseV1::Staged {
        session: receipt.session,
        transcript: receipt.transcript,
        registered_public_key: receipt.registered_public_key,
        joined_client_commitment: receipt.joined_client_commitment,
        joined_signing_worker_commitment: receipt.joined_signing_worker_commitment,
        signing_worker_verifying_share: receipt.signing_worker_verifying_share,
        state_epoch: receipt.state_epoch.get(),
    }
}

/// What a SigningWorker holds for the recovery a delivery names, in the terms
/// every host decides a recovery delivery by. Each store maps what it keeps
/// here, and persists what [`decide_ed25519_yao_recovery_delivery_v1`]
/// decides.
pub enum Ed25519YaoRecoveryHeldV1<'a> {
    /// No recovery staged, and none promoted by this lifecycle.
    Idle,
    /// A recovery staged here, holding one attempt's candidate.
    Staged {
        lifecycle_id: &'a str,
        session_id: Ed25519YaoSessionIdV1,
        attempt: Ed25519YaoRecoveryAttemptV1,
        /// The delivery carries exactly the staged attempt's packages.
        same_deliveries: bool,
    },
    /// A recovery that promoted here.
    Promoted {
        lifecycle_id: &'a str,
        /// The delivery carries exactly the packages that promoted.
        same_deliveries: bool,
    },
}

/// What a store does with a recovery delivery it did not refuse.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ed25519YaoRecoveryDeliveryDecisionV1 {
    /// The same deliveries again: answer from what is held.
    AnswerHeld,
    /// Stage this attempt over the active material, in place of any lower
    /// attempt staged.
    Stage,
}

/// Decides one recovery delivery from the Gateway's attempt `attempt`, on
/// every host.
/// - The same deliveries answer again, staged or promoted.
/// - A staged recovery holds the highest attempt delivered to it. A lower
///   attempt is one the Gateway has superseded, and it is refused however
///   late it arrives. A higher attempt supersedes the staged one and takes
///   its place, since the Gateway can no longer promote the staged one.
/// - Another attempt of a recovery that already promoted is stale: it never
///   replaces the material its recovery activated.
/// - With nothing held for its lifecycle, the attempt stages.
pub fn decide_ed25519_yao_recovery_delivery_v1(
    held: Ed25519YaoRecoveryHeldV1<'_>,
    lifecycle_id: &str,
    session_id: Ed25519YaoSessionIdV1,
    attempt: Ed25519YaoRecoveryAttemptV1,
) -> RouterAbProtocolResult<Ed25519YaoRecoveryDeliveryDecisionV1> {
    match held {
        Ed25519YaoRecoveryHeldV1::Idle => Ok(Ed25519YaoRecoveryDeliveryDecisionV1::Stage),
        Ed25519YaoRecoveryHeldV1::Promoted {
            lifecycle_id: promoted,
            same_deliveries,
        } => {
            if same_deliveries {
                return Ok(Ed25519YaoRecoveryDeliveryDecisionV1::AnswerHeld);
            }
            if promoted == lifecycle_id {
                return Err(superseded_recovery_attempt(
                    "Signing Worker recovery was already promoted by another attempt",
                ));
            }
            Ok(Ed25519YaoRecoveryDeliveryDecisionV1::Stage)
        }
        Ed25519YaoRecoveryHeldV1::Staged {
            lifecycle_id: staged,
            session_id: staged_session,
            attempt: staged_attempt,
            same_deliveries,
        } => {
            if staged != lifecycle_id {
                return Err(invalid_lifecycle(
                    "Signing Worker package pair conflicts with the Yao lifecycle state",
                ));
            }
            let same_session = staged_session == session_id;
            match attempt.cmp(&staged_attempt) {
                core::cmp::Ordering::Less => Err(superseded_recovery_attempt(
                    "Signing Worker recovery attempt was superseded by a later attempt",
                )),
                core::cmp::Ordering::Equal if same_session && same_deliveries => {
                    Ok(Ed25519YaoRecoveryDeliveryDecisionV1::AnswerHeld)
                }
                core::cmp::Ordering::Equal => Err(invalid_lifecycle(
                    "Signing Worker recovery attempt delivered different packages",
                )),
                core::cmp::Ordering::Greater if same_session => Err(invalid_lifecycle(
                    "Signing Worker recovery session was delivered under another attempt",
                )),
                core::cmp::Ordering::Greater => Ok(Ed25519YaoRecoveryDeliveryDecisionV1::Stage),
            }
        }
    }
}

/// What a SigningWorker holds for a recovery promotion. `matches` is the
/// store's own check that the request names exactly what it holds.
pub enum Ed25519YaoRecoveryPromotionHeldV1 {
    /// No recovery staged or promoted here.
    Nothing,
    /// A recovery staged here.
    Staged { matches: RouterAbProtocolResult<()> },
    /// A recovery that promoted here.
    Promoted { matches: RouterAbProtocolResult<()> },
}

/// What a store does with a recovery promotion it did not refuse.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ed25519YaoRecoveryPromotionDecisionV1 {
    /// Promote the staged candidate, retiring the material it replaces.
    Promote,
    /// Promoted already, by this request: answer active again.
    Repeat,
}

/// Decides one recovery promotion, on every host: the exact staged candidate
/// promotes, and the same promotion answers again once it has.
pub fn decide_ed25519_yao_recovery_promotion_v1(
    held: Ed25519YaoRecoveryPromotionHeldV1,
) -> RouterAbProtocolResult<Ed25519YaoRecoveryPromotionDecisionV1> {
    match held {
        Ed25519YaoRecoveryPromotionHeldV1::Staged { matches } => {
            matches.map(|()| Ed25519YaoRecoveryPromotionDecisionV1::Promote)
        }
        Ed25519YaoRecoveryPromotionHeldV1::Promoted { matches } => {
            matches.map(|()| Ed25519YaoRecoveryPromotionDecisionV1::Repeat)
        }
        Ed25519YaoRecoveryPromotionHeldV1::Nothing => Err(invalid_lifecycle(
            "recovery promotion requires an exact staged candidate",
        )),
    }
}

/// A recovery delivery settled against the lifecycle it meets. Every
/// SigningWorker store settles it this way, then writes what it decides.
pub(crate) enum SigningWorkerYaoRecoveryDeliveryV1 {
    /// The same deliveries again: they answer staged from what is stored.
    Answer(Ed25519YaoSigningWorkerActivationReceiptV1),
    /// The recovery with this attempt's candidate staged, to store.
    Stage {
        state: SigningWorkerYaoDurableStateV1,
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
    },
}

impl SigningWorkerYaoRecoveryDeliveryV1 {
    pub(crate) fn receipt(&self) -> &Ed25519YaoSigningWorkerActivationReceiptV1 {
        match self {
            Self::Answer(receipt) | Self::Stage { receipt, .. } => receipt,
        }
    }
}

/// Settles one recovery delivery from the Gateway's attempt `attempt`.
/// `combine` opens the delivered packages on the active material.
/// - The same deliveries answer again, staged or promoted.
/// - A staged recovery holds the highest attempt delivered to it. A lower
///   attempt is one the Gateway has superseded, and it is refused however
///   late it arrives. A higher attempt supersedes the staged one and takes
///   its place, since the Gateway can no longer promote the staged one.
/// - Another attempt of a recovery that already promoted is stale: it never
///   replaces the material its recovery activated.
/// - Over active material, a new recovery stages the attempt delivered.
pub(crate) fn settle_signing_worker_yao_recovery_delivery_v1(
    current: Option<SigningWorkerYaoDurableStateV1>,
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    attempt: Ed25519YaoRecoveryAttemptV1,
    combine: impl FnOnce(
        &Ed25519YaoActiveSigningMaterialV1,
    ) -> RouterAbProtocolResult<Ed25519YaoSigningWorkerActivationCandidateV1>,
) -> RouterAbProtocolResult<SigningWorkerYaoRecoveryDeliveryV1> {
    let binding = &delivery.deriver_a.binding;
    require_operation(binding, Ed25519YaoOperationV1::Recovery)?;
    let lifecycle_id = binding.lifecycle.lifecycle_id.as_str();
    let session_id = binding.session_id;
    let (active_material, active_receipt) = match current {
        Some(SigningWorkerYaoDurableStateV1::Active {
            deriver_a,
            deriver_b,
            material,
            receipt,
        }) => {
            let held = if material.binding().operation == Ed25519YaoOperationV1::Recovery {
                Ed25519YaoRecoveryHeldV1::Promoted {
                    lifecycle_id: material.binding().lifecycle.lifecycle_id.as_str(),
                    same_deliveries: deriver_a == delivery.deriver_a
                        && deriver_b == delivery.deriver_b,
                }
            } else {
                Ed25519YaoRecoveryHeldV1::Idle
            };
            match decide_ed25519_yao_recovery_delivery_v1(held, lifecycle_id, session_id, attempt)?
            {
                Ed25519YaoRecoveryDeliveryDecisionV1::AnswerHeld => {
                    return Ok(SigningWorkerYaoRecoveryDeliveryV1::Answer(receipt));
                }
                Ed25519YaoRecoveryDeliveryDecisionV1::Stage => (material, receipt),
            }
        }
        Some(SigningWorkerYaoDurableStateV1::RecoveryStaged {
            active_material,
            active_receipt,
            staged,
        }) => {
            let held = Ed25519YaoRecoveryHeldV1::Staged {
                lifecycle_id: staged.deriver_a.binding.lifecycle.lifecycle_id.as_str(),
                session_id: staged.deriver_a.binding.session_id,
                attempt: staged.attempt,
                same_deliveries: staged.deriver_a == delivery.deriver_a
                    && staged.deriver_b == delivery.deriver_b,
            };
            match decide_ed25519_yao_recovery_delivery_v1(held, lifecycle_id, session_id, attempt)?
            {
                Ed25519YaoRecoveryDeliveryDecisionV1::AnswerHeld => {
                    return Ok(SigningWorkerYaoRecoveryDeliveryV1::Answer(staged.receipt));
                }
                Ed25519YaoRecoveryDeliveryDecisionV1::Stage => (active_material, active_receipt),
            }
        }
        Some(SigningWorkerYaoDurableStateV1::RegistrationStaged { .. }) | None => {
            return Err(invalid_lifecycle(
                "Signing Worker package pair conflicts with the Yao lifecycle state",
            ))
        }
    };
    require_same_stable_identity(active_material.binding(), binding)?;
    let (candidate, receipt) = combine(&active_material)?.into_parts();
    let state = SigningWorkerYaoDurableStateV1::RecoveryStaged {
        active_material,
        active_receipt,
        staged: SigningWorkerYaoStagedRecoveryAttemptV1 {
            attempt,
            deriver_a: delivery.deriver_a.clone(),
            deriver_b: delivery.deriver_b.clone(),
            candidate,
            receipt: receipt.clone(),
        },
    };
    state.validate()?;
    Ok(SigningWorkerYaoRecoveryDeliveryV1::Stage { state, receipt })
}

/// A recovery promotion settled against the lifecycle it meets.
pub(crate) enum SigningWorkerYaoRecoveryPromotionV1 {
    /// Promoted already, by this request: the store writes the promoted
    /// activation again if it is missing, and answers active.
    Repeat {
        material: Ed25519YaoActiveSigningMaterialV1,
        receipt: Ed25519YaoSigningWorkerActivationReceiptV1,
    },
    /// Promote: the store writes `active`, whose activation replaces the
    /// `retired` material's. The retired activation never signs again.
    Promote {
        active: SigningWorkerYaoDurableStateV1,
        retired: Ed25519YaoActiveSigningMaterialV1,
    },
}

/// Settles one recovery promotion: the exact staged candidate promotes, and
/// the same promotion answers again once it has.
pub(crate) fn settle_signing_worker_yao_recovery_promotion_v1(
    current: Option<SigningWorkerYaoDurableStateV1>,
    request: &CloudflareEd25519YaoRecoveryPromotionRequestV1,
) -> RouterAbProtocolResult<SigningWorkerYaoRecoveryPromotionV1> {
    let held = match &current {
        Some(SigningWorkerYaoDurableStateV1::Active {
            material, receipt, ..
        }) if material.binding().operation == Ed25519YaoOperationV1::Recovery => {
            Ed25519YaoRecoveryPromotionHeldV1::Promoted {
                matches: validate_promotion_request(request, material.binding(), receipt),
            }
        }
        Some(SigningWorkerYaoDurableStateV1::RecoveryStaged { staged, .. }) => {
            Ed25519YaoRecoveryPromotionHeldV1::Staged {
                matches: validate_promotion_request(
                    request,
                    staged.candidate.binding(),
                    &staged.receipt,
                ),
            }
        }
        _ => Ed25519YaoRecoveryPromotionHeldV1::Nothing,
    };
    match (decide_ed25519_yao_recovery_promotion_v1(held)?, current) {
        (
            Ed25519YaoRecoveryPromotionDecisionV1::Repeat,
            Some(SigningWorkerYaoDurableStateV1::Active {
                material, receipt, ..
            }),
        ) => Ok(SigningWorkerYaoRecoveryPromotionV1::Repeat { material, receipt }),
        (
            Ed25519YaoRecoveryPromotionDecisionV1::Promote,
            Some(SigningWorkerYaoDurableStateV1::RecoveryStaged {
                active_material,
                staged,
                ..
            }),
        ) => {
            let active = SigningWorkerYaoDurableStateV1::Active {
                deriver_a: staged.deriver_a,
                deriver_b: staged.deriver_b,
                material: staged.candidate,
                receipt: staged.receipt,
            };
            active.validate()?;
            Ok(SigningWorkerYaoRecoveryPromotionV1::Promote {
                active,
                retired: active_material,
            })
        }
        _ => unreachable!("the promotion decision follows the state it was made on"),
    }
}

#[cfg(feature = "workers-rs")]
async fn execute_signing_worker_yao_command(
    env: &Env,
    command: SigningWorkerYaoCommandV1,
) -> RouterAbProtocolResult<SigningWorkerYaoCommandResponseV1> {
    command.validate()?;
    let record_key = encode_hex(command.stable_context_binding());
    for _ in 0..3 {
        let current = load_cloudflare_signing_worker_private_d1_secret_v1::<
            SigningWorkerYaoDurableStateV1,
        >(env, "ed25519_yao_lifecycle", &record_key)
        .await?;
        if let Some(current) = current.as_ref() {
            current.value.validate()?;
            if current.value.stable_context_binding() != command.stable_context_binding() {
                return Err(invalid_lifecycle(
                    "Ed25519 Yao private D1 stable identity mismatch",
                ));
            }
        }
        match execute_signing_worker_yao_d1_transition_v1(env, &record_key, current, &command).await
        {
            Err(error) if error.code() == RouterAbProtocolErrorCode::ConflictingPair => continue,
            result => return result,
        }
    }
    Err(invalid_lifecycle(
        "Signing Worker Yao private D1 lifecycle changed concurrently",
    ))
}

#[cfg(feature = "workers-rs")]
async fn execute_signing_worker_yao_d1_transition_v1(
    env: &Env,
    record_key: &str,
    current: Option<
        crate::CloudflareSigningWorkerPrivateD1VersionedSecretV1<SigningWorkerYaoDurableStateV1>,
    >,
    command: &SigningWorkerYaoCommandV1,
) -> RouterAbProtocolResult<SigningWorkerYaoCommandResponseV1> {
    let expected_version = current.as_ref().map(|current| current.version);
    let current = current.map(|current| current.value);
    match command {
        SigningWorkerYaoCommandV1::DeliverPackages {
            delivery,
            recovery_attempt,
        } => {
            execute_signing_worker_yao_delivery_d1_transition_v1(
                env,
                record_key,
                expected_version,
                current,
                delivery,
                *recovery_attempt,
            )
            .await
        }
        SigningWorkerYaoCommandV1::PromoteRecovery { request } => {
            execute_signing_worker_yao_promotion_d1_transition_v1(
                env,
                record_key,
                expected_version,
                current,
                request,
            )
            .await
        }
    }
}

#[cfg(feature = "workers-rs")]
async fn execute_signing_worker_yao_delivery_d1_transition_v1(
    env: &Env,
    record_key: &str,
    expected_version: Option<i64>,
    current: Option<SigningWorkerYaoDurableStateV1>,
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    recovery_attempt: Option<Ed25519YaoRecoveryAttemptV1>,
) -> RouterAbProtocolResult<SigningWorkerYaoCommandResponseV1> {
    match (delivery.deriver_a.binding.operation, current) {
        (Ed25519YaoOperationV1::Registration, None) => {
            let candidate = combine_signing_worker_yao_packages_v1(env, delivery, None)?;
            let (candidate, receipt) = candidate.into_parts();
            let staged = SigningWorkerYaoDurableStateV1::RegistrationStaged {
                deriver_a: delivery.deriver_a.clone(),
                deriver_b: delivery.deriver_b.clone(),
                candidate,
                receipt,
            };
            staged.validate()?;
            persist_signing_worker_yao_state_v1(env, record_key, expected_version, &staged).await?;
            let SigningWorkerYaoDurableStateV1::RegistrationStaged {
                deriver_a,
                deriver_b,
                candidate,
                receipt,
            } = staged
            else {
                unreachable!("registration branch constructs registration-staged state");
            };
            persist_signing_worker_yao_active_output_v1(env, &candidate, &receipt).await?;
            let active = SigningWorkerYaoDurableStateV1::Active {
                deriver_a,
                deriver_b,
                material: candidate,
                receipt: receipt.clone(),
            };
            persist_signing_worker_yao_state_v1(env, record_key, Some(1), &active).await?;
            Ok(SigningWorkerYaoCommandResponseV1::Active { receipt })
        }
        (
            Ed25519YaoOperationV1::Registration,
            Some(SigningWorkerYaoDurableStateV1::RegistrationStaged {
                deriver_a,
                deriver_b,
                candidate,
                receipt,
            }),
        ) if deriver_a == delivery.deriver_a && deriver_b == delivery.deriver_b => {
            persist_signing_worker_yao_active_output_v1(env, &candidate, &receipt).await?;
            let active = SigningWorkerYaoDurableStateV1::Active {
                deriver_a,
                deriver_b,
                material: candidate,
                receipt: receipt.clone(),
            };
            persist_signing_worker_yao_state_v1(env, record_key, expected_version, &active).await?;
            Ok(SigningWorkerYaoCommandResponseV1::Active { receipt })
        }
        (
            Ed25519YaoOperationV1::Registration,
            Some(SigningWorkerYaoDurableStateV1::Active {
                deriver_a,
                deriver_b,
                material,
                receipt,
            }),
        ) if deriver_a == delivery.deriver_a && deriver_b == delivery.deriver_b => {
            persist_signing_worker_yao_active_output_v1(env, &material, &receipt).await?;
            Ok(SigningWorkerYaoCommandResponseV1::Active { receipt })
        }
        (Ed25519YaoOperationV1::Recovery, current) => {
            let attempt = recovery_attempt
                .ok_or_else(|| invalid_lifecycle("SigningWorker recovery names no attempt"))?;
            let settled = settle_signing_worker_yao_recovery_delivery_v1(
                current,
                delivery,
                attempt,
                |active| combine_signing_worker_yao_packages_v1(env, delivery, Some(active)),
            )?;
            let receipt = settled.receipt().clone();
            if let SigningWorkerYaoRecoveryDeliveryV1::Stage { state, .. } = settled {
                persist_signing_worker_yao_state_v1(env, record_key, expected_version, &state)
                    .await?;
            }
            Ok(SigningWorkerYaoCommandResponseV1::Staged { receipt })
        }
        _ => Err(invalid_lifecycle(
            "Signing Worker package pair conflicts with the Yao lifecycle state",
        )),
    }
}

#[cfg(feature = "workers-rs")]
async fn execute_signing_worker_yao_promotion_d1_transition_v1(
    env: &Env,
    record_key: &str,
    expected_version: Option<i64>,
    current: Option<SigningWorkerYaoDurableStateV1>,
    request: &CloudflareEd25519YaoRecoveryPromotionRequestV1,
) -> RouterAbProtocolResult<SigningWorkerYaoCommandResponseV1> {
    match settle_signing_worker_yao_recovery_promotion_v1(current, request)? {
        SigningWorkerYaoRecoveryPromotionV1::Repeat { material, receipt } => {
            persist_signing_worker_yao_active_output_v1(env, &material, &receipt).await?;
            Ok(SigningWorkerYaoCommandResponseV1::Active { receipt })
        }
        SigningWorkerYaoRecoveryPromotionV1::Promote { active, retired } => {
            // The previous activation is fenced first, so no crash leaves it
            // signable beside the promoted one. The lifecycle then moves to
            // active by compare-and-set: one promotion wins it, and only the
            // winner writes the activation row. A repeated promotion finds the
            // lifecycle active and writes the row again.
            let retired_activation = retired.binding().material_activation();
            delete_cloudflare_signing_worker_output_activation_by_active_key_v1(
                env,
                &active_output_key_v1(retired_activation),
                retired_activation,
            )
            .await?;
            persist_signing_worker_yao_state_v1(env, record_key, expected_version, &active).await?;
            let SigningWorkerYaoDurableStateV1::Active {
                material, receipt, ..
            } = active
            else {
                unreachable!("promotion constructs active state");
            };
            persist_signing_worker_yao_active_output_v1(env, &material, &receipt).await?;
            Ok(SigningWorkerYaoCommandResponseV1::Active { receipt })
        }
    }
}

#[cfg(feature = "workers-rs")]
pub(crate) fn combine_signing_worker_yao_packages_v1(
    env: &Env,
    delivery: &CloudflareEd25519YaoPackagePairDeliveryV1,
    active: Option<&Ed25519YaoActiveSigningMaterialV1>,
) -> RouterAbProtocolResult<Ed25519YaoSigningWorkerActivationCandidateV1> {
    let runtime = CloudflareSigningWorkerRuntimeV1::from_worker_env(env)?;
    let private_key = load_cloudflare_server_output_hpke_private_key_bytes_v1(
        env,
        runtime.server_output_decrypt_key(),
    )?;
    let private_key = Ed25519YaoRecipientPrivateKeyV1::from_bytes(private_key);
    match active {
        Some(source)
            if delivery.deriver_a.binding.operation == Ed25519YaoOperationV1::Registration =>
        {
            combine_ed25519_yao_signing_worker_packages_source_preserving_v1(
                &private_key,
                delivery.deriver_a.clone(),
                delivery.deriver_b.clone(),
                source,
            )
        }
        _ => combine_ed25519_yao_signing_worker_packages_v1(
            &private_key,
            delivery.deriver_a.clone(),
            delivery.deriver_b.clone(),
            active,
        ),
    }
}

#[cfg(feature = "workers-rs")]
async fn persist_signing_worker_yao_state_v1(
    env: &Env,
    record_key: &str,
    expected_version: Option<i64>,
    state: &SigningWorkerYaoDurableStateV1,
) -> RouterAbProtocolResult<()> {
    state.validate()?;
    compare_and_set_cloudflare_signing_worker_private_d1_secret_v1(
        env,
        "ed25519_yao_lifecycle",
        record_key,
        expected_version,
        state,
        cloudflare_now_unix_ms_v1()?,
    )
    .await
}

#[cfg(feature = "workers-rs")]
async fn persist_signing_worker_yao_active_output_v1(
    env: &Env,
    material: &Ed25519YaoActiveSigningMaterialV1,
    receipt: &Ed25519YaoSigningWorkerActivationReceiptV1,
) -> RouterAbProtocolResult<()> {
    let runtime = CloudflareSigningWorkerRuntimeV1::from_worker_env(env)?;
    let record = build_output_activation_record(&runtime, material, receipt)?;
    persist_cloudflare_ed25519_yao_output_activation_v1(env, &runtime, record).await
}

#[cfg(feature = "workers-rs")]
async fn persist_cloudflare_ed25519_yao_output_activation_v1(
    env: &Env,
    _runtime: &CloudflareSigningWorkerRuntimeV1,
    record: CloudflareSigningWorkerOutputActivationRecordV1,
) -> RouterAbProtocolResult<()> {
    let activation_request = CloudflareEd25519YaoOutputActivationPutV1::new(record)?;
    let activated_at_ms = activation_request
        .record
        .active_signing_worker_state()
        .activated_at_ms;
    put_cloudflare_signing_worker_output_activation_record_v1(
        env,
        &activation_request.record,
        activated_at_ms,
    )
    .await?;
    Ok(())
}

#[cfg(feature = "workers-rs")]
pub(crate) fn build_output_activation_record(
    runtime: &CloudflareSigningWorkerRuntimeV1,
    yao_material: &Ed25519YaoActiveSigningMaterialV1,
    receipt: &Ed25519YaoSigningWorkerActivationReceiptV1,
) -> RouterAbProtocolResult<CloudflareSigningWorkerOutputActivationRecordV1> {
    build_output_activation_record_at_v1(
        runtime,
        yao_material,
        receipt,
        cloudflare_now_unix_ms_v1()?,
    )
}

/// The output activation that Ed25519 Yao material signs with, activated at
/// `activated_at_ms` by a host's own clock.
pub fn build_output_activation_record_at_v1(
    runtime: &CloudflareSigningWorkerRuntimeV1,
    yao_material: &Ed25519YaoActiveSigningMaterialV1,
    receipt: &Ed25519YaoSigningWorkerActivationReceiptV1,
    activated_at_ms: u64,
) -> RouterAbProtocolResult<CloudflareSigningWorkerOutputActivationRecordV1> {
    validate_material_receipt(yao_material, receipt)?;
    let binding = yao_material.binding();
    let decrypt_key = runtime.server_output_decrypt_key();
    let signing_worker = ServerIdentityV1::new(
        binding.lifecycle.selected_server_id.clone(),
        decrypt_key.key_epoch.clone(),
        decrypt_key.public_key.clone(),
    )?;
    decrypt_key.validate_matches_server(&signing_worker)?;
    let material_handle = format!(
        "signing-worker-private/ed25519-yao/{}/{}",
        encode_hex(binding.stable_key_context_binding.into_bytes()),
        yao_material.state_epoch().get()
    );
    let active_state = ActiveSigningWorkerStateV1::new(
        binding.lifecycle.account_id.clone(),
        binding.material_activation().clone(),
        format!(
            "ed25519:{}",
            bs58::encode(receipt.registered_public_key).into_string()
        ),
        signing_worker,
        PublicDigest32::new(receipt.transcript),
        PublicDigest32::new(receipt.registered_public_key),
        material_handle,
        activated_at_ms,
    )?;
    let material = CloudflareServerOutputMaterialRecordV1::new(
        PublicDigest32::new(receipt.transcript),
        OpenedShareKind::XServerBase,
        Role::Server,
        binding.lifecycle.selected_server_id.clone(),
        CloudflareSecretMaterial32V1::new(*yao_material.scalar()),
    )?;
    CloudflareSigningWorkerOutputActivationRecordV1::ed25519_yao(
        binding.clone(),
        receipt.clone(),
        active_state,
        material,
    )
}

fn validate_staged_candidate(
    deriver_a: &Ed25519YaoSigningWorkerPackageDeliveryV1,
    deriver_b: &Ed25519YaoSigningWorkerPackageDeliveryV1,
    candidate: &Ed25519YaoActiveSigningMaterialV1,
    receipt: &Ed25519YaoSigningWorkerActivationReceiptV1,
    operation: Ed25519YaoOperationV1,
) -> RouterAbProtocolResult<()> {
    deriver_a.validate_for_deriver(Ed25519YaoDeriverRoleV1::DeriverA)?;
    deriver_b.validate_for_deriver(Ed25519YaoDeriverRoleV1::DeriverB)?;
    require_operation(&deriver_a.binding, operation)?;
    if deriver_a.binding != deriver_b.binding || candidate.binding() != &deriver_a.binding {
        return Err(invalid_lifecycle(
            "staged Signing Worker Yao packages do not share one binding",
        ));
    }
    validate_material_receipt(candidate, receipt)
}

fn validate_material_receipt(
    material: &Ed25519YaoActiveSigningMaterialV1,
    receipt: &Ed25519YaoSigningWorkerActivationReceiptV1,
) -> RouterAbProtocolResult<()> {
    material.validate()?;
    if receipt.session != material.binding().session_id.into_bytes()
        || receipt.transcript != material.transcript()
        || receipt.registered_public_key != material.registered_public_key()
        || receipt.state_epoch != material.state_epoch()
        || receipt.signing_worker_verifying_share != receipt.joined_signing_worker_commitment
    {
        return Err(invalid_lifecycle(
            "Signing Worker Yao material does not match its public receipt",
        ));
    }
    Ok(())
}

/// A delivery from an attempt the Gateway can never promote: its answer is
/// final, and the Router passes it on as such.
fn superseded_recovery_attempt(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::SupersededAttempt, message)
}

fn validate_promotion_request(
    request: &CloudflareEd25519YaoRecoveryPromotionRequestV1,
    candidate_binding: &Ed25519YaoCeremonyBindingV1,
    receipt: &Ed25519YaoSigningWorkerActivationReceiptV1,
) -> RouterAbProtocolResult<()> {
    request.validate()?;
    let public = &request.public_receipt;
    if &request.binding != candidate_binding
        || request.binding.session_id.into_bytes() != receipt.session
        || public.transcript() != receipt.transcript
        || public.registered_public_key() != receipt.registered_public_key
        || public.joined_client_commitment() != receipt.joined_client_commitment
        || public.joined_signing_worker_commitment() != receipt.joined_signing_worker_commitment
        || public.signing_worker_verifying_share() != receipt.signing_worker_verifying_share
        || public.state_epoch() != receipt.state_epoch
    {
        return Err(invalid_lifecycle(
            "recovery promotion does not match the exact staged Yao receipt",
        ));
    }
    Ok(())
}

fn require_operation(
    binding: &Ed25519YaoCeremonyBindingV1,
    expected: Ed25519YaoOperationV1,
) -> RouterAbProtocolResult<()> {
    binding.validate()?;
    if binding.operation == expected {
        return Ok(());
    }
    Err(invalid_lifecycle(
        "Signing Worker Yao lifecycle operation mismatch",
    ))
}

fn require_same_stable_identity(
    active: &Ed25519YaoCeremonyBindingV1,
    candidate: &Ed25519YaoCeremonyBindingV1,
) -> RouterAbProtocolResult<()> {
    if active.stable_key_context_binding == candidate.stable_key_context_binding
        && active.lifecycle.root_share_epoch == candidate.lifecycle.root_share_epoch
        && active.lifecycle.account_id == candidate.lifecycle.account_id
        && active.lifecycle.signer_set_id == candidate.lifecycle.signer_set_id
        && active.lifecycle.selected_server_id == candidate.lifecycle.selected_server_id
    {
        return Ok(());
    }
    Err(invalid_lifecycle(
        "Signing Worker Yao recovery changed the stable signing identity",
    ))
}

#[cfg(feature = "workers-rs")]
async fn parse_request<T>(request: &mut Request) -> RouterAbProtocolResult<T>
where
    T: serde::de::DeserializeOwned,
{
    request
        .json::<T>()
        .await
        .map_err(|_| invalid_lifecycle("Signing Worker Yao request JSON is malformed"))
}

#[cfg(feature = "workers-rs")]
fn json_response<T>(value: &T) -> RouterAbProtocolResult<Response>
where
    T: Serialize,
{
    Response::from_json(value)
        .map_err(|_| invalid_lifecycle("Signing Worker Yao response could not be encoded"))
}

fn validate_participant_ids_v1(participant_ids: [u16; 2]) -> RouterAbProtocolResult<()> {
    if participant_ids[0] == 0
        || participant_ids[1] == 0
        || participant_ids[0] >= participant_ids[1]
    {
        return Err(invalid_lifecycle(
            "ordinary Ed25519 participant ids must be distinct, nonzero, ascending values",
        ));
    }
    Ok(())
}

pub fn public_activation_receipt_v1(
    binding: &Ed25519YaoCeremonyBindingV1,
    receipt: &Ed25519YaoSigningWorkerActivationReceiptV1,
) -> RouterAbProtocolResult<RouterAbEd25519YaoActivationPublicReceiptV1> {
    if receipt.session != binding.session_id.into_bytes()
        || receipt.transcript == [0; 32]
        || receipt.registered_public_key == [0; 32]
    {
        return Err(invalid_lifecycle(
            "ordinary Ed25519 activation receipt does not match its reservation binding",
        ));
    }
    RouterAbEd25519YaoActivationPublicReceiptV1::new(
        receipt.transcript,
        receipt.registered_public_key,
        receipt.joined_client_commitment,
        receipt.joined_signing_worker_commitment,
        receipt.signing_worker_verifying_share,
        receipt.state_epoch,
        binding.material_activation.clone(),
    )
}

fn invalid_lifecycle(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLifecycleState,
        message.into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deactivation_uses_the_same_active_output_identity_as_activation() {
        let material_activation = router_ab_core::MpcMaterialActivationRefV1::new(
            "activation",
            "capability",
            "wallet",
            "key-binding",
            "lifecycle-binding",
            "signing-worker",
        )
        .expect("valid material activation");

        assert_eq!(
            active_output_key_v1(&material_activation),
            "active-signing-worker/wallet/activation/signing-worker"
        );
    }

    #[test]
    fn deactivation_reservation_key_is_family_scoped() {
        let material_activation = router_ab_core::MpcMaterialActivationRefV1::new(
            "activation",
            "capability",
            "wallet",
            "key-binding",
            "lifecycle-binding",
            "signing-worker",
        )
        .expect("valid material activation");

        let key = reservation_record_key_from_material_activation_v1(&material_activation)
            .expect("record key");
        assert!(key.starts_with("ed25519/"));
        assert_eq!(key.len(), "ed25519/".len() + 64);
    }

    #[test]
    fn ordinary_reservation_participant_ids_are_strictly_ordered() {
        assert!(validate_participant_ids_v1([1, 2]).is_ok());
        assert!(validate_participant_ids_v1([0, 2]).is_err());
        assert!(validate_participant_ids_v1([2, 2]).is_err());
        assert!(validate_participant_ids_v1([3, 2]).is_err());
    }

    fn source_preserving_test_binding(
        operation: Ed25519YaoOperationV1,
        session: u8,
        activation_id: &str,
    ) -> Ed25519YaoCeremonyBindingV1 {
        let work_kind = match operation {
            Ed25519YaoOperationV1::Registration => {
                router_ab_core::ExpensiveWorkKindV1::RegistrationPrepare
            }
            Ed25519YaoOperationV1::Recovery => router_ab_core::ExpensiveWorkKindV1::Recovery,
            _ => panic!("test binding only covers activation operations"),
        };
        Ed25519YaoCeremonyBindingV1::new(
            router_ab_core::LifecycleScopeV1::new(
                "test-lifecycle",
                work_kind,
                router_ab_core::RootShareEpoch::new("test-epoch").expect("root epoch"),
                "test-account",
                "test-wallet",
                "test-signer-set",
                "test-worker",
            )
            .expect("lifecycle"),
            operation,
            router_ab_core::Ed25519YaoSessionIdV1::new([session; 32]).expect("session"),
            router_ab_core::Ed25519YaoStableKeyContextBindingV1::new([0x42; 32]),
            router_ab_core::MpcMaterialActivationRefV1::new(
                activation_id,
                "test-capability",
                "test-account",
                "test-key",
                "test-lifecycle",
                "test-worker",
            )
            .expect("material activation"),
        )
        .expect("binding")
    }

    fn source_preserving_test_package(
        kind: Ed25519YaoPackageKindV1,
        deriver: Ed25519YaoDeriverRoleV1,
        binding: &Ed25519YaoCeremonyBindingV1,
    ) -> Ed25519YaoEncryptedPackageV1 {
        Ed25519YaoEncryptedPackageV1::new(
            kind,
            deriver,
            binding.session_id.into_bytes(),
            [0x51; 32],
            [0x52; 32],
            vec![0x53; 16],
        )
        .expect("test encrypted package")
    }

    fn source_preserving_test_delivery(
        binding: Ed25519YaoCeremonyBindingV1,
    ) -> CloudflareEd25519YaoPackagePairDeliveryV1 {
        CloudflareEd25519YaoPackagePairDeliveryV1 {
            deriver_a: Ed25519YaoSigningWorkerPackageDeliveryV1 {
                binding: binding.clone(),
                client_commitment: [0x61; 32],
                signing_worker_commitment: [0x62; 32],
                package: source_preserving_test_package(
                    Ed25519YaoPackageKindV1::ActivationSigningWorker,
                    Ed25519YaoDeriverRoleV1::DeriverA,
                    &binding,
                ),
            },
            deriver_b: Ed25519YaoSigningWorkerPackageDeliveryV1 {
                binding: binding.clone(),
                client_commitment: [0x63; 32],
                signing_worker_commitment: [0x64; 32],
                package: source_preserving_test_package(
                    Ed25519YaoPackageKindV1::ActivationSigningWorker,
                    Ed25519YaoDeriverRoleV1::DeriverB,
                    &binding,
                ),
            },
        }
    }

    #[test]
    fn source_preserving_reservation_request_is_strict_and_registration_only() {
        let source_binding = source_preserving_test_binding(
            Ed25519YaoOperationV1::Registration,
            1,
            "source-activation",
        );
        let target_binding = source_preserving_test_binding(
            Ed25519YaoOperationV1::Registration,
            2,
            "target-activation",
        );
        let delivery = source_preserving_test_delivery(target_binding.clone());
        let request = CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1 {
            scope: CloudflareSigningWorkerWalletScopeV1::new(
                "org",
                "project",
                "environment",
                target_binding.lifecycle.account_id.clone(),
            )
            .expect("wallet scope"),
            source_binding: source_binding.clone(),
            delivery,
            participant_ids: [1, 2],
            deriver_a_client_package: source_preserving_test_package(
                Ed25519YaoPackageKindV1::ActivationClient,
                Ed25519YaoDeriverRoleV1::DeriverA,
                &target_binding,
            ),
            deriver_b_client_package: source_preserving_test_package(
                Ed25519YaoPackageKindV1::ActivationClient,
                Ed25519YaoDeriverRoleV1::DeriverB,
                &target_binding,
            ),
        };
        request.validate().expect("valid source-preserving request");

        let mut wire = serde_json::to_value(&request).expect("request wire");
        wire.as_object_mut()
            .expect("request object")
            .insert("unexpected".to_owned(), serde_json::Value::Null);
        assert!(serde_json::from_value::<
            CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1,
        >(wire)
        .is_err());

        let recovery_source = CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1 {
            source_binding: source_preserving_test_binding(
                Ed25519YaoOperationV1::Recovery,
                1,
                "source-activation",
            ),
            ..request
        };
        assert!(recovery_source.validate().is_err());
    }

    #[test]
    fn source_preserving_reservation_id_binds_source_and_target() {
        let source_binding = source_preserving_test_binding(
            Ed25519YaoOperationV1::Registration,
            1,
            "source-activation",
        );
        let target_binding = source_preserving_test_binding(
            Ed25519YaoOperationV1::Registration,
            2,
            "target-activation",
        );
        let delivery = source_preserving_test_delivery(target_binding);
        let first = source_preserving_reservation_id_v1(&source_binding, &delivery)
            .expect("source-preserving reservation id");
        let replay = source_preserving_reservation_id_v1(&source_binding, &delivery)
            .expect("source-preserving reservation id replay");
        assert_eq!(first, replay);
        assert!(first.starts_with("ordinary-ed25519-source-preserving-inactive-v1:"));

        let changed_source = source_preserving_test_binding(
            Ed25519YaoOperationV1::Registration,
            3,
            "source-activation",
        );
        let changed = source_preserving_reservation_id_v1(&changed_source, &delivery)
            .expect("changed source reservation id");
        assert_ne!(first, changed);
    }
}

fn encode_hex(bytes: [u8; 32]) -> String {
    encode_hex_slice(&bytes)
}

fn encode_hex_slice(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(ALPHABET[usize::from(byte >> 4)]));
        output.push(char::from(ALPHABET[usize::from(byte & 0x0f)]));
    }
    output
}
