//! The frame tree `Page.getFrameTree` answers, flattened.

use serde::Deserialize;

/// One frame: its id and current URL.
#[derive(Debug, Deserialize)]
pub(super) struct Frame {
    pub(super) id: String,
    pub(super) url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameTree {
    frame: Frame,
    #[serde(default)]
    child_frames: Vec<Self>,
}

/// The reply of `Page.getFrameTree`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FrameTreeResult {
    frame_tree: FrameTree,
}

impl FrameTreeResult {
    /// Port of `collectFrames`, iterative: every frame of the tree.
    pub(super) fn into_frames(self) -> Vec<Frame> {
        let mut frames = Vec::new();
        let mut pending = vec![self.frame_tree];
        while let Some(node) = pending.pop() {
            frames.push(node.frame);
            pending.extend(node.child_frames);
        }
        frames
    }
}

#[cfg(test)]
mod tests {
    use crate::driver::cdp::frames::*;
    use crate::error::Result;

    #[test]
    fn frames_are_collected_from_the_whole_tree() -> Result<()> {
        let tree: FrameTreeResult = serde_json::from_str(
            r#"{"frameTree":{"frame":{"id":"a","url":"u1"},"childFrames":[{"frame":{"id":"b","url":"u2"},"childFrames":[{"frame":{"id":"c","url":"u3"}}]}]}}"#,
        )?;
        let mut ids: Vec<String> = tree
            .into_frames()
            .into_iter()
            .map(|frame| frame.id)
            .collect();
        ids.sort();
        assert_eq!(ids, ["a", "b", "c"]);
        Ok(())
    }
}
