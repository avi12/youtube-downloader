//! `marionette <action>`: open, windows, goto, reload-ext, key, click and eval over Marionette.

use std::time::Duration;

use clap::{Args, Subcommand};

use super::client::{wrap_promise_expression, Marionette};
use crate::firefox::{pause, Result, GECKO_ID, MARIONETTE_DEFAULT_PORT};
use crate::port::parse_port_number;

const DEFAULT_EXTENSION_DIR: &str = r"C:\repositories\avi\youtube-downloader\.output\firefox-mv3";
const NEW_TAB_SETTLE: Duration = Duration::from_millis(500);

/// Arguments of `marionette`.
#[derive(Debug, Args)]
pub(crate) struct MarionetteArgs {
    /// The Marionette port
    #[arg(long, default_value_t = MARIONETTE_DEFAULT_PORT, value_parser = parse_port_number)]
    port: u16,
    #[command(subcommand)]
    action: Action,
}

#[derive(Debug, Subcommand)]
enum Action {
    /// Opens a URL in a new tab
    Open {
        /// Where to go
        url: String,
    },
    /// Lists every window with its URL
    Windows,
    /// Navigates the `YouTube` tab
    Goto {
        /// Where to go
        url: String,
    },
    /// Reinstalls the built extension as a temporary add-on
    ReloadExt {
        /// The build output directory
        #[arg(default_value = DEFAULT_EXTENSION_DIR)]
        path: String,
    },
    /// Presses a key in the `YouTube` tab
    Key {
        /// The key name (for example `k`)
        key: String,
    },
    /// Clicks the first element matching a CSS selector in the `YouTube` tab
    Click {
        /// The CSS selector (several words are joined with spaces)
        #[arg(required = true, num_args = 1.., allow_hyphen_values = true)]
        selector: Vec<String>,
    },
    /// Evaluates a promise-returning expression in the `YouTube` tab
    Eval {
        /// The expression (several words are joined with spaces)
        #[arg(required = true, num_args = 1.., allow_hyphen_values = true)]
        expression: Vec<String>,
    },
}

pub(in crate::firefox) async fn run(args: MarionetteArgs) -> Result<()> {
    let mut client = Marionette::connect(args.port).await?;
    match args.action {
        Action::Open { url } => open(&mut client, &url).await,
        Action::Windows => windows(&mut client).await,
        Action::Goto { url } => {
            client.find_youtube_tab().await?;
            client.navigate(&url).await?;
            println!("Navigated");
            Ok(())
        }
        Action::ReloadExt { path } => reload_extension(&mut client, &path).await,
        Action::Key { key } => {
            client.find_youtube_tab().await?;
            client.press_key(&key).await?;
            println!("pressed {key}");
            Ok(())
        }
        Action::Click { selector } => click(&mut client, &selector.join(" ")).await,
        Action::Eval { expression } => eval(&mut client, &expression.join(" ")).await,
    }
}

async fn open(client: &mut Marionette, url: &str) -> Result<()> {
    client.open_tab().await?;
    pause(NEW_TAB_SETTLE).await;
    client.navigate(url).await?;
    println!("opened {url}");
    Ok(())
}

async fn windows(client: &mut Marionette) -> Result<()> {
    for handle in client.windows().await? {
        client.switch_to(&handle).await?;
        println!("{handle} -> {}", client.current_url().await?);
    }
    Ok(())
}

async fn reload_extension(client: &mut Marionette, path: &str) -> Result<()> {
    if let Err(error) = client.uninstall_addon(GECKO_ID).await {
        println!("Uninstall (ignored): {error}");
    }
    let result = client.install_temporary_addon(path).await?;
    println!("Install result: {result}");
    Ok(())
}

async fn click(client: &mut Marionette, selector: &str) -> Result<()> {
    client.find_youtube_tab().await?;
    client.click(selector).await?;
    println!("clicked {selector}");
    Ok(())
}

async fn eval(client: &mut Marionette, expression: &str) -> Result<()> {
    let url = client.find_youtube_tab().await?;
    println!("Using tab: {url}");
    let result = client
        .execute_async(&wrap_promise_expression(expression))
        .await?;
    println!("Result: {}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
