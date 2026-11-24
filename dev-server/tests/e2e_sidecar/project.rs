//! A throwaway extension project on disk: sources, a fake install and a pre-built output directory.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{json, Value};

/// The HMR manifest, relative to the output directory.
const HMR_MANIFEST_PATH: &str = "hmr/manifest.json";

pub(crate) struct Project {
    pub(crate) base: PathBuf,
    pub(crate) root: PathBuf,
    pub(crate) output: PathBuf,
}

impl Project {
    pub(crate) fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let base = std::env::temp_dir().join(format!(
            "ytdl-e2e-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let root = base.join("ext");
        let output = root.join("out");
        let project = Self { base, root, output };
        project.write("src/lib/a.ts", "export const a = 1;");
        project.write(
            "src/public/_locales/en/messages.json",
            r#"{"hello":{"message":"old"}}"#,
        );
        project.write("src/public/img/a.png", "png-v1");
        project.write(".env", "VITE_A=1");
        project.write_base("node_modules/.modules.yaml", "installed");
        project.write_base("node_modules/.pnpm/lock.yaml", "lock-v1");
        project.write_output(
            "manifest.json",
            &json!({
                "background": { "service_worker": "background.js" },
                "content_scripts": [
                    { "matches": ["https://www.youtube.com/*"], "js": ["content-scripts/main.js"], "world": "MAIN" }
                ]
            })
            .to_string(),
        );
        project.write_output("background.js", "bg v1");
        project.write_output("content-scripts/main.js", "main v1");
        project.write_output(HMR_MANIFEST_PATH, r#"{"sourceModules":[]}"#);
        project
    }

    pub(crate) fn write(&self, relative: &str, text: &str) {
        write_file(&self.root.join(relative), text);
    }

    pub(crate) fn write_base(&self, relative: &str, text: &str) {
        write_file(&self.base.join(relative), text);
    }

    pub(crate) fn write_output(&self, relative: &str, text: &str) {
        write_file(&self.output.join(relative), text);
    }

    pub(crate) fn read_output(&self, relative: &str) -> String {
        std::fs::read_to_string(self.output.join(relative)).unwrap()
    }

    pub(crate) fn hmr_manifest(&self) -> Value {
        serde_json::from_str(&self.read_output(HMR_MANIFEST_PATH)).unwrap()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

pub(crate) fn write_file(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}
