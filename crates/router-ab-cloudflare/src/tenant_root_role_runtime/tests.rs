use super::*;
use base64::Engine;
use curve25519_dalek::scalar::Scalar;
use ed25519_dalek::SigningKey;
use hpke_ng::{DhKemX25519HkdfSha256, Kem};
use rand_chacha::ChaCha20Rng;
use rand_core_06::SeedableRng;
use router_ab_core::{
    resolve_active_tenant_root_pair_binding_v1, verify_tenant_root_creation_evidence_v1,
    PendingTenantRootRefreshRoleAttemptV1, TenantRootActiveRoleBindingV1,
    TenantRootActiveRoleResolutionV1, TenantRootActiveRoleRowKeyV1,
    TenantRootCeremonyContextV1, TenantRootCeremonyNonceV1,
    TenantRootControlPlaneAuthorityIdV1, TenantRootCreationJournalV1,
    TenantRootCustodyLineageId, TenantRootEpochCommitmentsV1, TenantRootIdentityV1,
    TenantRootLifecycleReceiptDigestV1, TenantRootManagedRestoreRoleV1,
    TenantRootRefreshHpkeKeypairV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreRefreshRoleCommandV1, TenantRootRestoreSessionIdV1,
    TenantRootRoleCreationCommandV1, TenantRootRoleRefreshCommandV1, TenantRootShareEpoch,
    TenantRootSignedCreationCommitmentV1, TenantRootSignedRefreshCommitmentV1,
    VerifiedTenantRootCreationCommitmentPairV1, VerifiedTenantRootCreationCommitmentV1,
    VerifiedTenantRootRefreshCommitmentPairV1, VerifiedTenantRootRestoreRefreshRoleCommandV1,
};
use threshold_prf::{SigningRootShare, SigningRootShareCommitment, SigningRootShareWire};

use crate::tenant_root_operational_provider::CloudflareTenantRootOperationalRotationProviderV1;

#[cfg(feature = "workers-rs")]
fn block_on<F: core::future::Future>(future: F) -> F::Output {
    futures::executor::block_on(future)
}

pub(crate) const ISSUER_KEY: [u8; 32] = [0x41; 32];
pub(crate) const ISSUER_KEY_ID: &str = "tenant-root-issuer-v1";
pub(crate) const ISSUED_AT_MS: u64 = 1_000_000;
const EXPIRES_AT_MS: u64 = 1_030_000;
const ONLINE_REF: &str = "online-key/tenant-7/epoch-1";
const BACKUP_PROVIDER: &str = "backup-provider-a";
const BACKUP_VERSION: &str = "backup-key-a/tenant-7/epoch-1";

pub(crate) struct InMemoryProvider {
    online_share: Option<SigningRootShareWire>,
    managed_share: Option<MpcPrfSigningRootShareWireV1>,
    online_role: Option<TwoPartyDeriverRole>,
    backup_role: Option<router_ab_core::TenantRootManagedRestoreRoleV1>,
}

impl InMemoryProvider {
    pub(crate) fn new() -> Self {
        Self {
            online_share: None,
            managed_share: None,
            online_role: None,
            backup_role: None,
        }
    }
}

impl TenantRootOnlineRoleShareProviderV1 for InMemoryProvider {
    fn seal_online_role_share(
        &mut self,
        request: &TenantRootOnlineRoleShareSealRequestV1,
    ) -> RouterAbDerivationResult<Vec<u8>> {
        self.online_role = Some(request.binding().role());
        self.online_share = Some(request.share_wire().clone());
        Ok(vec![0xa5; 96])
    }

    fn open_online_role_share(
        &mut self,
        sealed: TenantRootSealedOnlineRoleShareV1,
    ) -> RouterAbDerivationResult<VerifiedTenantRootOnlineRoleShareV1> {
        let opened_share = self
            .online_share
            .clone()
            .ok_or_else(|| malformed("online share was not sealed"))?;
        sealed.verify_opened_share(opened_share)
    }
}

impl TenantRootManagedBackupProviderV1 for InMemoryProvider {
    async fn seal_managed_backup(
        &mut self,
        request: &TenantRootManagedBackupSealRequestV1,
    ) -> RouterAbDerivationResult<Vec<u8>> {
        self.backup_role = Some(request.binding().role());
        self.managed_share = Some(MpcPrfSigningRootShareWireV1::new(
            request.plaintext_share().to_vec(),
        )?);
        Ok(vec![0xb5; 96])
    }

    async fn open_managed_backup(
        &mut self,
        backup: VerifiedTenantRootManagedBackupV1,
    ) -> RouterAbDerivationResult<VerifiedTenantRootManagedBackupShareV1> {
        let opened_share = self
            .managed_share
            .clone()
            .ok_or_else(|| malformed("managed backup was not sealed"))?;
        backup.verify_opened_share(opened_share)
    }
}

pub(crate) fn identity() -> TenantRootIdentityV1 {
    TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3")
        .expect("identity")
}

pub(crate) fn context() -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        identity().digest().expect("identity digest"),
        TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage"),
        TenantRootCeremonyEpochsV1::create(),
        router_ab_core::TenantRootCeremonySessionIdV1::from_bytes([0x11; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x33; 32]).expect("nonce"),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("context")
}

#[cfg(feature = "workers-rs")]
fn refresh_context() -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        identity().digest().expect("identity digest"),
        TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage"),
        TenantRootCeremonyEpochsV1::refresh(
            TenantRootShareEpoch::new(7).expect("current epoch"),
            TenantRootShareEpoch::new(8).expect("next epoch"),
        )
        .expect("refresh epochs"),
        router_ab_core::TenantRootCeremonySessionIdV1::from_bytes([0x11; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x33; 32]).expect("nonce"),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        "deriver-a-signing-key-7",
        "deriver-b-signing-key-9",
    )
    .expect("refresh context")
}

