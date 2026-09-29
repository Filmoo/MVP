//! Secrets: random ids, the session key's derived keys, hashes and sealed GitHub tokens (ring).
//!
//! - A session cookie holds 32 random bytes; the database keeps only HMAC-SHA-256 of it under a
//!   key derived from `ROADMAP_SESSION_KEY`, so a copy of the database opens no session, and a
//!   new session key signs everyone out.
//! - The user's GitHub token (kept to check, now and then, that they are still an admin) is
//!   sealed with `ChaCha20-Poly1305` under another key derived from the session key.
//! - Machine tokens are stored as plain SHA-256: 32 random bytes need no salt, and they survive
//!   a change of session key.

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ring::aead::{Aad, CHACHA20_POLY1305, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use ring::digest::{SHA256, digest};
use ring::hmac;
use ring::rand::{SecureRandom as _, SystemRandom};

/// Prefix of machine tokens (`mvpr_…`), so a leaked one is recognizable.
pub const TOKEN_PREFIX: &str = "mvpr_";

/// `n` random bytes from the operating system.
pub fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0_u8; N];
    // The OS generator doesn't fail on the platforms this runs on; if it ever did, the zeros
    // would be caught by the check below rather than handed out.
    let filled = SystemRandom::new().fill(&mut bytes).is_ok();
    assert!(
        filled && bytes.iter().any(|b| *b != 0),
        "no randomness from the OS"
    );
    bytes
}

/// A random id for URLs and cookies: 32 bytes, base64url (43 characters).
pub fn random_id() -> String {
    URL_SAFE_NO_PAD.encode(random::<32>())
}

/// A new machine token: `mvpr_` and 32 random bytes.
pub fn new_token() -> String {
    format!("{TOKEN_PREFIX}{}", random_id())
}

pub fn sha256(data: &[u8]) -> Vec<u8> {
    digest(&SHA256, data).as_ref().to_vec()
}

/// PKCE's S256 challenge for a verifier.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(digest(&SHA256, verifier.as_bytes()))
}

/// Equality in time that doesn't depend on where the inputs differ (lengths are public).
pub fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0_u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A new session key, as `mvp-roadmap key` prints it: 32 random bytes in hex.
pub fn new_session_key() -> String {
    use std::fmt::Write as _;
    random::<32>()
        .iter()
        .fold(String::with_capacity(64), |mut hex, b| {
            let _ = write!(hex, "{b:02x}");
            hex
        })
}

/// Reads a session key: hex (64 digits or more) or base64, at least 32 bytes.
pub fn parse_session_key(text: &str) -> Result<Vec<u8>, String> {
    let text = text.trim();
    let hex = text.len().is_multiple_of(2) && text.bytes().all(|b| b.is_ascii_hexdigit());
    let bytes = if hex {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16))
            .collect::<Result<Vec<u8>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        STANDARD
            .decode(text)
            .or_else(|_| URL_SAFE_NO_PAD.decode(text))
            .map_err(|_| "ROADMAP_SESSION_KEY is neither hex nor base64".to_owned())?
    };
    if bytes.len() < 32 {
        return Err(format!(
            "ROADMAP_SESSION_KEY holds {} bytes; it needs 32 or more (mvp-roadmap key makes one)",
            bytes.len()
        ));
    }
    Ok(bytes)
}

/// The keys derived from the session key.
pub struct Keys {
    session: hmac::Key,
    sealing: LessSafeKey,
}

impl std::fmt::Debug for Keys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Keys([redacted])")
    }
}

impl Keys {
    pub fn new(session_key: &[u8]) -> Self {
        let root = hmac::Key::new(hmac::HMAC_SHA256, session_key);
        let session = hmac::Key::new(
            hmac::HMAC_SHA256,
            hmac::sign(&root, b"mvp-roadmap/session-id/v1").as_ref(),
        );
        let sealing_key = hmac::sign(&root, b"mvp-roadmap/github-token/v1");
        // A 32-byte key is exactly what ChaCha20-Poly1305 takes, so this can't fail.
        let unbound = UnboundKey::new(&CHACHA20_POLY1305, sealing_key.as_ref());
        let sealing = LessSafeKey::new(unbound.unwrap_or_else(|_| unreachable!("32-byte key")));
        Self { session, sealing }
    }

