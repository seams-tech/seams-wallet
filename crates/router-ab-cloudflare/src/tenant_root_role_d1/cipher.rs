//! The role-private D1 cipher that seals and opens every stored record.

use super::*;

pub(super) struct TenantRootRoleD1CipherV1 {
    pub(super) environment: String,
    pub(super) role: CloudflareTenantRootDeriverRoleV1,
    pub(super) key_version: String,
    pub(super) public_key: <CloudflareHpkeKemV1 as Kem>::PublicKey,
    pub(super) private_key: <CloudflareHpkeKemV1 as Kem>::PrivateKey,
}

impl TenantRootRoleD1CipherV1 {
    pub(super) fn from_env_reader(
        env: &(impl crate::CloudflareEnvReaderV1 + crate::CloudflareSecretReaderV1),
    ) -> RoleStoreResult<Self> {
        let secret_binding = required_reader_var(env, ROLE_PRIVATE_D1_KEK_BINDING_ENV)?;
        let encoded_private_key = env.secret_text(&secret_binding).map_err(|error| {
            store_error(format!(
                "role-private D1 KEK Secret binding {secret_binding} is unavailable: {}",
                error.message()
            ))
        })?;
        Self::from_config(
            TenantRootRoleStoreKeyConfigV1 {
                environment: required_reader_var(env, ROLE_PRIVATE_D1_ENVIRONMENT_ENV)?,
                role: required_reader_var(env, ROLE_PRIVATE_D1_ROLE_ENV)?,
                key_version: required_reader_var(env, ROLE_PRIVATE_D1_KEK_VERSION_ENV)?,
                public_key: required_reader_var(env, ROLE_PRIVATE_D1_KEK_PUBLIC_KEY_ENV)?,
            },
            &encoded_private_key,
        )
    }

    pub(super) fn from_config(
        config: TenantRootRoleStoreKeyConfigV1,
        encoded_private_key: &str,
    ) -> RoleStoreResult<Self> {
        for (field, value) in [
            (ROLE_PRIVATE_D1_ENVIRONMENT_ENV, &config.environment),
            (ROLE_PRIVATE_D1_ROLE_ENV, &config.role),
            (ROLE_PRIVATE_D1_KEK_VERSION_ENV, &config.key_version),
        ] {
            require_identifier(field, value)?;
        }
        let environment = config.environment;
        let role = CloudflareTenantRootDeriverRoleV1::parse(&config.role)?;
        let key_version = config.key_version;
        let public_key = parse_cloudflare_hpke_x25519_public_key_v1(&config.public_key)
            .map_err(|error| store_error(error.message()))?;
        let mut private_key_bytes = decode_private_key(encoded_private_key)?;
        let private_key = CloudflareHpkeKemV1::sk_from_bytes(&private_key_bytes)
            .map_err(|error| store_error(format!("role-private D1 KEK is invalid: {error}")))?;
        private_key_bytes.zeroize();
        validate_role_private_d1_kek_key_pair(&public_key, &private_key)?;
        Ok(Self {
            environment,
            role,
            key_version,
            public_key,
            private_key,
        })
    }

