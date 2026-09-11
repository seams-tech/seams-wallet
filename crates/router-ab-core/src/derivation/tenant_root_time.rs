//! Wall-clock helpers for tenant-root console records.
//!
//! Every signed wall-clock field in the tenant-root console contracts is an
//! RFC 3339 UTC string with exactly millisecond precision and a trailing `Z`.
//! Ordering decisions still belong to monotonic revisions and epochs; these
//! helpers exist so freshness and validity *windows* can be checked exactly.

use super::tenant_root_recovery_artifacts::{malformed_owned, validate_rfc3339_millis};
use super::RouterAbDerivationResult;

/// Converts one RFC 3339 millisecond timestamp to epoch milliseconds.
///
/// The shape validator accepts a day out of range for its month (February 31,
/// say), so this rejects those before converting: a timestamp that is not a
/// real instant must never compare as valid.
pub(super) fn epoch_millis(value: &str, field: &'static str) -> RouterAbDerivationResult<i64> {
    validate_rfc3339_millis(value, field)?;
    let bytes = value.as_bytes();
    let year = i64::from(parse_number(&bytes[0..4]));
    let month = i64::from(parse_number(&bytes[5..7]));
    let day = i64::from(parse_number(&bytes[8..10]));
    let hour = i64::from(parse_number(&bytes[11..13]));
    let minute = i64::from(parse_number(&bytes[14..16]));
    let second = i64::from(parse_number(&bytes[17..19]));
    let millis = i64::from(parse_number(&bytes[20..23]));
    if day > days_in_month(year, month) {
        return Err(malformed_owned(format!(
            "{field} names a day that does not exist in its month"
        )));
    }
    let days = days_from_civil(year, month, day);
    Ok(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1_000 + millis)
}

fn parse_number(bytes: &[u8]) -> u32 {
    bytes
        .iter()
        .fold(0_u32, |value, digit| value * 10 + u32::from(digit - b'0'))
}

const fn is_leap_year(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

const fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
    }
}

/// Days from 1970-01-01 for one proleptic Gregorian date (Howard Hinnant's algorithm).
const fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
