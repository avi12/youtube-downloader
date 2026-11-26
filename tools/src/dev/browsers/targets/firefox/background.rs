//! Evaluates code in the extension's background event page over RDP, waking it page-safely when
//! suspended through the privileged parent process. Port of
//! `scripts/dev/browsers/firefox/background.ts`, on the RDP client the `firefox` group shares.

use std::time::Duration;

use serde_json::Value;
use ytdl_dev_hot::driver::rdp::message::{
    wake_background_script, ActorId, EvaluateParams, GetProcessParams, GetWatcherParams, NoParams,
    PacketKind, RequestKind, WatchTargetsParams,
};
use ytdl_dev_hot::types::Port;

use crate::dev::browsers::error::{BrowserError, Result};
use crate::firefox::rdp::client::Rdp;
use crate::firefox::rdp::replies::{EvaluationReply, ProcessReply, TargetReply, WatcherEvent};

/// How long one reply of the debugger server may take.
const REPLY_TIMEOUT: Duration = Duration::from_secs(9);
/// A suspended event page never surfaces its real frame, only a devtools fallback page, so wait
/// briefly to see whether it is already awake, longer once it has been woken.
const AWAKE_BACKGROUND_WAIT: Duration = Duration::from_millis(2500);
const WOKEN_BACKGROUND_WAIT: Duration = Duration::from_millis(9000);
/// A string completion value, so the console reports a result for a script that returns nothing.
const SCRIPT_COMPLETED: &str = "completed";
/// The page Firefox wraps an MV3 `background.scripts` list in; other extension frames (the
/// offscreen iframe) surface on the same watcher.
const GENERATED_BACKGROUND_PAGE: &str = "_generated_background_page.html";

/// Which add-on's background to reach, and where.
#[derive(Debug, Clone, Copy)]
pub(super) struct BackgroundAddress<'a> {
    pub(super) port: Port,
    /// The gecko id, which is also RDP's add-on id.
    pub(super) extension_id: &'a str,
}

/// The parent process's console evaluates privileged code.
async fn find_parent_process_console(rdp: &mut Rdp) -> Result<Option<ActorId>> {
    let process = rdp
        .request(
            &ActorId::root(),
            RequestKind::GetProcess,
            &GetProcessParams::PARENT,
        )
        .await?;
    let descriptor = process
        .parse::<ProcessReply>()?
        .process_descriptor
        .and_then(|descriptor| descriptor.actor);
    let Some(actor) = descriptor else {
        return Ok(None);
    };
    let reply = rdp
        .request(&actor, RequestKind::GetTarget, &NoParams {})
        .await?;
    let target: TargetReply = reply.parse()?;
    Ok([target.process, target.frame]
        .into_iter()
        .flatten()
        .find_map(|holder| holder.console_actor))
}

/// Wakes a suspended background event page without touching any tab: privileged main-process code
/// (`WebExtensionPolicy`) can, and Firefox honours it because the dev server launches it with
/// `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`. The reply is not awaited: the target announcements that
/// follow are what the caller waits for.
async fn wake_extension_background(rdp: &mut Rdp, extension_id: &str) {
    let Ok(Some(console)) = find_parent_process_console(rdp).await else {
        return;
    };
    let text = wake_background_script(extension_id);
    rdp.send(
        &console,
        RequestKind::EvaluateJsAsync,
        &EvaluateParams::new(&text),
    )
    .await
    .ok();
}

async fn wait_for_background_frame_console(
    rdp: &mut Rdp,
    watcher: &ActorId,
    page_url: &str,
    limit: Duration,
) -> Option<ActorId> {
    let announcement = rdp
        .wait_matching(watcher, limit, |message| {
            message.kind == Some(PacketKind::TargetAvailable)
                && message
                    .parse::<WatcherEvent>()
                    .ok()
                    .and_then(|event| event.target)
                    .is_some_and(|target| target.url.as_deref() == Some(page_url))
        })
        .await
        .ok()?;
    announcement
        .parse::<WatcherEvent>()
        .ok()?
        .target?
        .console_actor
}

