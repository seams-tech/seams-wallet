//! Deployment-scoped recovery trust established over verified HTTPS.
use crate::transport::{ConsoleRequestV1, ConsoleTransportV1};
use base64ct::{Base64UrlUnpadded, Encoding};
use router_ab_core::{
    decode_tenant_root_recovery_manifest_v1, verify_tenant_root_recovery_manifest_trust_v1,
    TenantRootRecoveryTrustBundleV1, TenantRootRecoveryTrustEvidenceV1,
    TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES, TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES,
};
use seams_recovery_core::{
    read_capped_file_v1, require_trust_bundle_continues_pinned_root_v1, write_new_file_durably_v1,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedTrust {
    origin: String,
    identity_digest: String,
    bundle: String,
}

fn directory() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("Cannot locate your home directory")?;
    Ok(PathBuf::from(home).join(".config/seams/recovery-trust"))
}

fn cache_path(origin: &str, identity: &str) -> Result<PathBuf, String> {
    let bytes = Base64UrlUnpadded::decode_vec(identity).map_err(|_| "Invalid recovery identity")?;
    if bytes.len() != 32 || Base64UrlUnpadded::encode_string(&bytes) != identity {
        return Err("Invalid recovery identity".into());
    }
    let deployment = Base64UrlUnpadded::encode_string(&Sha256::digest(origin.as_bytes()));
    Ok(directory()?.join(format!("{deployment}-{identity}.json")))
}

pub(crate) fn save_trust(
    origin: &str,
    identity: &str,
    bundle_bytes: &[u8],
) -> Result<PathBuf, String> {
    let bundle = TenantRootRecoveryTrustBundleV1::from_canonical_json(bundle_bytes)
        .map_err(|e| e.message().to_owned())?;
    let path = cache_path(origin, identity)?;
    if path.exists() {
        let saved = read_saved(&path)?;
        if saved.origin != origin {
            return Err("This recovery identity is already connected to another console".into());
        }
        let previous =
            TenantRootRecoveryTrustBundleV1::from_canonical_json(saved.bundle.as_bytes())
                .map_err(|e| e.message().to_owned())?;
        require_trust_bundle_continues_pinned_root_v1(&previous, &bundle)
            .map_err(|e| e.to_string())?;
        if saved.bundle.as_bytes() == bundle_bytes {
            return Ok(path);
        }
    }
    let parent = directory()?;
    std::fs::create_dir_all(&parent).map_err(|_| "Cannot create recovery trust directory")?;
    let bytes = serde_json::to_vec(&SavedTrust {
        origin: origin.into(),
        identity_digest: identity.into(),
        bundle: String::from_utf8(bundle_bytes.to_vec()).map_err(|_| "Invalid trust encoding")?,
    })
    .map_err(|_| "Cannot encode recovery trust")?;
    let temporary = parent.join(format!(".{identity}-{}.json", std::process::id()));
    write_new_file_durably_v1(&temporary, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &path).map_err(|_| "Cannot save recovery trust")?;
    Ok(path)
}

fn read_saved(path: &Path) -> Result<SavedTrust, String> {
    let bytes = read_capped_file_v1(path, TENANT_ROOT_RECOVERY_TRUST_BUNDLE_MAX_BYTES * 2)
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "Invalid saved recovery trust".into())
}

