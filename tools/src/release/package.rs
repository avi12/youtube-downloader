//! `release package`: builds Chrome and Firefox, packs the CRX, signs the XPI through AMO and
//! writes `docs/updates.json`. The builds themselves stay in Node (`pnpm build`, `web-ext`).

use std::path::{Path, PathBuf};

use clap::Args as ClapArgs;
use serde::Deserialize;

mod environment;
mod updates;

use self::environment::Environment;
use self::updates::{render_updates_json, FIREFOX_GECKO_ID};
use super::process::Invocation;
use super::ReleaseError;

const RELEASES_BASE: &str = "https://github.com/avi12/youtube-downloader/releases/download";
const KEY_PATH_VARIABLE: &str = "CHROME_CRX_PRIVATE_KEY_PATH";
const AMO_ISSUER_VARIABLE: &str = "AMO_JWT_ISSUER";
const AMO_SECRET_VARIABLE: &str = "AMO_JWT_SECRET";
const CHROME_BINARY_VARIABLE: &str = "CHROME_BIN";
const CHROME_BUILD_DIRECTORY: &str = "chrome-mv3";
const FIREFOX_BUILD_DIRECTORY: &str = "firefox-mv3";

/// Arguments of `release package`.
#[derive(Debug, ClapArgs)]
pub(crate) struct Args {
    /// The repository root (holds package.json, .env and docs)
    #[arg(long, default_value = ".")]
    root: PathBuf,
}

#[derive(Debug, Deserialize)]
struct PackageJson {
    version: String,
}

/// Where the artifacts of one version live.
struct Layout {
    root: PathBuf,
    artifacts: PathBuf,
    version: String,
}

impl Layout {
    fn new(root: PathBuf, version: String) -> Self {
        let artifacts = root.join(".output");
        Self {
            root,
            artifacts,
            version,
        }
    }

    fn chrome_zip(&self) -> PathBuf {
        self.artifacts
            .join(format!("youtube-downloader-{}-chrome.zip", self.version))
    }

    fn chrome_crx(&self) -> PathBuf {
        self.artifacts
            .join(format!("youtube-downloader-{}-chrome.crx", self.version))
    }

    fn firefox_xpi_name(&self) -> String {
        format!("youtube-downloader-{}-firefox.xpi", self.version)
    }

    fn firefox_xpi(&self) -> PathBuf {
        self.artifacts.join(self.firefox_xpi_name())
    }

    fn firefox_xpi_url(&self) -> String {
        format!(
            "{RELEASES_BASE}/v{}/{}",
            self.version,
            self.firefox_xpi_name()
        )
    }
}

fn chrome_candidates(root: &Path) -> Vec<PathBuf> {
    if cfg!(windows) {
        return vec![
            PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
            root.join(".chrome-for-testing")
                .join("chrome-win64")
                .join("chrome.exe"),
        ];
    }
    if cfg!(target_os = "macos") {
        return vec![PathBuf::from(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        )];
    }
    [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
    ]
    .map(PathBuf::from)
    .to_vec()
}

async fn exists(path: &Path) -> bool {
    tokio::fs::try_exists(path).await.unwrap_or(false)
}

async fn assert_artifact(path: &Path, description: &'static str) -> Result<(), ReleaseError> {
    if exists(path).await {
        return Ok(());
    }
    Err(ReleaseError::ArtifactMissing {
        description,
        path: path.to_path_buf(),
    })
}

async fn assert_build(
    layout: &Layout,
    browser: &'static str,
    directory: &str,
) -> Result<PathBuf, ReleaseError> {
    let source = layout.artifacts.join(directory);
    if exists(&source).await {
        return Ok(source);
    }
    Err(ReleaseError::BuildMissing {
        browser,
        path: source,
    })
}

async fn find_chrome_binary(
    environment: &Environment,
    root: &Path,
) -> Result<PathBuf, ReleaseError> {
    if let Some(configured) = environment.get(CHROME_BINARY_VARIABLE) {
        let path = PathBuf::from(configured);
        if exists(&path).await {
            return Ok(path);
        }
    }
    for candidate in chrome_candidates(root) {
        if exists(&candidate).await {
            return Ok(candidate);
        }
    }
    Err(ReleaseError::ChromeNotFound)
}

async fn build_and_package_chrome(layout: &Layout) -> Result<(), ReleaseError> {
    Invocation::pnpm()
        .arg("build")
        .in_directory(&layout.root)
        .run_inherited()
        .await?;
    Invocation::pnpm()
        .args(["run", "pack"])
        .in_directory(&layout.root)
        .run_inherited()
        .await?;
    assert_artifact(&layout.chrome_zip(), "Chrome zip").await
}

