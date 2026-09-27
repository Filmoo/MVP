//! TLS for the League client's loopback APIs.
//!
//! The client (and the in-game Live Client Data API on port 2999) serve certificates issued by
//! Riot's private root ("`LoL` Game Engineering Certificate Authority"). We trust exactly that root, and
//! nothing else. Hostnames are not checked: the peer is always `127.0.0.1` and its certificate
//! names don't match loopback addresses, so pinning the private root is what authenticates it.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::pem::PemObject as _;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::server::ParsedCertificate;
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};

/// Riot's local root CA. Public (shipped in Riot's open-source tools);
/// SHA-256 `CA:8C:9D:32:…:4E:A3`, valid 2013-12-04 → 2043-11-27.
pub const RIOT_ROOT_PEM: &[u8] = include_bytes!("riotgames.pem");

#[derive(Debug, thiserror::Error)]
pub enum TlsError {
    #[error("invalid root certificate: {0}")]
    Pem(String),
    #[error("cannot read root certificate: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Rustls(#[from] rustls::Error),
}

/// Client config that trusts only the given PEM root(s), with hostname checks disabled.
pub fn pinned_client_config(root_pem: &[u8]) -> Result<Arc<ClientConfig>, TlsError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut roots = RootCertStore::empty();
    for cert in CertificateDer::pem_slice_iter(root_pem) {
        let cert = cert.map_err(|e| TlsError::Pem(e.to_string()))?;
        roots.add(cert)?;
    }
    if roots.is_empty() {
        return Err(TlsError::Pem("no certificate found".into()));
    }
    let verifier = PinnedRootVerifier {
        roots: Arc::new(roots),
        provider: Arc::clone(&provider),
    };
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    Ok(Arc::new(config))
}

/// Config for the real League client: Riot's root.
pub fn riot_client_config() -> Result<Arc<ClientConfig>, TlsError> {
    pinned_client_config(RIOT_ROOT_PEM)
}

/// Development builds may trust another root instead (the mock client's CA), named by this
/// variable. Ignored in release builds.
pub const DEV_ROOT_ENV: &str = "SCOUT_LCU_CA";

/// Riot's root, or the development override in debug builds.
pub fn client_config_from_env() -> Result<Arc<ClientConfig>, TlsError> {
    match std::env::var_os(DEV_ROOT_ENV).filter(|_| cfg!(debug_assertions)) {
        Some(path) => pinned_client_config(&std::fs::read(path)?),
        None => riot_client_config(),
    }
}

#[derive(Debug)]
struct PinnedRootVerifier {
    roots: Arc<RootCertStore>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedRootVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let cert = ParsedCertificate::try_from(end_entity)?;
        rustls::client::verify_server_cert_signed_by_trust_anchor(
            &cert,
            &self.roots,
            intermediates,
            now,
            self.provider.signature_verification_algorithms.all,
        )?;
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_the_riot_root() {
        assert!(riot_client_config().is_ok());
    }

    #[test]
    fn rejects_input_without_certificates() {
        assert!(matches!(
            pinned_client_config(b"not a pem"),
            Err(TlsError::Pem(_))
        ));
    }
}
