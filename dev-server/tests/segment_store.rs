//! Both stores keep the same promises.

use std::fs;
use std::path::PathBuf;

use ytdl_dev_hot::downloads::{SafeName, SegmentKey, Storage};
use ytdl_dev_hot::Result;

fn scratch_directory(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("ytdl-segments-{label}-{}", std::process::id()))
}

fn key(track: &str, index: u64) -> Result<SegmentKey> {
    Ok(SegmentKey {
        track: SafeName::new(track)?,
        index,
    })
}

fn check_store(storage: Storage) -> Result<()> {
    let store = storage.open();
    let download = SafeName::new("video-1")?;
    assert_eq!(store.held(&download)?, Vec::<SegmentKey>::new());
    assert_eq!(store.load(&download, &key("audio", 0)?)?, None);

    store.save(&download, &key("video", 10)?, b"later")?;
    store.save(&download, &key("video", 2)?, b"first copy")?;
    store.save(&download, &key("video", 2)?, b"earlier")?;
    store.save(&download, &key("audio", 0)?, b"sound")?;

    assert_eq!(
        store.held(&download)?,
        [key("audio", 0)?, key("video", 2)?, key("video", 10)?]
    );
    assert_eq!(
        store.load(&download, &key("video", 2)?)?,
        Some(b"earlier".to_vec())
    );

    store.remove(&download)?;
    store.remove(&download)?;
    assert_eq!(store.held(&download)?, Vec::<SegmentKey>::new());
    Ok(())
}

#[test]
fn memory_keeps_segments_in_order() -> Result<()> {
    check_store(Storage::Memory)
}

#[test]
fn disk_keeps_segments_in_order() -> Result<()> {
    let root = scratch_directory("order");
    check_store(Storage::Disk(root.clone()))?;
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn disk_segments_outlive_the_store_and_partial_writes_are_ignored() -> Result<()> {
    let root = scratch_directory("restart");
    let download = SafeName::new("video-2")?;
    Storage::Disk(root.clone())
        .open()
        .save(&download, &key("video", 1)?, b"kept")?;
    fs::write(root.join("video-2").join("video").join("2.part"), b"cut")?;

    let reopened = Storage::Disk(root.clone()).open();
    assert_eq!(reopened.held(&download)?, [key("video", 1)?]);
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn a_segment_key_is_validated_while_it_is_parsed() {
    let parse = serde_json::from_str::<SegmentKey>;
    assert!(parse(r#"{"track":"audio","index":1}"#).is_ok());
    assert!(parse(r#"{"track":"../up","index":1}"#).is_err());
    assert!(parse(r#"{"track":"audio","index":-1}"#).is_err());
    assert!(parse(r#"{"track":"audio","index":1,"extra":true}"#).is_err());
}

#[test]
fn names_cannot_leave_the_store() {
    for raw in ["", "..", "a/b", "a\\b", "c:"] {
        assert!(SafeName::new(raw).is_err(), "{raw:?} was accepted");
    }
}
