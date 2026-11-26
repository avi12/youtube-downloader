//! Chrome for Testing, started directly with the extension loaded from the build output.

use tokio::process::Child;

use crate::dev::launcher::browser::cft::ensure_chrome;
use crate::dev::launcher::browser::BrowserLaunch;
use crate::dev::launcher::error::Result;
use crate::output::options::{DevOptions, HostEnvironment, OsPlatform};
use crate::release::process::Invocation;
use std::path::Path;

const REGISTRY_PROGRAM: &str = "reg.exe";
const REGISTRY_THEME_KEY: &str =
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const REGISTRY_THEME_VALUE: &str = "AppsUseLightTheme";
// AppsUseLightTheme is 0 when Windows apps use the dark theme
const APPS_USE_DARK_THEME: &str = "0x0";
const PROFILE_DIRECTORY_NAME: &str = "Profile 1";
// The Multipass VM and Ubuntu 24.04: AppArmor blocks Chrome's unprivileged userns sandbox even
// with kernel.unprivileged_userns_clone=1. --no-sandbox is Chrome's own documented workaround
// and is safe inside the disposable VM.
const LINUX_ARGS: [&str; 3] = [
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-sandbox",
];
const WSL_DARK_MODE_ARGS: [&str; 2] = [
    "--force-dark-mode",
    "--enable-features=WebContentsForceDark",
];

fn is_dark_theme_output(registry_output: &str) -> bool {
    registry_output
        .lines()
        .filter(|line| line.contains(REGISTRY_THEME_VALUE))
        .any(|line| line.split_whitespace().last() == Some(APPS_USE_DARK_THEME))
}

async fn detect_windows_dark_mode(host: &HostEnvironment) -> bool {
    if !host.is_wsl {
        return false;
    }
    Invocation::new(REGISTRY_PROGRAM)
        .args(["query", REGISTRY_THEME_KEY, "/v", REGISTRY_THEME_VALUE])
        .capture_checked()
        .await
        .is_ok_and(|output| is_dark_theme_output(&output))
}

fn chrome_args(options: &DevOptions, output_directory: &Path, extras: &[&str]) -> Vec<String> {
    let mut args = vec![
        format!("--user-data-dir={}", options.profile_directory.display()),
        format!("--profile-directory={PROFILE_DIRECTORY_NAME}"),
        format!("--load-extension={}", output_directory.display()),
        format!("--lang={}", options.lang),
        format!("--remote-debugging-port={}", options.cdp_port),
        "--disable-blink-features=AutomationControlled".to_owned(),
        "--no-first-run".to_owned(),
        "--no-default-browser-check".to_owned(),
    ];
    if options.is_audio_muted {
        args.push("--mute-audio".to_owned());
    }
    args.extend(extras.iter().map(|extra| (*extra).to_owned()));
    args.push(options.start_url.clone());
    args
}

/// Starts Chrome for Testing on the dev profile; killing the returned process closes it.
pub(super) async fn launch(launch: BrowserLaunch<'_>) -> Result<Child> {
    let BrowserLaunch {
        options,
        host,
        output_directory,
    } = launch;
    let executable = ensure_chrome(&options.project_root, host.platform).await?;
    let mut extras: Vec<&str> = Vec::new();
    let is_linux = host.platform == OsPlatform::Linux;
    if is_linux {
        if detect_windows_dark_mode(host).await {
            extras.extend(WSL_DARK_MODE_ARGS);
        }
        extras.extend(LINUX_ARGS);
    }
    Invocation::new(executable)
        .args(chrome_args(options, output_directory, &extras))
        .spawn_kill_on_drop()
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use crate::dev::launcher::browser::chrome::*;

    #[test]
    fn the_registry_dark_theme_value_is_recognised() {
        let dark = "\r\nHKEY_CURRENT_USER\\...\\Personalize\r\n    AppsUseLightTheme    REG_DWORD    0x0\r\n";
        let light = "    AppsUseLightTheme    REG_DWORD    0x1";
        assert!(is_dark_theme_output(dark));
        assert!(!is_dark_theme_output(light));
        assert!(!is_dark_theme_output(""));
    }
}
