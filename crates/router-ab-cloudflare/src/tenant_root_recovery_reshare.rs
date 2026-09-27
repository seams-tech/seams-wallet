//! A Deriver's part in generating a tenant's recovery package, on any host:
//! the five reshare phases, and Download and Destroy of the retained package.
//!
//! One retention key per recovery set and role seals the attempt's material
//! across the phases and wraps the package the Deriver keeps for Download.
//! Cloudflare holds that key in a destructible provider, Google Cloud KMS. A
//! host without one, the VM, keeps it in its role store, sealed to the role's
//! own key, and never claims more than an unverified erasure
//! (docs/refactor-150-vm-recovery-retention.md).

use core::num::NonZeroU64;

use rand_core_06::SeedableRng;
use router_ab_core::derivation::{TenantRootRecoveryPackageV1, TenantRootRetentionKeyIdV1};
use router_ab_core::*;
use sha2::{Digest, Sha256};
use threshold_prf::{RootShareRefreshCoefficient, SigningRootShareCommitment, TwoPartyDeriverRole};
use zeroize::Zeroizing;

use crate::tenant_root_role_d1::{recovery::RecoveryAttemptStateV1, TenantRootRoleShareStoreV1};
use crate::tenant_root_role_runtime::{RefreshHpkeReplayRng, TenantRootDeriverHostV1};
use crate::tenant_root_role_sql::RoleSqlSessionV1;

/// Private Deriver route for the five reshare phases of one recovery set.
pub const TENANT_ROOT_RECOVERY_RESHARE_PATH_V1: &str =
    "/router-ab/deriver/tenant-root-recovery/reshare";
/// Private Deriver route for Download and Destroy of a retained package.
pub const TENANT_ROOT_RECOVERY_ACCESS_PATH_V1: &str =
    "/router-ab/deriver/tenant-root-recovery/access";
/// The media type of a downloaded recovery package.
pub const TENANT_ROOT_RECOVERY_PACKAGE_CONTENT_TYPE_V1: &str =
    "application/vnd.seams.tenant-root-recovery-package.v1";

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TenantRootRecoveryCommitmentsV1 {
    a: String,
    b: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TenantRootRecoveryRoundV1 {
    commitments: TenantRootRecoveryCommitmentsV1,
    peer_contribution: String,
}

/// One reshare phase, with the issuer-signed generation command it runs under.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TenantRootRecoveryReshareRequestV1 {
    Prepare {
        command: String,
    },
    Contribute {
        command: String,
        commitments: TenantRootRecoveryCommitmentsV1,
    },
    Derive {
        command: String,
        round: TenantRootRecoveryRoundV1,
    },
    Prove {
        command: String,
        round: TenantRootRecoveryRoundV1,
        peer_commitment: String,
    },
    Package {
        command: String,
        round: TenantRootRecoveryRoundV1,
        evidence_a: String,
        evidence_b: String,
    },
}

impl TenantRootRecoveryReshareRequestV1 {
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

/// One reshare phase's result.
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TenantRootRecoveryReshareResponseV1 {
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

/// Download or Destroy of one role's retained package, under the generation
/// command that made it and an issuer-signed access grant.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TenantRootRecoveryAccessRequestV1 {
    generation_command: String,
    access_grant: String,
}

/// Download's package bytes, or Destroy's outcome.
pub enum TenantRootRecoveryAccessResponseV1 {
    Package {
        bytes: Zeroizing<Vec<u8>>,
        file_name: String,
    },
    Destruction(serde_json::Value),
}

/// What a retention provider did to one key version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TenantRootRecoveryRetentionDestructionV1 {
    /// The provider scheduled the key version's destruction: its receipt.
    Scheduled { receipt: String },
    /// The key is gone as far as this provider can tell: its receipt.
    Destroyed { receipt: String },
}

/// Where one recovery set's retention key for this role lives.
#[allow(async_fn_in_trait)]
pub trait TenantRootRecoveryRetentionProviderV1 {
    /// Creates the key version if it does not exist; a replay succeeds.
    async fn provision(&self) -> RouterAbDerivationResult<()>;
    /// Seals bytes under the key, with the given authenticated data.
    async fn seal(&self, aad: &[u8], plaintext: &[u8]) -> RouterAbDerivationResult<Vec<u8>>;
    /// Opens bytes sealed under the key, with the same authenticated data.
    async fn open(&self, aad: &[u8], ciphertext: &[u8])
        -> RouterAbDerivationResult<Zeroizing<Vec<u8>>>;
    /// Makes the key unusable, as far as this provider can, and says how.
    async fn destroy(&self) -> RouterAbDerivationResult<TenantRootRecoveryRetentionDestructionV1>;
}