#[cfg(feature = "workers-rs")]
fn refresh_share(role: TwoPartyDeriverRole) -> SigningRootShare {
    SigningRootShare::from_canonical_bytes(
        role.share_id(),
        Scalar::from(match role {
            TwoPartyDeriverRole::DeriverA => 17_u64,
            TwoPartyDeriverRole::DeriverB => 29_u64,
        })
        .to_bytes(),
    )
    .expect("refresh share")
}

#[cfg(feature = "workers-rs")]
fn refresh_active_pair() -> router_ab_core::TenantRootActiveRootPairV1 {
    let identity_digest = identity().digest().expect("identity digest");
    let lineage = TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage");
    let epoch = TenantRootShareEpoch::new(7).expect("current epoch");
    let receipt = TenantRootLifecycleReceiptDigestV1::from_bytes([0x77; 32])
        .expect("activation receipt digest");
    let binding_a = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            lineage,
            epoch,
            TenantRootManagedRestoreRoleV1::DeriverA,
        ),
        MpcPrfShareCommitmentWireV1::new(
            SigningRootShareCommitment::from_share(&refresh_share(
                TwoPartyDeriverRole::DeriverA,
            ))
            .to_bytes()
            .to_vec(),
        )
        .expect("Deriver A commitment"),
        receipt,
    )
    .expect("Deriver A active binding");
    let binding_b = TenantRootActiveRoleBindingV1::new(
        TenantRootActiveRoleRowKeyV1::new(
            identity_digest,
            lineage,
            epoch,
            TenantRootManagedRestoreRoleV1::DeriverB,
        ),
        MpcPrfShareCommitmentWireV1::new(
            SigningRootShareCommitment::from_share(&refresh_share(
                TwoPartyDeriverRole::DeriverB,
            ))
            .to_bytes()
            .to_vec(),
        )
        .expect("Deriver B commitment"),
        receipt,
    )
    .expect("Deriver B active binding");
    resolve_active_tenant_root_pair_binding_v1(
        identity_digest,
        &TenantRootActiveRoleResolutionV1::Active(binding_a),
        &TenantRootActiveRoleResolutionV1::Active(binding_b),
    )
    .expect("active pair resolution")
    .require_active()
    .expect("active pair")
    .clone()
}

#[cfg(feature = "workers-rs")]
fn refresh_active_binding(role: TwoPartyDeriverRole) -> TenantRootActiveRoleBindingV1 {
    let pair = refresh_active_pair();
    match role {
        TwoPartyDeriverRole::DeriverA => pair.deriver_a().clone(),
        TwoPartyDeriverRole::DeriverB => pair.deriver_b().clone(),
    }
}

#[cfg(feature = "workers-rs")]
fn refresh_recipient(
    role: TwoPartyDeriverRole,
) -> (&'static str, TenantRootRefreshHpkePublicKeyV1) {
    match role {
        TwoPartyDeriverRole::DeriverA => (
            "deriver-a-refresh-hpke-key-1",
            TenantRootRefreshHpkeKeypairV1::derive_from_ikm([0xa1; 32])
                .expect("Deriver A refresh HPKE key")
                .public_key(),
        ),
        TwoPartyDeriverRole::DeriverB => (
            "deriver-b-refresh-hpke-key-1",
            TenantRootRefreshHpkeKeypairV1::derive_from_ikm([0xb1; 32])
                .expect("Deriver B refresh HPKE key")
                .public_key(),
        ),
    }
}

#[cfg(feature = "workers-rs")]
fn refresh_command(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> router_ab_core::VerifiedTenantRootRoleRefreshCommandV1 {
    let active_pair = refresh_active_pair();
    let issuer = SigningKey::from_bytes(&ISSUER_KEY);
    TenantRootRoleRefreshCommandV1::sign(
        &active_pair,
        context,
        role,
        4,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x44; 32]),
        ISSUED_AT_MS + 1,
        EXPIRES_AT_MS - 1,
        ISSUER_KEY_ID,
        &ISSUER_KEY,
    )
    .expect("signed refresh command")
    .verify(
        &active_pair,
        context,
        role,
        4,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x44; 32]),
        ISSUER_KEY_ID,
        issuer.verifying_key().as_bytes(),
    )
    .expect("verified refresh command")
}

#[cfg(feature = "workers-rs")]
fn refresh_pending(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    coefficient_seed: u8,
) -> PendingTenantRootRefreshRoleAttemptV1 {
    let signing_key = role_key(role);
    let verifying_key = signing_key.verifying_key().to_bytes();
    let (recipient_key_id, recipient_public_key) = refresh_recipient(role);
    PendingTenantRootRefreshRoleAttemptV1::new(
        refresh_command(context, role),
        context.clone(),
        refresh_active_binding(role),
        refresh_share(role),
        &signing_key.to_bytes(),
        &verifying_key,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut ChaCha20Rng::from_seed([coefficient_seed; 32]),
    )
    .expect("pending refresh role attempt")
}

#[cfg(feature = "workers-rs")]
fn begun_refresh_pending(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    coefficient_seed: u8,
) -> PendingTenantRootRefreshRoleAttemptV1 {
    let signing_key = role_key(role);
    let signing_key_bytes = signing_key.to_bytes();
    let verifying_key_bytes = signing_key.verifying_key().to_bytes();
    let (recipient_key_id, recipient_public_key) = refresh_recipient(role);
    let progress = begin_tenant_root_role_refresh_v1(
        refresh_command(context, role),
        context.clone(),
        refresh_active_binding(role),
        refresh_share(role),
        &signing_key_bytes,
        &verifying_key_bytes,
        recipient_key_id,
        recipient_public_key,
        ISSUED_AT_MS + 10,
        &mut ChaCha20Rng::from_seed([coefficient_seed; 32]),
    )
    .expect("started refresh role attempt");
    let TenantRootRoleRefreshProgressV1::Committed { pending } = progress else {
        panic!("refresh start should expose a pending commitment");
    };
    pending
}

