import { useEffect, useState } from "react";
import { Chess } from "chess.js";
import { Cpu, Loader2, Zap } from "lucide-react";
import { analyzePosition, engineInfo, type AnalysisResult, type EngineInfo } from "../lib/backend";
import { Button } from "./ui";

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

/** Bewertung immer aus Weiß-Sicht darstellen. */
function whiteEval(fen: string, r: AnalysisResult): string {
  const blackToMove = fen.split(" ")[1] === "b";
  const sign = blackToMove ? -1 : 1;
  if (r.mate_in != null) return `#${sign * r.mate_in}`;
  if (r.eval_cp != null) {
    const cp = (sign * r.eval_cp) / 100;
    return `${cp >= 0 ? "+" : "−"}${Math.abs(cp).toFixed(2)}`;
  }
  return "–";
}

export default function LiveEngine({
  fen,
  demoLines,
}: {
  fen: string;
  demoLines: { eval: string; depth: number; line: string }[];
}) {
  const [engine, setEngine] = useState<EngineState>({ mode: "checking" });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = 22;

  useEffect(() => {
    engineInfo()
      .then((info) => setEngine({ mode: "desktop", info }))
      .catch(() => setEngine({ mode: "web" }));
  }, []);

  // Ergebnis verwerfen, sobald sich die Stellung ändert.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [fen]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await analyzePosition(fen, depth));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const available = engine.mode === "desktop" && engine.info.available;

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
            <div className="flex items-center gap-2">
              <Button primary onClick={run} className="flex-1">
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Stockfish rechnet …
                  </>
                ) : (
                  <>
                    <Zap size={15} /> Diese Stellung analysieren
                  </>
                )}
              </Button>
            </div>

            {result && (
              <div className="mt-3 rounded-lg border border-line bg-panel2 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[22px] font-semibold tabular-nums text-accent">
                    {whiteEval(fen, result)}
                  </span>
                  <span className="text-[11.5px] text-ink3">Tiefe {result.depth}</span>
                </div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">
                  {pvToSan(fen, result.pv)}
                </div>
              </div>
            )}
            {error && (
              <div className="mt-3 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12px] text-loss">
                {error}
              </div>
            )}
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">
              Läuft nativ über den Rust-Sidecar — volle Stärke, alle Kerne. Bewertung aus Weiß-Sicht.
            </p>
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
