/**
 * Erscheinungsbild: Farbwelt, Brett, Figuren und automatischer Wechsel.
 *
 * Die Vorschau ist keine Nachbildung, sondern die Sache selbst: Jede Kachel
 * trägt `data-theme` ihres Themas, und die Farbtokens darin gelten für ihren
 * Inhalt. Deshalb steht in dieser Datei kein einziger Farbwert — was in
 * `src/themes.css` steht, ist auch in der Kachel zu sehen. Für die Figuren
 * gilt dasselbe: Die Vorschau zeichnet die Figuren des Sets, nicht ein Bild
 * davon.
 */
import { BookMarked, Crown, Lock, Palette, Sparkles } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Button, Chip } from "../../components/ui";
import { useI18n } from "../../lib/i18n";
import { openPlusDialog } from "../../lib/plus/dialog";
import { usePlusGate } from "../../lib/plus/usePlus";
import {
  PIECE_VIEWBOX,
  glyphsVersion,
  loadPieceGlyphs,
  pieceGlyphs,
  subscribeGlyphs,
} from "../../lib/pieces/glyphs";
import { PIECE_SETS, pieceSetDef, type PieceSetId } from "../../lib/pieces/sets";
import {
  BOARD_SETS,
  THEMES,
  THEME_FEATURE,
  type Appearance,
  type BoardSetId,
  type ThemeId,
} from "../../lib/theme";
import { Field, inputCls } from "./SettingsLayout";

/** Angedeutete Oberfläche: Fläche, zwei Textzeilen, Akzent und ein Brett. */
function ThemePreview() {
  return (
    <span className="flex items-center gap-2 rounded-md bg-bg p-2">
      <span className="flex flex-1 flex-col gap-1">
        <span className="h-1.5 w-full rounded-full bg-ink2" />
        <span className="h-1.5 w-2/3 rounded-full bg-ink3" />
        <span className="h-1.5 w-1/3 rounded-full bg-accent" />
      </span>
      <BoardPreview />
    </span>
  );
}

/**
 * Drei Figuren eines Sets auf einem Stück Brett · die Vorschau zeigt die
 * Zeichnungen selbst und nicht ihre Beschreibung. Dame, Springer und Bauer
 * sind die drei, an denen ein Set als erstes auseinandergeht.
 */
function PiecePreview({ set }: { set: PieceSetId }) {
  const glyphs = pieceGlyphs(set);
  return (
    <span className="flex items-center gap-px overflow-hidden rounded-sm">
      {(["wQ", "bN", "wP"] as const).map((code, index) => (
        <span
          key={code}
          className={`flex h-7 w-7 items-center justify-center ${
            index % 2 === 0 ? "bg-board-light" : "bg-board-dark"
          }`}
        >
          <svg
            viewBox={PIECE_VIEWBOX}
            className="h-full w-full"
            aria-hidden="true"
            // Im Repo erzeugte Zeichnungen · keine Fremdeingabe.
            dangerouslySetInnerHTML={{ __html: glyphs[code] ?? "" }}
          />
        </span>
      ))}
    </span>
  );
}

/** Zwei mal zwei Felder · genug, um die Feldfarben zu zeigen. */
function BoardPreview() {
  return (
    <span className="grid h-6 w-6 shrink-0 grid-cols-2 overflow-hidden rounded-sm">
      <span className="bg-board-light" />
      <span className="bg-board-dark" />
      <span className="bg-board-dark" />
      <span className="bg-board-light" />
    </span>
  );
}

/**
 * Der Diagramm-Modus · ein Layoutmodus, kein Thema.
 *
 * Er steht über der Farbwelt, weil er die Seiten anders *setzt* und nicht
 * anders färbt · beides gehört ins Erscheinungsbild, aber der Satz kommt vor
 * der Farbe. Gesperrt folgt er dem Muster der übrigen Plus-Funktionen:
 * sichtbar, gedimmt, Schloss statt Schalter, Antippen öffnet die Erklärung —
 * wer nicht weiß, was es gibt, schaltet es auch nicht frei.
 *
 * Gesperrt ist die ganze Zeile die Schaltfläche, offen nur der Schalter
 * rechts: So gibt es nie eine Schaltfläche in einer Schaltfläche, und der
 * beschreibende Text bleibt markierbar, solange er etwas nützt.
 */
