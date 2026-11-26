//! The dev browser's own profile, seeded once from the user's, and cleanup of a leftover instance
//! on it. Port of `scripts/dev/server/profiles.ts`.

use std::fs;
use std::path::{Path, PathBuf};

mod processes;

use crate::output::error::{OutputError, Result};
use crate::output::options::{BuildBrowser, DevOptions, HostEnvironment, OsPlatform};

const SEEDED_SENTINEL: &str = ".seeded";
const CHROME_PROFILE_DIRECTORIES: [&str; 2] = ["Default", "Profile 1"];
const BOOKMARKS_FILE: &str = "Bookmarks";
const FIREFOX_SESSION_FILES: [&str; 7] = [
    "cookies.sqlite",
    "key4.db",
    "logins.json",
    "cert9.db",
    "permissions.sqlite",
    "places.sqlite",
    "favicons.sqlite",
];
const PROFILES_INI: &str = "profiles.ini";

fn create_directory(directory: &Path) -> Result<()> {
    fs::create_dir_all(directory).map_err(OutputError::with_path(directory))
}

fn copy_file(source: &Path, destination: &Path) -> Result<()> {
    fs::copy(source, destination)
        .map(drop)
        .map_err(OutputError::with_path(source))
}

fn write_sentinel(path: &Path) -> Result<()> {
    if let Some(directory) = path.parent() {
        create_directory(directory)?;
    }
    fs::write(path, "").map_err(OutputError::with_path(path))
}

fn chrome_user_data_dir(host: &HostEnvironment) -> PathBuf {
    match host.platform {
        OsPlatform::Windows => host
            .local_app_data
            .join("Google")
            .join("Chrome")
            .join("User Data"),
        OsPlatform::MacOs => host.home.join("Library/Application Support/Google/Chrome"),
        OsPlatform::Linux => host.home.join(".config/google-chrome"),
    }
}

fn firefox_data_dir(host: &HostEnvironment) -> PathBuf {
    match host.platform {
        OsPlatform::Windows => host.app_data.join("Mozilla").join("Firefox"),
        OsPlatform::MacOs => host.home.join("Library/Application Support/Firefox"),
        OsPlatform::Linux => host.home.join(".mozilla").join("firefox"),
    }
}

/// Seeds a Chrome profile with the user's bookmarks, once. Only Bookmarks: Preferences, Secure
/// Preferences and Local State carry DPAPI-sealed fields that send a cloned profile into
/// decryption loops until Chrome exits.
pub(crate) fn setup_chrome_profile(options: &DevOptions, host: &HostEnvironment) -> Result<()> {
    let profile = &options.profile_dir;
    if profile.join("Default").join(SEEDED_SENTINEL).exists() {
        return Ok(());
    }
    let source = chrome_user_data_dir(host);
    if !source.exists() {
        return create_directory(profile);
    }
    eprintln!("Setting up Chrome profile from {}...", source.display());
    for directory in CHROME_PROFILE_DIRECTORIES {
        let bookmarks = source.join(directory).join(BOOKMARKS_FILE);
        if !bookmarks.exists() {
            continue;
        }
        let destination = profile.join(directory);
        create_directory(&destination)?;
        copy_file(&bookmarks, &destination.join(BOOKMARKS_FILE))?;
    }
    eprintln!("Profile setup complete.");
    write_sentinel(&profile.join("Default").join(SEEDED_SENTINEL))
}

#[derive(Default)]
struct IniProfile {
    path: Option<String>,
    is_default: bool,
    is_relative: bool,
}

fn is_profile_header(line: &str) -> bool {
    let digit = line
        .strip_prefix("[Profile")
        .and_then(|rest| rest.chars().next());
    digit.is_some_and(|character| character.is_ascii_digit())
}

