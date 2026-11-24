//! Public resources: where an edited public file lands and what applying it takes.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::error::{Error, Result};
use crate::types::{ContentHash, RelPath};

/// Public assets are copied into the output directory verbatim, minus this prefix.
pub const PUBLIC_SOURCE_PREFIX: &str = "src/public/";
/// Locale catalogs live under the public directory.
pub const LOCALES_SOURCE_PREFIX: &str = "src/public/_locales/";
/// The catalog file inside each locale directory.
pub const LOCALE_MESSAGES_FILE_NAME: &str = "messages.json";
/// The field of a catalog entry that holds its translated text.
pub const LOCALE_MESSAGE_FIELD: &str = "message";
/// Length of a resource's cache-busting version.
pub const RESOURCE_HASH_LENGTH: usize = 12;

/// What to do with one edited public file, decided from its bytes and the output's current bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum ResourceAction {
    /// The build already carries these bytes: nothing to apply.
    Unchanged,
    /// A locale catalog: diff it with [`diff_locale_catalog`], then copy to `output_path`.
    Locale {
        /// Output-relative destination.
        output_path: String,
    },
    /// Any other public file: copy to `output_path` and re-point live references to `public_path`.
    Asset {
        /// Output-relative destination.
        output_path: String,
        /// The URL path the page references (leading slash).
        public_path: String,
        /// The cache-busting version, see [`resource_version`].
        version: String,
    },
}

/// The pure half of `applyResourceUpdate`: `None` when `path` is not a public file, otherwise the
/// action. `existing_output` is the destination's current bytes, `None` when absent.
///
/// ```
/// use ytdl_dev_hot::changes::classifier::{plan_resource_update, ResourceAction};
/// use ytdl_dev_hot::types::RelPath;
///
/// let path = RelPath::new("src/public/img/a.png");
/// assert_eq!(plan_resource_update(&path, b"x", Some(b"x")), Some(ResourceAction::Unchanged));
/// let Some(ResourceAction::Asset { public_path, .. }) = plan_resource_update(&path, b"x", None) else {
///     panic!("expected an asset");
/// };
/// assert_eq!(public_path, "/img/a.png");
/// ```
pub fn plan_resource_update(
    path: &RelPath,
    content: &[u8],
    existing_output: Option<&[u8]>,
) -> Option<ResourceAction> {
    let output_path = public_output_path(path)?.to_owned();
    if existing_output == Some(content) {
        return Some(ResourceAction::Unchanged);
    }
    if is_locale_file(path) {
        return Some(ResourceAction::Locale { output_path });
    }
    Some(ResourceAction::Asset {
        public_path: format!("/{output_path}"),
        version: resource_version(content),
        output_path,
    })
}

/// The output-relative path of a public source file (`src/public/a/b.png` becomes `a/b.png`).
///
/// ```
/// use ytdl_dev_hot::changes::classifier::public_output_path;
/// use ytdl_dev_hot::types::RelPath;
///
/// assert_eq!(public_output_path(&RelPath::new("src/public/img/a.png")), Some("img/a.png"));
/// assert_eq!(public_output_path(&RelPath::new("src/lib/a.ts")), None);
/// ```
pub fn public_output_path(path: &RelPath) -> Option<&str> {
    path.strip_prefix(PUBLIC_SOURCE_PREFIX)
}

/// Whether the file is a locale catalog (`src/public/_locales/<lang>/messages.json`).
///
/// ```
/// use ytdl_dev_hot::changes::classifier::is_locale_file;
/// use ytdl_dev_hot::types::RelPath;
///
/// assert!(is_locale_file(&RelPath::new("src/public/_locales/en/messages.json")));
/// assert!(!is_locale_file(&RelPath::new("src/public/icon.png")));
/// ```
pub fn is_locale_file(path: &RelPath) -> bool {
    path.strip_prefix(LOCALES_SOURCE_PREFIX)
        .is_some_and(|rest| rest.ends_with(LOCALE_MESSAGES_FILE_NAME))
}

/// The cache-busting version of a public resource's bytes.
///
/// ```
/// use ytdl_dev_hot::changes::classifier::resource_version;
///
/// assert_eq!(resource_version(b"abc"), "ba7816bf8f01");
/// ```
pub fn resource_version(content: &[u8]) -> String {
    ContentHash::from_bytes(content)
        .prefix(RESOURCE_HASH_LENGTH)
        .to_owned()
}

/// The message keys that differ between two parsed catalogs (added, removed or edited).
/// Port of `diffLocaleCatalog`; the caller owns the last-seen cache and the session overlay.
///
/// ```
/// use serde_json::json;
/// use ytdl_dev_hot::changes::classifier::diff_locale_catalog;
///
/// let before = json!({"a": {"message": "1"}, "b": {"message": "2"}});
/// let after = json!({"a": {"message": "1"}, "b": {"message": "3"}, "c": {"message": "4"}});
/// assert_eq!(diff_locale_catalog(&before, &after)?, ["b", "c"]);
/// # Ok::<(), ytdl_dev_hot::Error>(())
/// ```
pub fn diff_locale_catalog(previous: &Value, next: &Value) -> Result<Vec<String>> {
    let (Some(previous_keys), Some(next_keys)) = (previous.as_object(), next.as_object()) else {
        return Err(Error::Protocol(
            "a locale catalog must be a JSON object".to_owned(),
        ));
    };
    let all_keys: BTreeSet<&String> = previous_keys.keys().chain(next_keys.keys()).collect();
    Ok(all_keys
        .into_iter()
        .filter(|key| previous_keys.get(*key) != next_keys.get(*key))
        .cloned()
        .collect())
}
