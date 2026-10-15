//! Deployment policy is independent of replay and one-use enforcement.
use super::*;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum WalletCooldown {
    Disabled,
    Enabled { interval_ms: u64 },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(try_from = "PolicyWire")]
pub struct Policy {
    pub(crate) wallet_cooldown: WalletCooldown,
    pub(crate) max_active_operations: usize,
    pub(crate) operation_timeout_ms: u64,
    pub(crate) minimum_ready_batches: usize,
    pub(crate) refill_target_batches: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyWire {
    wallet_cooldown: WalletCooldown,
    max_active_operations: usize,
    operation_timeout_ms: u64,
    minimum_ready_batches: usize,
    refill_target_batches: usize,
}
impl TryFrom<PolicyWire> for Policy {
    type Error = RouterAbProtocolError;
    fn try_from(value: PolicyWire) -> Result<Self> {
        if matches!(
            value.wallet_cooldown,
            WalletCooldown::Enabled { interval_ms: 0 }
        ) || value.max_active_operations == 0
            || value.max_active_operations > 64
            || !(1_000..=300_000).contains(&value.operation_timeout_ms)
            || value.minimum_ready_batches == 0
            || value.minimum_ready_batches > value.refill_target_batches
            || value.refill_target_batches > 20
        {
            return Err(invalid("Invalid ML-DSA admission policy"));
        }
        Ok(Self {
            wallet_cooldown: value.wallet_cooldown,
            max_active_operations: value.max_active_operations,
            operation_timeout_ms: value.operation_timeout_ms,
            minimum_ready_batches: value.minimum_ready_batches,
            refill_target_batches: value.refill_target_batches,
        })
    }
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            wallet_cooldown: WalletCooldown::Enabled {
                interval_ms: 60_000,
            },
            max_active_operations: 1,
            operation_timeout_ms: 30_000,
            minimum_ready_batches: 2,
            refill_target_batches: 10,
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
