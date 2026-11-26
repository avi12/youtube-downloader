//! Public-resource edits applied without a build: copy each edited file into the output directory,
//! then publish locale strings into the overlay and every other file as a new version. Port of
//! `applyResourceUpdate`.

use std::collections::BTreeSet;

use serde_json::{json, Value};
use tokio::time::Instant;

use crate::bridge::Host;
use crate::changes::classifier::{
    diff_locale_catalog, plan_resource_update, public_output_path, ResourceAction,
    LOCALE_MESSAGE_FIELD,
};
use crate::changes::workspace::Workspace;
use crate::driver::BrowserDriver;
use crate::error::Result;
use crate::orchestrator::Orchestrator;
use crate::types::RelPath;

/// What applying one resource changed.
enum ResourceEffect {
    None,
    Strings(usize),
    Asset(String),
}

impl<H: Host, D: BrowserDriver, W: Workspace> Orchestrator<H, D, W> {
    pub(super) async fn apply_resource_update(
        &mut self,
        resources: &BTreeSet<RelPath>,
    ) -> Result<()> {
        if resources.is_empty() {
            return Ok(());
        }
        let started = Instant::now();
        let mut changed_keys = 0;
        let mut changed_resources = Vec::new();
        for path in resources {
            match self.apply_resource(path).await? {
                ResourceEffect::None => {}
                ResourceEffect::Strings(count) => changed_keys += count,
                ResourceEffect::Asset(public_path) => changed_resources.push(public_path),
            }
        }
        if changed_keys == 0 && changed_resources.is_empty() {
            tracing::info!(
                "Resource change had no effective changes ({}ms) - nothing to apply",
                started.elapsed().as_millis()
            );
            return Ok(());
        }
        self.write_extras().await?;
        self.broadcast_manifest().await?;
        let note = if changed_resources.is_empty() {
            String::new()
        } else {
            format!(", {} re-pointed", changed_resources.join(", "))
        };
        tracing::info!(
            "Resource hot-swap ({}ms) - {changed_keys} string(s){note}, no reload",
            started.elapsed().as_millis()
        );
        Ok(())
    }

    async fn apply_resource(&mut self, path: &RelPath) -> Result<ResourceEffect> {
        let Some(content) = self.files.read_public_file(path).await? else {
            return Ok(ResourceEffect::None);
        };
        let Some(output_path) = public_output_path(path) else {
            return Ok(ResourceEffect::None);
        };
        let existing = self.files.read_output(output_path).await?;
        match plan_resource_update(path, &content, existing.as_deref()) {
            Some(ResourceAction::Locale { output_path }) => {
                let Some(count) = self.merge_locale(path, &content) else {
                    return Ok(ResourceEffect::None);
                };
                self.files.write_output(&output_path, content).await?;
                Ok(ResourceEffect::Strings(count))
            }
            Some(ResourceAction::Asset {
                output_path,
                public_path,
                version,
            }) => {
                self.extras
                    .resource_versions
                    .insert(public_path.clone(), version);
                self.files.write_output(&output_path, content).await?;
                Ok(ResourceEffect::Asset(public_path))
            }
            _ => Ok(ResourceEffect::None),
        }
    }

    /// The number of strings a locale edit changed, merged into the session overlay; `None` for a
    /// file that is not valid JSON yet (mid-edit), which is neither copied nor applied.
    fn merge_locale(&mut self, path: &RelPath, content: &[u8]) -> Option<usize> {
        let Ok(next) = serde_json::from_slice::<Value>(content) else {
            tracing::info!(
                "Locale {} is not valid JSON (mid-edit?) - waiting for the next save",
                path.as_str()
            );
            return None;
        };
        let empty_catalog = json!({});
        let previous = self.locale_catalogs.get(path).unwrap_or(&empty_catalog);
        let changed_keys = diff_locale_catalog(previous, &next).ok()?;
        for key in &changed_keys {
            let entry = next
                .get(key)
                .cloned()
                .unwrap_or_else(|| json!({ LOCALE_MESSAGE_FIELD: "" }));
            self.extras.overlay.insert(key.clone(), entry);
        }
        self.locale_catalogs.insert(path.clone(), next);
        Some(changed_keys.len())
    }
}
