//! The full extension reload, postponed while downloads run since it would kill them. A postponed
//! reload waits on its own task, so later rebuilds keep applying, and the reloads asked for in the
//! meantime join it.

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::dev::browsers::error::{BrowserError, Result};
use crate::dev::browsers::scripts;
use crate::dev::browsers::swap::{BackgroundSwapper, LogFn};
use crate::dev::browsers::target::ReloadTarget;
use crate::output::reload::{
    describe_extension_reload, describe_postponed_reload, ExtensionReloadPlan, TabUpdateResult,
};

/// How long one evaluation listens for the downloads to end before it is asked again: under the
/// reply timeouts of both debugging protocols.
const DOWNLOADS_WAIT: Duration = Duration::from_secs(5);
const FAILED_CHECK_RETRY_DELAY: Duration = Duration::from_secs(1);
/// A background that stays unreachable has no downloads left to protect.
const MAX_FAILED_CHECKS: u32 = 3;
const APPLIED_PREFIX: &str = "Applied the postponed reload";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Downloads {
    Running,
    Ended,
}

/// What became of a requested reload.
#[derive(Debug)]
pub(super) enum ReloadOutcome {
    Applied {
        plan: ExtensionReloadPlan,
        result: TabUpdateResult,
    },
    /// Carries one plan covering every reload postponed so far.
    Postponed(ExtensionReloadPlan),
}

impl ReloadOutcome {
    /// The one logged sentence of the outcome.
    pub(super) fn describe(&self) -> String {
        match self {
            Self::Applied { plan, result } => describe_extension_reload(plan, result),
            Self::Postponed(plan) => describe_postponed_reload(plan),
        }
    }
}

#[derive(Default)]
struct State {
    /// The reload that still has to happen.
    pending: Option<ExtensionReloadPlan>,
    /// The task that applies `pending` once the downloads end.
    waiter: Option<JoinHandle<()>>,
}

impl State {
    /// A waiter that finds nothing pending is about to end, so only a pending plan counts.
    fn is_waiting(&self) -> bool {
        self.pending.is_some()
            && self
                .waiter
                .as_ref()
                .is_some_and(|waiter| !waiter.is_finished())
    }

    /// The pending plan joined with a newer one.
    fn take_merged(&mut self, newer: ExtensionReloadPlan) -> ExtensionReloadPlan {
        match self.pending.take() {
            Some(older) => older.merge(newer),
            None => newer,
        }
    }
}

struct Shared {
    target: Arc<dyn ReloadTarget>,
    swapper: BackgroundSwapper,
    log: LogFn,
    /// Held across a reload, so two never run at once.
    state: Mutex<State>,
}

impl Shared {
    async fn check_downloads(&self, limit: Duration) -> Result<Downloads> {
        let source = scripts::wait_until_downloads_end(limit);
        match self.target.evaluate_in_background(&source).await? {
            Value::Bool(true) => Ok(Downloads::Ended),
            Value::Bool(false) => Ok(Downloads::Running),
            other => Err(BrowserError::Protocol(format!(
                "the download check returned {other}"
            ))),
        }
    }

    async fn wait_for_downloads_to_end(&self) {
        let mut failed_checks = 0;
        let mut can_retry = true;
        while can_retry {
            match self.check_downloads(DOWNLOADS_WAIT).await {
                Ok(Downloads::Ended) => return,
                Ok(Downloads::Running) => failed_checks = 0,
                Err(_) => {
                    failed_checks += 1;
                    can_retry = failed_checks < MAX_FAILED_CHECKS;
                    tokio::time::sleep(FAILED_CHECK_RETRY_DELAY).await;
                }
            }
        }
    }

    /// A failed reload stays pending, so the next one covers it.
    async fn reload_now(
        &self,
        state: &mut State,
        plan: ExtensionReloadPlan,
    ) -> Result<ReloadOutcome> {
        self.swapper.forget();
        match self.target.reload_extension(&plan).await {
            Ok(result) => Ok(ReloadOutcome::Applied { plan, result }),
            Err(error) => {
                state.pending = Some(plan);
                Err(error)
            }
        }
    }

    async fn apply_once_downloads_end(self: Arc<Self>) {
        self.wait_for_downloads_to_end().await;
        let mut state = self.state.lock().await;
        let Some(plan) = state.pending.take() else {
            return;
        };
        let message = match self.reload_now(&mut state, plan).await {
            Ok(outcome) => format!("{APPLIED_PREFIX}: {}", outcome.describe()),
            Err(error) => {
                format!(
                    "The postponed reload failed, the next extension reload retries it: {error}"
                )
            }
        };
        // The waiter is done: a failed plan must not read as still being waited on
        state.waiter = None;
        (self.log)(&message);
    }
}

