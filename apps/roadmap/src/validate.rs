//! Input checks shared by the API, the seed and the command line. Errors are short phrases the
//! UI shows as they are.

use time::Date;
use time::macros::format_description;

pub const TITLE_MAX: usize = 200;
pub const DESCRIPTION_MAX: usize = 20_000;
pub const COMMENT_MAX: usize = 10_000;
pub const URL_MAX: usize = 2_000;

fn chars(s: &str) -> usize {
    s.chars().count()
}

/// A one-line title: 1–200 characters, no line breaks or control characters.
pub fn title(s: &str) -> Result<String, String> {
    let s = s.trim();
    if s.is_empty() {
        return Err("a title is needed".into());
    }
    if chars(s) > TITLE_MAX {
        return Err(format!("titles stay under {TITLE_MAX} characters"));
    }
    if s.chars().any(char::is_control) {
        return Err("a title is one line".into());
    }
    Ok(s.to_owned())
}

/// Free text (markdown), possibly empty.
pub fn text(s: &str, max: usize) -> Result<String, String> {
    if chars(s) > max {
        return Err(format!("keep it under {max} characters"));
    }
    if s.chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err("text has control characters".into());
    }
    Ok(s.trim_end().to_owned())
}

/// A comment: text that says something.
pub fn comment(s: &str) -> Result<String, String> {
    let body = text(s, COMMENT_MAX)?;
    if body.trim().is_empty() {
        return Err("an empty comment says nothing".into());
    }
    Ok(body.trim().to_owned())
}

/// A version's or an area's name.
pub fn name(s: &str, max: usize) -> Result<String, String> {
    let s = s.trim();
    if s.is_empty() {
        return Err("a name is needed".into());
    }
    if chars(s) > max {
        return Err(format!("names stay under {max} characters"));
    }
    if s.chars().any(char::is_control) {
        return Err("a name is one line".into());
    }
    Ok(s.to_owned())
}

/// An area's key: lowercase letters, digits and dashes.
pub fn area_key(s: &str) -> Result<(), String> {
    if !s.is_empty()
        && s.len() <= 40
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        Ok(())
    } else {
        Err("keys are lowercase letters, digits and dashes".into())
    }
}

/// The key a new area's name gets ("Tier list & builds" → `tier-list-builds`).
pub fn key_for(name: &str) -> String {
    let mut key = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            key.push(c);
        } else if !key.ends_with('-') && !key.is_empty() {
            key.push('-');
        }
    }
    let key = key.trim_end_matches('-');
    if key.is_empty() {
        "area".into()
    } else {
        key.chars().take(40).collect()
    }
}

/// A link: `https://` or `http://`, no spaces, bounded. Nothing else ever becomes a link
/// (`javascript:`, `data:`… are refused here, and the UI checks again).
pub fn url(s: &str) -> Result<String, String> {
    let s = s.trim();
    let lower = s.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("https://") || lower.starts_with("http://");
    if !scheme_ok {
        return Err("links start with https:// or http://".into());
    }
    if s.len() > URL_MAX {
        return Err(format!("links stay under {URL_MAX} characters"));
    }
    if s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("a link has no spaces".into());
    }
    let host = &s[s.find("://").map_or(0, |i| i + 3)..];
    if host.is_empty() || host.starts_with('/') {
        return Err("a link needs a host".into());
    }
    Ok(s.to_owned())
}

/// A calendar date, `YYYY-MM-DD`.
pub fn date(s: &str) -> Result<Date, String> {
    Date::parse(s, format_description!("[year]-[month]-[day]"))
        .map_err(|_| format!("{s:?} isn't a date (YYYY-MM-DD)"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_are_one_trimmed_line() {
        assert_eq!(title("  Settings search "), Ok("Settings search".into()));
        assert!(title("   ").is_err());
        assert!(title("two\nlines").is_err());
        assert!(title(&"x".repeat(TITLE_MAX + 1)).is_err());
        assert!(title(&"é".repeat(TITLE_MAX)).is_ok());
    }

    #[test]
    fn links_are_web_links() {
        assert!(url("https://github.com/Filmoo/MVP/pull/12").is_ok());
        assert!(url("HTTP://example.com").is_ok());
        for bad in [
            "javascript:alert(1)",
            "data:text/html,x",
            "ftp://x",
            "https://",
            "https:///x",
            "https://a b",
            "//x.com",
        ] {
            assert!(url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn keys_come_from_names() {
        assert_eq!(key_for("Tier list & builds"), "tier-list-builds");
        assert_eq!(key_for("ARAM & Mayhem"), "aram-mayhem");
        assert_eq!(key_for("  !!"), "area");
        assert!(area_key("platform-server").is_ok());
        assert!(area_key("Platform").is_err());
    }

    #[test]
    fn dates_are_calendar_dates() {
        assert!(date("2026-09-29").is_ok());
        assert!(date("2026-02-30").is_err());
        assert!(date("29/09/2026").is_err());
    }

    #[test]
    fn comments_say_something() {
        assert_eq!(
            comment("  done in 4d5f35b \n"),
            Ok("done in 4d5f35b".into())
        );
        assert!(comment(" \n ").is_err());
        assert!(text("a\u{7}b", 10).is_err());
    }
}
