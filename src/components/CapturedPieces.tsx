/**
 * Die geschlagenen Figuren einer Seite · als Zeile unter dem Namen.
 *
 * Die Zeichnungen sind dieselben wie auf dem Brett daneben, nicht bloß
 * ähnliche: sie stammen aus `pieceGlyphs.ts`, das `scripts/generate-piece-
 * glyphs.mjs` aus einem echten Brett ausliest. Ein zweites, selbst gezeichnetes
 * Figurenset wäre bei jedem Update auseinandergelaufen · und ein Springer, der
 * knapp nicht der Springer vom Brett ist, fällt sofort auf.
 *
 * Gleiche Figuren überlappen leicht, damit acht Bauern nicht die halbe Zeile
 * kosten — so hält es auch chess.com.
 */
import type { PieceKind } from "../lib/captured";
import { PIECE_GLYPH, PIECE_VIEWBOX } from "./pieceGlyphs";

function Glyph({ kind, color }: { kind: PieceKind; color: "white" | "black" }) {
  const code = `${color === "white" ? "w" : "b"}${kind.toUpperCase()}`;
  return (
    <svg
      viewBox={PIECE_VIEWBOX}
      // Die Brettzeichnungen tragen selbst ein `svg` in sich · die Marke
      // unterscheidet den äußeren Rahmen von seinem Inhalt.
      data-glyph={code}
      className="h-[15px] w-[15px] shrink-0"
      aria-hidden="true"
      // Vorgefertigte, im Repo erzeugte Zeichnungen · keine Fremdeingabe.
      dangerouslySetInnerHTML={{ __html: PIECE_GLYPH[code] ?? "" }}
    />
  );
}

/**
 * Eine Zeile geschlagener Figuren. Ohne Figuren *und* ohne Vorsprung entfällt
 * sie ganz · sonst stünde unter jedem Namen eine leere Zeile.
 */
export default function CapturedPieces({
  pieces,
  /** Farbe der *geschlagenen* Figuren · Weiß schlägt schwarze. */
  color,
  /** Materialvorsprung dieser Seite; nur ein echter Vorsprung wird gezeigt. */
  advantage,
  label,
}: {
  pieces: PieceKind[];
  color: "white" | "black";
  advantage: number;
  /** Vorgelesener Text, z. B. „Materialvorsprung 2". */
  label?: string;
}) {
  if (pieces.length === 0 && advantage <= 0) return null;
  return (
    <div
      data-captured={color}
      aria-label={label}
      className="mt-0.5 flex min-h-[16px] items-center gap-1"
    >
      {/* Die Figuren sind für ein helles Feld gezeichnet: schwarz gefüllt mit
          schwarzem Umriss, weiß gefüllt mit schwarzem Umriss. Auf der dunklen
          Seitenfläche verschwände das eine, das andere verlöre seinen Rand ·
          deshalb liegen beide Seiten auf einem Streifen in der Farbe des hellen
          Brettfeldes. Die Schlagliste sieht damit aus wie ein Stück Brett. */}
      <span
        className={
          pieces.length > 0
            ? "flex items-center rounded-[3px] bg-[#e6e3d3] px-[3px] py-px"
            : "flex items-center"
        }
      >
        {pieces.map((kind, i) => (
          <span key={i} style={{ marginLeft: i === 0 ? 0 : pieces[i - 1] === kind ? -6 : 2 }}>
            <Glyph kind={kind} color={color} />
          </span>
        ))}
      </span>
      {advantage > 0 && (
        <span className="ml-0.5 text-[11px] font-medium tabular-nums text-ink3">+{advantage}</span>
      )}
    </div>
  );
}