function DiagramModeRow({
  on,
  locked,
  onToggle,
}: {
  on: boolean;
  locked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useI18n();

  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel3 text-accent">
        <BookMarked size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-[7px]">
          <span className="text-[13.5px] font-medium text-ink">{t("set.diagramMode")}</span>
          {locked ? (
            <Lock size={12} className="shrink-0 text-ink3" />
          ) : (
            <Sparkles size={12} className="shrink-0 text-accent" />
          )}
          <span className="rounded border border-line2 px-[5px] py-[2px] text-[8px] font-medium uppercase tracking-[0.12em] text-ink3">
            {t("set.diagramModeBadge")}
          </span>
        </span>
        <span className="mt-1 block text-[12px] leading-[1.5] text-ink2">
          {t("set.diagramModeNote")}
        </span>
        <span className="mt-[5px] block text-[11.5px] leading-[1.5] text-ink3">
          {t("set.diagramModeScope")}
        </span>
      </span>
    </>
  );

  if (locked) {
    return (
      <button
        type="button"
        onClick={() => openPlusDialog(THEME_FEATURE)}
        className="flex w-full items-start gap-3 rounded-xl border border-line bg-panel2 py-3 pe-3 ps-3.5 text-start opacity-70"
      >
        {body}
        <span className="flex h-11 w-[52px] shrink-0 items-center justify-center text-ink3">
          <Lock size={15} />
        </span>
      </button>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border bg-panel2 py-3 pe-3 ps-3.5 ${
        on ? "border-accent-dim" : "border-line"
      }`}
    >
      {body}
      {/* 44 px Trefferfläche · der sichtbare Schalter ist kleiner als das, was
          man trifft. Der Knopf wandert mit `start`, damit er von rechts nach
          links genauso herumliegt wie umgekehrt. */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("set.diagramMode")}
        onClick={() => onToggle(!on)}
        className="flex h-11 w-[52px] shrink-0 items-center justify-end"
      >
        <span
          className={`relative inline-block h-[26px] w-[46px] rounded-full transition-colors ${
            on ? "bg-accent" : "bg-panel3 ring-1 ring-line2 ring-inset"
          }`}
        >
          <span
            className={`absolute top-[3px] h-5 w-5 rounded-full transition-all ${
              on ? "start-[23px] bg-accent-ink" : "start-[3px] bg-ink3"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

export default function AppearanceSection({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  /** Wirkt sofort · die Seite wendet die Wahl an und speichert sie. */
  onChange: (next: Appearance) => void;
}) {
  const { t } = useI18n();
  const gate = usePlusGate(THEME_FEATURE);
  // Die Vorschau zeigt jedes Set nebeneinander · dafür müssen hier ausnahmsweise
  // alle Zeichnungen her, nicht nur die des geltenden Sets. Sie kommen einzeln
  // an, und jede angekommene färbt ihre Kachel nach.
  useEffect(() => {
    for (const set of PIECE_SETS) void loadPieceGlyphs(set.id);
  }, []);
  useSyncExternalStore(subscribeGlyphs, glyphsVersion, glyphsVersion);
  // Solange der Plus-Zustand geprüft wird, bleiben die Kacheln offen: Ein
  // Schloss, das nach einer Sekunde verschwindet, ist schlechter als eines,
  // das eine Sekunde später erscheint.
  const locked = !gate.unlocked && !gate.pending;

  const pickTheme = (theme: ThemeId) => onChange({ ...appearance, theme });
  const pickNight = (night: ThemeId) => onChange({ ...appearance, night });
  const pickBoard = (boardSet: BoardSetId) => onChange({ ...appearance, boardSet });
  const pickPieces = (pieceSet: PieceSetId) => onChange({ ...appearance, pieceSet });
  const pickDiagram = (diagram: boolean) => onChange({ ...appearance, diagram });

  /** Kachel eines Themas · gesperrte führen zur Plus-Erklärung. */
  const themeTile = (id: ThemeId, selected: boolean, onPick: (id: ThemeId) => void) => {
    const def = THEMES.find((theme) => theme.id === id)!;
    const blocked = def.plus && locked;
    return (
      <button
        key={id}
        // Die Kachel steht in ihrem eigenen Thema · alles darin färbt sich
        // daraus, ohne dass hier eine Farbe stünde.
        data-theme={id}
        onClick={() => (blocked ? openPlusDialog(THEME_FEATURE) : onPick(id))}
        aria-pressed={selected}
        title={t(def.descKey)}
        // Die Fläche gehört zur Vorschau: Ohne eigenen Grund stünde die
        // Beschriftung eines hellen Themas in dunkler Schrift auf dunklem Panel.
        className={`flex flex-col gap-2 rounded-xl border bg-panel p-2.5 text-start transition-colors ${
          selected ? "border-accent-dim ring-1 ring-accent-dim" : "border-line hover:border-line2"
        } ${blocked ? "opacity-70" : ""}`}
      >
        <ThemePreview />
        <span className="flex items-center gap-1.5 px-0.5">
          <span className="flex-1 truncate text-[12.5px] font-medium text-ink">{t(def.nameKey)}</span>
          {def.plus && blocked && <Lock size={12} className="shrink-0 text-ink3" />}
          {def.plus && !blocked && <Sparkles size={12} className="shrink-0 text-accent" />}
        </span>
      </button>
    );
  };

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-ink2">{t("set.appearanceNote")}</p>

      <div className="mt-3.5">
        <DiagramModeRow on={appearance.diagram} locked={locked} onToggle={pickDiagram} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 min-[640px]:grid-cols-4">
        {THEMES.map((theme) => themeTile(theme.id, appearance.theme === theme.id, pickTheme))}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink3">
        {t(THEMES.find((theme) => theme.id === appearance.theme)!.descKey)}
      </p>

      {locked && (
        <div className="mt-3 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-accent">
          {t("plus.previewHint")}
          <div className="mt-2">
            <Button primary onClick={() => openPlusDialog(THEME_FEATURE)}>
              <Sparkles size={14} /> {t("plus.startTrial")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Brett ─────────────────────────────────────────────────────────── */}
      <h4 className="mt-5 flex items-center gap-2 text-[13px] font-medium text-ink">
        <Palette size={14} className="text-ink3" /> {t("set.boardSet")}
      </h4>
      <p className="mt-1 text-[12px] leading-relaxed text-ink3">{t("set.boardSetNote")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {BOARD_SETS.map((set) => (
          <button
            key={set.id}
            // "auto" zeigt das Brett des gewählten Themas, die übrigen ihr
            // eigenes · derselbe Weg wie bei den Themenkacheln.
            data-theme={set.id === "auto" ? appearance.theme : undefined}
            data-board={set.id === "auto" ? undefined : set.id}
            onClick={() => (locked ? openPlusDialog(THEME_FEATURE) : pickBoard(set.id))}
            aria-pressed={appearance.boardSet === set.id}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
              appearance.boardSet === set.id
                ? "border-accent-dim bg-accent-soft text-accent"
                : "border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
            } ${locked ? "opacity-70" : ""}`}
          >
            <BoardPreview />
            {t(set.nameKey)}
            {locked && <Lock size={12} className="text-ink3" />}
          </button>
        ))}
      </div>

      {/* ── Figuren ───────────────────────────────────────────────────────── */}
      <h4 className="mt-5 flex items-center gap-2 text-[13px] font-medium text-ink">
        <Crown size={14} className="text-ink3" /> {t("set.pieceSet")}
      </h4>
      <p className="mt-1 text-[12px] leading-relaxed text-ink3">{t("set.pieceSetNote")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {PIECE_SETS.map((set) => {
          const blocked = set.plus && locked;
          const selected = appearance.pieceSet === set.id;
          return (
            <button
              key={set.id}
              onClick={() => (blocked ? openPlusDialog(THEME_FEATURE) : pickPieces(set.id))}
              aria-pressed={selected}
              title={t(set.descKey)}
              className={`flex items-center gap-2 rounded-lg border p-1.5 pe-2.5 text-[12.5px] transition-colors ${
                selected
                  ? "border-accent-dim bg-accent-soft text-accent"
                  : "border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
              } ${blocked ? "opacity-70" : ""}`}
            >
              <PiecePreview set={set.id} />
              {t(set.nameKey)}
              {set.plus && blocked && <Lock size={12} className="text-ink3" />}
              {set.plus && !blocked && <Sparkles size={12} className="text-accent" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink3">
        {t(pieceSetDef(appearance.pieceSet).descKey)}
      </p>

      {/* ── Automatischer Wechsel ─────────────────────────────────────────── */}
      <h4 className="mt-5 text-[13px] font-medium text-ink">{t("set.themeAuto")}</h4>
      <p className="mt-1 text-[12px] leading-relaxed text-ink3">{t("set.themeAutoNote")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {(["off", "system", "time"] as const).map((mode) => (
          <Chip
            key={mode}
            active={appearance.auto === mode}
            onClick={() =>
              locked ? openPlusDialog(THEME_FEATURE) : onChange({ ...appearance, auto: mode })
            }
          >
            {t(
              mode === "off"
                ? "set.themeAutoOff"
                : mode === "system"
                  ? "set.themeAutoSystem"
                  : "set.themeAutoTime"
            )}
          </Chip>
        ))}
      </div>

      {appearance.auto !== "off" && (
        <>
          <p className="mt-3 text-[12px] text-ink3">{t("set.themeNight")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 min-[640px]:grid-cols-4">
            {THEMES.map((theme) => themeTile(theme.id, appearance.night === theme.id, pickNight))}
          </div>
        </>
      )}

      {appearance.auto === "time" && (
        <div className="mt-3 grid grid-cols-2 gap-3 min-[640px]:max-w-sm">
          <Field label={t("set.themeNightFrom")}>
            <input
              type="time"
              value={appearance.nightFrom}
              onChange={(e) => onChange({ ...appearance, nightFrom: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("set.themeNightTo")}>
            <input
              type="time"
              value={appearance.nightTo}
              onChange={(e) => onChange({ ...appearance, nightTo: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>
      )}
    </>
  );
}
