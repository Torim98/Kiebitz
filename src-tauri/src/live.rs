//! Langlebige Stockfish-Instanz für die Live-Analyse: die Engine bleibt als
//! gemanagter Tauri-State im Speicher, `info`-Zeilen werden fortlaufend als
//! Events an das Frontend gestreamt (Eval-Bar und Tiefe aktualisieren live).

use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub struct LiveEngine {
    inner: Mutex<Option<LiveProc>>,
    /// Anfrage-Generation: das Frontend ignoriert Events älterer Anfragen.
    generation: Arc<AtomicU64>,
}

struct LiveProc {
    stdin: ChildStdin,
    _child: Child,
}

/// Eine gestreamte Analyse-Zeile (eine MultiPV-Linie bei einer Tiefe).
#[derive(Serialize, Clone)]
pub struct LiveInfo {
    pub generation: u64,
    pub depth: u32,
    pub multipv: u32,
    /// Centipawns aus Sicht des Spielers am Zug.
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
    pub nps: Option<u64>,
    pub pv: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct LiveDone {
    pub generation: u64,
    pub bestmove: String,
}

impl Default for LiveEngine {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl LiveEngine {
    /// Startet die Engine, falls nötig, und beginnt eine neue Analyse.
    /// Liefert die Generation, unter der die Events dieser Anfrage laufen.
    pub fn analyze(
        &self,
        app: &tauri::AppHandle,
        engine_path: &str,
        fen: &str,
        depth: u32,
    ) -> Result<u64, String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            *guard = Some(self.spawn(app, engine_path)?);
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let proc = guard.as_mut().unwrap();
        let cmd = format!("stop\nposition fen {fen}\ngo depth {depth}\n");
        if proc.stdin.write_all(cmd.as_bytes()).is_err() {
            // Engine-Prozess ist gestorben — einmal neu starten.
            *guard = Some(self.spawn(app, engine_path)?);
            let proc = guard.as_mut().unwrap();
            proc.stdin
                .write_all(cmd.as_bytes())
                .map_err(|e| format!("Engine nicht erreichbar: {e}"))?;
        }
        Ok(generation)
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(proc) = guard.as_mut() {
                let _ = proc.stdin.write_all(b"stop\n");
            }
        }
    }

    fn spawn(&self, app: &tauri::AppHandle, path: &str) -> Result<LiveProc, String> {
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Engine konnte nicht gestartet werden ({path}): {e}"))?;

        let stdout = child.stdout.take().ok_or("stdout nicht verfügbar")?;
        let mut stdin = child.stdin.take().ok_or("stdin nicht verfügbar")?;

        let threads = crate::engine::UciEngine::worker_threads();
        write!(
            stdin,
            "uci\nsetoption name MultiPV value 3\nsetoption name Threads value {threads}\nsetoption name Hash value 256\nisready\n"
        )
        .map_err(|e| format!("Engine-Handshake fehlgeschlagen: {e}"))?;

        // Reader-Thread: parst info-Zeilen und streamt sie als Events.
        let app = app.clone();
        let generation = Arc::clone(&self.generation);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break, // Engine beendet
                    Ok(_) => {}
                }
                let trimmed = line.trim();
                let gen_now = generation.load(Ordering::SeqCst);
                if let Some(info) = parse_info(trimmed, gen_now) {
                    let _ = app.emit("engine://info", info);
                } else if let Some(rest) = trimmed.strip_prefix("bestmove ") {
                    let _ = app.emit(
                        "engine://done",
                        LiveDone {
                            generation: gen_now,
                            bestmove: rest.split_whitespace().next().unwrap_or("").to_string(),
                        },
                    );
                }
            }
        });

        Ok(LiveProc { stdin, _child: child })
    }
}

/// Parst eine `info …`-Zeile; None, wenn sie keine PV-Bewertung enthält.
fn parse_info(line: &str, generation: u64) -> Option<LiveInfo> {
    if !line.starts_with("info ") || !line.contains(" pv ") {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let mut info = LiveInfo {
        generation,
        depth: 0,
        multipv: 1,
        eval_cp: None,
        mate_in: None,
        nps: None,
        pv: Vec::new(),
    };
    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "depth" => {
                info.depth = tokens.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            "multipv" => {
                info.multipv = tokens.get(i + 1).and_then(|t| t.parse().ok()).unwrap_or(1);
                i += 2;
            }
            "nps" => {
                info.nps = tokens.get(i + 1).and_then(|t| t.parse().ok());
                i += 2;
            }
            "score" => {
                match (tokens.get(i + 1), tokens.get(i + 2)) {
                    (Some(&"cp"), Some(v)) => info.eval_cp = v.parse().ok(),
                    (Some(&"mate"), Some(v)) => info.mate_in = v.parse().ok(),
                    _ => {}
                }
                i += 3;
            }
            "pv" => {
                info.pv = tokens[i + 1..].iter().map(|s| s.to_string()).collect();
                break;
            }
            _ => i += 1,
        }
    }
    if info.depth == 0 || (info.eval_cp.is_none() && info.mate_in.is_none()) {
        return None;
    }
    Some(info)
}
