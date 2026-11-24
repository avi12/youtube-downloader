//! Newtypes for values that must not be mixed up: ports, project-relative paths, content hashes
//! and request ids. Each one validates or normalizes on construction.

use std::num::NonZeroU16;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::Error;

/// A TCP port, never zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(try_from = "u16", into = "u16")]
pub struct Port(NonZeroU16);

impl Port {
    /// A port, or [`Error::InvalidPort`] for zero.
    pub fn new(value: u16) -> Result<Self, Error> {
        NonZeroU16::new(value).map(Self).ok_or(Error::InvalidPort)
    }

    /// The port number.
    pub const fn get(self) -> u16 {
        self.0.get()
    }
}

impl TryFrom<u16> for Port {
    type Error = Error;

    fn try_from(value: u16) -> Result<Self, Error> {
        Self::new(value)
    }
}

impl From<Port> for u16 {
    fn from(port: Port) -> Self {
        port.get()
    }
}

/// A path relative to the extension project, always with forward slashes (the TypeScript
/// `replaceAll("\\", "/")` normalization happens once, here).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(from = "String", into = "String")]
pub struct RelPath(String);

impl RelPath {
    /// Normalizes backslashes to forward slashes.
    pub fn new(raw: impl AsRef<str>) -> Self {
        Self(raw.as_ref().replace('\\', "/"))
    }

    /// The normalized text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The rest of the path after `prefix`, when it starts with it.
    pub fn strip_prefix(&self, prefix: &str) -> Option<&str> {
        self.0.strip_prefix(prefix)
    }
}

impl From<String> for RelPath {
    fn from(raw: String) -> Self {
        Self::new(raw)
    }
}

impl From<RelPath> for String {
    fn from(path: RelPath) -> Self {
        path.0
    }
}

const HEX_RADIX: u32 = 16;
/// One hex digit spells four bits, so a byte is its high and its low nibble.
const NIBBLE_BITS: u8 = 4;
const LOW_NIBBLE_MASK: u8 = 0x0f;
/// The length of a SHA-256 digest in hex digits.
const SHA256_HEX_LENGTH: usize = 64;

/// The lowercase hex SHA-256 of some bytes. Only ever compared with another hash of the same kind.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContentHash(String);

impl ContentHash {
    /// Hashes `bytes`.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let mut hex = String::with_capacity(SHA256_HEX_LENGTH);
        for byte in Sha256::digest(bytes) {
            hex.extend(char::from_digit(u32::from(byte >> NIBBLE_BITS), HEX_RADIX));
            hex.extend(char::from_digit(
                u32::from(byte & LOW_NIBBLE_MASK),
                HEX_RADIX,
            ));
        }
        Self(hex)
    }

    /// The first `length` hex characters, the cache-busting version of a public resource.
    pub fn prefix(&self, length: usize) -> &str {
        self.0.get(..length).unwrap_or(&self.0)
    }

    /// The full hex text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Correlates a bridge request with its response.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(transparent)]
pub struct RequestId(pub u64);

/// Which family of browser the sidecar drives; decides CDP (Chromium) or RDP (Firefox).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum BrowserKind {
    /// Chrome, Edge, Opera: CDP over HTTP and WebSocket.
    Chromium,
    /// Firefox: RDP over a TCP socket.
    Firefox,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_rejects_zero() {
        assert!(matches!(Port::new(0), Err(Error::InvalidPort)));
        assert_eq!(Port::new(9260).map(Port::get).ok(), Some(9260));
    }

    #[test]
    fn rel_path_normalizes_backslashes() {
        assert_eq!(
            RelPath::new(r"src\public\a.png").as_str(),
            "src/public/a.png"
        );
    }

    #[test]
    fn content_hash_is_stable_hex() {
        let hash = ContentHash::from_bytes(b"abc");
        assert_eq!(hash.prefix(8), "ba7816bf");
        assert_eq!(hash.as_str().len(), 64);
    }
}
