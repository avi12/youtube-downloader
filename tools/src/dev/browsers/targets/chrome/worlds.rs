//! Shuts down the isolated worlds an extension reload orphaned in open tabs, from the outside over
//! CDP. Port of `scripts/dev/browsers/chrome/worlds.ts`.

use serde::Deserialize;
use serde_json::json;
use ytdl_dev_hot::driver::cdp::CdpTarget;

use crate::cdp::wire::{ContextEvaluation, Method, Session};
use crate::dev::browsers::error::{BrowserError, Result};
use crate::dev::browsers::scripts::{
    INVOKE_STARTED_LISTENER, ORPHANED_WORLD_PROBE, REMOVE_LISTENER,
    WXT_SCRIPT_STARTED_EVENT_SUFFIX, WXT_SCRIPT_STARTED_MESSAGE_ID,
};

const ISOLATED_WORLD_TYPE: &str = "isolated";
/// `DOMDebugger` hands back listener functions only for objects that belong to an object group.
const OBJECT_GROUP: &str = "ytdl-dev-server";
const WORLD_ROOTS: [&str; 2] = ["document", "window"];

#[derive(Debug, Deserialize)]
struct RemoteObject {
    #[serde(rename = "objectId")]
    object_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EvaluateReply {
    result: RemoteObject,
}

#[derive(Debug, Deserialize)]
struct ProbeReply {
    result: ProbeValue,
}

#[derive(Debug, Deserialize)]
struct ProbeValue {
    value: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ListenersReply {
    listeners: Vec<ListenerInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListenerInfo {
    #[serde(rename = "type")]
    kind: String,
    use_capture: bool,
    handler: Option<RemoteObject>,
    original_handler: Option<RemoteObject>,
}

struct Listener {
    kind: String,
    use_capture: bool,
    handler_object_id: String,
}

impl ListenerInfo {
    fn into_listener(self) -> Option<Listener> {
        let handler_object_id = self
            .original_handler
            .or(self.handler)
            .and_then(|handler| handler.object_id)?;
        Some(Listener {
            kind: self.kind,
            use_capture: self.use_capture,
            handler_object_id,
        })
    }
}

async fn list_world_listeners(session: &mut Session, object_id: &str) -> Result<Vec<Listener>> {
    let reply = session
        .call(
            Method::DomDebuggerGetEventListeners,
            json!({ "objectId": object_id }),
        )
        .await?;
    let reply: ListenersReply = serde_json::from_value(reply)?;
    Ok(reply
        .listeners
        .into_iter()
        .filter_map(ListenerInfo::into_listener)
        .collect())
}

/// Invalidates the world's WXT content-script contexts, which unmounts every UI and runs every
/// `onInvalidated` cleanup the scripts registered.
async fn invalidate_wxt_contexts(session: &mut Session, object_id: &str) -> Result<()> {
    for listener in list_world_listeners(session, object_id).await? {
        if !listener.kind.ends_with(WXT_SCRIPT_STARTED_EVENT_SUFFIX) {
            continue;
        }
        let script_name = listener.kind.split(':').nth(1).unwrap_or_default();
        let parameters = json!({
            "objectId": object_id,
            "functionDeclaration": INVOKE_STARTED_LISTENER.trim(),
            "arguments": [
                { "objectId": listener.handler_object_id },
                { "value": listener.kind },
                { "value": script_name },
                { "value": WXT_SCRIPT_STARTED_MESSAGE_ID },
            ],
        });
        session
            .call(Method::RuntimeCallFunctionOn, parameters)
            .await?;
    }
    Ok(())
}

async fn remove_world_listeners(session: &mut Session, object_id: &str) -> Result<()> {
    for listener in list_world_listeners(session, object_id).await? {
        let parameters = json!({
            "objectId": object_id,
            "functionDeclaration": REMOVE_LISTENER.trim(),
            "arguments": [
                { "value": listener.kind },
                { "objectId": listener.handler_object_id },
                { "value": listener.use_capture },
            ],
        });
        session
            .call(Method::RuntimeCallFunctionOn, parameters)
            .await?;
    }
    Ok(())
}

/// Shuts an orphaned world down from the outside: invalidates its WXT contexts, then removes every
/// listener it still has on document and window, so it can't answer the page's cross-world
/// messages alongside the fresh copy. `DOMDebugger` reports only the listeners whose handler lives in
/// the queried object's own world, so the page's and the fresh copy's listeners are never touched.
async fn neutralize_world(session: &mut Session, context_id: u64) -> Result<()> {
    for expression in WORLD_ROOTS {
        let reply = session
            .evaluate_in(ContextEvaluation {
                expression,
                context_id,
                group: Some(OBJECT_GROUP),
            })
            .await?;
        let reply: EvaluateReply = serde_json::from_value(reply)?;
        let Some(object_id) = reply.result.object_id else {
            continue;
        };
        invalidate_wxt_contexts(session, &object_id).await?;
        remove_world_listeners(session, &object_id).await?;
    }
    Ok(())
}

async fn is_orphaned(session: &mut Session, context_id: u64) -> Result<bool> {
    let reply = session
        .evaluate_in(ContextEvaluation {
            expression: ORPHANED_WORLD_PROBE.trim(),
            context_id,
            group: None,
        })
        .await?;
    let reply: ProbeReply = serde_json::from_value(reply)?;
    Ok(reply.result.value.unwrap_or(false))
}

async fn neutralize_contexts(session: &mut Session, world_name: &str) -> Result<()> {
    session.call(Method::RuntimeEnable, json!({})).await?;
    let worlds: Vec<u64> = session
        .execution_contexts()
        .iter()
        .filter(|context| context.aux.kind == ISOLATED_WORLD_TYPE && context.name == world_name)
        .map(|context| context.id)
        .collect();
    for context_id in worlds {
        if is_orphaned(session, context_id).await? {
            neutralize_world(session, context_id).await?;
        }
    }
    Ok(())
}

/// Neutralizes every orphaned isolated world of the extension in one page.
pub(super) async fn neutralize_orphaned_worlds_in_page(
    page: &CdpTarget,
    world_name: &str,
) -> Result<()> {
    let url = page
        .debugger_url()
        .ok_or_else(|| BrowserError::Protocol(format!("{} has no debugger URL", page.id)))?;
    let mut session = Session::open(url).await?;
    let outcome = neutralize_contexts(&mut session, world_name).await;
    session.close().await;
    outcome
}