#[cfg(feature = "workers-rs")]
fn verified_refresh_commitment(
    pending: &PendingTenantRootRefreshRoleAttemptV1,
) -> router_ab_core::VerifiedTenantRootRefreshCommitmentV1 {
    let role = pending.role();
    let context = pending.commitment().transcript().context();
    let key = role_key(role);
    TenantRootSignedRefreshCommitmentV1::decode_and_verify_canonical_bytes(
        pending.commitment_bytes(),
        context,
        role,
        context.signing_key_id(role),
        key.verifying_key().as_bytes(),
    )
    .expect("verified refresh commitment")
}

#[cfg(feature = "workers-rs")]
fn completed_refresh_attempt() -> router_ab_core::VerifiedTenantRootRefreshRoleAttemptV1 {
    let context = refresh_context();
    let pending_a = refresh_pending(&context, TwoPartyDeriverRole::DeriverA, 0x51);
    let pending_b = refresh_pending(&context, TwoPartyDeriverRole::DeriverB, 0x61);
    let pair = VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_refresh_commitment(&pending_a),
        verified_refresh_commitment(&pending_b),
    )
    .expect("verified refresh commitment pair");
    pending_a
        .finalize(
            pair,
            pending_b.contribution_for_peer(),
            &mut ChaCha20Rng::from_seed([0x71; 32]),
        )
        .expect("completed refresh role attempt")
}

#[cfg(feature = "workers-rs")]
fn restore_refresh_command(
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    imported_commitments: &TenantRootEpochCommitmentsV1,
) -> VerifiedTenantRootRestoreRefreshRoleCommandV1 {
    let destination_fingerprint =
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x91; 32])
            .expect("restore destination fingerprint");
    let restore_session_id =
        TenantRootRestoreSessionIdV1::from_bytes([0x92; 16]).expect("restore session id");
    let manifest_digest = [0x93; 32];
    let deriver_a_acceptance_receipt_digest =
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x94; 32])
            .expect("Deriver A acceptance receipt");
    let deriver_b_acceptance_receipt_digest =
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x95; 32])
            .expect("Deriver B acceptance receipt");
    let nonce = router_ab_core::tenant_root_restore_refresh_context_nonce_v1(
        context.identity_digest(),
        context.custody_lineage(),
        context.session_id(),
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        deriver_a_acceptance_receipt_digest,
        deriver_b_acceptance_receipt_digest,
        imported_commitments.deriver_a(),
        imported_commitments.deriver_b(),
        *imported_commitments.root_commitment(),
    )
    .expect("restore refresh context nonce");
    let context = TenantRootCeremonyContextV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        context.epochs(),
        context.session_id(),
        nonce,
        context.issued_at_ms(),
        context.expires_at_ms(),
        context.signing_key_id(TwoPartyDeriverRole::DeriverA),
        context.signing_key_id(TwoPartyDeriverRole::DeriverB),
    )
    .expect("restore refresh context");
    let issuer = SigningKey::from_bytes(&ISSUER_KEY);
    TenantRootRestoreRefreshRoleCommandV1::sign(
        &context,
        destination_fingerprint,
        restore_session_id,
        manifest_digest,
        deriver_a_acceptance_receipt_digest,
        deriver_b_acceptance_receipt_digest,
        imported_commitments.deriver_a().clone(),
        imported_commitments.deriver_b().clone(),
        *imported_commitments.root_commitment(),
        role,
        ISSUER_KEY_ID,
        &ISSUER_KEY,
    )
    .expect("signed restore refresh role command")
    .verify(ISSUER_KEY_ID, issuer.verifying_key().as_bytes())
    .expect("verified restore refresh role command")
}

#[cfg(feature = "workers-rs")]
fn verified_restore_refresh_commitment(
    pending: &router_ab_core::PendingTenantRootRestoreRefreshRoleAttemptV1,
) -> router_ab_core::VerifiedTenantRootRefreshCommitmentV1 {
    let role = pending.role();
    let context = pending.command().context();
    let key = role_key(role);
    TenantRootSignedRefreshCommitmentV1::decode_and_verify_restore_canonical_bytes(
        pending.commitment_bytes(),
        context,
        role,
        context.signing_key_id(role),
        key.verifying_key().as_bytes(),
    )
    .expect("verified restore refresh commitment")
}

pub(crate) fn role_key(role: TwoPartyDeriverRole) -> SigningKey {
    SigningKey::from_bytes(
        &[match role {
            TwoPartyDeriverRole::DeriverA => 0x51,
            TwoPartyDeriverRole::DeriverB => 0x61,
        }; 32],
    )
}

fn command(
    ceremony_context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> router_ab_core::VerifiedTenantRootRoleCreationCommandV1 {
    let journal = TenantRootCreationJournalV1::started(
        identity(),
        ceremony_context.custody_lineage(),
        ceremony_context.clone(),
    )
    .expect("journal");
    let signed = TenantRootRoleCreationCommandV1::sign(
        &journal,
        ceremony_context,
        role,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x44; 32]),
        ISSUED_AT_MS + 1,
        EXPIRES_AT_MS - 1,
        ISSUER_KEY_ID,
        &ISSUER_KEY,
    )
    .expect("signed command");
    signed
        .verify(
            &journal,
            ceremony_context,
            role,
            TenantRootControlPlaneAuthorityIdV1::from_bytes([0x44; 32]),
            ISSUER_KEY_ID,
            &SigningKey::from_bytes(&ISSUER_KEY)
                .verifying_key()
                .to_bytes(),
        )
        .expect("verified command")
}

fn pending(
    ceremony_context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    seed: u8,
) -> router_ab_core::PendingTenantRootInitialRoleAttemptV1 {
    let key = role_key(role);
    router_ab_core::PendingTenantRootInitialRoleAttemptV1::new(
        command(ceremony_context, role),
        ceremony_context.clone(),
        &key.to_bytes(),
        &key.verifying_key().to_bytes(),
        ISSUED_AT_MS + 10,
        &mut ChaCha20Rng::from_seed([seed; 32]),
    )
    .expect("pending attempt")
}