/// A Deriver host that can retain recovery packages.
pub trait TenantRootDeriverRecoveryHostV1: TenantRootDeriverHostV1 {
    type Retention: TenantRootRecoveryRetentionProviderV1;
    /// The retention key for one recovery set and this role.
    fn recovery_retention(
        &self,
        id: TenantRootRetentionKeyIdV1,
    ) -> RouterAbProtocolResult<Self::Retention>;
}

/// A retention key kept in the role store, sealed to the role's own key: for
/// a host without a destructible key provider. Destroying it deletes that
/// row, and nothing more can be claimed: a snapshot or backup of the store
/// may still hold it.
pub struct TenantRootRoleStoreRecoveryRetentionV1<S: RoleSqlSessionV1> {
    store: TenantRootRoleShareStoreV1<S>,
    id: TenantRootRetentionKeyIdV1,
}

impl<S: RoleSqlSessionV1> TenantRootRoleStoreRecoveryRetentionV1<S> {
    pub fn new(store: TenantRootRoleShareStoreV1<S>, id: TenantRootRetentionKeyIdV1) -> Self {
        Self { store, id }
    }

    async fn key(&self) -> RouterAbDerivationResult<TenantRootRetentionKeySecretV1> {
        self.store
            .recovery_retention_key(self.id)
            .await
            .map_err(|error| retention_error(error.to_string()))?
            .ok_or_else(|| retention_error("recovery retention key is not provisioned here"))
    }
}

impl<S: RoleSqlSessionV1> TenantRootRecoveryRetentionProviderV1
    for TenantRootRoleStoreRecoveryRetentionV1<S>
{
    async fn provision(&self) -> RouterAbDerivationResult<()> {
        let mut secret = Zeroizing::new([0_u8; 32]);
        fill_random(secret.as_mut());
        self.store
            .provision_recovery_retention_key(self.id, &secret)
            .await
            .map_err(|error| retention_error(error.to_string()))
    }

    async fn seal(&self, aad: &[u8], plaintext: &[u8]) -> RouterAbDerivationResult<Vec<u8>> {
        let mut nonce = [0_u8; 12];
        fill_random(&mut nonce);
        self.key().await?.seal(aad, plaintext, nonce)
    }

    async fn open(
        &self,
        aad: &[u8],
        ciphertext: &[u8],
    ) -> RouterAbDerivationResult<Zeroizing<Vec<u8>>> {
        self.key().await?.open(aad, ciphertext)
    }

    async fn destroy(&self) -> RouterAbDerivationResult<TenantRootRecoveryRetentionDestructionV1> {
        self.store
            .delete_recovery_retention_key(self.id)
            .await
            .map_err(|error| retention_error(error.to_string()))?;
        Ok(TenantRootRecoveryRetentionDestructionV1::Destroyed {
            receipt: serde_json::json!({
                "provider": "role_store",
                "retention_key_digest_b64u": encode(&self.id.digest()),
                "cryptographic_erasure": "cryptographic_erasure_unverified",
            })
            .to_string(),
        })
    }
}

/// The attempt's material, opened from its retention seal.
struct RecoveryAttemptMaterialV1 {
    replay_seed: Zeroizing<[u8; 32]>,
    active_share: threshold_prf::SigningRootShare,
}

/// One recovery set's retention at this role: what its key seals, and the
/// bindings that stop one set's or role's material opening as another's.
struct RecoveryRetentionV1<P> {
    id: TenantRootRetentionKeyIdV1,
    provider: P,
}

impl<P: TenantRootRecoveryRetentionProviderV1> RecoveryRetentionV1<P> {
    async fn wrap_package(
        &self,
        package: &TenantRootRecoveryPackageV1,
    ) -> RouterAbDerivationResult<Vec<u8>> {
        self.require_package_identity(package)?;
        let bytes = Zeroizing::new(package.to_bytes()?);
        self.provider.seal(&self.id.binding_bytes(), &bytes).await
    }

    async fn open_package(
        &self,
        retained_ciphertext: &[u8],
    ) -> RouterAbDerivationResult<Zeroizing<Vec<u8>>> {
        let bytes = self
            .provider
            .open(&self.id.binding_bytes(), retained_ciphertext)
            .await?;
        let package = TenantRootRecoveryPackageV1::decode(&bytes)?;
        self.require_package_identity(&package)?;
        Ok(bytes)
    }

    async fn seal_recovery_attempt(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        replay_seed: &[u8; 32],
        active_share: &threshold_prf::SigningRootShare,
    ) -> RouterAbDerivationResult<Vec<u8>> {
        let aad = self.recovery_attempt_aad(command)?;
        require_recovery_active_share(command, active_share)?;
        let mut plaintext = Zeroizing::new(Vec::with_capacity(66));
        plaintext.extend_from_slice(replay_seed);
        let wire = threshold_prf::SigningRootShareWire::from_share(active_share);
        let share_bytes = Zeroizing::new(wire.to_bytes());
        plaintext.extend_from_slice(share_bytes.as_ref());
        self.provider.seal(&aad, &plaintext).await
    }

