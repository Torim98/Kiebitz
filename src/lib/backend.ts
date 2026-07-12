import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface BackendInfo {
  version: string;
  backend: string;
}

export interface AnalysisResult {
  bestmove: string;
  eval_cp: number | null;
  mate_in: number | null;
  depth: number;
  pv: string[];
}

export interface EngineInfo {
  available: boolean;
  name: string;
  path: string;
}

/** Erkennt, ob die App in der Tauri-Shell (Desktop) oder im Browser läuft. */
export function useBackendInfo(): { mode: "desktop" | "web" | "pending"; info?: BackendInfo } {
  const [state, setState] = useState<{ mode: "desktop" | "web" | "pending"; info?: BackendInfo }>({
    mode: "pending",
  });

  useEffect(() => {
    let cancelled = false;
    invoke<BackendInfo>("app_info")
      .then((info) => !cancelled && setState({ mode: "desktop", info }))
      .catch(() => !cancelled && setState({ mode: "web" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** Fragt die gebündelte Stockfish-Engine ab (nur Desktop). */
export function engineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_info");
}

/**
 * Stockfish-Analyse über das Rust-Backend (nur Desktop).
 * Die Engine wird vom Backend selbst aufgelöst (gebündelte stockfish.exe
 * oder die Umgebungsvariable KIEBITZ_ENGINE).
 */
export function analyzePosition(fen: string, depth = 18): Promise<AnalysisResult> {
  return invoke<AnalysisResult>("analyze_position", { fen, depth });
}
