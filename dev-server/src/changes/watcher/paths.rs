//! Mapping notify's absolute event paths back to project-relative ones.

use std::path::{Component, Path};

use crate::types::RelPath;

/// Resolves `.` and `..` lexically, without touching the file system.
fn normalized_components(path: &Path) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                let is_poppable = parts.last().is_some_and(|last| last != "..");
                if is_poppable {
                    parts.pop();
                } else {
                    parts.push("..".to_owned());
                }
            }
            other => parts.push(other.as_os_str().to_string_lossy().into_owned()),
        }
    }
    parts
}

/// The project-relative path of an event path: the configured watch path itself, or a path below
/// a watched directory. `None` for paths outside every watch (the install marker lives in `..`,
/// so plain prefix stripping against the root would lose it).
///
/// ```
/// use std::path::Path;
/// use ytdl_dev_hot::types::RelPath;
/// use ytdl_dev_hot::changes::watcher::relativize;
///
/// let watches = [RelPath::new("src"), RelPath::new("../node_modules/.modules.yaml")];
/// let root = Path::new("/work/ext");
/// assert_eq!(
///     relativize(root, &watches, Path::new("/work/ext/src/lib/a.ts")),
///     Some(RelPath::new("src/lib/a.ts"))
/// );
/// assert_eq!(
///     relativize(root, &watches, Path::new("/work/ext/../node_modules/.modules.yaml")),
///     Some(RelPath::new("../node_modules/.modules.yaml"))
/// );
/// assert_eq!(relativize(root, &watches, Path::new("/elsewhere/a.ts")), None);
/// ```
pub fn relativize(root: &Path, watches: &[RelPath], event_path: &Path) -> Option<RelPath> {
    let event_parts = normalized_components(event_path);
    for watch in watches {
        let watch_parts = normalized_components(&root.join(watch.as_str()));
        if event_parts == watch_parts {
            return Some(watch.clone());
        }
        let Some(rest) = event_parts
            .strip_prefix(watch_parts.as_slice())
            .filter(|rest| !rest.is_empty())
        else {
            continue;
        };
        let base = watch.as_str().trim_end_matches('/');
        return Some(RelPath::new(format!("{base}/{}", rest.join("/"))));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relativize_handles_directories_and_files() {
        let watches = [RelPath::new("src"), RelPath::new("wxt.config.ts")];
        let root = Path::new("/p");
        assert_eq!(
            relativize(root, &watches, Path::new("/p/wxt.config.ts")),
            Some(RelPath::new("wxt.config.ts"))
        );
        assert_eq!(relativize(root, &watches, Path::new("/p/srcx/a.ts")), None);
        assert_eq!(
            relativize(root, &watches, Path::new("/p/src")),
            Some(RelPath::new("src"))
        );
    }
}
