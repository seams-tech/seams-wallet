//! Wall-clock helpers for tenant-root console records.
//!
//! Every signed wall-clock field in the tenant-root console contracts is an
//! RFC 3339 UTC string with exactly millisecond precision and a trailing `Z`.
//! Ordering decisions still belong to monotonic revisions and epochs; these
//! helpers exist so freshness and validity *windows* can be checked exactly.

use super::tenant_root_recovery_artifacts::{malformed, malformed_owned, validate_rfc3339_millis};
use super::RouterAbDerivationResult;

/// Formats one instant as the RFC 3339 millisecond UTC form these contracts
/// sign, `YYYY-MM-DDTHH:MM:SS.mmmZ`: the same string JavaScript's
/// `Date.prototype.toISOString` gives for it, on any host.
pub fn format_tenant_root_rfc3339_millis_v1(epoch_millis: u64) -> RouterAbDerivationResult<String> {
    let epoch_millis = i64::try_from(epoch_millis)
        .map_err(|_| malformed("tenant-root timestamp is out of range"))?;
    let (days, millis_of_day) = (epoch_millis / 86_400_000, epoch_millis % 86_400_000);
    let (year, month, day) = civil_from_days(days);
    if !(0..=9999).contains(&year) {
        return Err(malformed("tenant-root timestamp is outside four-digit years"));
    }
    let formatted = format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        millis_of_day / 3_600_000,
        millis_of_day / 60_000 % 60,
        millis_of_day / 1_000 % 60,
        millis_of_day % 1_000,
    );
    validate_rfc3339_millis(&formatted, "tenant-root timestamp")?;
    Ok(formatted)
}

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

/// The proleptic Gregorian date of one day from 1970-01-01 (Howard Hinnant's
/// algorithm), the inverse of `days_from_civil`.
const fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}
