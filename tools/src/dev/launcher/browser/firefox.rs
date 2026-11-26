//! Firefox on the dev profile: prefs written to `user.js`, a debugger server on a free port, and
//! the extension installed as a temporary add-on through Marionette (what web-ext-run did).

use std::collections::BTreeMap;
use std::env;
use std::fmt::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::process::Child;

use crate::dev::launcher::browser::marionette::install_temporary_addon;
use crate::dev::launcher::browser::{BrowserLaunch, FirefoxIdentity};
use crate::dev::launcher::error::{LauncherError, Result};
use crate::dev::launcher::process::{find_on_path, free_port};
use crate::output::manifest::ExtensionManifest;
use crate::output::options::{DevOptions, HostEnvironment, OsPlatform};
use crate::release::process::Invocation;

const USER_PREFS_FILE: &str = "user.js";
// Lets the dev server wake the suspended background event page over RDP (WebExtensionPolicy is
// privileged), the way about:debugging's Inspect does, without touching a tab
const ALLOW_SYSTEM_ACCESS_VARIABLE: &str = "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS";
const ENABLED_VALUE: &str = "1";
// The add-on's moz-extension:// host is a per-profile UUID; pinning it in the prefs makes it known
// before Firefox starts, so nothing has to be asked over RDP
const ADDON_UUID: &str = "5a3c2f7e-8b1d-4c9a-9e61-2f4d7a0b3c85";
const MAC_BINARY: &str = "/Applications/Firefox.app/Contents/MacOS/firefox";
const WINDOWS_BINARY_PATH: &str = "Mozilla Firefox/firefox.exe";
const PROGRAM_FILES_VARIABLES: [&str; 2] = ["ProgramFiles", "ProgramFiles(x86)"];

/// The preferences the dev profile sets.
#[derive(Debug, Clone, Copy)]
enum Pref {
    RemoteDebugging,
    ConnectionPrompt,
    ChromeDebugging,
    DebuggerPort,
    MarionettePort,
    ExtensionUuids,
    DefaultBrowserCheck,
    HomepageOverride,
    TabsWarnOnClose,
    AppUpdate,
    VolumeScale,
}

impl Pref {
    const fn name(self) -> &'static str {
        match self {
            Self::RemoteDebugging => "devtools.debugger.remote-enabled",
            Self::ConnectionPrompt => "devtools.debugger.prompt-connection",
            Self::ChromeDebugging => "devtools.chrome.enabled",
            Self::DebuggerPort => "devtools.debugger.remote-port",
            Self::MarionettePort => "marionette.port",
            Self::ExtensionUuids => "extensions.webextensions.uuids",
            Self::DefaultBrowserCheck => "browser.shell.checkDefaultBrowser",
            Self::HomepageOverride => "browser.startup.homepage_override.mstone",
            Self::TabsWarnOnClose => "browser.tabs.warnOnClose",
            Self::AppUpdate => "app.update.enabled",
            Self::VolumeScale => "media.volume_scale",
        }
    }
}

/// A preference value; it renders as the JavaScript literal of the same JSON.
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum PrefValue {
    Flag(bool),
    Number(u16),
    Text(String),
}

impl PrefValue {
    fn text(text: &str) -> Self {
        Self::Text(text.to_owned())
    }
}

fn pref_lines(prefs: &[(Pref, PrefValue)]) -> Result<String> {
    let mut lines = String::new();
    for (pref, value) in prefs {
        let value = serde_json::to_string(value)?;
        // Writing into a String cannot fail
        let _ = writeln!(lines, "user_pref(\"{}\", {value});", pref.name());
    }
    Ok(lines)
}

fn user_prefs(options: &DevOptions, extension_id: &str, rdp_port: u16) -> Result<String> {
    let uuids: BTreeMap<&str, &str> = BTreeMap::from([(extension_id, ADDON_UUID)]);
    let mut prefs = vec![
        (Pref::RemoteDebugging, PrefValue::Flag(true)),
        (Pref::ConnectionPrompt, PrefValue::Flag(false)),
        (Pref::ChromeDebugging, PrefValue::Flag(true)),
        (Pref::DebuggerPort, PrefValue::Number(rdp_port)),
        (
            Pref::MarionettePort,
            PrefValue::Number(options.marionette_port),
        ),
        (
            Pref::ExtensionUuids,
            PrefValue::Text(serde_json::to_string(&uuids)?),
        ),
        (Pref::DefaultBrowserCheck, PrefValue::Flag(false)),
        (Pref::HomepageOverride, PrefValue::text("ignore")),
        (Pref::TabsWarnOnClose, PrefValue::Flag(false)),
        (Pref::AppUpdate, PrefValue::Flag(false)),
    ];
    if options.is_audio_muted {
        prefs.push((Pref::VolumeScale, PrefValue::text("0.0")));
    }
    pref_lines(&prefs)
}

