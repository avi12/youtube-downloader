//! The two builds of the dev server: the production WXT build (a `pnpm wxt build` process, WXT
//! stays Node) with the dev patches applied to its output, and the HMR module build.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::time::sleep;

use super::error::{LauncherError, Result};
use super::log::log_event;
use super::wxt_worker::{run_wxt_build, WxtBuildRequest};
use crate::dev::hmr::{build_hmr, HmrBuild, HmrRequest};
use crate::dev::payload::{background_prelude_source, runtime_source, PayloadConfig};
use crate::output::manifest::{ExtensionManifest, MANIFEST_FILE};
use crate::output::options::DevOptions;
use crate::output::patches::{patch_built_output, patch_manifest};

const DEV_ONLY_PERMISSION: &str = "scripting";
const WXT_DEFAULT_OUT_DIR: &str = ".output";
const WXT_OUTPUT_SUFFIX: &str = "mv3";
const WXT_CONFIG_OVERRIDE: &str = include_str!("../../../assets/dev/wxt-out-dir.config.ts");
const WXT_CONFIG_OVERRIDE_FILE: &str = "ytdl-wxt-out-dir.config.ts";
const WXT_CONFIG_FILE: &str = "wxt.config.ts";
const BASE_CONFIG_VARIABLE: &str = "YTDL_WXT_BASE_CONFIG";
const OUT_DIR_VARIABLE: &str = "YTDL_WXT_OUT_DIR";
const NODE_PATH_VARIABLE: &str = "NODE_PATH";
const TRANSIENT_LOCK_MARKERS: [&str; 2] = ["EPERM", "EBUSY"];
const MAX_BUILD_ATTEMPTS: u32 = 3;
const BUILD_RETRY_DELAY: Duration = Duration::from_millis(300);

/// Where WXT writes this browser's build: `<outDir>/<browser>-mv3`.
pub(super) fn output_dir_of(options: &DevOptions) -> PathBuf {
    let base = options.out_dir.as_deref().unwrap_or(WXT_DEFAULT_OUT_DIR);
    options
        .project_root
        .join(base)
        .join(format!("{}-{WXT_OUTPUT_SUFFIX}", options.browser().name()))
}

fn node_path(options: &DevOptions) -> Option<OsString> {
    let platform_modules = options
        .project_root
        .join(format!("node_modules-{}", options.profile_platform_suffix));
    if !platform_modules.exists() {
        return None;
    }
    let existing = std::env::var_os(NODE_PATH_VARIABLE).unwrap_or_default();
    let mut paths = vec![platform_modules];
    paths.extend(std::env::split_paths(&existing));
    std::env::join_paths(paths).ok()
}

/// What the WXT build worker is started with: the platform `node_modules`, and the out-dir
/// override config when the output directory is not WXT's default.
struct WxtSetup {
    config_file: Option<PathBuf>,
    environment: Vec<(OsString, OsString)>,
}

fn wxt_setup(options: &DevOptions) -> Result<WxtSetup> {
    let mut environment = Vec::new();
    if let Some(paths) = node_path(options) {
        environment.push((OsString::from(NODE_PATH_VARIABLE), paths));
    }
    let Some(out_dir) = &options.out_dir else {
        return Ok(WxtSetup {
            config_file: None,
            environment,
        });
    };
    let override_path = std::env::temp_dir().join(WXT_CONFIG_OVERRIDE_FILE);
    std::fs::write(&override_path, WXT_CONFIG_OVERRIDE)?;
    environment.push((
        OsString::from(BASE_CONFIG_VARIABLE),
        options.project_root.join(WXT_CONFIG_FILE).into_os_string(),
    ));
    environment.push((
        OsString::from(OUT_DIR_VARIABLE),
        options.project_root.join(out_dir).into_os_string(),
    ));
    Ok(WxtSetup {
        config_file: Some(override_path),
        environment,
    })
}

