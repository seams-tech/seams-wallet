//! One declaration binds each internal wire command to its reply and decoder.
use super::*;
use crate::ml_dsa::registration as registration_core;
use std::marker::PhantomData;

pub(super) struct Request<W, R, C = Json> {
    wire: W,
    reply: PhantomData<(fn() -> R, C)>,
}
impl<W, R, C> Request<W, R, C> {
    pub(super) fn wire(&self) -> &W {
        &self.wire
    }
    pub(super) fn into_wire(self) -> W {
        self.wire
    }
}
impl<W: Serialize, R, C> Serialize for Request<W, R, C> {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> core::result::Result<S::Ok, S::Error> {
        self.wire.serialize(serializer)
    }
}

pub(super) enum Json {}
pub(super) enum Taken {}
pub(super) enum Inputs {}
pub(super) enum Upgrade {}
pub(super) trait Codec<R> {
    const STATUS: u16 = 200;
    async fn read(response: Response) -> Result<R>;
    fn local(output: RoleOutput) -> Result<R>;
}
impl<R: serde::de::DeserializeOwned> Codec<R> for Json {
    async fn read(mut response: Response) -> Result<R> {
        response.json().await.map_err(storage_error)
    }
    fn local(output: RoleOutput) -> Result<R> {
        serde_json::from_value(output.into_json()?)
            .map_err(|_| invalid("Invalid typed ML-DSA reply"))
    }
}
impl Codec<(Binding, Sealed)> for Taken {
    async fn read(mut response: Response) -> Result<(Binding, Sealed)> {
        material_delivery::take(&mut response).await
    }
    fn local(output: RoleOutput) -> Result<(Binding, Sealed)> {
        match output {
            RoleOutput::Taken { binding, sealed } => Ok((binding, sealed)),
            _ => Err(invalid("ML-DSA command returned the wrong material reply")),
        }
    }
}
impl Codec<material_delivery::SigningInputs> for Inputs {
    async fn read(mut response: Response) -> Result<material_delivery::SigningInputs> {
        material_delivery::signing_inputs(&mut response).await
    }
    fn local(output: RoleOutput) -> Result<material_delivery::SigningInputs> {
        match output {
            RoleOutput::SigningInputs(inputs) => Ok(inputs),
            _ => Err(invalid("ML-DSA command returned the wrong signing inputs")),
        }
    }
}
impl Codec<worker::WebSocket> for Upgrade {
    const STATUS: u16 = 101;
    async fn read(response: Response) -> Result<worker::WebSocket> {
        response
            .websocket()
            .ok_or_else(|| invalid("ML-DSA peer socket is absent"))
    }
    fn local(_: RoleOutput) -> Result<worker::WebSocket> {
        Err(invalid("ML-DSA upgrade requires a peer connection"))
    }
}

macro_rules! command_family {
    ($wire:ident, $requests:ident {
        $(
            $variant:ident($constructor:ident) {
                $( $field:ident: $ty:ty ),* $(,)?
            } => $reply:ty, $codec:ty;
        )*
    }) => {
        #[derive(Serialize, Deserialize)]
        #[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
        pub enum $wire {
            $( $variant { $( $field: $ty ),* }, )*
        }
        pub(in crate::ml_dsa::workers) mod $requests {
            use super::*;
            $(
                pub(in crate::ml_dsa::workers) fn $constructor(
                    $( $field: $ty ),*
                ) -> Request<$wire, $constructor::Reply, $codec> {
                    Request {
                        wire: $wire::$variant { $( $field ),* },
                        reply: PhantomData,
                    }
                }
                pub(in crate::ml_dsa::workers) mod $constructor {
                    #[allow(unused_imports)]
                    use super::*;
                    pub(in crate::ml_dsa::workers) type Reply = $reply;
                }
            )*
        }
    };
}