async fn pack_chrome_crx(
    layout: &Layout,
    environment: &Environment,
    key_path: &Path,
) -> Result<(), ReleaseError> {
    if !exists(key_path).await {
        return Err(ReleaseError::KeyNotFound(key_path.to_path_buf()));
    }
    let chrome = find_chrome_binary(environment, &layout.root).await?;
    let source = assert_build(layout, "Chrome", CHROME_BUILD_DIRECTORY).await?;
    Invocation::new(chrome)
        .arg(format!("--pack-extension={}", source.display()))
        .arg(format!("--pack-extension-key={}", key_path.display()))
        .arg("--no-message-box")
        .run_inherited()
        .await?;
    let packed = source.with_extension("crx");
    assert_artifact(&packed, "packed Chrome CRX").await?;
    tokio::fs::copy(&packed, layout.chrome_crx()).await?;
    assert_artifact(&layout.chrome_crx(), "Chrome CRX").await
}

async fn find_latest_signed_xpi(layout: &Layout) -> Result<PathBuf, ReleaseError> {
    let suffix = format!("-{}.xpi", layout.version);
    let own = layout.firefox_xpi();
    let mut entries = tokio::fs::read_dir(&layout.artifacts).await?;
    let mut latest: Option<(std::time::SystemTime, PathBuf)> = None;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let is_signed = entry.file_name().to_string_lossy().ends_with(&suffix) && path != own;
        if !is_signed {
            continue;
        }
        let modified = entry.metadata().await?.modified()?;
        if latest.as_ref().is_none_or(|(newest, _)| modified > *newest) {
            latest = Some((modified, path));
        }
    }
    latest
        .map(|(_, path)| path)
        .ok_or_else(|| ReleaseError::NoSignedXpi(layout.version.clone()))
}

async fn sign_firefox_xpi(layout: &Layout, issuer: &str, secret: &str) -> Result<(), ReleaseError> {
    let xpi = layout.firefox_xpi();
    if exists(&xpi).await {
        println!(
            "Signed Firefox XPI already exists at {}; reusing it",
            xpi.display()
        );
        return Ok(());
    }
    let source = assert_build(layout, "Firefox", FIREFOX_BUILD_DIRECTORY).await?;
    Invocation::pnpm()
        .args(["dlx", "web-ext", "sign"])
        .arg(format!("--source-dir={}", source.display()))
        .arg(format!("--artifacts-dir={}", layout.artifacts.display()))
        .arg(format!("--api-key={issuer}"))
        .arg(format!("--api-secret={secret}"))
        .arg("--channel=unlisted")
        .in_directory(&layout.root)
        .run_inherited()
        .await?;
    tokio::fs::copy(find_latest_signed_xpi(layout).await?, &xpi).await?;
    assert_artifact(&xpi, "Firefox XPI").await
}

pub(super) async fn run(args: Args) -> Result<(), ReleaseError> {
    let environment = Environment::load(&args.root).await;
    let manifest = tokio::fs::read_to_string(args.root.join("package.json")).await?;
    let PackageJson { version } = serde_json::from_str(&manifest)?;
    let layout = Layout::new(args.root, version);
    let key_path = PathBuf::from(environment.require(KEY_PATH_VARIABLE)?);
    let issuer = environment.require(AMO_ISSUER_VARIABLE)?;
    let secret = environment.require(AMO_SECRET_VARIABLE)?;

    build_and_package_chrome(&layout).await?;
    pack_chrome_crx(&layout, &environment, &key_path).await?;
    Invocation::pnpm()
        .arg("build:firefox")
        .in_directory(&layout.root)
        .run_inherited()
        .await?;
    sign_firefox_xpi(&layout, &issuer, &secret).await?;

    let docs = layout.root.join("docs");
    tokio::fs::create_dir_all(&docs).await?;
    let updates = render_updates_json(&layout.version, &layout.firefox_xpi_url())?;
    tokio::fs::write(docs.join("updates.json"), updates).await?;
    println!(
        "Wrote docs/updates.json (Firefox addon={FIREFOX_GECKO_ID}, version={})",
        layout.version
    );
    println!("Release artifacts:");
    for artifact in [
        layout.chrome_crx(),
        layout.chrome_zip(),
        layout.firefox_xpi(),
    ] {
        println!("  {}", artifact.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xpi_url_points_at_the_tagged_release() {
        let layout = Layout::new(PathBuf::from("."), "2.9.0".to_owned());
        assert_eq!(
            layout.firefox_xpi_url(),
            "https://github.com/avi12/youtube-downloader/releases/download/v2.9.0/youtube-downloader-2.9.0-firefox.xpi"
        );
    }
}
