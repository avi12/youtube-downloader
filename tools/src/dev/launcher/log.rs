//! The log line format of the dev server, `[2:05:33 PM] message`, for its own lines and for the
//! `tracing` events the hot loop library emits.

use std::fmt::{self, Debug, Write};

use jiff::Zoned;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};

use super::error::{LauncherError, Result};

const MILLISECONDS_PER_TENTH: u64 = 100;
const TENTHS_PER_SECOND: u64 = 10;
const HALF_TENTH_MILLISECONDS: u64 = 50;
const MESSAGE_FIELD: &str = "message";

/// Prints one timestamped line.
pub(super) fn log_event(message: &str) {
    println!("[{}] {message}", Zoned::now().strftime("%-I:%M:%S %p"));
}

/// Seconds with at most one decimal, the way `1.2s` and `3s` read.
pub(super) fn format_elapsed(elapsed_milliseconds: u64) -> String {
    let tenths =
        elapsed_milliseconds.saturating_add(HALF_TENTH_MILLISECONDS) / MILLISECONDS_PER_TENTH;
    let (seconds, fraction) = (tenths / TENTHS_PER_SECOND, tenths % TENTHS_PER_SECOND);
    if fraction == 0 {
        return format!("{seconds}s");
    }
    format!("{seconds}.{fraction}s")
}

#[derive(Default)]
struct MessageVisitor {
    text: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        if field.name() == MESSAGE_FIELD {
            // Writing into a String cannot fail
            let _ = write!(self.text, "{value:?}");
        }
    }
}

impl fmt::Display for MessageVisitor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.text)
    }
}

struct PrintLayer;

impl<S: Subscriber> Layer<S> for PrintLayer {
    fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let level = *event.metadata().level();
        if level <= Level::WARN {
            log_event(&format!("{level} {visitor}"));
            return;
        }
        log_event(&visitor.to_string());
    }
}

/// Routes the library's `tracing` events through [`log_event`].
pub(super) fn install_log_layer() -> Result<()> {
    tracing::subscriber::set_global_default(tracing_subscriber::registry().with(PrintLayer))
        .map_err(|error| LauncherError::Invalid(format!("logging: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elapsed_time_keeps_one_decimal() {
        assert_eq!(format_elapsed(0), "0s");
        assert_eq!(format_elapsed(84), "0.1s");
        assert_eq!(format_elapsed(1_240), "1.2s");
        assert_eq!(format_elapsed(3_000), "3s");
        assert_eq!(format_elapsed(2_960), "3s");
    }
}