pub(crate) fn trust_for_manifest(
    path: &Path,
    production: &TenantRootRecoveryTrustBundleV1,
) -> Result<TenantRootRecoveryTrustBundleV1, String> {
    let bytes = read_capped_file_v1(path, TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES)
        .map_err(|e| e.to_string())?;
    let manifest =
        decode_tenant_root_recovery_manifest_v1(&bytes).map_err(|e| e.message().to_owned())?;
    if verify_tenant_root_recovery_manifest_trust_v1(
        &manifest,
        production,
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .is_ok()
    {
        return Ok(production.clone());
    }
    let identity = Base64UrlUnpadded::encode_string(
        manifest
            .descriptor()
            .tenant_root_identity_digest()
            .as_bytes(),
    );
    let saved_directory = directory()?;
    if saved_directory.exists() {
        let entries = std::fs::read_dir(&saved_directory)
            .map_err(|_| "Cannot read saved recovery authorities")?;
        let suffix = format!("-{identity}.json");
        for entry in entries {
            let path = entry
                .map_err(|_| "Cannot read saved recovery authority")?
                .path();
            if !path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().ends_with(&suffix))
            {
                continue;
            }
            let saved = read_saved(&path)?;
            if saved.identity_digest != identity || cache_path(&saved.origin, &identity)? != path {
                return Err("Saved recovery trust identity mismatch".into());
            }
            let bundle =
                TenantRootRecoveryTrustBundleV1::from_canonical_json(saved.bundle.as_bytes())
                    .map_err(|e| e.message().to_owned())?;
            if let Ok(trust) = verify_tenant_root_recovery_manifest_trust_v1(
                &manifest,
                &bundle,
                &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
            ) {
                manifest
                    .verify(&trust.trusted_verifying_keys().control_plane)
                    .map_err(|e| e.message().to_owned())?;
                return Ok(bundle);
            }
        }
    }
    Err("This backup's recovery authority has not been connected on this computer. Run the dashboard's ‘Connect recovery trust’ command first.".into())
}

pub(crate) fn fetch_trust(
    transport: &dyn ConsoleTransportV1,
    origin: &str,
) -> Result<Vec<u8>, String> {
    let uri: ureq::http::Uri = origin.parse().map_err(|_| "Invalid console URL")?;
    if uri.scheme_str() != Some("https")
        || uri.authority().is_none()
        || uri
            .authority()
            .is_some_and(|authority| authority.as_str().contains('@'))
        || uri.path_and_query().is_some_and(|p| p.as_str() != "/")
        || origin.ends_with('/')
    {
        return Err("Use the console HTTPS origin without a trailing slash or path".into());
    }
    let response = transport
        .send(ConsoleRequestV1 {
            method: "GET",
            url: format!("{origin}/console/tenant-root/security/recovery-trust"),
            headers: BTreeMap::new(),
            body: None,
        })
        .map_err(|e| e.message().to_owned())?;
    if response.status != 200 {
        return Err("The console has not published its recovery authority".into());
    }
    TenantRootRecoveryTrustBundleV1::from_canonical_json(&response.body)
        .map_err(|e| e.message().to_owned())?;
    Ok(response.body)
}

pub(crate) fn dashboard_origin(
    transport: &dyn ConsoleTransportV1,
    origin: &str,
) -> Result<String, String> {
    let response = transport
        .send(ConsoleRequestV1 {
            method: "GET",
            url: format!("{origin}/console/tenant-root/security/cli-info"),
            headers: BTreeMap::new(),
            body: None,
        })
        .map_err(|e| e.message().to_owned())?;
    if response.status != 200 {
        return Err("The console could not provide its browser approval address".into());
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CliInfo {
        dashboard_url: String,
    }
    let info: CliInfo = serde_json::from_slice(&response.body)
        .map_err(|_| "Invalid console browser approval address")?;
    crate::run::enrollment_origin(&info.dashboard_url, true)
        .map_err(|_| "The console returned an invalid browser approval address".into())
}

pub(crate) fn connect_manifest(
    transport: &dyn ConsoleTransportV1,
    origin: &str,
    path: &Path,
) -> Result<PathBuf, String> {
    let bundle_bytes = fetch_trust(transport, origin)?;
    let bundle = TenantRootRecoveryTrustBundleV1::from_canonical_json(&bundle_bytes)
        .map_err(|e| e.message().to_owned())?;
    let bytes = read_capped_file_v1(path, TENANT_ROOT_RECOVERY_MANIFEST_MAX_BYTES)
        .map_err(|e| e.to_string())?;
    let manifest =
        decode_tenant_root_recovery_manifest_v1(&bytes).map_err(|e| e.message().to_owned())?;
    let trust = verify_tenant_root_recovery_manifest_trust_v1(
        &manifest,
        &bundle,
        &TenantRootRecoveryTrustEvidenceV1::OfflineRootsOnly,
    )
    .map_err(|e| e.message().to_owned())?;
    manifest
        .verify(&trust.trusted_verifying_keys().control_plane)
        .map_err(|e| e.message().to_owned())?;
    save_trust(
        origin,
        &Base64UrlUnpadded::encode_string(
            manifest
                .descriptor()
                .tenant_root_identity_digest()
                .as_bytes(),
        ),
        &bundle_bytes,
    )
}
