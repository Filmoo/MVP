//! Removes personal data from crash reports: Riot IDs, PUUIDs and other long ids, user names in
//! file paths, e-mails, credentials in URLs/headers and IP addresses.
//!
//! Used twice: by the app before a report leaves the machine, and by the backend before one is
//! stored (older or modified apps may send anything).
//!
//! It errs on the side of removing too much: a stack line that loses a word is fine, a stored
//! Riot ID is not.

use std::borrow::Cow;
use std::sync::LazyLock;

use regex::{Captures, Regex};

/// (pattern, replacement), applied in order.
const RULES: [(&str, &str); 12] = [
    // Credentials: `https://riot:password@127.0.0.1:1234/…` (the LCU's basic auth), headers.
    (r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s@]+@", "${1}<redacted>@"),
    (
        r"(?i)\b(basic|bearer)\s+[A-Za-z0-9+/=._-]{8,}",
        "$1 <redacted>",
    ),
    // User names in paths: C:\Users\Jane Doe\…, C:/Users/jane/…, /home/jane, /Users/jane.
    (
        r#"(?i)\b([a-z]:[\\/]+(?:users|documents and settings)[\\/]+)[^\\/\r\n"'<>|:*?]+"#,
        "${1}<user>",
    ),
    (r#"(/home/|/Users/)[^/\s"']+"#, "${1}<user>"),
    // Identity fields in JSON and query strings.
    (
        r#"(?i)("(?:gameName|tagLine|summonerName|displayName|internalName|riotId|puuid|summonerId|accountId|playerId)"\s*:\s*")[^"]*""#,
        "${1}<redacted>\"",
    ),
    (
        r#"(?i)([?&](?:name|gameName|tagLine|riotId|puuid|summonerName)=)[^&\s"']+"#,
        "${1}<redacted>",
    ),
    // Riot IDs in our own and Riot's URLs: /v1/players/euw1/Name/TAG, by-riot-id/Name/TAG.
    (
        r#"(/v1/players/[a-z0-9]+/|by-riot-id/)[^/\s?"']+/[^/\s?"'#]+"#,
        "${1}<riot-id>",
    ),
    (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "<email>"),
    // LCU PUUIDs and summoner ids are UUIDs; Riot API PUUIDs (78 chars) and encrypted ids
    // are long URL-safe base64.
    (
        r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
        "<id>",
    ),
    (r"[A-Za-z0-9_-]{40,}", "<id>"),
    // Riot IDs: `Name#TAG` (names may hold up to two spaces), also URL-encoded (`%23`).
    (
        r"[\p{L}\p{N}_.]+(?: [\p{L}\p{N}_.]+){0,2}(?:#|%23)[\p{L}\p{N}]{3,5}\b",
        "<riot-id>",
    ),
    (r"[\p{L}\p{N}_.%-]+%23[\p{L}\p{N}]{3,5}", "<riot-id>"),
];

static COMPILED: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    RULES
        .iter()
        .filter_map(|&(pattern, with)| Regex::new(pattern).ok().map(|re| (re, with)))
        .collect()
});

static IPV4: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").ok());

/// `text` without personal data.
pub fn scrub(text: &str) -> String {
    let mut out = Cow::Borrowed(text);
    for (re, with) in COMPILED.iter() {
        if let Cow::Owned(s) = re.replace_all(&out, *with) {
            out = Cow::Owned(s);
        }
    }
    if let Some(re) = IPV4.as_ref()
        && let Cow::Owned(s) = re.replace_all(&out, |c: &Captures<'_>| {
            let ip = &c[0];
            if ip.starts_with("127.") || ip == "0.0.0.0" {
                ip.to_owned()
            } else {
                "<ip>".to_owned()
            }
        })
    {
        out = Cow::Owned(s);
    }
    out.into_owned()
}