    /// A random key, for development (`--dev-login` without `ROADMAP_SESSION_KEY`).
    pub fn ephemeral() -> Self {
        Self::new(&random::<32>())
    }

    /// What the database keeps of a session id.
    pub fn session_hash(&self, id: &str) -> Vec<u8> {
        hmac::sign(&self.session, id.as_bytes()).as_ref().to_vec()
    }

    /// Nonce and ciphertext with its tag.
    pub fn seal(&self, plain: &[u8]) -> Vec<u8> {
        let nonce_bytes = random::<NONCE_LEN>();
        let mut sealed = plain.to_vec();
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        // Sealing only fails for inputs over 256 GiB.
        let ok = self
            .sealing
            .seal_in_place_append_tag(nonce, Aad::from(b"github-token"), &mut sealed)
            .is_ok();
        assert!(ok, "sealing failed");
        let mut out = nonce_bytes.to_vec();
        out.extend_from_slice(&sealed);
        out
    }

    /// The plain text, or `None` when the data was tampered with or sealed under another key.
    pub fn open(&self, sealed: &[u8]) -> Option<Vec<u8>> {
        if sealed.len() < NONCE_LEN {
            return None;
        }
        let (nonce, body) = sealed.split_at(NONCE_LEN);
        let nonce = Nonce::try_assume_unique_for_key(nonce).ok()?;
        let mut body = body.to_vec();
        let plain = self
            .sealing
            .open_in_place(nonce, Aad::from(b"github-token"), &mut body)
            .ok()?;
        Some(plain.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_tokens_open_with_their_key_only() {
        let keys = Keys::new(&[7; 32]);
        let sealed = keys.seal(b"gho_secret");
        assert_eq!(keys.open(&sealed).as_deref(), Some(&b"gho_secret"[..]));
        assert!(!sealed.windows(10).any(|w| w == b"gho_secret"));
        assert_eq!(Keys::new(&[8; 32]).open(&sealed), None);
        let mut tampered = sealed.clone();
        if let Some(last) = tampered.last_mut() {
            *last ^= 1;
        }
        assert_eq!(keys.open(&tampered), None);
        assert_eq!(keys.open(b"short"), None);
    }

    #[test]
    fn session_hashes_depend_on_the_key() {
        let a = Keys::new(&[1; 32]);
        let b = Keys::new(&[2; 32]);
        assert_eq!(a.session_hash("id"), a.session_hash("id"));
        assert_ne!(a.session_hash("id"), b.session_hash("id"));
        assert_ne!(a.session_hash("id"), a.session_hash("id2"));
    }

    #[test]
    fn session_keys_parse_from_hex_or_base64() {
        let hex = new_session_key();
        assert_eq!(hex.len(), 64);
        assert_eq!(parse_session_key(&hex).map(|k| k.len()), Ok(32));
        let b64 = STANDARD.encode([3_u8; 48]);
        assert_eq!(parse_session_key(&b64).map(|k| k.len()), Ok(48));
        assert!(parse_session_key("abcd").is_err());
        assert!(parse_session_key("not a key!").is_err());
    }

    #[test]
    fn ids_and_tokens_look_right() {
        let id = random_id();
        assert_eq!(id.len(), 43);
        assert_ne!(id, random_id());
        let token = new_token();
        assert!(token.starts_with(TOKEN_PREFIX));
        assert_eq!(token.len(), TOKEN_PREFIX.len() + 43);
        assert!(same(b"abc", b"abc"));
        assert!(!same(b"abc", b"abd"));
        assert!(!same(b"abc", b"ab"));
        // RFC 7636, appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
