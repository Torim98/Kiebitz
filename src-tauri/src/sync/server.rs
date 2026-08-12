// ── Server (Desktop-Hub) ────────────────────────────────────────────────────

#[derive(Default)]
pub struct SyncServer(pub AtomicBool);

/// Zertifikat und Schlüssel des lokalen HTTPS-Hubs. Der Fingerprint wird beim
/// Pairing in den QR-Code geschrieben und vom Handy gepinnt.
#[cfg(desktop)]
struct TlsMaterial {
    certificate_pem: Vec<u8>,
    private_key_pem: Vec<u8>,
    fingerprint: String,
}

#[cfg(desktop)]
fn hex_fingerprint(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(desktop)]
fn fingerprint_from_pem(certificate_pem: &[u8]) -> Result<String, String> {
    let mut reader = std::io::BufReader::new(certificate_pem);
    let cert = rustls_pemfile::certs(&mut reader)
        .next()
        .transpose()
        .map_err(|e| format!("Zertifikat nicht lesbar: {e}"))?
        .ok_or("Zertifikat enthält keine PEM-Codierung.")?;
    Ok(hex_fingerprint(cert.as_ref()))
}

/// Lädt das dauerhaft gespeicherte Hub-Zertifikat oder erstellt es beim ersten
/// Start. Es bleibt bewusst im App-Konfigurationsordner (nicht im Repository)
/// erhalten, damit bereits gekoppelte Geräte ihren Pin nicht verlieren.
#[cfg(desktop)]
fn tls_material(app: &tauri::AppHandle) -> Result<TlsMaterial, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let certificate_path = dir.join("sync-cert.pem");
    let private_key_path = dir.join("sync-key.pem");

    if let (Ok(certificate_pem), Ok(private_key_pem)) = (
        std::fs::read(&certificate_path),
        std::fs::read(&private_key_path),
    ) {
        let fingerprint = fingerprint_from_pem(&certificate_pem)?;
        return Ok(TlsMaterial {
            certificate_pem,
            private_key_pem,
            fingerprint,
        });
    }

    let mut names = vec!["localhost".to_string(), "kiebitz.local".to_string()];
    if let Some(ip) = local_ip() {
        names.push(ip);
    }
    let rcgen::CertifiedKey { cert, key_pair } = rcgen::generate_simple_self_signed(names)
        .map_err(|e| format!("TLS-Zertifikat nicht erzeugbar: {e}"))?;
    let certificate_pem = cert.pem().into_bytes();
    let private_key_pem = key_pair.serialize_pem().into_bytes();
    let fingerprint = hex_fingerprint(cert.der().as_ref());
    std::fs::write(&certificate_path, &certificate_pem)
        .map_err(|e| format!("TLS-Zertifikat nicht speicherbar: {e}"))?;
    std::fs::write(&private_key_path, &private_key_pem)
        .map_err(|e| format!("TLS-Schlüssel nicht speicherbar: {e}"))?;
    Ok(TlsMaterial {
        certificate_pem,
        private_key_pem,
        fingerprint,
    })
}

/// Prüft den im Pairing gespeicherten SHA-256-Fingerprint. Zertifikats-Pinning
/// ersetzt hier eine öffentliche CA: Nur genau der beim QR-Scan übernommene Hub
/// darf die TLS-Verbindung beenden.
#[derive(Debug)]
struct PinnedCertVerifier {
    fingerprint: [u8; 32],
    algorithms: rustls::crypto::WebPkiSupportedAlgorithms,
}

impl PinnedCertVerifier {
    fn new(fingerprint: &str) -> Result<Self, String> {
        // ureq bringt rustls bereits mit AWS-LC; tiny_http benötigt parallel
        // rustls/ring. Deshalb den Provider hier explizit einmal pro Prozess
        // festlegen, statt die Feature-Auswahl raten zu lassen.
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        if fingerprint.len() != 64 || !fingerprint.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Kein gültiger TLS-Fingerprint konfiguriert. Bitte den Desktop erneut per QR-Code koppeln.".into());
        }
        let mut bytes = [0u8; 32];
        for (slot, pair) in bytes.iter_mut().zip(fingerprint.as_bytes().chunks_exact(2)) {
            let hex = std::str::from_utf8(pair).map_err(|e| e.to_string())?;
            *slot = u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?;
        }
        Ok(Self {
            fingerprint: bytes,
            algorithms: rustls::crypto::aws_lc_rs::default_provider()
                .signature_verification_algorithms,
        })
    }
}

