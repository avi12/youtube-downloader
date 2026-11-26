//! The timestamped, file-appending log of the cherry-pick loop.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::io::AsyncWriteExt;

const DAYS_FROM_ERA_ORIGIN_TO_UNIX_EPOCH: u64 = 719_468;
const DAYS_PER_ERA: u64 = 146_097;
const LAST_DAY_OF_FOUR_YEARS: u64 = 1460;
const DAYS_PER_CENTURY: u64 = 36_524;
const LAST_DAY_OF_ERA: u64 = 146_096;
const DAYS_PER_COMMON_YEAR: u64 = 365;
const YEARS_PER_LEAP_CYCLE: u64 = 4;
const YEARS_PER_CENTURY: u64 = 100;
const MONTHS_PER_MARCH_CYCLE: u64 = 5;
const DAYS_PER_MARCH_CYCLE: u64 = 153;
const FIRST_JANUARY_MONTH_INDEX: u64 = 10;
const MARCH_MONTH_NUMBER: u64 = 3;
const JANUARY_INDEX_OFFSET: u64 = 9;
const YEARS_PER_ERA: u64 = 400;

const LOG_FILE: &str = "scripts/cherry-pick-loop.log";
const SECONDS_PER_DAY: u64 = 86_400;
const SECONDS_PER_HOUR: u64 = 3600;
const SECONDS_PER_MINUTE: u64 = 60;

/// `YYYY-MM-DDTHH:MM:SS.mmmZ`, UTC (civil-from-days after Howard Hinnant).
fn iso_timestamp(moment: SystemTime) -> String {
    let elapsed = moment.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = elapsed.as_secs();
    let shifted_days = seconds / SECONDS_PER_DAY + DAYS_FROM_ERA_ORIGIN_TO_UNIX_EPOCH;
    let era = shifted_days / DAYS_PER_ERA;
    let day_of_era = shifted_days % DAYS_PER_ERA;
    let year_of_era = (day_of_era - day_of_era / LAST_DAY_OF_FOUR_YEARS
        + day_of_era / DAYS_PER_CENTURY
        - day_of_era / LAST_DAY_OF_ERA)
        / DAYS_PER_COMMON_YEAR;
    let day_of_year = day_of_era
        - (DAYS_PER_COMMON_YEAR * year_of_era + year_of_era / YEARS_PER_LEAP_CYCLE
            - year_of_era / YEARS_PER_CENTURY);
    let month_index = (MONTHS_PER_MARCH_CYCLE * day_of_year + 2) / DAYS_PER_MARCH_CYCLE;
    let day = day_of_year - (DAYS_PER_MARCH_CYCLE * month_index + 2) / MONTHS_PER_MARCH_CYCLE + 1;
    let is_march_to_december = month_index < FIRST_JANUARY_MONTH_INDEX;
    let month = if is_march_to_december {
        month_index + MARCH_MONTH_NUMBER
    } else {
        month_index - JANUARY_INDEX_OFFSET
    };
    let year = year_of_era + era * YEARS_PER_ERA + u64::from(month <= 2);
    let time_of_day = seconds % SECONDS_PER_DAY;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time_of_day / SECONDS_PER_HOUR,
        time_of_day % SECONDS_PER_HOUR / SECONDS_PER_MINUTE,
        time_of_day % SECONDS_PER_MINUTE,
        elapsed.subsec_millis()
    )
}

pub(super) async fn log(line: &str) {
    let stamped = format!("[{}] {line}", iso_timestamp(SystemTime::now()));
    println!("{stamped}");
    append_line(Path::new(LOG_FILE), &stamped).await.ok();
}

async fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(format!("{line}\n").as_bytes()).await
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crate::release::download::log::*;

    const SAMPLE_UNIX_MILLIS: u64 = 1_700_000_000_123;

    #[test]
    fn timestamp_is_iso_utc() {
        let moment = UNIX_EPOCH + Duration::from_millis(SAMPLE_UNIX_MILLIS);
        assert_eq!(iso_timestamp(moment), "2023-11-14T22:13:20.123Z");
        assert_eq!(iso_timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
    }
}
