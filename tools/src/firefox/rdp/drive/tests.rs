use super::*;

fn target(url: &str) -> FrameTarget {
    FrameTarget {
        url: Some(url.to_owned()),
        console_actor: Some(ActorId::new(format!("console-{url}"))),
    }
}

#[test]
fn the_background_page_wins_over_other_extension_pages() {
    let targets = [
        target("moz-extension://x/popup.html"),
        target("moz-extension://x/background.js"),
    ];
    assert_eq!(
        background_console(&targets),
        Some(ActorId::new("console-moz-extension://x/background.js"))
    );
}

#[test]
fn any_extension_page_is_the_fallback() {
    let targets = [
        target("https://example.com"),
        target("moz-extension://x/popup.html"),
    ];
    assert!(background_console(&targets).is_some());
    assert!(background_console(&[target("https://example.com")]).is_none());
}

#[test]
fn an_evaluation_prints_result_then_exception_then_everything() {
    let result = json!({"result": 1, "exception": 2});
    assert_eq!(evaluation_summary(&result), &json!(1));
    let exception = json!({"exception": 2});
    assert_eq!(evaluation_summary(&exception), &json!(2));
    let bare = json!({"x": 3});
    assert_eq!(evaluation_summary(&bare), &bare);
}