fn verified_commitment(
    pending: &router_ab_core::PendingTenantRootInitialRoleAttemptV1,
) -> VerifiedTenantRootCreationCommitmentV1 {
    let role = pending.role();
    let key = role_key(role);
    TenantRootSignedCreationCommitmentV1::decode_and_verify_canonical_bytes(
        pending.commitment_bytes(),
        pending.commitment().context(),
        role,
        pending.commitment().context().signing_key_id(role),
        &key.verifying_key().to_bytes(),
    )
    .expect("verified commitment")
}

fn verified_commitment_bytes(
    bytes: &[u8],
    ceremony_context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
) -> VerifiedTenantRootCreationCommitmentV1 {
    let key = role_key(role);
    TenantRootSignedCreationCommitmentV1::decode_and_verify_canonical_bytes(
        bytes,
        ceremony_context,
        role,
        ceremony_context.signing_key_id(role),
        &key.verifying_key().to_bytes(),
    )
    .expect("verified commitment bytes")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn signer(
    role: TwoPartyDeriverRole,
) -> crate::CloudflareTenantRootCreationRoleSignerV1 {
    signer_with_keys(
        role,
        role_key(TwoPartyDeriverRole::DeriverA),
        role_key(TwoPartyDeriverRole::DeriverB),
    )
}

fn signer_with_keys(
    role: TwoPartyDeriverRole,
    key_a: SigningKey,
    key_b: SigningKey,
) -> crate::CloudflareTenantRootCreationRoleSignerV1 {
    let key_set = format!(
        r#"{{"active_deriver_a_signing_key_id":"deriver-a-signing-key-7","active_deriver_b_signing_key_id":"deriver-b-signing-key-9","keys":[{{"role":"deriver_a","signing_key_id":"deriver-a-signing-key-7","verifying_key_hex":"{}"}},{{"role":"deriver_b","signing_key_id":"deriver-b-signing-key-9","verifying_key_hex":"{}"}}]}}"#,
        hex(&key_a.verifying_key().to_bytes()),
        hex(&key_b.verifying_key().to_bytes()),
    );
    let (worker_role, binding_env, key_id_env, binding_name, key_id) = match role {
        TwoPartyDeriverRole::DeriverA => (
            crate::CloudflareWorkerRoleV1::DeriverA,
            crate::DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_BINDING_ENV,
            crate::DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_ID_ENV,
            "DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY",
            "deriver-a-signing-key-7",
        ),
        TwoPartyDeriverRole::DeriverB => (
            crate::CloudflareWorkerRoleV1::DeriverB,
            crate::DERIVER_B_TENANT_ROOT_CREATION_SIGNING_KEY_BINDING_ENV,
            crate::DERIVER_B_TENANT_ROOT_CREATION_SIGNING_KEY_ID_ENV,
            "DERIVER_B_TENANT_ROOT_CREATION_SIGNING_KEY",
            "deriver-b-signing-key-9",
        ),
    };
    let key = match role {
        TwoPartyDeriverRole::DeriverA => key_a,
        TwoPartyDeriverRole::DeriverB => key_b,
    };
    let env = crate::CloudflareEnvMapV1::new(vec![
        (binding_env, binding_name),
        (key_id_env, key_id),
        (
            crate::ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON_ENV,
            key_set.as_str(),
        ),
    ]);
    let selection = crate::parse_cloudflare_tenant_root_creation_role_signing_key_selection_v1(
        worker_role,
        &env,
    )
    .expect("role signer selection");
    let secret = crate::decode_cloudflare_tenant_root_creation_role_signing_secret_v1(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(key.to_bytes()),
    )
    .expect("role signer secret");
    crate::derive_cloudflare_tenant_root_creation_role_signing_key_v1(selection, secret)
        .expect("role signer")
}

fn operational_keypair(seed: u8) -> ([u8; 32], [u8; 32]) {
    let (private_key, public_key) =
        DhKemX25519HkdfSha256::derive_key_pair(&[seed; 32]).expect("operational key pair");
    let private_key_bytes = DhKemX25519HkdfSha256::sk_to_bytes(&private_key);
    let public_key_bytes = DhKemX25519HkdfSha256::pk_to_bytes(&public_key);
    let mut private_key_out = [0u8; 32];
    let mut public_key_out = [0u8; 32];
    private_key_out.copy_from_slice(&private_key_bytes);
    public_key_out.copy_from_slice(&public_key_bytes);
    (private_key_out, public_key_out)
}

fn operational_provider(
    role: TwoPartyDeriverRole,
    online_seed: u8,
    backup_seed: u8,
    online_ref: &str,
) -> CloudflareTenantRootOperationalRotationProviderV1 {
    let (online_secret, online_public) = operational_keypair(online_seed);
    let (backup_secret, backup_public) = operational_keypair(backup_seed);
    CloudflareTenantRootOperationalRotationProviderV1::new(
        role,
        online_ref,
        online_public,
        Zeroizing::new(online_secret.to_vec()),
        BACKUP_PROVIDER,
        BACKUP_VERSION,
        backup_public,
        Zeroizing::new(backup_secret.to_vec()),
    )
    .expect("operational provider")
}

#[cfg(feature = "workers-rs")]
#[test]
fn initial_role_attempts_remain_live_through_pair_and_compose_both_roles() {
    let ceremony_context = context();
    let pending_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0x51);
    let pending_b = pending(&ceremony_context, TwoPartyDeriverRole::DeriverB, 0x61);

    let commitment_a_bytes = pending_a.commitment_bytes().to_vec();
    let commitment_b_bytes = pending_b.commitment_bytes().to_vec();
    let commitment_a = verified_commitment(&pending_a);
    assert_eq!(commitment_a.role(), TwoPartyDeriverRole::DeriverA);
    let commitment_b = verified_commitment(&pending_b);
    assert_eq!(commitment_b.role(), TwoPartyDeriverRole::DeriverB);
    let pair_a = VerifiedTenantRootCreationCommitmentPairV1::new(
        verified_commitment(&pending_a),
        verified_commitment(&pending_b),
    )
    .expect("A/B commitment pair");
    let pair_b = VerifiedTenantRootCreationCommitmentPairV1::new(
        verified_commitment_bytes(
            &commitment_a_bytes,
            &ceremony_context,
            TwoPartyDeriverRole::DeriverA,
        ),
        verified_commitment_bytes(
            &commitment_b_bytes,
            &ceremony_context,
            TwoPartyDeriverRole::DeriverB,
        ),
    )
    .expect("exact A/B commitment pair replay");
    assert_eq!(pair_a.canonical_bytes(), pair_b.canonical_bytes());
    assert_eq!(pair_a.pair_digest(), pair_b.pair_digest());

    let key_a = role_key(TwoPartyDeriverRole::DeriverA);
    let attempt_a = pending_a
        .finalize(
            pair_a,
            &key_a.to_bytes(),
            &mut ChaCha20Rng::from_seed([0x71; 32]),
        )
        .expect("Deriver A initial role attempt");
    let key_b = role_key(TwoPartyDeriverRole::DeriverB);
    let attempt_b = pending_b
        .finalize(
            pair_b,
            &key_b.to_bytes(),
            &mut ChaCha20Rng::from_seed([0x72; 32]),
        )
        .expect("Deriver B initial role attempt");

    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let mut online_provider_a = InMemoryProvider::new();
    let mut backup_provider_a = InMemoryProvider::new();
    let (command_a, evidence_a, artifacts_a) =
        block_on(compose_initial_tenant_root_role_runtime_v1(
            attempt_a,
            &signer(TwoPartyDeriverRole::DeriverA),
            &config,
            &mut online_provider_a,
            &mut backup_provider_a,
            ISSUED_AT_MS + 2,
        ))
        .expect("composed Deriver A role runtime");
    let mut online_provider_b = InMemoryProvider::new();
    let mut backup_provider_b = InMemoryProvider::new();
    let (command_b, evidence_b, artifacts_b) =
        block_on(compose_initial_tenant_root_role_runtime_v1(
            attempt_b,
            &signer(TwoPartyDeriverRole::DeriverB),
            &config,
            &mut online_provider_b,
            &mut backup_provider_b,
            ISSUED_AT_MS + 2,
        ))
        .expect("composed Deriver B role runtime");

    assert_eq!(command_a.role(), TwoPartyDeriverRole::DeriverA);
    assert_eq!(command_b.role(), TwoPartyDeriverRole::DeriverB);
    assert_eq!(
        artifacts_a
            .online_sealed()
            .binding()
            .epoch_wrapping_key_ref(),
        ONLINE_REF
    );
    assert_eq!(
        artifacts_b.online_sealed().binding().epoch(),
        TenantRootShareEpoch::INITIAL
    );
    assert_eq!(
        artifacts_a.managed_backup().binding().backup_provider_id(),
        BACKUP_PROVIDER
    );
    assert_eq!(
        artifacts_b.managed_backup().binding().backup_key_version(),
        BACKUP_VERSION
    );
    assert_eq!(
        artifacts_a
            .managed_backup()
            .binding()
            .installation_receipt_digest(),
        evidence_a
            .lifecycle_receipt_digest()
            .expect("evidence digest")
    );
    assert_eq!(
        artifacts_b
            .managed_backup()
            .binding()
            .installation_receipt_digest(),
        evidence_b
            .lifecycle_receipt_digest()
            .expect("evidence digest")
    );
    assert_eq!(
        online_provider_a.online_role,
        Some(TwoPartyDeriverRole::DeriverA)
    );
    assert_eq!(
        backup_provider_a.backup_role,
        Some(router_ab_core::TenantRootManagedRestoreRoleV1::DeriverA)
    );
    assert_eq!(
        online_provider_b.online_role,
        Some(TwoPartyDeriverRole::DeriverB)
    );
    assert_eq!(
        backup_provider_b.backup_role,
        Some(router_ab_core::TenantRootManagedRestoreRoleV1::DeriverB)
    );

    let root_commitments =
        verify_tenant_root_creation_evidence_v1(evidence_a.evidence(), evidence_b.evidence())
            .expect("exact A/B installation evidence pair");
    assert_eq!(
        root_commitments.deriver_a(),
        evidence_a.evidence().transcript().commitment()
    );
    assert_eq!(
        root_commitments.deriver_b(),
        evidence_b.evidence().transcript().commitment()
    );
    assert_ne!(root_commitments.root().to_bytes(), [0; 32]);

    let (online_sealed, managed_backup, provider_canary_receipt) = artifacts_a.into_parts();
    assert!(!provider_canary_receipt.is_empty());
    let online_opened =
        open_tenant_root_online_role_share_v1(online_sealed, &mut online_provider_a)
            .expect("opened online share");
    let managed_opened = block_on(open_tenant_root_managed_backup_v1(
        managed_backup,
        &mut backup_provider_a,
    ))
    .expect("opened managed backup");
    assert_eq!(online_opened.role(), TwoPartyDeriverRole::DeriverA);
    assert_eq!(
        managed_opened.role(),
        router_ab_core::TenantRootManagedRestoreRoleV1::DeriverA
    );
    assert_eq!(
        online_opened.share_commitment(),
        managed_opened.share_commitment()
    );
    assert_eq!(
        online_opened.share_commitment().as_bytes(),
        root_commitments.deriver_a().to_bytes().as_slice()
    );

    let (online_sealed, managed_backup, provider_canary_receipt) = artifacts_b.into_parts();
    assert!(!provider_canary_receipt.is_empty());
    let online_opened =
        open_tenant_root_online_role_share_v1(online_sealed, &mut online_provider_b)
            .expect("opened online share");
    let managed_opened = block_on(open_tenant_root_managed_backup_v1(
        managed_backup,
        &mut backup_provider_b,
    ))
    .expect("opened managed backup");
    assert_eq!(online_opened.role(), TwoPartyDeriverRole::DeriverB);
    assert_eq!(
        managed_opened.role(),
        router_ab_core::TenantRootManagedRestoreRoleV1::DeriverB
    );
    assert_eq!(
        online_opened.share_commitment(),
        managed_opened.share_commitment()
    );
    assert_eq!(
        online_opened.share_commitment().as_bytes(),
        root_commitments.deriver_b().to_bytes().as_slice()
    );
}

