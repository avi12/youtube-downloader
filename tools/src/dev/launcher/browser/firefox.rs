//! Firefox on the dev profile: prefs written to `user.js`, a debugger server on a free port, and
//! the extension installed as a temporary add-on through Marionette (what web-ext-run did).

use std::collections::BTreeMap;
use std::env;
use std::fmt::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tokio::process::Child;

use super::marionette::install_temporary_addon;
use super::{BrowserLaunch, FirefoxIdentity};
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

fn pref_lines(prefs: &[(&str, Value)]) -> String {
    prefs
        .iter()
        .fold(String::new(), |mut lines, (name, value)| {
            // Writing into a String cannot fail
            let _ = writeln!(lines, "user_pref(\"{name}\", {value});");
            lines
        })
}

fn user_prefs(options: &DevOptions, extension_id: &str, rdp_port: u16) -> Result<String> {
    let uuids: BTreeMap<&str, &str> = BTreeMap::from([(extension_id, ADDON_UUID)]);
    let mut prefs = vec![
        ("devtools.debugger.remote-enabled", json!(true)),
        ("devtools.debugger.prompt-connection", json!(false)),
        ("devtools.chrome.enabled", json!(true)),
        ("devtools.debugger.remote-port", json!(rdp_port)),
        ("marionette.port", json!(options.marionette_port)),
        (
            "extensions.webextensions.uuids",
            json!(serde_json::to_string(&uuids)?),
        ),
        ("browser.shell.checkDefaultBrowser", json!(false)),
        ("browser.startup.homepage_override.mstone", json!("ignore")),
        ("browser.tabs.warnOnClose", json!(false)),
        ("app.update.enabled", json!(false)),
    ];
    if options.is_audio_muted {
        prefs.push(("media.volume_scale", json!("0.0")));
    }
    Ok(pref_lines(&prefs))
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
        options.profile_dir.display().to_string(),
        "-no-remote".to_owned(),
        "--marionette".to_owned(),
        format!("--remote-debugging-port={}", options.cdp_port),
        "-start-debugger-server".to_owned(),
        rdp_port.to_string(),
        "-url".to_owned(),
        options.start_url.clone(),
    ]
}

fn write_user_prefs(profile_dir: &Path, prefs: &str) -> Result<()> {
    std::fs::create_dir_all(profile_dir)?;
    std::fs::write(profile_dir.join(USER_PREFS_FILE), prefs)?;
    Ok(())
}

/// Starts Firefox with the extension installed as a temporary add-on.
pub(super) async fn launch(launch: BrowserLaunch<'_>) -> Result<(Child, FirefoxIdentity)> {
    let BrowserLaunch {
        options,
        host,
        output_dir,
    } = launch;
    let extension_id = ExtensionManifest::read(output_dir)?.gecko_id();
    let rdp_port = free_port()?;
    write_user_prefs(
        &options.profile_dir,
        &user_prefs(options, &extension_id, rdp_port)?,
    )?;
    let child = Invocation::new(find_firefox(host)?)
        .args(firefox_args(options, rdp_port))
        .env(ALLOW_SYSTEM_ACCESS_VARIABLE, ENABLED_VALUE)
        .spawn_kill_on_drop()?;
    install_temporary_addon(options.marionette_port, output_dir).await?;
    let identity = FirefoxIdentity {
        rdp_port,
        extension_id,
        uuid: ADDON_UUID.to_owned(),
    };
    Ok((child, identity))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefs_render_as_user_pref_lines() {
        let lines = pref_lines(&[("a.b", json!(true)), ("c.d", json!("x\"y"))]);
        assert_eq!(
            lines,
            "user_pref(\"a.b\", true);\nuser_pref(\"c.d\", \"x\\\"y\");\n"
        );
    }

    #[test]
    fn the_uuid_pref_maps_the_gecko_id() {
        let uuids: BTreeMap<&str, &str> = BTreeMap::from([("a@b.c", ADDON_UUID)]);
        let encoded = serde_json::to_string(&json!(serde_json::to_string(&uuids).unwrap()));
        assert_eq!(
            encoded.unwrap(),
            format!("\"{{\\\"a@b.c\\\":\\\"{ADDON_UUID}\\\"}}\"")
        );
    }
}