/// The watcher of the add-on and the URL of its generated background page.
async fn find_addon_watcher(
    rdp: &mut Rdp,
    extension_id: &str,
) -> Result<Option<(ActorId, String)>> {
    let addons = rdp.addons().await?;
    let found = addons
        .into_iter()
        .find(|addon| addon.id.as_deref() == Some(extension_id));
    let Some((actor, manifest_url)) = found.and_then(|addon| addon.actor.zip(addon.manifest_url))
    else {
        return Ok(None);
    };
    let reply = rdp
        .request(
            &actor,
            RequestKind::GetWatcher,
            &GetWatcherParams::SWITCHING_TARGETS,
        )
        .await?;
    let Some(watcher_actor) = reply.parse::<WatcherEvent>()?.actor else {
        return Ok(None);
    };
    let (base, _manifest) = manifest_url
        .rsplit_once('/')
        .unwrap_or((manifest_url.as_str(), ""));
    Ok(Some((
        watcher_actor,
        format!("{base}/{GENERATED_BACKGROUND_PAGE}"),
    )))
}

async fn find_background_console(rdp: &mut Rdp, extension_id: &str) -> Result<Option<ActorId>> {
    let Some((watcher, page_url)) = find_addon_watcher(rdp, extension_id).await? else {
        return Ok(None);
    };
    rdp.send(
        &watcher,
        RequestKind::WatchTargets,
        &WatchTargetsParams::FRAMES,
    )
    .await?;
    if let Some(console) =
        wait_for_background_frame_console(rdp, &watcher, &page_url, AWAKE_BACKGROUND_WAIT).await
    {
        return Ok(Some(console));
    }
    wake_extension_background(rdp, extension_id).await;
    Ok(wait_for_background_frame_console(rdp, &watcher, &page_url, WOKEN_BACKGROUND_WAIT).await)
}

/// `is_awaited` makes `evaluateJSAsync` await the returned promise, as the console does for
/// top-level await input; a whole script goes without it, so its `var`s land on the global.
async fn evaluate_in_console(
    rdp: &mut Rdp,
    console: &ActorId,
    text: &str,
    is_awaited: bool,
) -> Result<String> {
    let reply = if is_awaited {
        rdp.evaluate_awaiting(console, text, REPLY_TIMEOUT).await?
    } else {
        rdp.evaluate(console, text, REPLY_TIMEOUT).await?
    };
    let EvaluationReply {
        result,
        exception_message,
    } = reply.parse()?;
    match result {
        Some(Value::String(result)) => Ok(result),
        _ => Err(BrowserError::Exception(
            exception_message
                .as_ref()
                .and_then(Value::as_str)
                .unwrap_or("the background returned no result")
                .to_owned(),
        )),
    }
}

async fn evaluate_text(
    address: BackgroundAddress<'_>,
    text: &str,
    is_awaited: bool,
) -> Result<String> {
    let mut rdp = Rdp::connect(address.port.get(), REPLY_TIMEOUT).await?;
    let console = find_background_console(&mut rdp, address.extension_id)
        .await?
        .ok_or_else(|| {
            BrowserError::Protocol("the extension's background page is not reachable".to_owned())
        })?;
    tokio::time::timeout(
        REPLY_TIMEOUT,
        evaluate_in_console(&mut rdp, &console, text, is_awaited),
    )
    .await
    .map_err(|_| BrowserError::Timeout("the background's evaluation"))?
}

/// Evaluates a source string that resolves to a JSON-serializable value in the background.
pub(super) async fn evaluate_in_background(
    address: BackgroundAddress<'_>,
    source: &str,
) -> Result<Value> {
    let text = format!("(async () => JSON.stringify(await {source}))()");
    let result = evaluate_text(address, &text, true).await?;
    Ok(serde_json::from_str(&result)?)
}

/// Runs a whole classic script in the background page's global scope.
pub(super) async fn run_script_in_background(
    address: BackgroundAddress<'_>,
    script: &str,
) -> Result<()> {
    let completion = Value::from(SCRIPT_COMPLETED);
    evaluate_text(address, &format!("{script}\n;{completion}"), false).await?;
    Ok(())
}
