//! The browser targets of the dev server: reloading the extension, refreshing its pages and swapping
//! its background in place, on Chrome (over CDP) and Firefox (over RDP). Port of
//! `scripts/dev/browsers/**` and the session half of `scripts/cdp-utils.ts`.

mod error;

mod plan;
mod scripts;
mod swap;
mod target;
mod targets;

use std::path::PathBuf;
use std::sync::Arc;

use clap::{Args, Subcommand, ValueEnum};
use ytdl_dev_hot::types::Port;

pub(crate) use self::error::{BrowserError, Result};
pub(crate) use self::plan::{apply_reload_plan, ApplyRequest};
pub(crate) use self::swap::BackgroundSwapper;
pub(crate) use self::target::ReloadTarget;
pub(crate) use self::targets::{ChromeTarget, FirefoxTarget, FirefoxTargetConfig};

use crate::dev::hmr::ContentScriptUpdate;
use crate::output::reload::ReloadPlan;
use crate::port::parse_port_number;

const DEFAULT_CDP_PORT: u16 = 9229;

/// Which browser family carries the reload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Family {
    /// Chrome, Edge, Opera over CDP.
    Chrome,
    /// Firefox over RDP.
    Firefox,
}

/// The commands of this part.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Applies a reload plan (JSON, as `ytdl output plan-reload` prints it) to a running browser
    Apply(ApplyArgs),
    /// Prints what the hot sidecar needs to reach a Firefox add-on, as JSON
    Connection(FirefoxArgs),
}

/// The Firefox endpoints and add-on identity.
#[derive(Debug, Args)]
pub(crate) struct FirefoxArgs {
    /// Firefox's remote debugging (RDP) port
    #[arg(long, value_parser = parse_port_number)]
    rdp_port: u16,
    /// Firefox's Marionette port
    #[arg(long, value_parser = parse_port_number)]
    marionette_port: u16,
    /// The gecko id of the extension
    #[arg(long)]
    extension_id: String,
    /// The per-profile moz-extension UUID of the extension
    #[arg(long)]
    uuid: String,
}

/// Arguments of `ytdl dev browser apply`.
#[derive(Debug, Args)]
pub(crate) struct ApplyArgs {
    /// The reload plan JSON file
    plan: PathBuf,
    /// The build output directory (the rebuilt background script is read from it)
    #[arg(long = "out-dir", value_name = "OUT_DIR")]
    out_directory: PathBuf,
    /// The browser family
    #[arg(long, value_enum, default_value_t = Family::Chrome)]
    browser: Family,
    /// Chrome's remote debugging port
    #[arg(long, default_value_t = DEFAULT_CDP_PORT, value_parser = parse_port_number)]
    cdp_port: u16,
    /// The extension's manifest name, to tell it from other extensions of the profile
    #[arg(long)]
    extension_name: Option<String>,
    /// Firefox's remote debugging (RDP) port
    #[arg(long, value_parser = parse_port_number)]
    rdp_port: Option<u16>,
    /// Firefox's Marionette port
    #[arg(long, value_parser = parse_port_number)]
    marionette_port: Option<u16>,
    /// The gecko id of the extension
    #[arg(long)]
    extension_id: Option<String>,
    /// The per-profile moz-extension UUID of the extension
    #[arg(long)]
    uuid: Option<String>,
}

impl FirefoxArgs {
    fn config(&self) -> Result<FirefoxTargetConfig> {
        Ok(FirefoxTargetConfig {
            rdp_port: Port::new(self.rdp_port)?,
            marionette_port: Port::new(self.marionette_port)?,
            extension_id: self.extension_id.clone(),
            uuid: self.uuid.clone(),
        })
    }
}

impl ApplyArgs {
    fn firefox(&self) -> Option<FirefoxArgs> {
        Some(FirefoxArgs {
            rdp_port: self.rdp_port?,
            marionette_port: self.marionette_port?,
            extension_id: self.extension_id.clone()?,
            uuid: self.uuid.clone()?,
        })
    }

    fn target(&self) -> Result<Arc<dyn ReloadTarget>> {
        let is_chrome = self.browser == Family::Chrome;
        if is_chrome {
            let chrome = ChromeTarget::new(Port::new(self.cdp_port)?);
            return Ok(Arc::new(match &self.extension_name {
                Some(name) => chrome.with_extension_name(name.clone()),
                None => chrome,
            }));
        }
        let firefox = self.firefox().ok_or_else(|| {
            BrowserError::Protocol(
                "Firefox needs --rdp-port, --marionette-port, --extension-id and --uuid".to_owned(),
            )
        })?;
        Ok(Arc::new(FirefoxTarget::new(firefox.config()?)))
    }
}

async fn apply(args: ApplyArgs) -> Result<()> {
    let plan: ReloadPlan = serde_json::from_str(&tokio::fs::read_to_string(&args.plan).await?)?;
    let target = args.target()?;
    let swapper = BackgroundSwapper::new(
        Arc::clone(&target),
        Arc::new(|message| println!("{message}")),
    );
    let outcome = apply_reload_plan(&ApplyRequest {
        content_script_update: ContentScriptUpdate::Unchanged,
        plan: &plan,
        target: target.as_ref(),
        swapper: &swapper,
        output_directory: &args.out_directory,
    })
    .await?;
    println!("{outcome}");
    Ok(())
}

/// Runs one command of this part.
pub(crate) async fn run(command: Command) -> Result<()> {
    match command {
        Command::Apply(args) => apply(args).await,
        Command::Connection(args) => {
            let connection = FirefoxTarget::new(args.config()?).connection();
            println!("{}", serde_json::to_string_pretty(&connection)?);
            Ok(())
        }
    }
}
