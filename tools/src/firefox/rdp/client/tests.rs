use serde_json::json;

use super::*;

#[test]
fn the_rdp_port_skips_marionette_and_the_placeholder() {
    assert_eq!(pick_rdp_port("2828\r\n9230\r\n6000\r\n7000"), Some(6000));
}

#[test]
fn low_ports_and_garbage_are_ignored() {
    assert_eq!(pick_rdp_port("80 abc 1024"), None);
}

#[test]
fn truncation_counts_characters() {
    assert_eq!(truncate("héllo", 3), "hél");
}

#[test]
fn a_message_needs_a_string_sender() {
    assert!(Message::from_value(json!({"from": "root"})).is_some());
    assert!(Message::from_value(json!({"from": 3})).is_none());
}
