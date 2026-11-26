//! The one parser of a TCP port argument.

use ytdl_dev_hot::types::Port;

/// A port number in `1..=65535`, for a clap `value_parser`.
pub(crate) fn parse_port_number(raw: &str) -> Result<u16, String> {
    let value: u16 = raw.parse().map_err(|error| format!("{error}"))?;
    Port::new(value)
        .map(Port::get)
        .map_err(|error| error.to_string())
}

/// A typed port, for a clap `value_parser`.
pub(crate) fn parse_port(raw: &str) -> Result<Port, String> {
    let value = parse_port_number(raw)?;
    Port::new(value).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use crate::port::*;

    #[test]
    fn accepts_the_valid_range_only() {
        assert_eq!(parse_port_number("9229"), Ok(9229));
        assert_eq!(parse_port_number("65535"), Ok(65535));
        assert!(parse_port_number("0").is_err());
        assert!(parse_port_number("65536").is_err());
        assert!(parse_port_number("abc").is_err());
    }
}
