//! Chrome for Testing: branded Chrome 137+ removed `--load-extension`, Chrome for Testing keeps
//! it. The newest stable build is kept under `.chrome-for-testing/chrome/<platform>-<version>`,
//! downloaded when missing (the cache is reused as is while offline).

use std::cmp::Reverse;
use std::env;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::dev::launcher::error::{LauncherError, Result};
use crate::dev::launcher::log::log_event;
use crate::output::options::OsPlatform;
use crate::release::process::Invocation;

const CACHE_DIR: &str = ".chrome-for-testing/chrome";
const LAST_KNOWN_GOOD_URL: &str =
    "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json";
const DOWNLOAD_URL_BASE: &str = "https://storage.googleapis.com/chrome-for-testing-public";
const CURL_PROGRAM: &str = "curl";
const TAR_PROGRAM: &str = "tar";
const UNZIP_PROGRAM: &str = "unzip";
const ARM_ARCHITECTURE: &str = "aarch64";

/// The Chrome for Testing platform names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CftPlatform {
    Win64,
    Linux64,
    MacArm64,
    MacX64,
}

impl CftPlatform {
    fn detect(platform: OsPlatform) -> Self {
        match platform {
            OsPlatform::Windows => Self::Win64,
            OsPlatform::Linux => Self::Linux64,
            OsPlatform::MacOs if env::consts::ARCH == ARM_ARCHITECTURE => Self::MacArm64,
            OsPlatform::MacOs => Self::MacX64,
        }
    }

    const fn slug(self) -> &'static str {
        match self {
            Self::Win64 => "win64",
            Self::Linux64 => "linux64",
            Self::MacArm64 => "mac-arm64",
            Self::MacX64 => "mac-x64",
        }
    }

    fn executable_relative(self) -> PathBuf {
        let folder = format!("chrome-{}", self.slug());
        match self {
            Self::Win64 => PathBuf::from(folder).join("chrome.exe"),
            Self::Linux64 => PathBuf::from(folder).join("chrome"),
            Self::MacArm64 | Self::MacX64 => PathBuf::from(folder)
                .join("Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct LastKnownGood {
    channels: Channels,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Channels {
    stable: Channel,
}

#[derive(Debug, Deserialize)]
struct Channel {
    version: String,
}

fn build_directory(cache: &Path, platform: CftPlatform, version: &str) -> PathBuf {
    cache.join(format!("{}-{version}", platform.slug()))
}

fn version_key(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

/// The newest build already extracted in the cache.
fn newest_cached(cache: &Path, platform: CftPlatform) -> Option<PathBuf> {
    let prefix = format!("{}-", platform.slug());
    let mut builds: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(cache)
        .ok()?
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let version = name.strip_prefix(&prefix)?.to_owned();
            let executable = entry.path().join(platform.executable_relative());
            executable
                .is_file()
                .then(|| (version_key(&version), executable))
        })
        .collect();
    builds.sort_by_key(|(key, _)| Reverse(key.clone()));
    builds.into_iter().next().map(|(_, executable)| executable)
}

async fn fetch_stable_version() -> Result<String> {
    let body = Invocation::new(CURL_PROGRAM)
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            LAST_KNOWN_GOOD_URL,
        ])
        .capture_checked()
        .await?;
    Ok(serde_json::from_str::<LastKnownGood>(&body)?
        .channels
        .stable
        .version)
}

async fn download(platform: CftPlatform, version: &str, destination: &Path) -> Result<()> {
    let slug = platform.slug();
    let url = format!("{DOWNLOAD_URL_BASE}/{version}/{slug}/chrome-{slug}.zip");
    std::fs::create_dir_all(destination)?;
    let archive = destination.join(format!("chrome-{slug}.zip"));
    Invocation::new(CURL_PROGRAM)
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--output",
        ])
        .args([&archive])
        .args([url])
        .capture_checked()
        .await?;
    let extraction = if platform == CftPlatform::Linux64 {
        Invocation::new(UNZIP_PROGRAM)
            .args(["-q", "-o"])
            .args([&archive])
            .args(["-d"])
            .args([destination])
    } else {
        Invocation::new(TAR_PROGRAM)
            .args(["-xf"])
            .args([&archive])
            .args(["-C"])
            .args([destination])
    };
    extraction.capture_checked().await?;
    std::fs::remove_file(archive)?;
    Ok(())
}

/// The Chrome for Testing executable, downloading the newest stable build when it is missing.
pub(super) async fn ensure_chrome(project_root: &Path, os_platform: OsPlatform) -> Result<PathBuf> {
    let platform = CftPlatform::detect(os_platform);
    let cache = project_root.join(CACHE_DIR);
    let Ok(version) = fetch_stable_version().await else {
        return newest_cached(&cache, platform).ok_or_else(|| {
            LauncherError::Browser(
                "could not look up Chrome for Testing and none is cached".to_owned(),
            )
        });
    };
    let directory = build_directory(&cache, platform, &version);
    let executable = directory.join(platform.executable_relative());
    if executable.is_file() {
        return Ok(executable);
    }
    log_event(&format!(
        "Downloading Chrome for Testing ({}, build {version})...",
        platform.slug()
    ));
    download(platform, &version, &directory).await?;
    log_event(&format!(
        "Chrome for Testing installed at {}",
        executable.display()
    ));
    Ok(executable)
}

#[cfg(test)]
mod tests {
    use crate::dev::launcher::browser::cft::*;

    #[test]
    fn versions_compare_numerically() {
        assert!(version_key("149.0.7827.54") > version_key("149.0.7827.9"));
        assert!(version_key("150.0.1.0") > version_key("149.9.9.9"));
    }

    #[test]
    fn the_newest_extracted_build_wins() {
        let cache = env::temp_dir().join(format!("ytdl-cft-test-{}", std::process::id()));
        let platform = CftPlatform::detect(OsPlatform::Windows);
        for version in ["148.0.1.0", "149.0.2.0"] {
            let executable =
                build_directory(&cache, platform, version).join(platform.executable_relative());
            std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
            std::fs::write(&executable, "").unwrap();
        }
        let newest = newest_cached(&cache, platform).unwrap();
        std::fs::remove_dir_all(&cache).unwrap();
        assert!(newest.to_string_lossy().contains("149.0.2.0"));
    }
}