#[cfg(feature = "workers-rs")]
#[test]
fn refresh_role_attempt_composes_a_provider_sealed_d1_input() {
    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let mut provider = InMemoryProvider::new();
    let input = compose_refresh_tenant_root_role_runtime_v1(
        completed_refresh_attempt(),
        identity(),
        &config,
        &mut provider,
        ISSUED_AT_MS + 11,
    )
    .expect("refresh persistence input");

    assert_eq!(provider.online_role, Some(TwoPartyDeriverRole::DeriverA));
    assert_eq!(
        provider
            .online_share
            .as_ref()
            .expect("provider received the next share")
            .to_share()
            .expect("provider share wire")
            .id(),
        TwoPartyDeriverRole::DeriverA.share_id()
    );
    assert!(format!("{input:?}").contains("CloudflareTenantRootRefreshInputV1"));
}

#[cfg(feature = "workers-rs")]
#[test]
fn restore_refresh_promotion_seals_and_canaries_epoch_one_without_managed_backup() {
    let context = context();
    let imported_a = refresh_share(TwoPartyDeriverRole::DeriverA);
    let imported_b = refresh_share(TwoPartyDeriverRole::DeriverB);
    let imported_commitments = TenantRootEpochCommitmentsV1::new(
        MpcPrfShareCommitmentWireV1::new(
            SigningRootShareCommitment::from_share(&imported_a)
                .to_bytes()
                .to_vec(),
        )
        .expect("Deriver A imported commitment"),
        MpcPrfShareCommitmentWireV1::new(
            SigningRootShareCommitment::from_share(&imported_b)
                .to_bytes()
                .to_vec(),
        )
        .expect("Deriver B imported commitment"),
    )
    .expect("imported commitment pair");
    let command_a = restore_refresh_command(
        &context,
        TwoPartyDeriverRole::DeriverA,
        &imported_commitments,
    );
    let command_b = restore_refresh_command(
        &context,
        TwoPartyDeriverRole::DeriverB,
        &imported_commitments,
    );
    let signer_a = signer(TwoPartyDeriverRole::DeriverA);
    let signer_b = signer(TwoPartyDeriverRole::DeriverB);
    let key_a = role_key(TwoPartyDeriverRole::DeriverA);
    let key_b = role_key(TwoPartyDeriverRole::DeriverB);
    let (recipient_key_id_a, recipient_key_a) =
        refresh_recipient(TwoPartyDeriverRole::DeriverA);
    let (recipient_key_id_b, recipient_key_b) =
        refresh_recipient(TwoPartyDeriverRole::DeriverB);
    let pending_a =
        router_ab_core::PendingTenantRootRestoreRefreshRoleAttemptV1::from_verified_command(
            command_a,
            imported_a,
            &key_a.to_bytes(),
            &key_a.verifying_key().to_bytes(),
            recipient_key_id_a,
            recipient_key_a,
            ISSUED_AT_MS + 10,
            &mut ChaCha20Rng::from_seed([0xa1; 32]),
        )
        .expect("Deriver A restore refresh attempt");
    let pending_b =
        router_ab_core::PendingTenantRootRestoreRefreshRoleAttemptV1::from_verified_command(
            command_b,
            imported_b,
            &key_b.to_bytes(),
            &key_b.verifying_key().to_bytes(),
            recipient_key_id_b,
            recipient_key_b,
            ISSUED_AT_MS + 10,
            &mut ChaCha20Rng::from_seed([0xa2; 32]),
        )
        .expect("Deriver B restore refresh attempt");
    let pair = VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_restore_refresh_commitment(&pending_a),
        verified_restore_refresh_commitment(&pending_b),
    )
    .expect("restore refresh commitment pair");
    let finalized = pending_a
        .finalize(
            pair,
            pending_b.contribution_for_peer(),
            &mut ChaCha20Rng::from_seed([0xa3; 32]),
        )
        .expect("finalized restore refresh attempt");
    let (command, share_wire, evidence) = finalized.into_parts();
    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let authority_id = TenantRootControlPlaneAuthorityIdV1::from_bytes([0x44; 32]);
    let mut provider = InMemoryProvider::new();
    let artifacts = compose_restore_refresh_promotion_v1(
        command,
        share_wire,
        evidence,
        &signer_a,
        &config,
        authority_id,
        &mut provider,
        ISSUED_AT_MS + 20,
    )
    .expect("restore refresh promotion artifacts");

    assert_eq!(provider.online_role, Some(TwoPartyDeriverRole::DeriverA));
    assert!(provider.managed_share.is_none());
    assert_eq!(
        artifacts.online_sealed().binding().epoch(),
        TenantRootShareEpoch::INITIAL
    );
    let canary = TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(
        artifacts.provider_canary_receipt(),
    )
    .expect("restore promotion canary");
    assert_eq!(
        canary.transition(),
        TenantRootActivationReceiptTransitionV1::InitialCreation
    );
    assert_eq!(canary.target_epoch(), TenantRootShareEpoch::INITIAL);
    assert_eq!(canary.binding().authority_id(), authority_id);
    canary
        .verify(&canary.binding().clone(), &signer_a.verifying_key_bytes())
        .expect("restore promotion canary signature");
}

