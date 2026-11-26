//! [`BridgeClient`]: the [`Host`] as seen over the bridge.

mod correlator;

use std::sync::Arc;

use serde::de::DeserializeOwned;
use tokio::sync::mpsc;

pub(crate) use correlator::Correlator;

use crate::bridge::logging::BridgeLogLayer;
use crate::bridge::protocol::{
    EntrypointLayout, HostRequest, OutboundMessage, RebuildHmrResult, ReloadExtensionParams,
    RequestEnvelope,
};
use crate::bridge::Host;
use crate::error::{Error, Result};

/// The host as seen over the bridge: writes request lines into the outbound queue and awaits the
/// response with the same id. Cheap to clone.
#[derive(Debug, Clone)]
pub struct BridgeClient {
    outbound: mpsc::Sender<OutboundMessage>,
    correlator: Arc<Correlator>,
}

impl BridgeClient {
    /// A client writing into `outbound` and resolving through `correlator`.
    pub(crate) const fn new(
        outbound: mpsc::Sender<OutboundMessage>,
        correlator: Arc<Correlator>,
    ) -> Self {
        Self {
            outbound,
            correlator,
        }
    }

    /// The tracing layer that routes logs through this bridge.
    pub fn log_layer(&self) -> BridgeLogLayer {
        BridgeLogLayer::new(self.outbound.clone())
    }

    async fn call<T: DeserializeOwned>(&self, request: HostRequest) -> Result<T> {
        let (id, receiver) = self.correlator.register();
        let envelope = OutboundMessage::Request(RequestEnvelope { id, request });
        if self.outbound.send(envelope).await.is_err() {
            self.correlator.forget(id);
            return Err(Error::BridgeClosed);
        }
        let value = receiver.await.map_err(|_| Error::BridgeClosed)??;
        Ok(serde_json::from_value(value)?)
    }
}

impl Host for BridgeClient {
    async fn build_extension(&self) -> Result<Option<EntrypointLayout>> {
        self.call(HostRequest::BuildExtension).await
    }

    async fn rebuild_hmr(&self) -> Result<RebuildHmrResult> {
        self.call(HostRequest::RebuildHmr).await
    }

    async fn reload_extension(&self, parameters: ReloadExtensionParams) -> Result<()> {
        self.call(HostRequest::ReloadExtension(parameters)).await
    }

    async fn inject_hmr(&self) -> Result<bool> {
        self.call(HostRequest::InjectHmr).await
    }

    async fn refresh_env(&self) -> Result<()> {
        self.call(HostRequest::RefreshEnv).await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use crate::bridge::client::*;
    use crate::bridge::protocol::Response;
    use crate::bridge::BRIDGE_CHANNEL_CAPACITY;

    fn client() -> (
        BridgeClient,
        mpsc::Receiver<OutboundMessage>,
        Arc<Correlator>,
    ) {
        let (outbound, written) = mpsc::channel(BRIDGE_CHANNEL_CAPACITY);
        let correlator = Arc::new(Correlator::default());
        let client = BridgeClient::new(outbound, Arc::clone(&correlator));
        (client, written, correlator)
    }

    #[tokio::test]
    async fn a_response_reaches_the_call_with_its_id() -> Result<()> {
        let (client, mut written, correlator) = client();
        let call = tokio::spawn(async move { client.inject_hmr().await });
        let Some(OutboundMessage::Request(request)) = written.recv().await else {
            return Err(Error::BridgeClosed);
        };
        assert_eq!(request.request, HostRequest::InjectHmr);
        let response = Response {
            id: request.id,
            result: Some(Value::Bool(true)),
            error: None,
        };
        assert!(correlator.resolve(response));
        assert!(call.await.map_err(|_| Error::BridgeClosed)??);
        Ok(())
    }

    #[tokio::test]
    async fn closing_fails_pending_calls() -> Result<()> {
        let (client, _written, correlator) = client();
        let call = tokio::spawn(async move { client.refresh_env().await });
        tokio::task::yield_now().await;
        correlator.fail_all();
        assert!(matches!(
            call.await.map_err(|_| Error::BridgeClosed)?,
            Err(Error::BridgeClosed)
        ));
        Ok(())
    }
}
