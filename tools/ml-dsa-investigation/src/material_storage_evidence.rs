//! Encrypted role files for disposable, separate-process signing campaigns.
//!
//! The fixture stores a random wrapping seed in a separate mode-0600 file.
//! Production must keep it outside the material database and pin the expected
//! binding through admission and durable activation. These files do neither.

use crate::{InvestigationResult, private_keygen, private_signing, require};
use ml_dsa_threshold::ml_dsa_signing::SigningRole;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use signer_core::ml_dsa_custody::{
    MlDsaCeremonyBindingV1, MlDsaRoleV1,
    material::{
        MlDsaMaterialBindingV1, SealedMlDsaRoleMaterialV1, open_ml_dsa_role_material_v1,
        seal_ml_dsa_role_material_v1,
    },
};
use std::{fs, os::unix::fs::PermissionsExt, path::Path};
use zeroize::Zeroizing;

pub(super) const MATERIAL_FILENAME: &str = "sealed-test-material.json";
const CONTEXT_FILENAME: &str = "test-material-context.json";
const KEY_FILENAME: &str = "test-wrapping-key.bin";
const ENVIRONMENT: &str = "ml-dsa-host-disposable-test";
const KEY_VERSION: &str = "test-wrapping-key-1";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TestMaterialContext {
    ceremony: MlDsaCeremonyBindingV1,
    role: MlDsaRoleV1,
}

pub(super) fn custody_role(role: SigningRole) -> MlDsaRoleV1 {
    match role {
        SigningRole::A => MlDsaRoleV1::A,
        SigningRole::B => MlDsaRoleV1::B,
    }
}

pub(super) fn canonical_fixture_binding() -> InvestigationResult<MlDsaCeremonyBindingV1> {
    Ok(MlDsaCeremonyBindingV1::new(
        "canonical-disposable-fixture".into(),
        "near-ml-dsa-65".into(),
        private_signing::fresh_operation_id()?,
        0,
    )?)
}

pub(super) fn persist(
    directory: &Path,
    ceremony: MlDsaCeremonyBindingV1,
    role: SigningRole,
    public_key: &[u8; 1952],
    material: &[u8],
) -> InvestigationResult<Value> {
    let context = TestMaterialContext {
        ceremony,
        role: custody_role(role),
    };
    let binding = MlDsaMaterialBindingV1::new(
        ENVIRONMENT,
        KEY_VERSION,
        &context.ceremony,
        context.role,
        public_key,
    )?;
    let mut key = Zeroizing::new([0; 32]);
    getrandom::getrandom(key.as_mut())?;
    let sealed = seal_ml_dsa_role_material_v1(material, &binding, &key)?;
    let rejections = reject_substitutions(&sealed, &context, public_key, &key)?;
    let encoded = serde_json::to_vec(&sealed)?;
    private_keygen::write_private_file(&directory.join(MATERIAL_FILENAME), &encoded)?;
    private_keygen::write_private_file(
        &directory.join(CONTEXT_FILENAME),
        &serde_json::to_vec(&context)?,
    )?;
    private_keygen::write_private_file(&directory.join(KEY_FILENAME), key.as_ref())?;
    require(
        *open(&directory.join(MATERIAL_FILENAME), role, public_key)? == material,
        "Stored role material changed after authenticated reopening.",
    )?;
    let other_role = match role {
        SigningRole::A => SigningRole::B,
        SigningRole::B => SigningRole::A,
    };
    require(
        open(&directory.join(MATERIAL_FILENAME), other_role, public_key).is_err(),
        "Fixture opened the peer role record.",
    )?;
    let repeated = seal_ml_dsa_role_material_v1(material, &binding, &key)?;
    require(
        serde_json::to_vec(&repeated)? != encoded,
        "Storage encryption reused its ciphertext.",
    )?;
    Ok(json!({
        "wrong_role_file_rejected": true,
        "fresh_encryption": true,
        "sealed_record_bytes": encoded.len(),
        "plaintext_bytes": material.len(),
        "authenticated_roundtrip": true,
        "substitution_rejections": rejections,
        "scope": "Encrypted disposable role file. Separate signing processes reopen it. The fixture key file and expected context share the host; no production isolation, admission, activation, or rollback protection is claimed."
    }))
}