command_family! { AdmissionCommand, admission_requests {
    PrepareRegistration(prepare_registration) {
        wallet: WalletScope,
        schedule: [u8; 32],
        signing_schedule: [u8; 32],
        signing_batches: usize,
    } => registration_core::queue::Status, Json;
    ActivateRegistration(activate_registration) {
        wallet: WalletScope,
        schedule: [u8; 32],
        signing_schedule: [u8; 32],
        signing_batches: usize,
    } => bool, Json;
    RetireRegistration(retire_registration) {
        job: registration_core::Job,
    } => registration_core::PreparationRetirement, Json;
    ReadyRegistration(ready_registration) {
        job: registration_core::Job,
        role: Participant,
    } => bool, Json;
    CheckRegistrationJob(check_registration_job) {
        job: registration_core::Job,
    } => bool, Json;
    ClaimRegistration(claim_registration) {
        request: registration_core::Request,
        schedule: [u8; 32],
    } => registration_core::Decision, Json;
    CheckRegistrationClaim(check_registration_claim) {
        claim: registration_core::Claim,
    } => bool, Json;
    FinishRegistration(finish_registration) {
        claim: registration_core::Claim,
        result: registration_core::Completed,
    } => registration_core::Operation, Json;
    ClaimRefill(claim_refill) {
        key: KeyScope,
        occupied: refill::OccupiedBatches,
    } => refill::Claim, Json;
    PendingRefills(pending_refills) {
        key: KeyScope,
    } => Vec<refill::Job>, Json;
    WithdrawRefill(withdraw_refill) {
        key: KeyScope,
    } => bool, Json;
    CheckRefill(check_refill) {
        job: refill::Job,
    } => bool, Json;
    FinishRefill(finish_refill) {
        job: refill::Job,
        outcome: refill::Outcome,
    } => Vec<KeyScope>, Json;
    AuthorizeKey(authorize_key) {
        activation: admission::KeyActivation,
    } => bool, Json;
    KeyState(key_state) {
        key: KeyScope,
    } => Option<admission::KeyState>, Json;
    CommitKey(commit_key) {
        activation: admission::KeyActivation,
    } => admission::KeyState, Json;
    ActiveKey(active_key) {
        key: KeyScope,
    } => Option<admission::KeyActivation>, Json;
    Preflight(preflight) {
        request: SigningRequest,
    } => admission::Preflight, Json;
    DeferEmpty(defer_empty) {
        request: SigningRequest,
        retry_at_ms: u64,
    } => Decision, Json;
    Begin(begin) {
        request: SigningRequest,
    } => Decision, Json;
    Admit(admit) {
        claim: Claim,
        batches: Vec<[u8; 32]>,
    } => Decision, Json;
    Cancel(cancel) {
        claim: Claim,
    } => bool, Json;
    AwaitStock(await_stock) {
        claim: Claim,
        retry_at_ms: u64,
    } => bool, Json;
    Finish(finish) {
        permit: Permit,
        completion: Completion,
    } => Status, Json;
    Settled(settled) {
        request: SigningRequest,
    } => bool, Json;
    Lookup(lookup) {
        request: SigningRequest,
    } => Option<Status>, Json;
}}
command_family! { RoleCommand, role_requests {
    InitializeRegistrationStorage(initialize_registration_storage) {
        claim: registration_core::Claim,
    } => bool, Json;
    InstallRegistrationStock(install_registration_stock) {
        claim: registration_core::Claim,
        delivery: RegistrationStockDelivery,
    } => bool, Json;
    StartRefill(start_refill) {
        job: refill::Job,
    } => Vec<u8>, Json;
    WakeRefill(wake_refill) {
        key: KeyScope,
    } => bool, Json;
    CheckMaterial(check_material) {
        activation: admission::KeyActivation,
    } => bool, Json;
    InstallMaterial(install_material) {
        record: material::Record,
    } => bool, Json;
    LoadSigningInputs(load_signing_inputs) {
        permit: Permit,
    } => material_delivery::SigningInputs, Inputs;
    PublicationRecorded(publication_recorded) {
        job: refill::Job,
    } => bool, Json;
    Inspect(inspect) {
        key: KeyScope,
        batches: Vec<[u8; 32]>,
    } => Vec<pool::BatchAvailability>, Json;
    RetireUnpaired(retire_unpaired) {
        key: KeyScope,
        batches: Vec<[u8; 32]>,
    } => bool, Json;
    Fence(fence) {
        request: SigningRequest,
        batches: Vec<[u8; 32]>,
    } => pool::FencedBatches, Json;
    RefillStatus(refill_status) {
        key: KeyScope,
    } => pool::RefillStatus, Json;
    Install(install) {
        key: KeyScope,
    } => bool, Json;
    Put(put) {
        job: refill::Job,
        batches: Vec<(Binding, Sealed)>,
    } => bool, Json;
    LiveInventory(live_inventory) {
        key: KeyScope,
        target: usize,
    } => pool::Inventory, Json;
    Inventory(inventory) {
        key: KeyScope,
        target: usize,
        ready_until_ms: u64,
    } => pool::Inventory, Json;
    Reserve(reserve) {
        claim: Claim,
        batches: Vec<[u8; 32]>,
    } => bool, Json;
    Take(take) {
        permit: Permit,
        batch: [u8; 32],
    } => (Binding, Sealed), Taken;
    Release(release) {
        request: SigningRequest,
        batches: Vec<[u8; 32]>,
        settlement: pool::Settlement,
        consumed_union: Vec<[u8; 32]>,
        unopened_intersection: Vec<[u8; 32]>,
    } => bool, Json;
}}
command_family! { RegistrationCommand, registration_requests {
    Prepare(prepare) {
        job: registration_core::Job,
    } => bool, Json;
    PreparePeer(prepare_peer) {
        job: registration_core::Job,
    } => worker::WebSocket, Upgrade;
    Execute(execute) {
        claim: registration_core::Claim,
    } => registration_core::ExecutionReply, Json;
    ExecutePeer(execute_peer) {
        claim: registration_core::Claim,
    } => worker::WebSocket, Upgrade;
    Install(install) {
        claim: registration_core::Claim,
    } => bool, Json;
    Result(result) {
        claim: registration_core::Claim,
    } => Option<registration_core::RoleResult>, Json;
}}

// Static API fixtures: constructing a request fixes its reply and its decoder.
const _: fn(SigningRequest) -> Request<AdmissionCommand, Option<Status>> =
    admission_requests::lookup;
const _: fn(KeyScope, usize) -> Request<RoleCommand, pool::Inventory> =
    role_requests::live_inventory;
const _: fn(Permit, [u8; 32]) -> Request<RoleCommand, (Binding, Sealed), Taken> =
    role_requests::take;
const _: fn(Permit) -> Request<RoleCommand, material_delivery::SigningInputs, Inputs> =
    role_requests::load_signing_inputs;