/// Reloads the extension of one target, and owns the background swapper a reload resets.
pub(crate) struct ExtensionReloader {
    shared: Arc<Shared>,
}

impl ExtensionReloader {
    /// A reloader over one target; `log` receives what happens after a call returned.
    pub(crate) fn new(target: Arc<dyn ReloadTarget>, log: LogFn) -> Self {
        let swapper = BackgroundSwapper::new(Arc::clone(&target), Arc::clone(&log));
        Self {
            shared: Arc::new(Shared {
                target,
                swapper,
                log,
                state: Mutex::default(),
            }),
        }
    }

    pub(super) fn swapper(&self) -> &BackgroundSwapper {
        &self.shared.swapper
    }

    /// Reloads right away when nothing downloads, else postpones without waiting for the downloads.
    pub(super) async fn reload(&self, plan: &ExtensionReloadPlan) -> Result<ReloadOutcome> {
        let mut state = self.shared.state.lock().await;
        let is_waiting = state.is_waiting();
        let plan = state.take_merged(plan.clone());
        // An unreachable background has nothing running in it
        let is_postponed = is_waiting
            || matches!(
                self.shared.check_downloads(Duration::ZERO).await,
                Ok(Downloads::Running)
            );
        if !is_postponed {
            return self.shared.reload_now(&mut state, plan).await;
        }
        state.pending = Some(plan.clone());
        if !is_waiting {
            let shared = Arc::clone(&self.shared);
            state.waiter = Some(tokio::spawn(shared.apply_once_downloads_end()));
        }
        Ok(ReloadOutcome::Postponed(plan))
    }

    /// Waits until a postponed reload has been applied, for a process that would exit before it.
    pub(crate) async fn finish_postponed(&self) -> Result<()> {
        let waiter = self.shared.state.lock().await.waiter.take();
        let Some(waiter) = waiter else {
            return Ok(());
        };
        waiter
            .await
            .map_err(|error| BrowserError::Io(std::io::Error::other(error)))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex as StdMutex;

    use crate::dev::browsers::plan::fake::FakeTarget;
    use crate::dev::browsers::reloader::*;

    fn plan(reason: &str) -> ExtensionReloadPlan {
        ExtensionReloadPlan {
            reasons: vec![reason.to_owned()],
            main_world_content_scripts: Vec::new(),
            swappable_main_world_scripts: Vec::new(),
            isolated_content_scripts: Vec::new(),
            changed_isolated_style_sheets: Vec::new(),
        }
    }

    fn reloader(fake: &Arc<FakeTarget>) -> (ExtensionReloader, Arc<StdMutex<Vec<String>>>) {
        let messages = Arc::new(StdMutex::new(Vec::new()));
        let sink = Arc::clone(&messages);
        let log: LogFn = Arc::new(move |message| sink.lock().unwrap().push(message.to_owned()));
        (ExtensionReloader::new(fake.clone(), log), messages)
    }

    #[tokio::test]
    async fn an_idle_extension_reloads_right_away() {
        let fake = Arc::new(FakeTarget::default());
        let (reloader, _messages) = reloader(&fake);
        let outcome = reloader.reload(&plan("a")).await.unwrap();
        assert!(matches!(outcome, ReloadOutcome::Applied { .. }));
        assert_eq!(fake.reloads(), 1);
    }

    #[tokio::test]
    async fn postponed_reloads_coalesce_and_apply_once_downloads_end() {
        let fake = Arc::new(FakeTarget::default());
        fake.set_downloading(true);
        let (reloader, messages) = reloader(&fake);
        for reason in ["a", "b"] {
            let outcome = reloader.reload(&plan(reason)).await.unwrap();
            assert!(matches!(outcome, ReloadOutcome::Postponed(_)));
        }
        assert_eq!(fake.reloads(), 0);
        fake.set_downloading(false);
        reloader.finish_postponed().await.unwrap();
        assert_eq!(fake.reloads(), 1);
        let messages = messages.lock().unwrap();
        let [message] = messages.as_slice() else {
            panic!("expected one message, got {messages:?}");
        };
        assert!(message.starts_with("Applied the postponed reload: Reloaded extension (a; b)"));
    }
}