impl rustls::client::danger::ServerCertVerifier for PinnedCertVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if Sha256::digest(end_entity.as_ref()).as_slice() == self.fingerprint {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::InvalidCertificate(
                rustls::CertificateError::ApplicationVerificationFailure,
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

fn pinned_tls_config(fingerprint: &str) -> Result<Arc<rustls::ClientConfig>, String> {
    // `PinnedCertVerifier::new` installiert den expliziten CryptoProvider,
    // bevor `ClientConfig::builder` ihn abfragt.
    let verifier = PinnedCertVerifier::new(fingerprint)?;
    Ok(Arc::new(
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth(),
    ))
}

/// Lokale LAN-Adresse ermitteln (UDP-Trick, es wird nichts gesendet).
fn local_ip() -> Option<String> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    Some(sock.local_addr().ok()?.ip().to_string())
}

fn ensure_code(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<settings::SettingsState>();
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    if s.sync_code.is_empty() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64 + d.as_secs())
            .unwrap_or(0);
        s.sync_code = format!(
            "{:06}",
            (nanos ^ ((std::process::id() as u64) * 2654435761)) % 1_000_000
        );
        settings::save(app, &s)?;
    }
    Ok(s.sync_code.clone())
}

/// Beantwortet Discovery-Broadcasts vom Handy mit "KIEBITZ_HERE <port>".
/// Der eigentliche Sync auf diesem Port erfolgt ausschließlich per HTTPS.
#[cfg(desktop)]
fn start_discovery_responder() {
    std::thread::spawn(|| {
        let sock = match std::net::UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Discovery-Responder startet nicht (Port {DISCOVERY_PORT}): {e}");
                return;
            }
        };
        let mut buf = [0u8; 64];
        loop {
            if let Ok((n, peer)) = sock.recv_from(&mut buf) {
                if &buf[..n] == DISCOVER_MSG {
                    let _ = sock.send_to(format!("{DISCOVER_REPLY} {SYNC_PORT}").as_bytes(), peer);
                }
            }
        }
    });
}

#[cfg(desktop)]
pub fn start_server(app: &tauri::AppHandle) -> Result<(), String> {
    let flag = &app.state::<SyncServer>().0;
    if flag.swap(true, Ordering::SeqCst) {
        return Ok(()); // läuft schon
    }
    if let Err(e) = ensure_code(app) {
        app.state::<SyncServer>().0.store(false, Ordering::SeqCst);
        return Err(e);
    }
    let tls = match tls_material(app) {
        Ok(tls) => tls,
        Err(e) => {
            app.state::<SyncServer>().0.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    let server = tiny_http::Server::https(
        ("0.0.0.0", SYNC_PORT),
        tiny_http::SslConfig {
            certificate: tls.certificate_pem,
            private_key: tls.private_key_pem,
        },
    )
    .map_err(|e| {
        app.state::<SyncServer>().0.store(false, Ordering::SeqCst);
        format!("Sync-Server startet nicht (Port {SYNC_PORT}): {e}")
    })?;
    start_discovery_responder();
    let app = app.clone();
    std::thread::spawn(move || {
        log::info!("Sync-Server lauscht per HTTPS auf Port {SYNC_PORT}");
        for mut request in server.incoming_requests() {
            let respond_json = |req: tiny_http::Request, status: u16, body: String| {
                let header =
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                        .unwrap();
                let _ = req.respond(
                    tiny_http::Response::from_string(body)
                        .with_status_code(status)
                        .with_header(header),
                );
            };
            let url = request.url().to_string();
            if request.method() == &tiny_http::Method::Get && url == "/ping" {
                respond_json(request, 200, "{\"app\":\"kiebitz\"}".into());
                continue;
            }
            if request.method() != &tiny_http::Method::Post || url != "/sync" {
                respond_json(request, 404, "{\"error\":\"not found\"}".into());
                continue;
            }
            let mut body = Vec::new();
            if request
                .as_reader()
                .take(MAX_BODY as u64)
                .read_to_end(&mut body)
                .is_err()
            {
                respond_json(request, 400, "{\"error\":\"read\"}".into());
                continue;
            }
            let parsed: Result<SyncRequest, _> = serde_json::from_slice(&body);
            let req_data = match parsed {
                Ok(r) => r,
                Err(e) => {
                    respond_json(request, 400, format!("{{\"error\":\"json: {e}\"}}"));
                    continue;
                }
            };
            let expected = app
                .state::<settings::SettingsState>()
                .0
                .lock()
                .map(|s| s.sync_code.clone())
                .unwrap_or_default();
            if expected.is_empty() || req_data.code != expected {
                respond_json(request, 403, "{\"error\":\"code\"}".into());
                continue;
            }
            let result = {
                let db = app.state::<db::Db>();
                let mut conn = match db.0.lock() {
                    Ok(c) => c,
                    Err(e) => {
                        respond_json(request, 500, format!("{{\"error\":\"lock: {e}\"}}"));
                        continue;
                    }
                };
                handle_sync(&mut conn, &req_data)
            };
            match result.and_then(|r| serde_json::to_string(&r).map_err(|e| e.to_string())) {
                Ok(json) => respond_json(request, 200, json),
                Err(e) => respond_json(request, 500, format!("{{\"error\":\"{e}\"}}")),
            }
        }
    });
    Ok(())
}

#[cfg(not(desktop))]
pub fn start_server(_app: &tauri::AppHandle) -> Result<(), String> {
    Err("Der Sync-Server läuft nur auf dem Desktop-Hub.".into())
}