fn find_firefox(host: &HostEnvironment) -> Result<PathBuf> {
    let installed = match host.platform {
        OsPlatform::Windows => PROGRAM_FILES_VARIABLES
            .iter()
            .filter_map(env::var_os)
            .map(|root| PathBuf::from(root).join(WINDOWS_BINARY_PATH))
            .find(|candidate| candidate.is_file())
            .or_else(|| find_on_path("firefox.exe")),
        OsPlatform::MacOs => Some(PathBuf::from(MAC_BINARY)).filter(|path| path.is_file()),
        OsPlatform::Linux => find_on_path("firefox"),
    };
    installed.ok_or_else(|| LauncherError::Browser("could not find Firefox".to_owned()))
}

fn firefox_args(options: &DevOptions, rdp_port: u16) -> Vec<String> {
    vec![
        "-profile".to_owned(),
        options.profile_directory.display().to_string(),
        "-no-remote".to_owned(),
        "--marionette".to_owned(),
        format!("--remote-debugging-port={}", options.cdp_port),
        "-start-debugger-server".to_owned(),
        rdp_port.to_string(),
        "-url".to_owned(),
        options.start_url.clone(),
    ]
}

fn write_user_prefs(profile_directory: &Path, prefs: &str) -> Result<()> {
    std::fs::create_dir_all(profile_directory)?;
    std::fs::write(profile_directory.join(USER_PREFS_FILE), prefs)?;
    Ok(())
}

/// Starts Firefox with the extension installed as a temporary add-on.
pub(super) async fn launch(launch: BrowserLaunch<'_>) -> Result<(Child, FirefoxIdentity)> {
    let BrowserLaunch {
        options,
        host,
        output_directory,
    } = launch;
    let extension_id = ExtensionManifest::read(output_directory)?.gecko_id();
    let rdp_port = free_port()?;
    write_user_prefs(
        &options.profile_directory,
        &user_prefs(options, &extension_id, rdp_port)?,
    )?;
    let child = Invocation::new(find_firefox(host)?)
        .args(firefox_args(options, rdp_port))
        .env(ALLOW_SYSTEM_ACCESS_VARIABLE, ENABLED_VALUE)
        .spawn_kill_on_drop()?;
    install_temporary_addon(options.marionette_port, output_directory).await?;
    let identity = FirefoxIdentity {
        rdp_port,
        extension_id,
        uuid: ADDON_UUID.to_owned(),
    };
    Ok((child, identity))
}

#[cfg(test)]
mod tests {
    use crate::dev::launcher::browser::firefox::*;

    #[test]
    fn prefs_render_as_user_pref_lines() -> Result<()> {
        let lines = pref_lines(&[
            (Pref::AppUpdate, PrefValue::Flag(true)),
            (Pref::DebuggerPort, PrefValue::Number(6000)),
            (Pref::VolumeScale, PrefValue::text("x\"y")),
        ])?;
        assert_eq!(
            lines,
            "user_pref(\"app.update.enabled\", true);\n\
             user_pref(\"devtools.debugger.remote-port\", 6000);\n\
             user_pref(\"media.volume_scale\", \"x\\\"y\");\n"
        );
        Ok(())
    }

    #[test]
    fn the_uuid_pref_maps_the_gecko_id() -> Result<()> {
        let uuids: BTreeMap<&str, &str> = BTreeMap::from([("a@b.c", ADDON_UUID)]);
        let value = PrefValue::Text(serde_json::to_string(&uuids)?);
        assert_eq!(
            serde_json::to_string(&value)?,
            format!("\"{{\\\"a@b.c\\\":\\\"{ADDON_UUID}\\\"}}\"")
        );
        Ok(())
    }
}