/// The `[Install...] Default=` profile Firefox actually launches, else the `Default=1` profile.
fn default_profile_path(ini: &str, data_dir: &Path) -> Option<PathBuf> {
    let mut is_install_section = false;
    let mut profiles: Vec<IniProfile> = Vec::new();
    for line in ini.lines().map(str::trim) {
        if line.starts_with('[') {
            is_install_section = line.starts_with("[Install");
            if is_profile_header(line) {
                profiles.push(IniProfile::default());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("Default=").filter(|_| is_install_section) {
            return Some(data_dir.join(value.trim()));
        }
        let Some(profile) = profiles.last_mut().filter(|_| !is_install_section) else {
            continue;
        };
        match line.split_once('=') {
            Some(("Path", value)) => profile.path = Some(value.trim().to_owned()),
            Some(("Default", "1")) => profile.is_default = true,
            Some(("IsRelative", "1")) => profile.is_relative = true,
            _ => {}
        }
    }
    let default = profiles.into_iter().find(|profile| profile.is_default)?;
    let path = PathBuf::from(default.path?);
    Some(if default.is_relative {
        data_dir.join(path)
    } else {
        path
    })
}

/// Seeds a Firefox profile with the user's session files, once.
pub(crate) fn setup_firefox_profile(options: &DevOptions, host: &HostEnvironment) -> Result<()> {
    let profile = &options.profile_dir;
    if profile.join(SEEDED_SENTINEL).exists() {
        return Ok(());
    }
    create_directory(profile)?;
    let data_dir = firefox_data_dir(host);
    let ini = fs::read_to_string(data_dir.join(PROFILES_INI)).unwrap_or_default();
    let source = default_profile_path(&ini, &data_dir).filter(|path| path.exists());
    if let Some(source) = source {
        eprintln!("Setting up Firefox profile from {}...", source.display());
        for file in FIREFOX_SESSION_FILES {
            let session_file = source.join(file);
            if session_file.exists() {
                copy_file(&session_file, &profile.join(file))?;
            }
        }
        eprintln!("Profile setup complete.");
    }
    write_sentinel(&profile.join(SEEDED_SENTINEL))
}

/// Seeds the profile of the browser the options target.
pub(crate) fn setup_profile(options: &DevOptions, host: &HostEnvironment) -> Result<()> {
    match options.browser() {
        BuildBrowser::Chrome => setup_chrome_profile(options, host),
        BuildBrowser::Firefox => setup_firefox_profile(options, host),
    }
}

/// Stops a leftover browser started on this dev server's own profile: only the processes whose
/// command line names that profile directory, by process id.
pub(crate) async fn clean_leftover_instances(
    options: &DevOptions,
    host: &HostEnvironment,
) -> Result<()> {
    match (options.browser(), host.platform) {
        (BuildBrowser::Chrome, OsPlatform::Linux | OsPlatform::Windows)
        | (BuildBrowser::Firefox, OsPlatform::Windows) => {
            processes::stop_on_profile(host.platform, &options.profile_dir).await
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use crate::output::profile::*;

    const INI_WITH_INSTALL: &str = "[Profile0]\nName=old\nIsRelative=1\nPath=Profiles/old\nDefault=1\n\n[Install4F96D1932A9F858E]\nDefault=Profiles/live\nLocked=1\n";

    #[test]
    fn the_install_default_wins() {
        let path = default_profile_path(INI_WITH_INSTALL, Path::new("/data"));
        assert_eq!(path, Some(PathBuf::from("/data").join("Profiles/live")));
    }

    #[test]
    fn a_default_profile_resolves_relative_and_absolute_paths() {
        let relative = "[Profile1]\nName=a\nIsRelative=1\nPath=Profiles/a\nDefault=1\n";
        assert_eq!(
            default_profile_path(relative, Path::new("/data")),
            Some(PathBuf::from("/data").join("Profiles/a"))
        );
        let absolute = "[Profile1]\r\nIsRelative=0\r\nPath=/abs/a\r\nDefault=1\r\n";
        assert_eq!(
            default_profile_path(absolute, Path::new("/data")),
            Some(PathBuf::from("/abs/a"))
        );
        assert_eq!(
            default_profile_path("[Profile1]\nPath=x\n", Path::new("/data")),
            None
        );
    }
}