/// `text` cut to at most `max` bytes on a character boundary.
pub fn truncate(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_rule_compiles() {
        assert_eq!(COMPILED.len(), RULES.len());
        assert!(IPV4.is_some());
    }

    #[test]
    fn removes_riot_ids() {
        for (input, expected) in [
            ("failed to load Fillmo#7272", "failed <riot-id>"), // over-scrubbing is fine
            ("player Hide on bush#KR1 left", "player <riot-id> left"),
            ("Ünïcödé#EUW crashed", "<riot-id> crashed"),
            (
                "GET /v1/players/euw1/Fillmo/7272 → 500",
                "GET /v1/players/euw1/<riot-id> → 500",
            ),
            (
                "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Fillmo/7272?x=1",
                "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/<riot-id>?x=1",
            ),
            ("search?q=Fillmo%237272", "search?q=<riot-id>"),
            (
                r#"{"gameName":"Fillmo","tagLine":"7272"}"#,
                r#"{"gameName":"<redacted>","tagLine":"<redacted>"}"#,
            ),
            (
                "/lol-summoner/v1/summoners?name=Fillmo",
                "/lol-summoner/v1/summoners?name=<redacted>",
            ),
        ] {
            assert_eq!(scrub(input), expected, "{input}");
        }
    }

    #[test]
    fn removes_puuids_and_ids() {
        let riot_puuid = "a".repeat(40) + "B-c_" + &"d".repeat(34);
        assert_eq!(riot_puuid.len(), 78);
        assert_eq!(
            scrub(&format!("no card for {riot_puuid}")),
            "no card for <id>"
        );
        assert_eq!(
            scrub("summoner 0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33 missing"),
            "summoner <id> missing"
        );
        assert_eq!(scrub(r#"{"puuid":"short"}"#), r#"{"puuid":"<redacted>"}"#);
    }

    #[test]
    fn removes_user_names_from_paths() {
        for (input, expected) in [
            (
                r"at C:\Users\Jane Doe\AppData\Local\MVP\app.exe",
                r"at C:\Users\<user>\AppData\Local\MVP\app.exe",
            ),
            (
                r"C:\\Users\\jane\\AppData\\Roaming",
                r"C:\\Users\\<user>\\AppData\\Roaming",
            ),
            ("d:/users/jane/League", "d:/users/<user>/League"),
            ("/home/jane/.cache/mvp", "/home/<user>/.cache/mvp"),
            ("/Users/jane/Library", "/Users/<user>/Library"),
            (
                r"C:\Riot Games\League of Legends\lockfile",
                r"C:\Riot Games\League of Legends\lockfile",
            ),
        ] {
            assert_eq!(scrub(input), expected, "{input}");
        }
    }

    #[test]
    fn removes_credentials_emails_and_ips() {
        assert_eq!(
            scrub("GET https://riot:s3cretT0ken@127.0.0.1:52437/lol-gameflow/v1/session"),
            "GET https://<redacted>@127.0.0.1:52437/lol-gameflow/v1/session"
        );
        assert_eq!(
            scrub("Authorization: Basic cmlvdDpzM2NyZXQ="),
            "Authorization: Basic <redacted>"
        );
        assert_eq!(scrub("mail jane.doe@example.com"), "mail <email>");
        assert_eq!(scrub("connect 192.168.1.23 failed"), "connect <ip> failed");
        assert_eq!(scrub("loopback 127.0.0.1 ok"), "loopback 127.0.0.1 ok");
    }

    #[test]
    fn keeps_ordinary_stack_traces() {
        let stack = "TypeError: x is undefined\n    at render (index-4f2a9c.js:1:2345)\n    \
                     at core::panicking::panic_fmt (library/core/src/panicking.rs:72)\n    \
                     Windows 10.0.22631 build";
        assert_eq!(scrub(stack), stack);
    }

    #[test]
    fn truncates_on_char_boundaries() {
        assert_eq!(truncate("héllo", 2), "h");
        assert_eq!(truncate("héllo", 3), "hé");
        assert_eq!(truncate("abc", 10), "abc");
    }
}
