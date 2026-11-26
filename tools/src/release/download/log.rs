//! The timestamped, file-appending log of the cherry-pick loop.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::io::AsyncWriteExt;

const LOG_FILE: &str = "scripts/cherry-pick-loop.log";
const SECONDS_PER_DAY: u64 = 86_400;
const SECONDS_PER_HOUR: u64 = 3600;
const SECONDS_PER_MINUTE: u64 = 60;

/// `YYYY-MM-DDTHH:MM:SS.mmmZ`, UTC (civil-from-days after Howard Hinnant).
fn iso_timestamp(moment: SystemTime) -> String {
    let elapsed = moment.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = elapsed.as_secs();
    let shifted_days = seconds / SECONDS_PER_DAY + 719_468;
    let era = shifted_days / 146_097;
    let day_of_era = shifted_days % 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + u64::from(month <= 2);
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

    #[test]
    fn timestamp_is_iso_utc() {
        let moment = UNIX_EPOCH + Duration::from_millis(1_700_000_000_123);
        assert_eq!(iso_timestamp(moment), "2023-11-14T22:13:20.123Z");
        assert_eq!(iso_timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
    }
}
