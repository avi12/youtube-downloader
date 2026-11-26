//! The dev server's command line: each flag falls back to a `YTDL_DEV_*` environment variable, so a
//! second instance can run side by side. Port of `scripts/dev/server/options.ts`, with the
//! constants of `enums.ts` and `project.ts` it needs.

use std::env;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use serde::{Deserialize, Serialize};

use crate::output::error::{OutputError, Result};
use crate::port::parse_port_number;

const CDP_PORT_WINDOWS: u16 = 9229;
const CDP_PORT_LINUX: u16 = 9233;
const CDP_PORT_FIREFOX: u16 = 9230;
const MARIONETTE_PORT_DEFAULT: u16 = 2828;
const REBUILD_DEBOUNCE_MS: u32 = 800;
const WATCH_POLL_INTERVAL_MS: u32 = 500;
const HMR_PORT_OFFSET: u32 = 1000;
const ENV_FILES: [&str; 2] = [".env", ".env.local"];
const INSTALL_MARKER_PATH: &str = "bun.lock";
const USER_PROFILES_DIR: &str = "user-profiles";
const DEFAULT_START_URL: &str = "https://www.youtube.com/feed/subscriptions";
const DEFAULT_LANG: &str = "en";
const WSL_DISTRO_VARIABLE: &str = "WSL_DISTRO_NAME";

/// The browser target names WXT and Vite take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BuildBrowser {
    /// Chromium family.
    Chrome,
    /// Firefox.
    Firefox,
}

impl BuildBrowser {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Chrome => "chrome",
            Self::Firefox => "firefox",
        }
    }
}

/// Node's `os.platform()` names, which the profile directory names carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub(crate) enum OsPlatform {
    /// Windows.
    #[serde(rename = "win32")]
    Windows,
    /// Linux.
    #[serde(rename = "linux")]
    Linux,
    /// macOS.
    #[serde(rename = "darwin")]
    MacOs,
}

impl OsPlatform {
    fn current() -> Self {
        match env::consts::OS {
            "windows" => Self::Windows,
            "macos" => Self::MacOs,
            _ => Self::Linux,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Windows => "win32",
            Self::Linux => "linux",
            Self::MacOs => "darwin",
        }
    }
}

/// What the host machine says about itself; faked in tests.
#[derive(Debug, Clone)]
pub(crate) struct HostEnvironment {
    pub(crate) platform: OsPlatform,
    pub(crate) is_wsl: bool,
    pub(crate) home: PathBuf,
    pub(crate) local_app_data: PathBuf,
    pub(crate) app_data: PathBuf,
    pub(crate) lang: String,
}

impl HostEnvironment {
    pub(crate) fn detect() -> Self {
        let variable = |name: &str| env::var(name).ok().filter(|value| !value.is_empty());
        let path_variable = |name: &str| variable(name).map_or_else(PathBuf::new, PathBuf::from);
        let platform = OsPlatform::current();
        let home = variable("HOME").or_else(|| variable("USERPROFILE"));
        Self {
            platform,
            is_wsl: platform == OsPlatform::Linux && variable(WSL_DISTRO_VARIABLE).is_some(),
            home: home.map_or_else(PathBuf::new, PathBuf::from),
            local_app_data: path_variable("LOCALAPPDATA"),
            app_data: path_variable("APPDATA"),
            lang: variable("LANG").unwrap_or_else(|| DEFAULT_LANG.to_owned()),
        }
    }
}

/// The flags every dev command shares.
#[derive(Debug, Clone, Args)]
pub(crate) struct OptionArgs {
    /// The repository root the profile and install paths resolve against
    #[arg(long, env = "YTDL_PROJECT_ROOT", default_value = ".")]
    project_root: PathBuf,
    /// Target Firefox instead of Chrome
    #[arg(long = "firefox", id = "firefox")]
    is_firefox: bool,
    /// Chrome remote debugging port
    #[arg(long, env = "YTDL_DEV_CDP_PORT", value_parser = parse_port_number)]
    cdp_port: Option<u16>,
    /// Firefox Marionette port
    #[arg(long, env = "YTDL_DEV_MARIONETTE_PORT", value_parser = parse_port_number)]
    marionette_port: Option<u16>,
    /// The dev browser's profile directory
    #[arg(
        long = "profile-dir",
        value_name = "PROFILE_DIR",
        env = "YTDL_DEV_PROFILE_DIR"
    )]
    profile_directory: Option<PathBuf>,
    /// WXT's outDir; unset keeps WXT's own `.output`
    #[arg(long = "out-dir", value_name = "OUT_DIR", env = "YTDL_DEV_OUT_DIR")]
    out_directory: Option<String>,
    /// The page the browser opens
    #[arg(long, env = "YTDL_DEV_START_URL")]
    start_url: Option<String>,
    /// Keep test browsers silent
    #[arg(long = "mute-audio", id = "mute_audio", env = "YTDL_DEV_MUTE_AUDIO")]
    should_mute_audio: bool,
}

/// The options after flags, environment and defaults are merged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevOptions {
    pub(crate) project_root: PathBuf,
    pub(crate) is_firefox: bool,
    pub(crate) is_audio_muted: bool,
    pub(crate) is_wsl: bool,
    pub(crate) profile_platform_suffix: String,
    pub(crate) cdp_port: u16,
    pub(crate) marionette_port: u16,
    #[serde(rename = "profileDir")]
    pub(crate) profile_directory: PathBuf,
    #[serde(rename = "outDir")]
    pub(crate) out_directory: Option<String>,
    pub(crate) start_url: String,
    pub(crate) lang: String,
    pub(crate) rebuild_debounce_ms: u32,
    pub(crate) watch_poll_interval_ms: u32,
    pub(crate) hmr_port_offset: u32,
    pub(crate) env_files: Vec<String>,
    pub(crate) install_marker_path: String,
    pub(crate) installed_lockfile_path: PathBuf,
}