pub(super) fn open(
    path: &Path,
    expected_role: SigningRole,
    public_key: &[u8; 1952],
) -> InvestigationResult<Zeroizing<Vec<u8>>> {
    let directory = path
        .parent()
        .ok_or("Material file has no parent directory.")?;
    let context: TestMaterialContext =
        serde_json::from_slice(&fs::read(directory.join(CONTEXT_FILENAME))?)?;
    require(
        context.role == custody_role(expected_role),
        "Stored material belongs to another role.",
    )?;
    let binding = MlDsaMaterialBindingV1::new(
        ENVIRONMENT,
        KEY_VERSION,
        &context.ceremony,
        context.role,
        public_key,
    )?;
    let key_path = directory.join(KEY_FILENAME);
    require(
        fs::metadata(&key_path)?.permissions().mode() & 0o777 == 0o600,
        "Fixture wrapping key must use mode 0600.",
    )?;
    let key_bytes = Zeroizing::new(fs::read(key_path)?);
    let key: &[u8; 32] = key_bytes.as_slice().try_into()?;
    let sealed: SealedMlDsaRoleMaterialV1 = serde_json::from_slice(&fs::read(path)?)?;
    Ok(open_ml_dsa_role_material_v1(&sealed, &binding, key)?)
}

fn reject_substitutions(
    sealed: &SealedMlDsaRoleMaterialV1,
    context: &TestMaterialContext,
    public_key: &[u8; 1952],
    key: &[u8; 32],
) -> InvestigationResult<Vec<Value>> {
    let mut checks = Vec::new();
    for field in [
        "environment",
        "wrapping-key-version",
        "wallet",
        "signing-key",
        "operation",
        "epoch",
        "role",
        "public-key",
    ] {
        let current = &context.ceremony;
        let mut operation = *current.operation_id();
        if field == "operation" {
            operation[0] ^= 1;
            operation[1] |= 1;
        }
        let ceremony = MlDsaCeremonyBindingV1::new(
            if field == "wallet" {
                format!("{}-other", current.wallet_id())
            } else {
                current.wallet_id().into()
            },
            if field == "signing-key" {
                format!("{}-other", current.signing_key_id())
            } else {
                current.signing_key_id().into()
            },
            operation,
            if field == "epoch" {
                current.material_epoch() ^ 1
            } else {
                current.material_epoch()
            },
        )?;
        let role = if field == "role" {
            match context.role {
                MlDsaRoleV1::A => MlDsaRoleV1::B,
                MlDsaRoleV1::B => MlDsaRoleV1::A,
            }
        } else {
            context.role
        };
        let mut public = *public_key;
        if field == "public-key" {
            public[0] ^= 1;
        }
        let binding = MlDsaMaterialBindingV1::new(
            if field == "environment" {
                "other-environment"
            } else {
                ENVIRONMENT
            },
            if field == "wrapping-key-version" {
                "other-key-version"
            } else {
                KEY_VERSION
            },
            &ceremony,
            role,
            &public,
        )?;
        require(
            open_ml_dsa_role_material_v1(sealed, &binding, key).is_err(),
            "Storage accepted substituted public coordinates.",
        )?;
        checks.push(json!({"case": field, "rejected": true}));
    }
    let binding = MlDsaMaterialBindingV1::new(
        ENVIRONMENT,
        KEY_VERSION,
        &context.ceremony,
        context.role,
        public_key,
    )?;
    let mut other_key = Zeroizing::new(*key);
    other_key[0] ^= 1;
    require(
        open_ml_dsa_role_material_v1(sealed, &binding, &other_key).is_err(),
        "Storage accepted another wrapping key.",
    )?;
    checks.push(json!({"case": "wrapping-key", "rejected": true}));
    for field in ["ciphertext", "encapsulated_key", "truncated-ciphertext"] {
        let mut wire = serde_json::to_value(sealed)?;
        let target = if field == "truncated-ciphertext" {
            "ciphertext"
        } else {
            field
        };
        let bytes = wire[target]
            .as_array_mut()
            .ok_or("Missing envelope bytes.")?;
        if field == "truncated-ciphertext" {
            bytes.pop();
        } else {
            let byte = bytes[0].as_u64().ok_or("Invalid envelope byte.")?;
            bytes[0] = json!(byte ^ 1);
        }
        let changed = serde_json::from_value(wire)?;
        require(
            open_ml_dsa_role_material_v1(&changed, &binding, key).is_err(),
            "Storage accepted a damaged envelope.",
        )?;
        checks.push(json!({"case": field, "rejected": true}));
    }
    Ok(checks)
}