#[cfg(feature = "workers-rs")]
#[test]
fn refresh_role_progresses_from_commitment_to_composed_input() {
    let context = refresh_context();
    let role = TwoPartyDeriverRole::DeriverA;
    let pending = begun_refresh_pending(&context, role, 0x51);

    let peer_pending = refresh_pending(&context, role.peer(), 0x61);
    let pair = VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_refresh_commitment(&pending),
        verified_refresh_commitment(&peer_pending),
    )
    .expect("verified refresh commitment pair");
    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let mut provider = InMemoryProvider::new();
    let mut backup_provider = InMemoryProvider::new();
    let role_signer = signer(role);
    let progress = block_on(finalize_tenant_root_role_refresh_v1(
        pending,
        pair,
        peer_pending.contribution_for_peer(),
        &role_signer,
        identity(),
        &config,
        &mut provider,
        &mut backup_provider,
        ISSUED_AT_MS + 11,
        &mut ChaCha20Rng::from_seed([0x71; 32]),
    ))
    .expect("finalized refresh role attempt");

    let TenantRootRoleRefreshProgressV1::Sealed {
        signed_commitment,
        signed_installation_evidence,
        input,
        managed_backup,
        provider_canary_receipt,
    } = progress
    else {
        panic!("refresh finalization should expose a composed input");
    };
    assert!(!signed_commitment.is_empty());
    assert!(!signed_installation_evidence.is_empty());
    assert_eq!(provider.online_role, Some(role));
    assert_eq!(
        backup_provider.backup_role,
        Some(router_ab_core::TenantRootManagedRestoreRoleV1::DeriverA)
    );
    assert_eq!(
        managed_backup.binding().backup_provider_id(),
        BACKUP_PROVIDER
    );
    assert!(!provider_canary_receipt.is_empty());
    assert_eq!(
        input.installation_evidence_bytes(),
        signed_installation_evidence.as_slice()
    );
    let canary = TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(
        &provider_canary_receipt,
    )
    .expect("canonical refresh provider canary");
    assert_eq!(
        canary.transition(),
        TenantRootActivationReceiptTransitionV1::RefreshSwap
    );
    assert_eq!(
        canary.target_epoch(),
        TenantRootShareEpoch::new(8).expect("next epoch")
    );
    assert_eq!(canary.provider_key_version_ref(), ONLINE_REF);
    canary
        .verify(
            &canary.binding().clone(),
            &role_signer.verifying_key_bytes(),
        )
        .expect("refresh provider canary signature");
    assert!(format!("{input:?}").contains("CloudflareTenantRootRefreshInputV1"));
}

