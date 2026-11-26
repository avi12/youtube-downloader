//! The Firefox `updates.json` that self-hosted auto-updates read.

use crate::firefox::GECKO_ID;
use std::collections::BTreeMap;

use serde::Serialize;

use crate::release::ReleaseError;

const FIREFOX_STRICT_MIN_VERSION: &str = "147.0";

#[derive(Debug, Serialize)]
struct UpdatesDocument {
    addons: BTreeMap<&'static str, AddonUpdates>,
}

#[derive(Debug, Serialize)]
struct AddonUpdates {
    updates: Vec<AddonUpdate>,
}

#[derive(Debug, Serialize)]
struct AddonUpdate {
    version: String,
    update_link: String,
    applications: Applications,
}

#[derive(Debug, Serialize)]
struct Applications {
    gecko: Gecko,
}

#[derive(Debug, Serialize)]
struct Gecko {
    strict_min_version: &'static str,
}

pub(super) fn render_updates_json(version: &str, xpi_url: &str) -> Result<String, ReleaseError> {
    let update = AddonUpdate {
        version: version.to_owned(),
        update_link: xpi_url.to_owned(),
        applications: Applications {
            gecko: Gecko {
                strict_min_version: FIREFOX_STRICT_MIN_VERSION,
            },
        },
    };
    let document = UpdatesDocument {
        addons: BTreeMap::from([(
            GECKO_ID,
            AddonUpdates {
                updates: vec![update],
            },
        )]),
    };
    Ok(format!("{}\n", serde_json::to_string_pretty(&document)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_json_matches_the_amo_shape() {
        let rendered = render_updates_json("1.2.3", "https://example.test/a.xpi").unwrap();
        let value: serde_json::Value = serde_json::from_str(&rendered).unwrap();
        let update = &value["addons"][GECKO_ID]["updates"][0];
        assert_eq!(update["version"], "1.2.3");
        assert_eq!(update["update_link"], "https://example.test/a.xpi");
        assert_eq!(
            update["applications"]["gecko"]["strict_min_version"],
            "147.0"
        );
        assert!(rendered.ends_with("}\n"));
    }
}