fn add_dev_permission(output_dir: &Path) -> Result<()> {
    let mut manifest = ExtensionManifest::read(output_dir)?;
    let Some(object) = manifest.0.as_object_mut() else {
        return Err(LauncherError::Invalid(
            "the built manifest is not an object".to_owned(),
        ));
    };
    let permissions = object
        .entry("permissions")
        .or_insert_with(|| Value::Array(Vec::new()));
    let permission = json!(DEV_ONLY_PERMISSION);
    if let Some(list) = permissions
        .as_array_mut()
        .filter(|list| !list.contains(&permission))
    {
        list.push(permission);
    }
    std::fs::write(
        output_dir.join(MANIFEST_FILE),
        serde_json::to_string_pretty(&manifest.0)?,
    )?;
    Ok(())
}

async fn build_extension(options: &DevOptions) -> Result<PathBuf> {
    let prelude = background_prelude_source();
    let setup = wxt_setup(options)?;
    run_wxt_build(&WxtBuildRequest {
        project_root: &options.project_root,
        browser: options.browser().name(),
        config_file: setup.config_file.as_deref(),
        environment: setup.environment,
    })
    .await?;
    let output_dir = output_dir_of(options);
    add_dev_permission(&output_dir)?;
    patch_manifest(&output_dir)?;
    patch_built_output(&output_dir, &prelude)?;
    Ok(output_dir)
}

fn is_retryable(error: &LauncherError, attempt: u32) -> bool {
    let text = error.to_string();
    attempt < MAX_BUILD_ATTEMPTS
        && TRANSIENT_LOCK_MARKERS
            .iter()
            .any(|marker| text.contains(marker))
}

/// The browser serves extension files straight off the output dir and briefly holds them open, so
/// a rebuild's cleanup can hit a transient Windows lock. Builds are idempotent, so those are
/// retried; anything else (a mid-edit syntax error) fails at once.
pub(super) async fn build_with_lock_retry(options: &DevOptions) -> Result<PathBuf> {
    let mut attempt = 1;
    loop {
        let error = match build_extension(options).await {
            Ok(output_dir) => return Ok(output_dir),
            Err(error) => error,
        };
        if !is_retryable(&error, attempt) {
            return Err(error);
        }
        log_event(&format!(
            "Build hit a transient file lock (attempt {attempt}/{MAX_BUILD_ATTEMPTS}) - retrying"
        ));
        sleep(BUILD_RETRY_DELAY).await;
        attempt += 1;
    }
}

/// The hot-swappable entrypoints run from these modules, so every WXT build, which empties the
/// output dir, is followed by this.
pub(super) async fn build_hmr_modules(options: &DevOptions, output_dir: &Path) -> Result<HmrBuild> {
    let request = HmrRequest {
        project_root: options.project_root.clone(),
        output_dir: output_dir.to_owned(),
        browser: options.browser(),
        runtime_source: runtime_source(&PayloadConfig::dev_default())?,
    };
    let build = build_hmr(&request).await?;
    for line in &build.logs {
        log_event(line);
    }
    Ok(build)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(out_dir: Option<&str>) -> DevOptions {
        DevOptions {
            project_root: PathBuf::from("repo"),
            is_firefox: false,
            is_audio_muted: false,
            is_wsl: false,
            profile_platform_suffix: "linux".to_owned(),
            cdp_port: 9229,
            marionette_port: 2828,
            profile_dir: PathBuf::from("profile"),
            out_dir: out_dir.map(str::to_owned),
            start_url: String::new(),
            lang: "en".to_owned(),
            rebuild_debounce_ms: 800,
            watch_poll_interval_ms: 500,
            hmr_port_offset: 1000,
            env_files: Vec::new(),
            install_marker_path: String::new(),
            installed_lockfile_path: PathBuf::new(),
        }
    }

    #[test]
    fn the_output_dir_follows_wxt_naming() {
        let default = output_dir_of(&options(None));
        assert_eq!(default, PathBuf::from("repo/.output/chrome-mv3"));
        let custom = output_dir_of(&options(Some("out-two")));
        assert_eq!(custom, PathBuf::from("repo/out-two/chrome-mv3"));
    }

    #[test]
    fn only_transient_locks_are_retried() {
        let lock = LauncherError::Invalid("EBUSY: resource busy".to_owned());
        let syntax = LauncherError::Invalid("Unexpected token".to_owned());
        assert!(is_retryable(&lock, 1));
        assert!(!is_retryable(&lock, MAX_BUILD_ATTEMPTS));
        assert!(!is_retryable(&syntax, 1));
    }
}
