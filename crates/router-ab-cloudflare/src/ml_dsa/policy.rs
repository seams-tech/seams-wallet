//! Deployment policy is independent of replay and one-use enforcement.
use super::*;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum WalletCooldown {
    Disabled,
    Enabled { interval_ms: u64 },
}

/// Public, deployment-fixed width of each independently consumed signing group.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(try_from = "u16", into = "u16")]
enum CandidateGroupSize {
    Two,
    Four,
    Eight,
}
impl TryFrom<u16> for CandidateGroupSize {
    type Error = RouterAbProtocolError;

    fn try_from(value: u16) -> Result<Self> {
        match value {
            2 => Ok(Self::Two),
            4 => Ok(Self::Four),
            8 => Ok(Self::Eight),
            _ => Err(invalid(
                "ML-DSA candidate groups must contain 2, 4, or 8 candidates",
            )),
        }
    }
}
impl From<CandidateGroupSize> for u16 {
    fn from(value: CandidateGroupSize) -> Self {
        match value {
            CandidateGroupSize::Two => 2,
            CandidateGroupSize::Four => 4,
            CandidateGroupSize::Eight => 8,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(try_from = "PolicyWire")]
pub struct Policy {
    pub(crate) service_groups: u8,
    pub(crate) wallet_cooldown: WalletCooldown,
    pub(crate) max_active_operations: usize,
    pub(crate) max_active_preparations: usize,
    pub(crate) operation_timeout_ms: u64,
    candidate_group_size: CandidateGroupSize,
    preparation_group_size: CandidateGroupSize,
    pub(crate) minimum_ready_batches: usize,
    pub(crate) refill_target_batches: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyWire {
    #[serde(default = "single_service_group")]
    service_groups: u8,
    wallet_cooldown: WalletCooldown,
    max_active_operations: usize,
    #[serde(default = "serial_preparation")]
    max_active_preparations: usize,
    operation_timeout_ms: u64,
    candidate_group_size: CandidateGroupSize,
    preparation_group_size: CandidateGroupSize,
    minimum_ready_batches: usize,
    refill_target_batches: usize,
}
const fn single_service_group() -> u8 {
    1
}
const fn serial_preparation() -> usize {
    1
}

impl TryFrom<PolicyWire> for Policy {
    type Error = RouterAbProtocolError;
    fn try_from(value: PolicyWire) -> Result<Self> {
        let consumed = u16::from(value.candidate_group_size);
        let prepared = u16::from(value.preparation_group_size);
        if !(1..=64).contains(&value.service_groups)
            || matches!(
                value.wallet_cooldown,
                WalletCooldown::Enabled { interval_ms: 0 }
            )
            || value.max_active_operations == 0
            || value.max_active_operations > 64
            || !(1..=2).contains(&value.max_active_preparations)
            || !(1_000..=300_000).contains(&value.operation_timeout_ms)
            || value.minimum_ready_batches == 0
            || value.minimum_ready_batches > value.refill_target_batches
            || value.refill_target_batches > 20
            || !(prepared == consumed || (prepared == 4 && consumed == 2))
        {
            return Err(invalid("Invalid ML-DSA admission policy"));
        }
        Ok(Self {
            service_groups: value.service_groups,
            wallet_cooldown: value.wallet_cooldown,
            max_active_operations: value.max_active_operations,
            max_active_preparations: value.max_active_preparations,
            operation_timeout_ms: value.operation_timeout_ms,
            candidate_group_size: value.candidate_group_size,
            preparation_group_size: value.preparation_group_size,
            minimum_ready_batches: value.minimum_ready_batches,
            refill_target_batches: value.refill_target_batches,
        })
    }
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            service_groups: single_service_group(),
            wallet_cooldown: WalletCooldown::Enabled {
                interval_ms: 60_000,
            },
            max_active_operations: 1,
            max_active_preparations: serial_preparation(),
            operation_timeout_ms: 30_000,
            candidate_group_size: CandidateGroupSize::Two,
            preparation_group_size: CandidateGroupSize::Four,
            minimum_ready_batches: 8,
            refill_target_batches: 16,
        }
    }
}
impl Policy {
    pub fn parse(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|_| invalid("Invalid ML-DSA admission policy JSON"))
    }
    pub fn cooldown(&self) -> &WalletCooldown {
        &self.wallet_cooldown
    }
    pub fn candidate_group_size(&self) -> u16 {
        self.candidate_group_size.into()
    }
    pub fn preparation_groups(&self, available: usize) -> refill::Groups {
        if u16::from(self.preparation_group_size) > self.candidate_group_size() && available >= 2 {
            refill::Groups::Two
        } else {
            refill::Groups::One
        }
    }
    pub fn minimum_ready_batches(&self) -> usize {
        self.minimum_ready_batches
    }
    pub fn refill_target_batches(&self) -> usize {
        self.refill_target_batches
    }
    pub fn deadline(&self, now_ms: u64) -> Result<u64> {
        now_ms
            .checked_add(self.operation_timeout_ms)
            .ok_or_else(|| invalid("ML-DSA deadline overflow"))
    }
    pub(crate) fn next_admission(&self, now_ms: u64) -> Result<u64> {
        let interval = match self.wallet_cooldown {
            WalletCooldown::Disabled => 0,
            WalletCooldown::Enabled { interval_ms } => interval_ms,
        };
        now_ms
            .checked_add(interval)
            .ok_or_else(|| invalid("ML-DSA cooldown overflow"))
    }
}
