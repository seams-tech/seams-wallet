//! Decimal strings preserve SQL integers across JavaScript storage bindings.

use serde::{Deserialize, Deserializer, Serializer};

pub(super) fn serialize<S: Serializer>(value: &i64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}

pub(super) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    let decimal = String::deserialize(deserializer)?;
    let value: i64 = decimal.parse().map_err(serde::de::Error::custom)?;
    if value.to_string() != decimal {
        return Err(serde::de::Error::custom("SQL integer is not canonical decimal"));
    }
    Ok(value)
}
