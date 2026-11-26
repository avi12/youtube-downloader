//! Which page-world scripts can replace their own run in an open tab. The wrapper only undoes event
//! listeners and `document`/`window` property definitions made while the script starts, so a script
//! qualifies only while its source does nothing else that outlives a run.

use std::io::ErrorKind;
use std::path::Path;

use crate::output::error::{OutputError, Result};

/// The first line of a wrapped script, by which a build snapshot recognizes it.
pub(super) const SWAPPABLE_MARKER: &str = "// ytdl-dev:swappable";

/// The page-world scripts reviewed as undoable. The others keep the run-once guard: `youtube-main`
/// holds in-page downloads, observers, player patches and mounted UI, and `iframe-mute` patches media
/// prototypes in per-download frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SwappableScript {
    VisibilitySpoof,
    PageSabrFetch,
}

impl SwappableScript {
    const ALL: [Self; 2] = [Self::VisibilitySpoof, Self::PageSabrFetch];

    const fn built_file(self) -> &'static str {
        match self {
            Self::VisibilitySpoof => "content-scripts/visibility-spoof.js",
            Self::PageSabrFetch => "content-scripts/page-sabr-fetch.js",
        }
    }

    const fn source_path(self) -> &'static str {
        match self {
            Self::VisibilitySpoof => "src/layers/youtube/entrypoints/visibility-spoof.content.ts",
            Self::PageSabrFetch => "src/layers/youtube/entrypoints/page-sabr-fetch.content.ts",
        }
    }
}

/// Source text that points at an effect the wrapper cannot undo.
const UNTRACKED_EFFECTS: [&str; 10] = [
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "requestIdleCallback",
    "Observer(",
    ".prototype",
    "globalThis",
    "window.",
    "navigator",
    "async main",
];

/// The first effect in a script's code, comment lines aside, that a swap would leave behind.
fn find_untracked_effect(source: &str) -> Option<&'static str> {
    let code: Vec<&str> = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect();
    UNTRACKED_EFFECTS
        .into_iter()
        .find(|effect| code.iter().any(|line| line.contains(effect)))
}

/// Whether a built file is a reviewed script whose source still qualifies.
pub(super) fn is_swappable_script(project_root: &Path, built_file: &str) -> Result<bool> {
    let Some(script) = SwappableScript::ALL
        .into_iter()
        .find(|script| script.built_file() == built_file)
    else {
        return Ok(false);
    };
    let path = project_root.join(script.source_path());
    let source = match std::fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(OutputError::with_path(&path)(error)),
    };
    if let Some(effect) = find_untracked_effect(&source) {
        eprintln!(
            "{built_file} cannot be swapped in open tabs: its source uses `{effect}`, which a swap cannot undo"
        );
        return Ok(false);
    }
    Ok(true)
}

/// Whether a built file carries the swap wrapper.
pub(crate) fn is_swappable_output(bytes: &[u8]) -> bool {
    bytes.starts_with(SWAPPABLE_MARKER.as_bytes())
}

#[cfg(test)]
mod tests {
    use crate::output::patches::main_world::*;

    fn repository_root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[test]
    fn effects_outside_comments_disqualify_a_script() {
        assert_eq!(
            find_untracked_effect("  // wraps window.fetch\nmain() {}"),
            None
        );
        assert_eq!(
            find_untracked_effect("main() { setInterval(tick, 1); }"),
            Some("setInterval")
        );
        assert_eq!(
            find_untracked_effect("new MutationObserver(run)"),
            Some("Observer(")
        );
    }

    #[test]
    fn the_reviewed_sources_still_qualify() -> Result<()> {
        for script in SwappableScript::ALL {
            assert!(is_swappable_script(
                &repository_root(),
                script.built_file()
            )?);
        }
        Ok(())
    }

    #[test]
    fn other_scripts_are_never_swappable() -> Result<()> {
        for file in [
            "content-scripts/youtube-main.js",
            "content-scripts/iframe-mute.js",
        ] {
            assert!(!is_swappable_script(&repository_root(), file)?);
        }
        Ok(())
    }
}
