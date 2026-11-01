//! Immutable wallet placement. Only first access consults the shared directory.
use super::*;
use service_group::ServiceGroup;

const PATH: &str = "/routing";
const GROUP_COUNT: &str = "routing/group-count";
const NEXT: &str = "routing/next";
const CACHE_ENTRIES: usize = 128;
thread_local! {
    static CACHE: RefCell<Vec<(WalletScope, ServiceGroup)>> = const { RefCell::new(Vec::new()) };
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lookup {
    wallet: WalletScope,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Placement {
    wallet: WalletScope,
    group: ServiceGroup,
}

enum Destination<'a> {
    Wallet(&'a WalletScope),
    Registration(ServiceGroup),
}
impl AdmissionCommand {
    fn destination(&self) -> Destination<'_> {
        match self {
            Self::PrepareRegistration { wallet, .. }
            | Self::ActivateRegistration { wallet, .. } => Destination::Wallet(wallet),
            Self::RetireRegistration { job }
            | Self::ReadyRegistration { job, .. }
            | Self::CheckRegistrationJob { job } => Destination::Registration(job.service_group),
            Self::ClaimRegistration { request, .. } => Destination::Wallet(&request.wallet),
            Self::CheckRegistrationClaim { claim } | Self::FinishRegistration { claim, .. } => {
                Destination::Wallet(&claim.request.wallet)
            }
            Self::ClaimRefill { key, .. }
            | Self::PendingRefills { key }
            | Self::WithdrawRefill { key }
            | Self::KeyState { key }
            | Self::ActiveKey { key } => Destination::Wallet(&key.wallet),
            Self::CheckRefill { job } | Self::FinishRefill { job, .. } => {
                Destination::Wallet(&job.key.wallet)
            }
            Self::AuthorizeKey { activation } | Self::CommitKey { activation } => {
                Destination::Wallet(&activation.key.wallet)
            }
            Self::Preflight { request }
            | Self::DeferEmpty { request, .. }
            | Self::Begin { request }
            | Self::Settled { request }
            | Self::Lookup { request } => Destination::Wallet(&request.key.wallet),
            Self::Admit { claim, .. } | Self::Cancel { claim } | Self::AwaitStock { claim, .. } => {
                Destination::Wallet(&claim.request.key.wallet)
            }
            Self::Finish { permit, .. } => Destination::Wallet(&permit.request.key.wallet),
        }
    }
}
fn cache(wallet: &WalletScope, group: ServiceGroup) {
    CACHE.with(|entries| {
        let mut entries = entries.borrow_mut();
        if entries.iter().any(|(known, _)| known == wallet) {
            return;
        }
        if entries.len() == CACHE_ENTRIES {
            entries.remove(0);
        }
        entries.push((wallet.clone(), group));
    });
}
fn cached(wallet: &WalletScope) -> Option<ServiceGroup> {
    CACHE.with(|entries| {
        entries
            .borrow()
            .iter()
            .find(|(known, _)| known == wallet)
            .map(|(_, group)| *group)
    })
}
pub(super) fn is_path(path: &str) -> bool {
    path == PATH
}
fn placement_key(wallet: &WalletScope) -> Result<String> {
    Ok(format!(
        "routing/wallet/{}",
        hex(&digest(b"wallet", wallet)?)
    ))
}
fn directory_id(env: &Env) -> Result<String> {
    Ok(env
        .durable_object(SERVICE_BINDING)
        .map_err(storage_error)?
        .id_from_name(SERVICE_NAME)
        .map_err(storage_error)?
        .to_string())
}
pub(super) async fn resolve(env: &Env, wallet: &WalletScope) -> Result<ServiceGroup> {
    if let Some(group) = cached(wallet) {
        return Ok(group);
    }
    let lookup = Lookup {
        wallet: wallet.clone(),
    };
    let mut response = env
        .durable_object(SERVICE_BINDING)
        .map_err(storage_error)?
        .get_by_name(SERVICE_NAME)
        .map_err(storage_error)?
        .fetch_with_request(object_request(env, CallAuthority::Internal, PATH, &lookup)?)
        .await
        .map_err(storage_error)?;
    if response.status_code() != 200 {
        return Err(invalid("ML-DSA wallet placement is unavailable"));
    }
    let placement: Placement = response.json().await.map_err(storage_error)?;
    if placement.wallet != *wallet {
        return Err(invalid("ML-DSA wallet placement changed identity"));
    }
    cache(wallet, placement.group);
    Ok(placement.group)
}
pub(super) async fn destination(env: &Env, command: &AdmissionCommand) -> Result<ServiceGroup> {
    match command.destination() {
        Destination::Wallet(wallet) => resolve(env, wallet).await,
        Destination::Registration(group) => Ok(group),
    }
}
pub(super) async fn check_destination(
    env: &Env,
    state: &State,
    command: &AdmissionCommand,
) -> Result<ServiceGroup> {
    let group = match command.destination() {
        Destination::Wallet(wallet) => match cached(wallet) {
            Some(group) => group,
            None if state.id().to_string() == directory_id(env)? => {
                let group = assign(env, state, wallet).await?;
                cache(wallet, group);
                group
            }
            None => resolve(env, wallet).await?,
        },
        Destination::Registration(group) => group,
    };
    let expected = env
        .durable_object(SERVICE_BINDING)
        .map_err(storage_error)?
        .id_from_name(&group.admission_name())
        .map_err(storage_error)?
        .to_string();
    if expected.to_string() != state.id().to_string() {
        return Err(invalid(
            "ML-DSA admission command reached the wrong service group",
        ));
    }
    match command {
        AdmissionCommand::CheckRegistrationClaim { claim }
        | AdmissionCommand::FinishRegistration { claim, .. }
            if claim.job.service_group != group =>
        {
            return Err(invalid(
                "ML-DSA registration belongs to another service group",
            ));
        }
        _ => {}
    }
    Ok(group)
}
pub(super) async fn check_producer(env: &Env, state: &State, job: &refill::Job) -> Result<()> {
    let group = resolve(env, &job.key.wallet).await?;
    let expected = env
        .durable_object(job.producer_slot.namespace())
        .map_err(storage_error)?
        .id_from_name(&group.producer_name())
        .map_err(storage_error)?
        .to_string();
    if expected.to_string() != state.id().to_string() {
        return Err(invalid(
            "ML-DSA preparation reached the wrong service group or slot",
        ));
    }
    Ok(())
}
pub(super) async fn handle(
    mut request: worker::Request,
    env: &Env,
    state: &State,
) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_internal_service_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if state.id().to_string() != directory_id(env).map_err(protocol_error)?.to_string() {
        return Response::error("ML-DSA placement requires the directory object", 409);
    }
    let input: Lookup = decode_bounded_json_request(&mut request, 4096)
        .await
        .map_err(protocol_error)?;
    let group = assign(env, state, &input.wallet)
        .await
        .map_err(protocol_error)?;
    Response::from_json(&Placement {
        wallet: input.wallet,
        group,
    })
}
async fn assign(env: &Env, state: &State, wallet: &WalletScope) -> Result<ServiceGroup> {
    let count = policy(env)?.service_groups;
    let wallet = wallet.clone();
    transaction(state, move |store| async move {
        let previous: Option<u8> = store.get(GROUP_COUNT).await?;
        match previous {
            None => migrate_existing_wallets(&store).await?,
            Some(previous) if count < previous => {
                return Err(invalid("ML-DSA service group count cannot decrease"));
            }
            Some(_) => {}
        }
        if previous != Some(count) {
            store.put(GROUP_COUNT, &count).await?;
        }
        let key = placement_key(&wallet)?;
        if let Some(group) = store.get::<ServiceGroup>(&key).await? {
            if u8::from(group) >= count {
                return Err(invalid("ML-DSA persisted wallet placement is inconsistent"));
            }
            return Ok(group);
        }
        let next = store.get::<u64>(NEXT).await?.unwrap_or_default();
        let group = ServiceGroup::try_from((next % u64::from(count)) as u8)?;
        store.put(&key, &group).await?;
        store
            .put(
                NEXT,
                &next
                    .checked_add(1)
                    .ok_or_else(|| invalid("ML-DSA placement counter overflow"))?,
            )
            .await?;
        Ok(group)
    })
    .await
}
/// Normalize existing admission records once, before a newly enabled group can receive a wallet.
async fn migrate_existing_wallets(store: &TransactionStore) -> Result<()> {
    for prefix in [
        "activation/",
        "registration-operation/",
        "operation/",
        "cooldown/",
    ] {
        let mut start = prefix.to_owned();
        loop {
            let rows = store
                .transaction
                .list_with_options(
                    worker::ListOptions::new()
                        .prefix(prefix)
                        .start(&start)
                        .limit(64),
                )
                .await
                .map_err(storage_error)?;
            let iterator = worker::js_sys::try_iter(&rows.keys())
                .map_err(|_| invalid("Cannot list existing ML-DSA wallet placements"))?
                .ok_or_else(|| invalid("Missing ML-DSA wallet placement iterator"))?;
            for key in iterator {
                let key = key
                    .map_err(|_| invalid("Cannot read ML-DSA wallet record key"))?
                    .as_string()
                    .ok_or_else(|| invalid("Invalid ML-DSA wallet record key"))?;
                if prefix == "activation/" {
                    let state: admission::KeyState = store
                        .get(&key)
                        .await?
                        .ok_or_else(|| invalid("Existing ML-DSA activation disappeared"))?;
                    pin_existing(store, &state.activation().key.wallet).await?;
                } else {
                    let suffix = key
                        .strip_prefix(prefix)
                        .ok_or_else(|| invalid("ML-DSA wallet record prefix changed"))?;
                    let wallet_digest = suffix.split('/').next().unwrap_or_default();
                    if wallet_digest.len() != 64
                        || !wallet_digest
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                    {
                        return Err(invalid("Invalid persisted ML-DSA wallet digest"));
                    }
                    pin_key(store, &format!("routing/wallet/{wallet_digest}")).await?;
                }
                start = format!("{key}\0");
            }
            if rows.size() < 64 {
                break;
            }
        }
    }
    if let Some(claim) = store
        .get::<super::super::registration::Claim>("registration-active")
        .await?
    {
        pin_existing(store, &claim.request.wallet).await?;
    }
    Ok(())
}
async fn pin_existing(store: &impl Store, wallet: &WalletScope) -> Result<()> {
    pin_key(store, &placement_key(wallet)?).await
}
async fn pin_key(store: &impl Store, key: &str) -> Result<()> {
    match store.get::<ServiceGroup>(key).await? {
        Some(group) if group != ServiceGroup::default() => Err(invalid(
            "Existing ML-DSA wallet has a conflicting placement",
        )),
        Some(_) => Ok(()),
        None => store.put(key, &ServiceGroup::default()).await,
    }
}