    async fn open_recovery_attempt(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
        ciphertext: &[u8],
    ) -> RouterAbDerivationResult<RecoveryAttemptMaterialV1> {
        let aad = self.recovery_attempt_aad(command)?;
        let plaintext = self.provider.open(&aad, ciphertext).await?;
        if plaintext.len() != 32 + threshold_prf::SigningRootShareWire::LEN {
            return Err(retention_error("invalid recovery replay material length"));
        }
        let replay_seed = Zeroizing::new(
            plaintext[..32]
                .try_into()
                .expect("checked replay seed length"),
        );
        let active_share = threshold_prf::SigningRootShareWire::decode_slice(&plaintext[32..])
            .and_then(|wire| wire.to_share())
            .map_err(|_| retention_error("invalid recovery replay share"))?;
        require_recovery_active_share(command, &active_share)?;
        Ok(RecoveryAttemptMaterialV1 {
            replay_seed,
            active_share,
        })
    }

    fn recovery_attempt_aad(
        &self,
        command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    ) -> RouterAbDerivationResult<Vec<u8>> {
        if command.role() != self.id.role()
            || command.context().recovery_set_id() != self.id.recovery_set_id()
        {
            return Err(retention_error("recovery attempt does not match retention key"));
        }
        let mut aad = b"seams/tenant-root/recovery-attempt/v1".to_vec();
        aad.extend_from_slice(&self.id.binding_bytes());
        aad.extend_from_slice(command.digest().as_bytes());
        Ok(aad)
    }

    fn require_package_identity(
        &self,
        package: &TenantRootRecoveryPackageV1,
    ) -> RouterAbDerivationResult<()> {
        if package.header().recovery_set_id() != self.id.recovery_set_id()
            || package.role() != self.id.role()
        {
            return Err(retention_error(
                "recovery package does not match the retention key set and role",
            ));
        }
        Ok(())
    }
}

fn require_recovery_active_share(
    command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    active_share: &threshold_prf::SigningRootShare,
) -> RouterAbDerivationResult<()> {
    if active_share.id() != command.role().share_id()
        || SigningRootShareCommitment::from_share(active_share)
            != command.context().active_share_commitment(command.role())
    {
        return Err(retention_error(
            "recovery attempt share differs from the authorized active commitment",
        ));
    }
    Ok(())
}

fn retention_error(message: impl Into<String>) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::MalformedInput, message)
}