impl DevOptions {
    pub(crate) fn browser(&self) -> BuildBrowser {
        if self.is_firefox {
            return BuildBrowser::Firefox;
        }
        BuildBrowser::Chrome
    }
}

fn default_cdp_port(is_firefox: bool, platform: OsPlatform) -> u16 {
    if is_firefox {
        return CDP_PORT_FIREFOX;
    }
    if platform == OsPlatform::Linux {
        return CDP_PORT_LINUX;
    }
    CDP_PORT_WINDOWS
}

fn default_profile_name(is_firefox: bool, platform_suffix: &str) -> String {
    if is_firefox {
        return BuildBrowser::Firefox.name().to_owned();
    }
    format!("{}-{platform_suffix}", BuildBrowser::Chrome.name())
}

/// Merges the flags with the host's facts.
pub(crate) fn resolve_options(args: &OptionArgs, host: &HostEnvironment) -> Result<DevOptions> {
    let project_root = std::path::absolute(&args.project_root)
        .map_err(OutputError::with_path(&args.project_root))?;
    let platform_suffix = if host.is_wsl {
        "wsl"
    } else {
        host.platform.name()
    };
    let default_profile = project_root
        .join(USER_PROFILES_DIR)
        .join(default_profile_name(args.is_firefox, platform_suffix));
    let profile_directory = args
        .profile_directory
        .as_ref()
        .map_or(default_profile, |directory| project_root.join(directory));
    Ok(DevOptions {
        is_firefox: args.is_firefox,
        is_audio_muted: args.should_mute_audio,
        is_wsl: host.is_wsl,
        profile_platform_suffix: platform_suffix.to_owned(),
        cdp_port: args
            .cdp_port
            .unwrap_or_else(|| default_cdp_port(args.is_firefox, host.platform)),
        marionette_port: args.marionette_port.unwrap_or(MARIONETTE_PORT_DEFAULT),
        profile_directory,
        out_directory: args.out_directory.clone(),
        start_url: args
            .start_url
            .clone()
            .unwrap_or_else(|| DEFAULT_START_URL.to_owned()),
        lang: host.lang.clone(),
        rebuild_debounce_ms: REBUILD_DEBOUNCE_MS,
        watch_poll_interval_ms: WATCH_POLL_INTERVAL_MS,
        hmr_port_offset: HMR_PORT_OFFSET,
        env_files: ENV_FILES.map(str::to_owned).to_vec(),
        install_marker_path: INSTALL_MARKER_PATH.to_owned(),
        installed_lockfile_path: lockfile_path(&project_root),
        project_root,
    })
}

fn lockfile_path(project_root: &Path) -> PathBuf {
    project_root.join("bun.lock")
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use crate::output::options::*;

    #[derive(Debug, Parser)]
    struct Wrapper {
        #[command(flatten)]
        args: OptionArgs,
    }

    fn host(platform: OsPlatform, is_wsl: bool) -> HostEnvironment {
        HostEnvironment {
            platform,
            is_wsl,
            home: PathBuf::new(),
            local_app_data: PathBuf::new(),
            app_data: PathBuf::new(),
            lang: "en".to_owned(),
        }
    }

    fn resolve(arguments: &[&str], host: &HostEnvironment) -> Result<DevOptions> {
        let wrapper = Wrapper::try_parse_from(
            ["ytdl", "--project-root", "/repo"]
                .into_iter()
                .chain(arguments.iter().copied()),
        )
        .map_err(|error| OutputError::Invalid(error.to_string()))?;
        resolve_options(&wrapper.args, host)
    }

    #[test]
    fn chrome_defaults_follow_the_platform() -> Result<()> {
        let windows = resolve(&[], &host(OsPlatform::Windows, false))?;
        assert_eq!(windows.cdp_port, 9229);
        assert!(windows.profile_directory.ends_with("chrome-win32"));
        let wsl = resolve(&[], &host(OsPlatform::Linux, true))?;
        assert_eq!(wsl.cdp_port, 9233);
        assert!(wsl.profile_directory.ends_with("chrome-wsl"));
        Ok(())
    }

    #[test]
    fn firefox_and_flags_override_the_defaults() -> Result<()> {
        let options = resolve(
            &["--firefox", "--cdp-port", "9300", "--profile-dir", "p"],
            &host(OsPlatform::Linux, false),
        )?;
        assert_eq!(options.cdp_port, 9300);
        assert_eq!(options.marionette_port, 2828);
        assert_eq!(options.browser(), BuildBrowser::Firefox);
        assert!(options.profile_directory.ends_with("p"));
        Ok(())
    }

    #[test]
    fn a_zero_port_is_rejected() {
        assert!(resolve(&["--cdp-port", "0"], &host(OsPlatform::Windows, false)).is_err());
    }
}

#[cfg(test)]
mod build_browser_tests {
    use clap::ValueEnum;

    use crate::output::options::*;

    #[test]
    fn one_browser_enum_serves_clap_serde_and_the_build_name() {
        let parsed = BuildBrowser::from_str("firefox", true).unwrap();
        assert_eq!(parsed, BuildBrowser::Firefox);
        assert_eq!(serde_json::to_string(&parsed).unwrap(), "\"firefox\"");
        assert_eq!(
            serde_json::from_str::<BuildBrowser>("\"chrome\"")
                .unwrap()
                .name(),
            "chrome"
        );
    }
}