    pub(super) fn seal(
        &self,
        record: &CloudflareTenantRootRoleShareRecordV1,
        revision: i64,
    ) -> RoleStoreResult<String> {
        if revision <= 0 {
            return Err(store_error(
                "tenant-root role-private row has an invalid revision",
            ));
        }
        record.validate()?;
        self.require_role(record.role)?;
        let metadata = record_metadata(record)?;
        let aad = self.aad(&metadata, revision)?;
        let plaintext = serde_json::to_vec(record).map_err(|error| {
            store_error(format!(
                "tenant-root role-private record encoding failed: {error}"
            ))
        })?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_ROLE_D1_HPKE_INFO,
            &aad,
            &plaintext,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private D1 encryption failed: {error}"
            ))
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        serde_json::to_string(&TenantRootRoleD1CiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: metadata.identity_digest_hex,
            custody_lineage_b64u: metadata.custody_lineage_b64u,
            tenant_root_share_epoch: metadata.epoch,
            role: metadata.role,
            lifecycle: metadata.lifecycle,
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private ciphertext encoding failed: {error}"
            ))
        })
    }

    /// Seals one recovery set's role-store retention key to this role's own
    /// key, with the key's identity and this store's scope as authenticated
    /// data.
    pub(super) fn seal_recovery_retention_key(
        &self,
        id: router_ab_core::derivation::TenantRootRetentionKeyIdV1,
        secret: &[u8; 32],
    ) -> RoleStoreResult<String> {
        require_nonzero_bytes("tenant-root recovery retention key", secret)?;
        let aad = self.recovery_retention_key_aad(id)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RECOVERY_RETENTION_KEY_D1_HPKE_INFO,
            &aad,
            secret,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root recovery retention key encryption failed: {error}"
            ))
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        serde_json::to_string(&TenantRootRecoveryRetentionKeyCiphertextV1 {
            key_version: self.key_version.clone(),
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root recovery retention key encoding failed: {error}"
            ))
        })
    }

    pub(super) fn open_recovery_retention_key(
        &self,
        id: router_ab_core::derivation::TenantRootRetentionKeyIdV1,
        sealed_json: &str,
    ) -> RoleStoreResult<zeroize::Zeroizing<[u8; 32]>> {
        let envelope: TenantRootRecoveryRetentionKeyCiphertextV1 =
            serde_json::from_str(sealed_json).map_err(|error| {
                store_error(format!(
                    "tenant-root recovery retention key decoding failed: {error}"
                ))
            })?;
        if envelope.key_version != self.key_version {
            return Err(store_error(
                "tenant-root recovery retention key was sealed under another role key version",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root recovery retention key ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
        {
            return Err(store_error(
                "tenant-root recovery retention key ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root recovery retention key encapsulation is invalid")
        })?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RECOVERY_RETENTION_KEY_D1_HPKE_INFO,
                &self.recovery_retention_key_aad(id)?,
                ciphertext,
            )
            .map_err(|_| store_error("tenant-root recovery retention key decryption failed"))?,
        );
        let secret: [u8; 32] = plaintext.as_slice().try_into().map_err(|_| {
            store_error("tenant-root recovery retention key has the wrong length")
        })?;
        Ok(zeroize::Zeroizing::new(secret))
    }

    pub(super) fn recovery_retention_key_aad(
        &self,
        id: router_ab_core::derivation::TenantRootRetentionKeyIdV1,
    ) -> RoleStoreResult<Vec<u8>> {
        if id.role().as_str() != self.role.as_str() {
            return Err(store_error(
                "tenant-root recovery retention key belongs to another role",
            ));
        }
        let mut aad = b"seams/deriver/tenant-root-recovery-retention-key/v1".to_vec();
        for field in [self.environment.as_bytes(), self.key_version.as_bytes()] {
            aad.extend_from_slice(&(field.len() as u32).to_be_bytes());
            aad.extend_from_slice(field);
        }
        aad.extend_from_slice(&id.binding_bytes());
        Ok(aad)
    }

    pub(super) fn seal_restore_import_ikm(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        ikm: &[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES],
    ) -> RoleStoreResult<String> {
        binding.validate()?;
        self.require_role(binding.role)?;
        require_nonzero_bytes("tenant-root restore import key IKM", ikm)?;
        let lifecycle = CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued;
        let aad = self.restore_import_key_aad(binding, lifecycle)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_IMPORT_KEY_D1_HPKE_INFO,
            &aad,
            ikm,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore import key encryption failed: {error}"
            ))
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_IMPORT_KEY_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore import key ciphertext exceeds its size limit",
            ));
        }
        let identity_digest_hex = encode_hex(binding.identity_digest.as_bytes());
        let custody_lineage_b64u = binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(binding.restore_session_id.as_bytes());
        let public_key_b64u = encode_base64url_bytes_v1(binding.import_public_key.as_bytes());
        serde_json::to_string(&TenantRootRestoreImportKeyCiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            role: binding.role,
            generation: binding.generation,
            import_key_id: binding.import_key_id.clone(),
            public_key_b64u,
            issued_at_ms: binding.issued_at_ms,
            expires_at_ms: binding.expires_at_ms,
            lifecycle: lifecycle.as_str().to_owned(),
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore import key ciphertext encoding failed: {error}"
            ))
        })
    }

    pub(super) fn seal_restore_imported_share(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        envelope_digest: &[u8; 32],
        share_bytes: &[u8],
    ) -> RoleStoreResult<String> {
        binding.validate()?;
        self.require_role(binding.role)?;
        require_nonzero_bytes(
            "tenant-root restore imported share envelope digest",
            envelope_digest,
        )?;
        if share_bytes.len() != SigningRootShareWire::LEN {
            return Err(store_error(
                "tenant-root restore imported share wire has an invalid length",
            ));
        }
        let identity_digest_hex = encode_hex(binding.identity_digest.as_bytes());
        let custody_lineage_b64u = binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(binding.restore_session_id.as_bytes());
        let envelope_digest_hex = encode_hex(envelope_digest);
        let share_commitment_b64u = encode_base64url_bytes_v1(&binding.share_commitment);
        let aad = self.restore_imported_share_aad(
            binding,
            &identity_digest_hex,
            &custody_lineage_b64u,
            &restore_session_id_hex,
            &envelope_digest_hex,
            &share_commitment_b64u,
        )?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_HPKE_INFO,
            &aad,
            share_bytes,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore imported share encryption failed: {error}"
            ))
        })?;
        if ciphertext.len() != SigningRootShareWire::LEN + 16 {
            return Err(store_error(
                "tenant-root restore imported share ciphertext has an invalid length",
            ));
        }
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_IMPORTED_SHARE_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore imported share ciphertext exceeds its size limit",
            ));
        }
        serde_json::to_string(&TenantRootRestoreImportedShareCiphertextV1 {
            key_version: self.key_version.clone(),
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            role: binding.role,
            generation: binding.generation,
            import_key_id: binding.import_key_id.clone(),
            envelope_digest_hex,
            share_commitment_b64u,
            ciphertext_b64u: encode_base64url_bytes_v1(&payload),
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore imported share ciphertext encoding failed: {error}"
            ))
        })
    }

    pub(super) fn restore_imported_share_aad(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        identity_digest_hex: &str,
        custody_lineage_b64u: &str,
        restore_session_id_hex: &str,
        envelope_digest_hex: &str,
        share_commitment_b64u: &str,
    ) -> RoleStoreResult<Vec<u8>> {
        serde_json::to_vec(&TenantRootRestoreImportedShareAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: identity_digest_hex,
            custody_lineage_b64u,
            restore_session_id_hex,
            role: binding.role,
            generation: binding.generation,
            import_key_id: &binding.import_key_id,
            envelope_digest_hex,
            share_commitment_b64u,
            purpose: TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore imported share AAD encoding failed: {error}"
            ))
        })
    }

    pub(super) fn open_restore_imported_share(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> RoleStoreResult<SigningRootShare> {
        record.binding.validate()?;
        self.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed {
            return Err(store_error(
                "tenant-root restore imported share is not installed",
            ));
        }
        let envelope_digest = record.envelope_digest.ok_or_else(|| {
            store_error("tenant-root restore imported share envelope digest is missing")
        })?;
        let encoded = record.encrypted_imported_share_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore imported share ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestoreImportedShareCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|error| {
                store_error(format!(
                    "tenant-root restore imported share ciphertext decoding failed: {error}"
                ))
            })?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let expected_envelope_digest_hex = encode_hex(&envelope_digest);
        let expected_share_commitment_b64u =
            encode_base64url_bytes_v1(&record.binding.share_commitment);
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.role != record.binding.role
            || envelope.generation != record.binding.generation
            || envelope.import_key_id != record.binding.import_key_id
            || envelope.envelope_digest_hex != expected_envelope_digest_hex
            || envelope.share_commitment_b64u != expected_share_commitment_b64u
        {
            return Err(store_error(
                "tenant-root restore imported share ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore imported share ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len()
                != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + SigningRootShareWire::LEN + 16
            || payload.len() > MAX_RESTORE_IMPORTED_SHARE_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore imported share ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore imported share encapsulation is invalid")
        })?;
        let aad = self.restore_imported_share_aad(
            &record.binding,
            &identity_digest_hex,
            &custody_lineage_b64u,
            &restore_session_id_hex,
            &expected_envelope_digest_hex,
            &expected_share_commitment_b64u,
        )?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_IMPORTED_SHARE_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| store_error("tenant-root restore imported share decryption failed"))?,
        );
        let share = SigningRootShareWire::decode_slice(&plaintext)
            .and_then(|wire| wire.to_share())
            .map_err(|_| store_error("tenant-root restore imported share plaintext is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(record.binding.role).share_id()
            || SigningRootShareCommitment::from_share(&share).to_bytes()
                != record.binding.share_commitment
        {
            return Err(store_error(
                "tenant-root restore imported share does not match its accepted commitment",
            ));
        }
        Ok(share)
    }

    pub(super) fn restore_refresh_seed_aad(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
    ) -> RoleStoreResult<Vec<u8>> {
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        serde_json::to_vec(&TenantRootRestoreRefreshSeedAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            attempt: &attempt,
            issued_at_ms: binding.issued_at_ms,
            expires_at_ms: binding.expires_at_ms,
            admitted_at_ms: binding.admitted_at_ms,
            purpose: TENANT_ROOT_RESTORE_REFRESH_SEED_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_REFRESH_SEED_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh replay seed AAD encoding failed: {error}"
            ))
        })
    }

    pub(super) fn restore_refresh_share_aad(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        evidence_digest_hex: &str,
    ) -> RoleStoreResult<Vec<u8>> {
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        serde_json::to_vec(&TenantRootRestoreRefreshShareAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            attempt: &attempt,
            evidence_digest_hex,
            purpose: TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh share AAD encoding failed: {error}"
            ))
        })
    }

    pub(super) fn restore_promotion_aad(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        provider_binding_aad_b64u: &str,
    ) -> RoleStoreResult<Vec<u8>> {
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        serde_json::to_vec(&TenantRootRestorePromotionAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            attempt: &attempt,
            provider_binding_aad_b64u,
            purpose: TENANT_ROOT_RESTORE_PROMOTION_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_PROMOTION_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh promotion AAD encoding failed: {error}"
            ))
        })
    }

    pub(super) fn seal_restore_refresh_promotion_output(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
        sealed: &TenantRootSealedOnlineRoleShareV1,
    ) -> RoleStoreResult<String> {
        if record.lifecycle() != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            return Err(store_error(
                "tenant-root restore refresh promotion requires a refreshed attempt",
            ));
        }
        let binding = record.binding();
        let import = binding.import_binding();
        if sealed.binding().identity_digest() != import.identity_digest
            || sealed.binding().custody_lineage() != import.custody_lineage
            || sealed.binding().role() != tenant_root_protocol_role_of(import.role)
            || sealed.binding().epoch() != TenantRootShareEpoch::INITIAL
        {
            return Err(store_error(
                "tenant-root restore refresh promotion provider binding does not match its row",
            ));
        }
        let provider_binding_aad = sealed.aad().map_err(|error| store_error(error.message()))?;
        let provider_binding_aad_b64u = encode_base64url_bytes_v1(&provider_binding_aad);
        let aad = self.restore_promotion_aad(binding, &provider_binding_aad_b64u)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_PROMOTION_D1_HPKE_INFO,
            &aad,
            sealed.ciphertext(),
        )
        .map_err(|_| {
            store_error("tenant-root restore refresh promotion output encryption failed")
        })?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_PROMOTION_ROLE_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext exceeds its size limit",
            ));
        }
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        serde_json::to_string(&TenantRootRestorePromotionRoleCiphertextV1::new(
            self.key_version.clone(),
            attempt,
            provider_binding_aad_b64u,
            encode_base64url_bytes_v1(&payload),
        ))
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh promotion ciphertext encoding failed: {error}"
            ))
        })
    }

    pub(super) fn open_restore_refresh_promotion_output(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> RoleStoreResult<(Vec<u8>, Vec<u8>, Vec<u8>)> {
        if record.promotion_lifecycle()
            != CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::Completed
        {
            return Err(store_error(
                "tenant-root restore refresh promotion is not complete",
            ));
        }
        let binding = record.binding();
        let encoded = record.encrypted_online_role_share_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestorePromotionRoleCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|_| {
                store_error("tenant-root restore refresh promotion ciphertext is malformed")
            })?;
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        if envelope.key_version != self.key_version || envelope.attempt() != attempt {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext metadata does not match its row",
            ));
        }
        let provider_binding_aad = decode_base64url_bytes_v1(
            "tenant-root restore refresh promotion provider binding",
            &envelope.provider_binding_aad_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&provider_binding_aad) != envelope.provider_binding_aad_b64u
            || provider_binding_aad.is_empty()
        {
            return Err(store_error(
                "tenant-root restore refresh promotion provider binding is malformed",
            ));
        }
        let aad = self.restore_promotion_aad(binding, &envelope.provider_binding_aad_b64u)?;
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore refresh promotion ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() < CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + 1 + 16
            || payload.len() > MAX_RESTORE_PROMOTION_ROLE_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore refresh promotion ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore refresh promotion encapsulation is invalid")
        })?;
        let provider_ciphertext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_PROMOTION_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| store_error("tenant-root restore refresh promotion decryption failed"))?,
        );
        if provider_ciphertext.is_empty() || provider_ciphertext.len() > MAX_SEALED_ROLE_SHARE_BYTES
        {
            return Err(store_error(
                "tenant-root restore refresh promotion provider ciphertext is malformed",
            ));
        }
        let canary = decode_base64url_bytes_v1(
            "tenant-root restore refresh provider canary",
            record.provider_canary_receipt_b64u()?,
        )
        .map_err(|error| store_error(error.message()))?;
        Ok((provider_ciphertext.to_vec(), provider_binding_aad, canary))
    }

    pub(super) fn seal_restore_refresh_seed(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        replay_seed: &[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES],
    ) -> RoleStoreResult<String> {
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        require_nonzero_bytes("tenant-root restore refresh replay seed", replay_seed)?;
        let aad = self.restore_refresh_seed_aad(binding)?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_REFRESH_SEED_D1_HPKE_INFO,
            &aad,
            replay_seed,
        )
        .map_err(|_| store_error("tenant-root restore refresh replay seed encryption failed"))?;
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_REFRESH_SEED_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext exceeds its size limit",
            ));
        }
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        serde_json::to_string(&TenantRootRestoreRefreshSeedCiphertextV1::new(
            self.key_version.clone(),
            attempt,
            binding.issued_at_ms,
            binding.expires_at_ms,
            binding.admitted_at_ms,
            encode_base64url_bytes_v1(&payload),
        ))
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refresh replay seed ciphertext encoding failed: {error}"
            ))
        })
    }

    pub(super) fn open_restore_refresh_seed(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> RoleStoreResult<zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]>>
    {
        let binding = record.binding();
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        let encoded = record.encrypted_seed_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestoreRefreshSeedCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|_| {
                store_error("tenant-root restore refresh replay seed ciphertext is malformed")
            })?;
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        if envelope.key_version != self.key_version
            || envelope.attempt() != attempt
            || envelope.issued_at_ms != binding.issued_at_ms
            || envelope.expires_at_ms != binding.expires_at_ms
            || envelope.admitted_at_ms != binding.admitted_at_ms
        {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore refresh replay seed ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len()
                != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
                    + TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES
                    + 16
            || payload.len() > MAX_RESTORE_REFRESH_SEED_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore refresh replay seed ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore refresh replay seed encapsulation is invalid")
        })?;
        let aad = self.restore_refresh_seed_aad(binding)?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_REFRESH_SEED_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| {
                store_error("tenant-root restore refresh replay seed decryption failed")
            })?,
        );
        if plaintext.len() != TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES {
            return Err(store_error(
                "tenant-root restore refresh replay seed length is invalid",
            ));
        }
        let mut replay_seed =
            zeroize::Zeroizing::new([0_u8; TENANT_ROOT_RESTORE_REFRESH_REPLAY_SEED_BYTES]);
        replay_seed.copy_from_slice(&plaintext);
        require_nonzero_bytes(
            "tenant-root restore refresh replay seed",
            replay_seed.as_ref(),
        )?;
        Ok(replay_seed)
    }

    pub(super) fn seal_restore_refresh_share(
        &self,
        binding: &CloudflareTenantRootRestoreRefreshRoleAttemptBindingV1,
        evidence_digest: &[u8; 32],
        share_wire: &SigningRootShareWire,
    ) -> RoleStoreResult<String> {
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        require_nonzero_bytes(
            "tenant-root restore refresh installation evidence digest",
            evidence_digest,
        )?;
        let share = share_wire
            .to_share()
            .map_err(|_| store_error("tenant-root restore refreshed share is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(binding.import_binding().role).share_id() {
            return Err(store_error(
                "tenant-root restore refreshed share belongs to the wrong role",
            ));
        }
        let aad = self.restore_refresh_share_aad(binding, &encode_hex(evidence_digest))?;
        let mut rng = CloudflareHpkeGetrandomRngV1;
        let share_bytes = share_wire.to_bytes();
        let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
            &mut rng,
            &self.public_key,
            TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_HPKE_INFO,
            &aad,
            &share_bytes,
        )
        .map_err(|_| store_error("tenant-root restore refreshed share encryption failed"))?;
        if ciphertext.len() != SigningRootShareWire::LEN + 16 {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext has an invalid length",
            ));
        }
        let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
        payload.extend_from_slice(encapped_key.as_ref());
        payload.extend_from_slice(&ciphertext);
        if payload.len() > MAX_RESTORE_REFRESH_SHARE_CIPHERTEXT_BYTES {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext exceeds its size limit",
            ));
        }
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        serde_json::to_string(&TenantRootRestoreRefreshShareCiphertextV1::new(
            self.key_version.clone(),
            attempt,
            encode_hex(evidence_digest),
            encode_base64url_bytes_v1(&payload),
        ))
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore refreshed share ciphertext encoding failed: {error}"
            ))
        })
    }

    pub(super) fn open_restore_refresh_share(
        &self,
        record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
    ) -> RoleStoreResult<SigningRootShare> {
        if record.lifecycle() != CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::Refreshed
        {
            return Err(store_error(
                "tenant-root restore refreshed share is not durably staged",
            ));
        }
        let binding = record.binding();
        binding.import_binding().validate()?;
        self.require_role(binding.import_binding().role)?;
        let evidence_digest = record.installation_evidence_digest().ok_or_else(|| {
            store_error("tenant-root restore refreshed share evidence digest is missing")
        })?;
        let encoded = record.encrypted_refreshed_share_json()?;
        if encoded.len() > 8 * 1024 {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext JSON exceeds its size limit",
            ));
        }
        let envelope: TenantRootRestoreRefreshShareCiphertextV1 = serde_json::from_str(encoded)
            .map_err(|_| {
                store_error("tenant-root restore refreshed share ciphertext is malformed")
            })?;
        let import = binding.import_binding();
        let attempt = TenantRootRestoreRefreshAttemptFieldsV1::from_binding(binding);
        let evidence_digest_hex = encode_hex(&evidence_digest);
        if envelope.key_version != self.key_version
            || envelope.attempt() != attempt
            || envelope.evidence_digest_hex != evidence_digest_hex
        {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext metadata does not match its row",
            ));
        }
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore refreshed share ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len()
                != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + SigningRootShareWire::LEN + 16
            || payload.len() > MAX_RESTORE_REFRESH_SHARE_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore refreshed share ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|_| {
            store_error("tenant-root restore refreshed share encapsulation is invalid")
        })?;
        let aad = self.restore_refresh_share_aad(binding, &evidence_digest_hex)?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_REFRESH_SHARE_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|_| store_error("tenant-root restore refreshed share decryption failed"))?,
        );
        let wire = SigningRootShareWire::decode_slice(&plaintext)
            .map_err(|_| store_error("tenant-root restore refreshed share plaintext is invalid"))?;
        let share = wire
            .to_share()
            .map_err(|_| store_error("tenant-root restore refreshed share plaintext is invalid"))?;
        if share.id() != tenant_root_protocol_role_of(import.role).share_id() {
            return Err(store_error(
                "tenant-root restore refreshed share plaintext belongs to the wrong role",
            ));
        }
        Ok(share)
    }

    pub(super) fn open_restore_import_ikm(
        &self,
        record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    ) -> RoleStoreResult<zeroize::Zeroizing<[u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES]>> {
        record.binding.validate()?;
        self.require_role(record.binding.role)?;
        if record.lifecycle != CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued {
            return Err(store_error(
                "tenant-root restore import key is not live for opening",
            ));
        }
        let envelope: TenantRootRestoreImportKeyCiphertextV1 =
            serde_json::from_str(record.encrypted_ikm_json()?).map_err(|error| {
                store_error(format!(
                    "tenant-root restore import key ciphertext decoding failed: {error}"
                ))
            })?;
        let identity_digest_hex = encode_hex(record.binding.identity_digest.as_bytes());
        let custody_lineage_b64u = record.binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(record.binding.restore_session_id.as_bytes());
        let public_key_b64u =
            encode_base64url_bytes_v1(record.binding.import_public_key.as_bytes());
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != identity_digest_hex
            || envelope.custody_lineage_b64u != custody_lineage_b64u
            || envelope.restore_session_id_hex != restore_session_id_hex
            || envelope.role != record.binding.role
            || envelope.generation != record.binding.generation
            || envelope.import_key_id != record.binding.import_key_id
            || envelope.public_key_b64u != public_key_b64u
            || envelope.issued_at_ms != record.binding.issued_at_ms
            || envelope.expires_at_ms != record.binding.expires_at_ms
            || envelope.lifecycle != record.lifecycle.as_str()
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext metadata does not match its row",
            ));
        }
        let aad = self.restore_import_key_aad(
            &record.binding,
            CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued,
        )?;
        let payload = decode_base64url_bytes_v1(
            "tenant-root restore import key ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
            || payload.len() > MAX_RESTORE_IMPORT_KEY_CIPHERTEXT_BYTES
        {
            return Err(store_error(
                "tenant-root restore import key ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|error| {
            store_error(format!(
                "tenant-root restore import key encapsulation is invalid: {error}"
            ))
        })?;
        let plaintext = zeroize::Zeroizing::new(
            CloudflareHpkeSuiteV1::open_base(
                &encapped_key,
                &self.private_key,
                TENANT_ROOT_RESTORE_IMPORT_KEY_D1_HPKE_INFO,
                &aad,
                ciphertext,
            )
            .map_err(|error| {
                store_error(format!(
                    "tenant-root restore import key decryption failed: {error}"
                ))
            })?,
        );
        if plaintext.len() != TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES {
            return Err(store_error(
                "tenant-root restore import key IKM length is invalid",
            ));
        }
        let mut ikm = zeroize::Zeroizing::new([0_u8; TENANT_ROOT_RESTORE_IMPORT_KEY_IKM_BYTES]);
        ikm.copy_from_slice(&plaintext);
        require_nonzero_bytes("tenant-root restore import key IKM", ikm.as_ref())?;
        Ok(ikm)
    }

    pub(super) fn restore_import_key_aad(
        &self,
        binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
        lifecycle: CloudflareTenantRootRestoreImportKeyLifecycleV1,
    ) -> RoleStoreResult<Vec<u8>> {
        let identity_digest_hex = encode_hex(binding.identity_digest.as_bytes());
        let custody_lineage_b64u = binding.custody_lineage.to_base64url();
        let restore_session_id_hex = encode_hex(binding.restore_session_id.as_bytes());
        let recovery_set_id_b64u = binding.recovery_set_id.to_base64url();
        let destination_fingerprint_hex = encode_hex(binding.destination_fingerprint.as_bytes());
        let manifest_digest_hex = encode_hex(&binding.manifest_digest);
        let stable_root_commitment_b64u =
            encode_base64url_bytes_v1(&binding.stable_root_commitment);
        let share_commitment_b64u = encode_base64url_bytes_v1(&binding.share_commitment);
        let replay_key_digest_hex = encode_hex(&binding.replay_key_digest);
        let command_digest_hex = encode_hex(&binding.command_digest);
        let operation_digest_hex = encode_hex(&binding.operation_digest);
        let public_key_b64u = encode_base64url_bytes_v1(binding.import_public_key.as_bytes());
        serde_json::to_vec(&TenantRootRestoreImportKeyAadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: &identity_digest_hex,
            custody_lineage_b64u: &custody_lineage_b64u,
            restore_session_id_hex: &restore_session_id_hex,
            recovery_set_id_b64u: &recovery_set_id_b64u,
            destination_fingerprint_hex: &destination_fingerprint_hex,
            manifest_digest_hex: &manifest_digest_hex,
            stable_root_commitment_b64u: &stable_root_commitment_b64u,
            share_commitment_b64u: &share_commitment_b64u,
            role: binding.role,
            generation: binding.generation,
            import_key_id: &binding.import_key_id,
            replay_key_digest_hex: &replay_key_digest_hex,
            command_digest_hex: &command_digest_hex,
            operation_digest_hex: &operation_digest_hex,
            public_key_b64u: &public_key_b64u,
            issued_at_ms: binding.issued_at_ms,
            expires_at_ms: binding.expires_at_ms,
            lifecycle: lifecycle.as_str(),
            purpose: TENANT_ROOT_RESTORE_IMPORT_KEY_D1_PURPOSE,
            schema: TENANT_ROOT_RESTORE_IMPORT_KEY_D1_SCHEMA,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root restore import key AAD encoding failed: {error}"
            ))
        })
    }

    pub(super) fn open(
        &self,
        row: &TenantRootRoleD1RowV1,
    ) -> RoleStoreResult<CloudflareTenantRootRoleShareRecordV1> {
        let envelope: TenantRootRoleD1CiphertextV1 = serde_json::from_str(&row.ciphertext_json)
            .map_err(|error| {
                store_error(format!(
                    "tenant-root role-private ciphertext decoding failed: {error}"
                ))
            })?;
        if envelope.key_version != self.key_version
            || envelope.tenant_identity_digest_hex != row.tenant_identity_digest_hex
            || envelope.custody_lineage_b64u != row.custody_lineage_b64u
            || epoch_i64_value(envelope.tenant_root_share_epoch)? != row.tenant_root_share_epoch
            || envelope.role.as_str() != row.role
            || envelope.lifecycle != row.lifecycle
        {
            return Err(store_error(
                "tenant-root role-private ciphertext metadata does not match its row",
            ));
        }
        self.require_role(envelope.role)?;
        let metadata = TenantRootRoleD1MetadataV1 {
            identity_digest_hex: envelope.tenant_identity_digest_hex,
            custody_lineage_b64u: envelope.custody_lineage_b64u,
            epoch: envelope.tenant_root_share_epoch,
            role: envelope.role,
            lifecycle: envelope.lifecycle,
        };
        let aad = self.aad(&metadata, row.revision)?;
        let payload = decode_base64url_bytes_v1(
            "tenant-root role-private ciphertext",
            &envelope.ciphertext_b64u,
        )
        .map_err(|error| store_error(error.message()))?;
        if encode_base64url_bytes_v1(&payload) != envelope.ciphertext_b64u
            || payload.len() <= CloudflareHpkeKemV1::ENCAPPED_KEY_LEN
        {
            return Err(store_error(
                "tenant-root role-private ciphertext is malformed",
            ));
        }
        let (encapped_key, ciphertext) = payload.split_at(CloudflareHpkeKemV1::ENCAPPED_KEY_LEN);
        let encapped_key = CloudflareHpkeKemV1::enc_from_bytes(encapped_key).map_err(|error| {
            store_error(format!(
                "tenant-root role-private encapsulated key is invalid: {error}"
            ))
        })?;
        let plaintext = CloudflareHpkeSuiteV1::open_base(
            &encapped_key,
            &self.private_key,
            TENANT_ROOT_ROLE_D1_HPKE_INFO,
            &aad,
            ciphertext,
        )
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private D1 decryption failed: {error}"
            ))
        })?;
        let record = decode_tenant_root_role_d1_record_v1(plaintext)?;
        record.validate()?;
        validate_record_activation_binding(&record)?;
        let actual = record_metadata(&record)?;
        if actual != metadata
            || timestamp_i64(record.created_at_ms)? != row.created_at_ms
            || timestamp_i64(record.updated_at_ms)? != row.updated_at_ms
        {
            return Err(store_error(
                "tenant-root role-private record does not match its authenticated row",
            ));
        }
        Ok(record)
    }

    pub(super) fn aad(&self, metadata: &TenantRootRoleD1MetadataV1, revision: i64) -> RoleStoreResult<Vec<u8>> {
        if revision <= 0 {
            return Err(store_error(
                "tenant-root role-private row has an invalid revision",
            ));
        }
        let record_key = metadata.record_key();
        serde_json::to_vec(&TenantRootRoleD1AadV1 {
            environment: &self.environment,
            worker_role: self.role,
            tenant_identity_digest_hex: &metadata.identity_digest_hex,
            custody_lineage_b64u: &metadata.custody_lineage_b64u,
            tenant_root_share_epoch: metadata.epoch,
            record_role: metadata.role,
            lifecycle: &metadata.lifecycle,
            revision,
            purpose: TENANT_ROOT_ROLE_D1_PURPOSE,
            schema: TENANT_ROOT_ROLE_D1_SCHEMA,
            record_key: &record_key,
        })
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private AAD encoding failed: {error}"
            ))
        })
    }

    pub(super) fn require_role(&self, role: CloudflareTenantRootDeriverRoleV1) -> RoleStoreResult<()> {
        if role != self.role {
            return Err(store_error(
                "tenant-root role-private record belongs to the other Deriver",
            ));
        }
        Ok(())
    }
}

/// Keeps the large authenticated record decoder out of the HPKE open frame.
#[inline(never)]
pub(super) fn decode_tenant_root_role_d1_record_v1(
    plaintext: Vec<u8>,
) -> RoleStoreResult<CloudflareTenantRootRoleShareRecordV1> {
    serde_json::from_slice::<TenantRootRoleD1RecordWireV1>(&plaintext)
        .map_err(|error| {
            store_error(format!(
                "tenant-root role-private record decoding failed: {error}"
            ))
        })?
        .into_record()
}