fn error(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}
fn crypto_error(value: RouterAbDerivationError) -> RouterAbProtocolError {
    error(value.message())
}
fn storage_error(value: impl core::fmt::Display) -> RouterAbProtocolError {
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
fn fill_random(bytes: &mut [u8]) {
    rand_core::RngCore::fill_bytes(&mut crate::hpke::CloudflareHpkeGetrandomRngV1, bytes);
}
fn fresh_rng() -> rand_chacha::ChaCha20Rng {
    let mut seed = Zeroizing::new([0; 32]);
    fill_random(seed.as_mut());
    rand_chacha::ChaCha20Rng::from_seed(*seed)
}
fn hpke_key_id(key: TenantRootRecoveryReshareHpkePublicKeyV1) -> String {
    format!("recovery-{}", encode(&Sha256::digest(key.as_bytes())))
}

fn deriver_role(host: &impl TenantRootDeriverHostV1) -> RouterAbProtocolResult<TwoPartyDeriverRole> {
    match host.worker_role() {
        crate::CloudflareWorkerRoleV1::DeriverA => Ok(TwoPartyDeriverRole::DeriverA),
        crate::CloudflareWorkerRoleV1::DeriverB => Ok(TwoPartyDeriverRole::DeriverB),
        _ => Err(error("recovery sharing requires a Deriver")),
    }
}

fn retention_key_id(
    command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    role: TwoPartyDeriverRole,
) -> TenantRootRetentionKeyIdV1 {
    TenantRootRetentionKeyIdV1::new(command.context().recovery_set_id(), role, NonZeroU64::MIN)
}

fn verify_commitments(
    command: &VerifiedTenantRootRecoveryReshareRoleCommandV1,
    pair: &TenantRootRecoveryCommitmentsV1,
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
    round: &TenantRootRecoveryRoundV1,
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

/// Runs one reshare phase of an issuer-signed generation command at this
/// Deriver. The first phase admits the attempt and seals its replay seed and
/// the active share it read under the set's retention key; every phase
/// reopens them, so each is an exact replay of the same attempt. The last
/// phase wraps the package and keeps it for Download.
pub async fn tenant_root_deriver_recovery_reshare_v1<Host: TenantRootDeriverRecoveryHostV1>(
    host: &Host,
    request: TenantRootRecoveryReshareRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootRecoveryReshareResponseV1> {
    let role = deriver_role(host)?;
    let worker_role = host.worker_role();
    let issuers =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(host.env())?;
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
    let (_, signer) = crate::env::load_tenant_root_creation_role_signing_key_v1(worker_role, host.env())?;
    let keys = crate::env::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(host.env())?;
    let store = host.role_store().map_err(storage_error)?;
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
        return Ok(TenantRootRecoveryReshareResponseV1::Packaged {
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
    let id = retention_key_id(&command, role);
    let retention = RecoveryRetentionV1 {
        id,
        provider: host.recovery_retention(id)?,
    };
    retention.provider.provision().await.map_err(crypto_error)?;
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
            crate::env::load_tenant_root_operational_rotation_provider_v1(worker_role, host.env())?;
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
        fill_random(seed.as_mut());
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
        TenantRootRecoveryReshareRequestV1::Prepare { .. } => {
            Ok(TenantRootRecoveryReshareResponseV1::Prepared {
                commitment: encode(
                    &local
                        .canonical_bytes(command.context())
                        .map_err(crypto_error)?,
                ),
            })
        }
        TenantRootRecoveryReshareRequestV1::Contribute { commitments, .. } => {
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
            Ok(TenantRootRecoveryReshareResponseV1::Contributed {
                contribution: encode(&contribution.canonical_bytes().map_err(crypto_error)?),
            })
        }
        TenantRootRecoveryReshareRequestV1::Derive { round, .. } => {
            let pending = derive_pending(
                &command,
                &round,
                &local,
                &coefficient,
                &hpke,
                &material.active_share,
                &keys,
            )?;
            Ok(TenantRootRecoveryReshareResponseV1::Derived {
                commitment: encode(&pending.commitment().to_bytes()),
            })
        }
        TenantRootRecoveryReshareRequestV1::Prove {
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
            Ok(TenantRootRecoveryReshareResponseV1::Proved {
                evidence: encode(
                    &signed
                        .canonical_bytes(command.context())
                        .map_err(crypto_error)?,
                ),
            })
        }
        TenantRootRecoveryReshareRequestV1::Package {
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
            let time =
                format_tenant_root_rfc3339_millis_v1(context.issued_at_ms()).map_err(crypto_error)?;
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
                } => Ok(TenantRootRecoveryReshareResponseV1::Packaged {
                    package_digest: package_digest_b64u,
                    descriptor: descriptor_b64u,
                    package_length,
                }),
                _ => Err(error("recovery cleanup prevented package publication")),
            }
        }
    }
}

/// Downloads or destroys one role's retained package under an issuer-signed
/// access grant for its generation command.
pub async fn tenant_root_deriver_recovery_access_v1<Host: TenantRootDeriverRecoveryHostV1>(
    host: &Host,
    request: TenantRootRecoveryAccessRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootRecoveryAccessResponseV1> {
    let role = deriver_role(host)?;
    let issuers =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(host.env())?;
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
    let store = host.role_store().map_err(storage_error)?;
    let state = store
        .load_recovery_attempt(&command)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| error("recovery set is missing"))?;
    let id = retention_key_id(&command, role);
    let retention = RecoveryRetentionV1 {
        id,
        provider: host.recovery_retention(id)?,
    };
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
            // Cleanup may start while the retention key opens the package.
            if !matches!(
                store
                    .load_recovery_attempt(&command)
                    .await
                    .map_err(storage_error)?,
                Some(RecoveryAttemptStateV1::Packaged { .. })
            ) {
                return Err(error("recovery cleanup closed this download"));
            }
            Ok(TenantRootRecoveryAccessResponseV1::Package {
                bytes,
                file_name: format!(
                    "seams-recovery-{}-{}.bin",
                    command.context().recovery_set_id().to_base64url(),
                    role.as_str()
                ),
            })
        }
        TenantRootRecoveryAccessOperationV1::DestroyRecoverySet => {
            store
                .begin_recovery_destruction(&command)
                .await
                .map_err(storage_error)?;
            let outcome = retention.provider.destroy().await.map_err(crypto_error)?;
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
            Ok(TenantRootRecoveryAccessResponseV1::Destruction(serde_json::json!({
                "status": status,
                "role": role.as_str(),
                "recovery_set_id": command.context().recovery_set_id().to_base64url(),
                "provider_receipt": receipt,
            })))
        }
    }
}