#[cfg(feature = "workers-rs")]
#[test]
fn completed_refresh_replay_requires_the_exact_command_context_and_evidence() {
    let context = refresh_context();
    let role = TwoPartyDeriverRole::DeriverA;
    let command = refresh_command(&context, role);
    let (_, _, evidence) = completed_refresh_attempt().into_parts();
    let raw_command =
        TenantRootRoleRefreshCommandV1::decode_canonical_bytes(command.canonical_bytes())
            .expect("canonical raw refresh command");

    validate_raw_refresh_context_binding_v1(&raw_command, &context, role)
        .expect("exact refresh command context binding");
    validate_replayed_refresh_evidence_v1(&command, role, &evidence)
        .expect("exact completed refresh evidence binding");

    let peer_command = refresh_command(&context, role.peer());
    assert!(validate_replayed_refresh_evidence_v1(&peer_command, role, &evidence).is_err());

    let changed_context = TenantRootCeremonyContextV1::new(
        context.identity_digest(),
        context.custody_lineage(),
        context.epochs(),
        context.session_id(),
        context.nonce(),
        context.issued_at_ms(),
        context.expires_at_ms() - 1,
        context.signing_key_id(TwoPartyDeriverRole::DeriverA),
        context.signing_key_id(TwoPartyDeriverRole::DeriverB),
    )
    .expect("changed context");
    assert!(
        validate_raw_refresh_context_binding_v1(&raw_command, &changed_context, role,).is_err()
    );
}

#[cfg(feature = "workers-rs")]
#[test]
fn refresh_role_refuses_a_contribution_from_the_wrong_peer() {
    let context = refresh_context();
    let role = TwoPartyDeriverRole::DeriverA;
    let pending = begun_refresh_pending(&context, role, 0x51);
    let peer_pending = refresh_pending(&context, role.peer(), 0x61);
    let pair = VerifiedTenantRootRefreshCommitmentPairV1::new(
        verified_refresh_commitment(&pending),
        verified_refresh_commitment(&peer_pending),
    )
    .expect("verified refresh commitment pair");
    let wrong_peer_contribution = pending.contribution_for_peer();
    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let mut provider = InMemoryProvider::new();
    let mut backup_provider = InMemoryProvider::new();
    let role_signer = signer(role);
    assert!(block_on(finalize_tenant_root_role_refresh_v1(
        pending,
        pair,
        wrong_peer_contribution,
        &role_signer,
        identity(),
        &config,
        &mut provider,
        &mut backup_provider,
        ISSUED_AT_MS + 11,
        &mut ChaCha20Rng::from_seed([0x71; 32]),
    ))
    .is_err());
    assert_eq!(provider.online_role, None);
    assert!(provider.online_share.is_none());
}

#[cfg(feature = "workers-rs")]
#[test]
fn refresh_role_attempt_rejects_a_sealing_identity_substitution_before_provider_use() {
    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let wrong_identity =
        TenantRootIdentityV1::new("org-1", "project-2", "production", "root-substituted", "v3")
            .expect("wrong identity");
    let mut provider = InMemoryProvider::new();
    assert!(compose_refresh_tenant_root_role_runtime_v1(
        completed_refresh_attempt(),
        wrong_identity,
        &config,
        &mut provider,
        ISSUED_AT_MS + 11,
    )
    .is_err());
    assert_eq!(provider.online_role, None);
    assert!(provider.online_share.is_none());
}

