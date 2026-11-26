//! The in-browser payloads of the dev server: the HMR runtime, the background prelude and the popup
//! loader. They run inside the browser, so they stay JavaScript (`assets/payload/*.js`); this part
//! embeds them and injects the generated config.

use clap::{Subcommand, ValueEnum};
use serde::Serialize;
use serde_json::Value;
use tokio::io::AsyncWriteExt;

use crate::error::Result;
use crate::output::patches::hmr_names::{
    HMR_MANIFEST_PATH, HMR_POLL_INTERVAL_MS, HMR_RUNTIME_FILE, POPUP_ENTRY_NAME,
};

/// What `runtime.js` reads from its generated `HMR_CONFIG` header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PayloadConfig {
    /// Extension-relative path of the HMR manifest the runtime polls.
    pub(crate) manifest_path: String,
    /// How often the runtime re-reads the manifest.
    pub(crate) poll_interval_ms: u32,
}

impl PayloadConfig {
    /// The config the dev server runs with: the shared HMR names and polling interval.
    pub(crate) fn dev_default() -> Self {
        Self {
            manifest_path: HMR_MANIFEST_PATH.to_owned(),
            poll_interval_ms: HMR_POLL_INTERVAL_MS,
        }
    }
}

const RUNTIME: &str = include_str!("../../assets/payload/runtime.js");
const BACKGROUND_PRELUDE: &str = include_str!("../../assets/payload/background-prelude.js");
const POPUP_LOADER: &str = include_str!("../../assets/payload/popup-loader.js");

/// Where the popup loader finds the runtime and the built popup entry, both relative to itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PopupLoaderPaths {
    /// The HMR entry name the runtime reports styles for.
    pub(crate) entry: String,
    /// Module specifier of the runtime.
    pub(crate) runtime_path: String,
    /// Module specifier of the built popup entry.
    pub(crate) popup_path: String,
}

/// The page and content-script runtime, with its `HMR_CONFIG` header.
pub(crate) fn runtime_source(config: &PayloadConfig) -> serde_json::Result<String> {
    let header = serde_json::to_string(config)?;
    Ok(format!("const HMR_CONFIG = {header};\n{RUNTIME}"))
}

/// The background prelude, wrapped so evaluating it again redeclares nothing.
pub(crate) fn background_prelude_source() -> String {
    format!("(() => {{\n{BACKGROUND_PRELUDE}\n}})();\n")
}

/// The popup loader: sets the entry name, then imports the runtime and the popup.
pub(crate) fn loader_source(paths: &PopupLoaderPaths) -> String {
    [
        ("ENTRY", &paths.entry),
        ("RUNTIME_PATH", &paths.runtime_path),
        ("POPUP_PATH", &paths.popup_path),
    ]
    .iter()
    .fold(POPUP_LOADER.to_owned(), |source, (name, value)| {
        source.replace(
            &format!("\"@@{name}@@\""),
            &Value::String((*value).clone()).to_string(),
        )
    })
}

/// Which payload to print.
#[derive(Debug, Clone, Copy, ValueEnum)]
pub(crate) enum Payload {
    /// The page and content-script HMR runtime
    Runtime,
    /// The prelude prepended to the background script
    BackgroundPrelude,
    /// The popup loader
    Loader,
}

/// The commands of this part.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Prints one rendered payload to stdout
    Print {
        /// The payload to render
        payload: Payload,
    },
}

/// Runs one command of this part.
pub(crate) async fn run(command: Command) -> Result<()> {
    let Command::Print { payload } = command;
    let source = match payload {
        Payload::Runtime => runtime_source(&PayloadConfig::dev_default())?,
        Payload::BackgroundPrelude => background_prelude_source(),
        Payload::Loader => loader_source(&PopupLoaderPaths {
            entry: POPUP_ENTRY_NAME.to_owned(),
            runtime_path: format!("./{HMR_RUNTIME_FILE}"),
            popup_path: "./popup.js".to_owned(),
        }),
    };
    tokio::io::stdout().write_all(source.as_bytes()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use crate::dev::payload::*;

    fn assert_parses(source: &str) {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::mjs()).parse();
        assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
    }

    fn config() -> PayloadConfig {
        PayloadConfig {
            manifest_path: "hmr/manifest.json".to_owned(),
            poll_interval_ms: 250,
        }
    }

    #[test]
    fn runtime_parses_and_carries_config() {
        let source = runtime_source(&config()).unwrap();
        assert_parses(&source);
        assert!(source.starts_with(
            "const HMR_CONFIG = {\"manifestPath\":\"hmr/manifest.json\",\"pollIntervalMs\":250};\n"
        ));
    }

    #[test]
    fn background_prelude_parses_and_is_wrapped() {
        let source = background_prelude_source();
        assert_parses(&source);
        assert!(source.starts_with("(() => {\n"));
    }

    #[test]
    fn loader_parses_and_fills_every_placeholder() {
        let source = loader_source(&PopupLoaderPaths {
            entry: "popup".to_owned(),
            runtime_path: "./runtime.js".to_owned(),
            popup_path: "./popup.js".to_owned(),
        });
        assert_parses(&source);
        assert!(source.contains("const ENTRY = \"popup\";"));
        assert!(source.contains("\"./runtime.js\""));
        assert!(!source.contains("@@"));
    }
}

#[cfg(test)]
mod seam_tests {
    use crate::dev::payload::*;
    use crate::output::patches::hmr_names::{HMR_ENTRY_GLOBAL, HMR_RUNTIME_GLOBAL};

    #[test]
    fn the_dev_config_is_the_shared_names_and_interval() {
        let config = PayloadConfig::dev_default();
        assert_eq!(config.manifest_path, HMR_MANIFEST_PATH);
        assert_eq!(config.poll_interval_ms, HMR_POLL_INTERVAL_MS);
    }

    #[test]
    fn the_assets_install_and_read_the_globals_the_rust_side_names() {
        assert!(RUNTIME.contains(HMR_RUNTIME_GLOBAL));
        assert!(RUNTIME.contains(HMR_ENTRY_GLOBAL));
        assert!(POPUP_LOADER.contains(HMR_ENTRY_GLOBAL));
    }

    #[test]
    fn the_hmr_loader_is_the_payload_loader_with_the_shared_names() {
        let loader = loader_source(&PopupLoaderPaths {
            entry: POPUP_ENTRY_NAME.to_owned(),
            runtime_path: format!("./{HMR_RUNTIME_FILE}"),
            popup_path: "./popup.js".to_owned(),
        });
        assert!(loader.contains("\"popup\"") && loader.contains("\"./runtime.js\""));
    }
}
