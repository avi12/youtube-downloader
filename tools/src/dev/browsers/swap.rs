//! Restarts the extension background in place with the rebuilt script, on Chrome and Firefox alike,
//! instead of reloading the extension (which orphans every content script in the open tabs). Port of
//! `scripts/dev/browsers/background-swap.ts`.
//!
//! Chrome keeps running a service worker from the script it cached at install, so once the worker
//! is stopped it would come back with the old code. A guard keeps the background awake with an
//! extension API call and re-applies the swapped script whenever it finds a background without it.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::Value;
use ytdl_dev_hot::types::ContentHash;

use crate::dev::browsers::error::Result;
use crate::dev::browsers::scripts::RUNNING_VERSION;
use crate::dev::browsers::target::ReloadTarget;

/// Under the 30 s after which an idle MV3 background is stopped.
const GUARD_INTERVAL: Duration = Duration::from_secs(20);

const VERSION_HEX_CHARS: usize = 16;

/// Where the swapper reports what the guard does.
pub(crate) type LogFn = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone)]
struct Swapped {
    script: String,
    version: String,
}

#[derive(Default)]
struct State {
    swapped: Option<Swapped>,
    is_guard_running: bool,
}

fn locked(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

fn version_of(script: &str) -> String {
    ContentHash::from_bytes(script.as_bytes())
        .prefix(VERSION_HEX_CHARS)
        .to_owned()
}

async fn apply_swapped(target: &dyn ReloadTarget, swapped: &Swapped) -> Result<()> {
    let version = Value::from(swapped.version.as_str());
    let script = format!(
        "{}\n;globalThis.ytdlDevBackground.version = {version};",
        swapped.script
    );
    target.run_script_in_background(&script).await
}

async fn check_background(target: &dyn ReloadTarget, log: &LogFn, swapped: &Swapped) {
    let Ok(running) = target.evaluate_in_background(RUNNING_VERSION).await else {
        return;
    };
    let is_already_swapped = running.as_str() == Some(swapped.version.as_str());
    if is_already_swapped {
        return;
    }
    log("The background restarted from the installed build - re-applying the swapped one");
    if let Err(error) = apply_swapped(target, swapped).await {
        log(&format!(
            "Re-applying the swapped background failed: {error}"
        ));
    }
}

async fn guard(target: Arc<dyn ReloadTarget>, log: LogFn, state: Arc<Mutex<State>>) {
    loop {
        tokio::time::sleep(GUARD_INTERVAL).await;
        let swapped = {
            let mut current = locked(&state);
            let Some(swapped) = current.swapped.clone() else {
                current.is_guard_running = false;
                return;
            };
            swapped
        };
        check_background(target.as_ref(), &log, &swapped).await;
    }
}

/// Swaps the background script of a target and keeps it swapped.
pub(crate) struct BackgroundSwapper {
    target: Arc<dyn ReloadTarget>,
    log: LogFn,
    state: Arc<Mutex<State>>,
}

impl BackgroundSwapper {
    /// A swapper over one target; `log` receives the guard's messages.
    pub(crate) fn new(target: Arc<dyn ReloadTarget>, log: LogFn) -> Self {
        Self {
            target,
            log,
            state: Arc::new(Mutex::new(State::default())),
        }
    }

    /// Runs the rebuilt background script in the running background and starts the guard.
    pub(crate) async fn swap(&self, script: &str) -> Result<()> {
        let swapped = Swapped {
            script: script.to_owned(),
            version: version_of(script),
        };
        locked(&self.state).swapped = Some(swapped.clone());
        apply_swapped(self.target.as_ref(), &swapped).await?;
        let mut state = locked(&self.state);
        if state.is_guard_running {
            return Ok(());
        }
        state.is_guard_running = true;
        tokio::spawn(guard(
            Arc::clone(&self.target),
            Arc::clone(&self.log),
            Arc::clone(&self.state),
        ));
        Ok(())
    }

    /// A full extension reload installs the current build, so there is nothing left to guard.
    pub(crate) fn forget(&self) {
        locked(&self.state).swapped = None;
    }
}

#[cfg(test)]
mod tests {
    use crate::dev::browsers::plan::fake::FakeTarget;
    use crate::dev::browsers::swap::*;

    #[test]
    fn version_follows_the_script() {
        assert_eq!(version_of("a"), version_of("a"));
        assert_ne!(version_of("a"), version_of("b"));
    }

    #[tokio::test]
    async fn swap_runs_the_script_with_its_version() {
        let fake = Arc::new(FakeTarget::default());
        let swapper = BackgroundSwapper::new(fake.clone(), Arc::new(|_| {}));
        swapper.swap("var swapped = 1").await.unwrap();
        let scripts = fake.scripts();
        let [script] = scripts.as_slice() else {
            panic!("expected one script, got {scripts:?}");
        };
        assert!(script.starts_with("var swapped = 1\n;globalThis.ytdlDevBackground.version = "));
        swapper.forget();
    }

    #[tokio::test]
    async fn a_background_on_another_version_gets_the_script_again() {
        let fake = FakeTarget::default();
        let log: LogFn = Arc::new(|_| {});
        let swapped = Swapped {
            script: "x".to_owned(),
            version: "v1".to_owned(),
        };
        check_background(&fake, &log, &swapped).await;
        assert_eq!(fake.scripts().len(), 1);
    }
}

#[cfg(test)]
mod version_tests {
    use crate::dev::browsers::swap::*;

    #[test]
    fn a_version_is_the_shared_content_hash_prefix() {
        assert_eq!(version_of("a"), version_of("a"));
        assert_ne!(version_of("a"), version_of("b"));
        assert_eq!(version_of("a").len(), VERSION_HEX_CHARS);
    }
}
