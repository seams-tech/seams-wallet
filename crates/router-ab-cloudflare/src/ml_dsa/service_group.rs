//! Public placement identity. Group zero retains the original object names.
use super::*;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct ServiceGroup(u8);
impl TryFrom<u8> for ServiceGroup {
    type Error = RouterAbProtocolError;
    fn try_from(value: u8) -> Result<Self> {
        if value >= 64 {
            return Err(invalid(
                "ML-DSA service group is outside the deployment bound",
            ));
        }
        Ok(Self(value))
    }
}
impl From<ServiceGroup> for u8 {
    fn from(value: ServiceGroup) -> Self {
        value.0
    }
}
impl ServiceGroup {
    pub fn admission_name(self) -> String {
        self.object_name("ml-dsa-admission-v1")
    }
    pub fn producer_name(self) -> String {
        self.object_name("ml-dsa-producer-v1")
    }
    fn object_name(self, base: &str) -> String {
        if self.0 == 0 {
            base.to_owned()
        } else {
            format!("{base}-group-{}", self.0)
        }
    }
}
