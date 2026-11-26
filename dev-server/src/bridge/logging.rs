//! Logs as bridge messages: a `tracing` layer that turns every event into a `{"log": "..."}` line
//! for TypeScript's `logEvent`, so nothing in the sidecar prints to stdout (which is the bridge).

use std::fmt::{self, Debug, Write};

use tokio::sync::mpsc;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};

use crate::bridge::protocol::{LogLine, OutboundMessage};
use crate::error::{Error, Result};

/// Forwards `tracing` events into the bridge's outbound queue. A full queue drops the line: a log
/// must never block the hot loop.
#[derive(Debug, Clone)]
pub struct BridgeLogLayer {
    sender: mpsc::Sender<OutboundMessage>,
}

impl BridgeLogLayer {
    /// A layer writing into `sender`.
    pub const fn new(sender: mpsc::Sender<OutboundMessage>) -> Self {
        Self { sender }
    }
}

/// The `tracing` field that holds an event's formatted message.
const MESSAGE_FIELD: &str = "message";

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

impl<S: Subscriber> Layer<S> for BridgeLogLayer {
    fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let level = *event.metadata().level();
        let log = if level <= Level::WARN {
            format!("{level} {visitor}")
        } else {
            visitor.to_string()
        };
        let _ = self.sender.try_send(OutboundMessage::Log(LogLine { log }));
    }
}

/// Installs `layer` as the global subscriber.
pub fn install(layer: BridgeLogLayer) -> Result<()> {
    tracing::subscriber::set_global_default(tracing_subscriber::registry().with(layer))
        .map_err(|error| Error::Logging(error.to_string()))
}

#[cfg(test)]
mod tests {
    use tracing::subscriber::with_default;

    use crate::bridge::logging::*;

    #[test]
    fn an_event_becomes_a_log_line() {
        let (sender, mut receiver) = mpsc::channel(4);
        let subscriber = tracing_subscriber::registry().with(BridgeLogLayer::new(sender));
        with_default(subscriber, || tracing::info!("Hot-swapped"));
        let message = receiver.try_recv().ok();
        assert_eq!(
            message,
            Some(OutboundMessage::Log(LogLine {
                log: "Hot-swapped".into()
            }))
        );
    }

    #[test]
    fn a_warning_carries_its_level() {
        let (sender, mut receiver) = mpsc::channel(4);
        let subscriber = tracing_subscriber::registry().with(BridgeLogLayer::new(sender));
        with_default(subscriber, || tracing::warn!("slow"));
        let message = receiver.try_recv().ok();
        assert_eq!(
            message,
            Some(OutboundMessage::Log(LogLine {
                log: "WARN slow".into()
            }))
        );
    }
}