#[cfg(feature = "workers-rs")]
#[test]
fn compose_rejects_same_role_and_key_id_with_alternate_evidence_key() {
    let ceremony_context = context();
    let pending_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0x51);
    let pending_b = pending(&ceremony_context, TwoPartyDeriverRole::DeriverB, 0x61);
    let pair = VerifiedTenantRootCreationCommitmentPairV1::new(
        verified_commitment(&pending_a),
        verified_commitment(&pending_b),
    )
    .expect("A/B commitment pair");
    let key_a = role_key(TwoPartyDeriverRole::DeriverA);
    let attempt = pending_a
        .finalize(
            pair,
            &key_a.to_bytes(),
            &mut ChaCha20Rng::from_seed([0x73; 32]),
        )
        .expect("initial role attempt");
    let alternate_signer = signer_with_keys(
        TwoPartyDeriverRole::DeriverA,
        SigningKey::from_bytes(&[0x71; 32]),
        role_key(TwoPartyDeriverRole::DeriverB),
    );
    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let mut online_provider = InMemoryProvider::new();
    let mut backup_provider = InMemoryProvider::new();
    let result = block_on(compose_initial_tenant_root_role_runtime_v1(
        attempt,
        &alternate_signer,
        &config,
        &mut online_provider,
        &mut backup_provider,
        ISSUED_AT_MS + 2,
    ));

    assert!(result.is_err());
    assert_eq!(online_provider.online_role, None);
    assert_eq!(backup_provider.backup_role, None);
}

#[cfg(feature = "workers-rs")]
#[test]
fn operational_provider_roundtrip_and_rejections() {
    let ceremony_context = context();
    let pending_a = pending(&ceremony_context, TwoPartyDeriverRole::DeriverA, 0x51);
    let pending_b = pending(&ceremony_context, TwoPartyDeriverRole::DeriverB, 0x61);
    let pair = VerifiedTenantRootCreationCommitmentPairV1::new(
        verified_commitment(&pending_a),
        verified_commitment(&pending_b),
    )
    .expect("A/B commitment pair");
    let key_a = role_key(TwoPartyDeriverRole::DeriverA);
    let attempt = pending_a
        .finalize(
            pair,
            &key_a.to_bytes(),
            &mut ChaCha20Rng::from_seed([0x71; 32]),
        )
        .expect("initial role attempt");
    let config =
        TenantRootRoleRuntimeProviderConfigV1::new(ONLINE_REF, BACKUP_PROVIDER, BACKUP_VERSION)
            .expect("provider config");
    let mut online_provider =
        operational_provider(TwoPartyDeriverRole::DeriverA, 0x81, 0x82, ONLINE_REF);
    let mut backup_provider =
        operational_provider(TwoPartyDeriverRole::DeriverA, 0x81, 0x82, ONLINE_REF);
    let (_, _, artifacts) = block_on(compose_initial_tenant_root_role_runtime_v1(
        attempt,
        &signer(TwoPartyDeriverRole::DeriverA),
        &config,
        &mut online_provider,
        &mut backup_provider,
        ISSUED_AT_MS + 2,
    ))
    .expect("composed operational provider artifacts");
    let (online_sealed, managed_backup, provider_canary_receipt) = artifacts.into_parts();
    assert!(!provider_canary_receipt.is_empty());
    let managed_backup_bytes = managed_backup.canonical_bytes().to_vec();
    let managed_binding = managed_backup.binding().clone();
    let managed_verifying_key = signer(TwoPartyDeriverRole::DeriverA).verifying_key_bytes();

    let online_opened =
        open_tenant_root_online_role_share_v1(online_sealed.clone(), &mut online_provider)
            .expect("opened online share");
    let managed_opened = block_on(open_tenant_root_managed_backup_v1(
        managed_backup,
        &mut backup_provider,
    ))
    .expect("opened managed backup");
    assert_eq!(
        online_opened.share_commitment(),
        managed_opened.share_commitment()
    );

    let mut wrong_provider =
        operational_provider(TwoPartyDeriverRole::DeriverA, 0x91, 0x92, ONLINE_REF);
    assert!(
        open_tenant_root_online_role_share_v1(online_sealed, &mut wrong_provider).is_err(),
        "a ciphertext sealed to another provider key must not open"
    );

    let (reused_secret, reused_public) = operational_keypair(0xa1);
    assert!(CloudflareTenantRootOperationalRotationProviderV1::new(
        TwoPartyDeriverRole::DeriverA,
        ONLINE_REF,
        reused_public,
        Zeroizing::new(reused_secret.to_vec()),
        BACKUP_PROVIDER,
        BACKUP_VERSION,
        reused_public,
        Zeroizing::new(reused_secret.to_vec()),
    )
    .is_err());
    assert!(CloudflareTenantRootOperationalRotationProviderV1::new(
        TwoPartyDeriverRole::DeriverA,
        ONLINE_REF,
        operational_keypair(0xb1).1,
        Zeroizing::new(operational_keypair(0xb1).0.to_vec()),
        ONLINE_REF,
        BACKUP_VERSION,
        operational_keypair(0xb2).1,
        Zeroizing::new(operational_keypair(0xb2).0.to_vec()),
    )
    .is_err());

    let reconstructed_backup =
        router_ab_core::TenantRootSignedManagedBackupV1::decode_and_verify_canonical_bytes(
            &managed_backup_bytes,
            &managed_binding,
            &managed_verifying_key,
        )
        .expect("reconstruct managed backup after rejection checks");
    assert!(
        block_on(open_tenant_root_managed_backup_v1(
            reconstructed_backup,
            &mut wrong_provider
        ))
        .is_err(),
        "a managed backup sealed to another provider key must not open"
    );
}
