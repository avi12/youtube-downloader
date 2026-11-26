//! The process environment layered over `.env`.

use std::collections::BTreeMap;
use std::path::Path;

use crate::release::ReleaseError;

const ENV_FILE: &str = ".env";

/// Process environment layered over the values of `.env`; the process wins, as with Node's
/// `loadEnvFile`.
pub(super) struct Environment {
    file_values: BTreeMap<String, String>,
}

impl Environment {
    pub(super) async fn load(root: &Path) -> Self {
        let text = tokio::fs::read_to_string(root.join(ENV_FILE))
            .await
            .unwrap_or_default();
        Self {
            file_values: parse_env_file(&text),
        }
    }

    pub(super) fn get(&self, name: &str) -> Option<String> {
        std::env::var(name)
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| self.file_values.get(name).cloned())
            .filter(|value| !value.is_empty())
    }

    pub(super) fn require(&self, name: &'static str) -> Result<String, ReleaseError> {
        self.get(name)
            .ok_or(ReleaseError::MissingEnvironment { name })
    }
}

fn parse_env_file(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.strip_prefix("export ").unwrap_or(line).split_once('='))
        .map(|(name, value)| (name.trim().to_owned(), unquote(value.trim()).to_owned()))
        .collect()
}

fn unquote(value: &str) -> &str {
    ['"', '\'']
        .iter()
        .find_map(|quote| value.strip_prefix(*quote)?.strip_suffix(*quote))
        .unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use crate::release::package::environment::*;

    #[test]
    fn env_file_skips_comments_and_strips_quotes() {
        let parsed = parse_env_file("# note\nA=1\nexport B=\"two words\"\n\nC='x'\nbroken\n");
        assert_eq!(parsed.get("A").map(String::as_str), Some("1"));
        assert_eq!(parsed.get("B").map(String::as_str), Some("two words"));
        assert_eq!(parsed.get("C").map(String::as_str), Some("x"));
        assert_eq!(parsed.len(), 3);
    }
}
