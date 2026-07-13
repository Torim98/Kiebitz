//! Minimaler UCI-Client: spricht mit einer beliebigen UCI-Engine
//! (Stockfish) über stdin/stdout eines Kindprozesses.

use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

#[derive(Serialize)]
pub struct AnalysisResult {
    pub bestmove: String,
    /// Bewertung in Centipawns aus Sicht des Spielers am Zug.
    /// `None`, wenn die Engine ein Matt meldet (dann ist `mate_in` gesetzt).
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
    pub depth: u32,
    pub pv: Vec<String>,
}

pub struct UciEngine {
    child: Child,
    reader: BufReader<std::process::ChildStdout>,
    name: String,
}

impl UciEngine {
    pub fn spawn(path: &str) -> Result<Self, String> {
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Engine konnte nicht gestartet werden ({path}): {e}"))?;

        let stdout = child.stdout.take().ok_or("stdout nicht verfügbar")?;
        let mut engine = Self {
            child,
            reader: BufReader::new(stdout),
            name: String::new(),
        };

        engine.send("uci")?;
        engine.name = engine.read_id_name()?;
        engine.send("isready")?;
        engine.wait_for("readyok")?;
        Ok(engine)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Setzt eine UCI-Option und wartet, bis die Engine bereit ist.
    pub fn set_option(&mut self, name: &str, value: &str) -> Result<(), String> {
        self.send(&format!("setoption name {name} value {value}"))?;
        self.send("isready")?;
        self.wait_for("readyok")
    }

    /// Sinnvolle Thread-Zahl für Hintergrund-Analyse: Kerne minus zwei.
    pub fn worker_threads() -> usize {
        std::thread::available_parallelism()
            .map(|n| n.get().saturating_sub(2).max(1))
            .unwrap_or(1)
    }

    /// Liest Zeilen bis `uciok` und merkt sich dabei den `id name`-Wert.
    fn read_id_name(&mut self) -> Result<String, String> {
        let mut name = String::new();
        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
            if n == 0 {
                return Err("Engine-Prozess wurde unerwartet beendet".into());
            }
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("id name ") {
                name = rest.to_string();
            } else if trimmed.starts_with("uciok") {
                return Ok(name);
            }
        }
    }

    fn send(&mut self, cmd: &str) -> Result<(), String> {
        let stdin = self.child.stdin.as_mut().ok_or("stdin nicht verfügbar")?;
        writeln!(stdin, "{cmd}").map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))
    }

    fn wait_for(&mut self, token: &str) -> Result<(), String> {
        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
            if n == 0 {
                return Err("Engine-Prozess wurde unerwartet beendet".into());
            }
            if line.trim_start().starts_with(token) {
                return Ok(());
            }
        }
    }

    /// Analysiert eine Stellung bis zur angegebenen Tiefe und liefert
    /// besten Zug, Bewertung und Hauptvariante.
    pub fn analyze(&mut self, fen: &str, depth: u32) -> Result<AnalysisResult, String> {
        self.send(&format!("position fen {fen}"))?;
        self.send(&format!("go depth {depth}"))?;

        let mut result = AnalysisResult {
            bestmove: String::new(),
            eval_cp: None,
            mate_in: None,
            depth: 0,
            pv: Vec::new(),
        };

        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
            if n == 0 {
                return Err("Engine-Prozess wurde unerwartet beendet".into());
            }
            let trimmed = line.trim();

            if trimmed.starts_with("info ") {
                Self::parse_info(trimmed, &mut result);
            } else if let Some(rest) = trimmed.strip_prefix("bestmove ") {
                result.bestmove = rest.split_whitespace().next().unwrap_or("").to_string();
                return Ok(result);
            }
        }
    }

    fn parse_info(line: &str, result: &mut AnalysisResult) {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let mut i = 0;
        while i < tokens.len() {
            match tokens[i] {
                "depth" => {
                    if let Some(d) = tokens.get(i + 1).and_then(|t| t.parse().ok()) {
                        result.depth = d;
                    }
                    i += 2;
                }
                "score" => match (tokens.get(i + 1), tokens.get(i + 2)) {
                    (Some(&"cp"), Some(v)) => {
                        result.eval_cp = v.parse().ok();
                        result.mate_in = None;
                        i += 3;
                    }
                    (Some(&"mate"), Some(v)) => {
                        result.mate_in = v.parse().ok();
                        result.eval_cp = None;
                        i += 3;
                    }
                    _ => i += 1,
                },
                "pv" => {
                    result.pv = tokens[i + 1..].iter().map(|s| s.to_string()).collect();
                    return;
                }
                _ => i += 1,
            }
        }
    }
}

impl Drop for UciEngine {
    fn drop(&mut self) {
        let _ = self.send("quit");
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Testet den echten Analyse-Pfad gegen die gebündelte Engine.
    /// Wird übersprungen, wenn keine stockfish.exe vorhanden ist.
    #[test]
    fn analyzes_italian_position() {
        let exe = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(if cfg!(windows) { "stockfish.exe" } else { "stockfish" });
        if !exe.exists() {
            eprintln!("übersprungen: keine Engine unter {}", exe.display());
            return;
        }

        let mut e = UciEngine::spawn(&exe.to_string_lossy()).expect("Engine-Start");
        assert!(e.name().contains("Stockfish"), "unerwarteter Name: {}", e.name());

        let fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1";
        let r = e.analyze(fen, 18).expect("Analyse");

        assert_eq!(r.depth, 18);
        assert!(!r.bestmove.is_empty(), "bestmove leer");
        assert!(r.eval_cp.is_some() || r.mate_in.is_some(), "keine Bewertung");
        assert!(!r.pv.is_empty(), "keine Hauptvariante");
        eprintln!(
            "OK: name={} bestmove={} eval_cp={:?} depth={} pv={:?}",
            e.name(),
            r.bestmove,
            r.eval_cp,
            r.depth,
            &r.pv[..r.pv.len().min(3)]
        );
    }
}
