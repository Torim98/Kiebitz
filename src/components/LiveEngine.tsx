import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Cpu, Pause, Play } from "lucide-react";
import { engineInfo, type EngineInfo } from "../lib/backend";
import { analyzeLive, onEngineDone, onEngineInfo, stopLive, type LiveInfo } from "../lib/analysis";

type EngineState =
  | { mode: "checking" }
  | { mode: "web" }
  | { mode: "desktop"; info: EngineInfo };

/** Wandelt die UCI-Hauptvariante (z. B. "e2e4") in lesbares SAN um. */
function pvToSan(fen: string, pv: string[]): string {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, 8)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out.join(" ");
}

/** Bewertung einer Linie aus Weiß-Sicht formatieren. */
function lineEvalLabel(blackToMove: boolean, info: LiveInfo): string {
  const sign = blackToMove ? -1 : 1;
  if (info.mate_in != null) return `#${sign * info.mate_in}`;
  if (info.eval_cp != null) {
    const cp = (sign * info.eval_cp) / 100;
    return `${cp >= 0 ? "+" : "−"}${Math.abs(cp).toFixed(2)}`;
  }
  return "–";
}

/**
 * Live-Analyse über die persistente Stockfish-Instanz: sobald sich die
 * Stellung ändert, rechnet die Engine neu; info-Zeilen streamen als Events
 * und aktualisieren Linien, Tiefe und (per onEval) die Eval-Bar.
 */
export default function LiveEngine({
  fen,
  demoLines,
  onEval,
}: {
  fen: string;
  demoLines: { eval: string; depth: number; line: string }[];
  /** Bewertung aus Weiß-Sicht, sobald die Engine Tiefe gewinnt. */
  onEval?: (evalCp: number | null, mateIn: number | null) => void;
}) {
  const [engine, setEngine] = useState<EngineState>({ mode: "checking" });
  const [running, setRunning] = useState(true);
  const [lines, setLines] = useState<Map<number, LiveInfo>>(new Map());
  const [nps, setNps] = useState<number | null>(null);
  const genRef = useRef(0);
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const onEvalRef = useRef(onEval);
  onEvalRef.current = onEval;

  useEffect(() => {
    engineInfo()
      .then((info) => setEngine({ mode: "desktop", info }))
      .catch(() => setEngine({ mode: "web" }));
  }, []);

  const available = engine.mode === "desktop" && engine.info.available;

  // Event-Listener einmalig registrieren.
  useEffect(() => {
    if (!available) return;
    let unInfo: (() => void) | undefined;
    let unDone: (() => void) | undefined;
    let disposed = false;
    onEngineInfo((info) => {
      if (info.generation !== genRef.current) return;
      setLines((prev) => {
        const next = new Map(prev);
        next.set(info.multipv, info);
        return next;
      });
      if (info.nps != null) setNps(info.nps);
      if (info.multipv === 1 && onEvalRef.current) {
        const blackToMove = fenRef.current.split(" ")[1] === "b";
        const sign = blackToMove ? -1 : 1;
        onEvalRef.current(
          info.eval_cp != null ? sign * info.eval_cp : null,
          info.mate_in != null ? sign * info.mate_in : null
        );
      }
    }).then((u) => (disposed ? u() : (unInfo = u)));
    onEngineDone(() => {}).then((u) => (disposed ? u() : (unDone = u)));
    return () => {
      disposed = true;
      unInfo?.();
      unDone?.();
    };
  }, [available]);

  // Bei Stellungswechsel (oder Start/Stopp) neu analysieren.
  useEffect(() => {
    if (!available) return;
    setLines(new Map());
    if (!running) return;
    let stale = false;
    analyzeLive(fen, 24)
      .then((generation) => {
        if (!stale) genRef.current = generation;
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [available, fen, running]);

  // Beim Verlassen der Seite die Engine anhalten.
  useEffect(() => {
    return () => {
      if (available) stopLive().catch(() => {});
    };
  }, [available]);

  const blackToMove = fen.split(" ")[1] === "b";
  const ordered = [1, 2, 3]
    .map((i) => lines.get(i))
    .filter((l): l is LiveInfo => l != null);
  const depth = ordered[0]?.depth ?? 0;

  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink2">
          <Cpu size={15} className={available ? "text-accent" : "text-ink3"} />
          Engine-Analyse
        </h2>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
          style={{
            color: available ? "var(--color-win)" : "var(--color-ink3)",
            background: available ? "var(--color-accent-soft)" : "var(--color-panel2)",
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: available ? "var(--color-win)" : "var(--color-draw)" }}
          />
          {engine.mode === "checking"
            ? "…"
            : available
              ? (engine as { info: EngineInfo }).info.name
              : "nicht verbunden"}
        </span>
      </header>

      <div className="p-4">
        {available ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <button
                onClick={() => setRunning((r) => !r)}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] text-ink2 transition-colors hover:border-line2 hover:text-ink"
              >
                {running ? <Pause size={13} /> : <Play size={13} />}
                {running ? "Pause" : "Analysieren"}
              </button>
              <span className="text-[11.5px] tabular-nums text-ink3">
                {running && depth > 0
                  ? `Tiefe ${depth}${nps ? ` · ${(nps / 1_000_000).toFixed(1)} Mn/s` : ""}`
                  : running
                    ? "rechnet …"
                    : "pausiert"}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {ordered.length > 0
                ? ordered.map((l) => (
                    <div key={l.multipv} className="rounded-lg border border-line bg-panel2 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[14px] font-semibold tabular-nums text-accent">
                          {lineEvalLabel(blackToMove, l)}
                        </span>
                        <span className="text-[11px] text-ink3">Tiefe {l.depth}</span>
                      </div>
                      <div className="mt-1 truncate text-[12px] leading-relaxed text-ink2">
                        {pvToSan(fen, l.pv)}
                      </div>
                    </div>
                  ))
                : running && (
                    <div className="rounded-lg border border-dashed border-line2 px-3 py-4 text-center text-[12px] text-ink3">
                      Stockfish rechnet …
                    </div>
                  )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              {demoLines.map((l, i) => (
                <div key={i} className="rounded-lg border border-line bg-panel2 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-accent">{l.eval}</span>
                    <span className="text-[11px] text-ink3">Tiefe {l.depth}</span>
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-ink2">{l.line}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink3">
              {engine.mode === "web"
                ? "Vorschau-Werte. Die Live-Analyse mit Stockfish läuft in der Desktop-App."
                : "Engine nicht gefunden — stockfish.exe unter src-tauri/binaries/ ablegen."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
