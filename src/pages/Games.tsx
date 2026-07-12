import { useEffect, useMemo, useState } from "react";
import { Database, Download, Loader2, Save, Search, StickyNote } from "lucide-react";
import { games as demoGames, profile, type Game, type Result, type Source } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { listGames, setGameNote, upsertGames, type GameRecord } from "../lib/db";
import { fetchAll } from "../lib/importer";
import Board from "../components/Board";
import { Button, Card, Chip, ExtLink, ResultBadge, SourceBadge, Tag } from "../components/ui";
import { de, deInt, fenAfter } from "../lib/util";

interface UiGame extends Omit<Game, "tc"> {
  tc: string;
  dbId?: number;
  url?: string;
}

const TC_LABEL: Record<string, string> = {
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  daily: "Täglich",
  classical: "Klassisch",
};

function toUi(r: GameRecord): UiGame {
  const [y, m, d] = r.played_at.split("-");
  return {
    id: `db-${r.id}`,
    dbId: r.id ?? undefined,
    url: r.url,
    date: d && m && y ? `${d}.${m}.${y}` : r.played_at,
    source: r.source,
    tc: TC_LABEL[r.time_class] ?? r.time_class,
    color: r.color,
    opponent: r.opponent,
    oppElo: r.opp_elo,
    myElo: r.my_elo,
    result: r.result,
    opening: r.opening || "—",
    eco: r.eco,
    moves: r.moves_count,
    accuracy: r.accuracy,
    analyzed: r.analyzed,
    tags: [],
    note: r.note || undefined,
    sans: r.moves ? r.moves.split(" ") : undefined,
  };
}

export default function Games() {
  const backend = useBackendInfo();
  const [dbGames, setDbGames] = useState<UiGame[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  const [source, setSource] = useState<Source | "alle">("alle");
  const [result, setResult] = useState<Result | "alle">("alle");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = () =>
    listGames()
      .then((rs) => setDbGames(rs.map(toUi)))
      .catch(() => setDbGames(null));

  useEffect(() => {
    if (backend.mode === "desktop") reload();
  }, [backend.mode]);

  const live = dbGames !== null && dbGames.length > 0;
  const allGames: UiGame[] = live ? dbGames! : demoGames;

  const filtered = useMemo(
    () =>
      allGames.filter(
        (g) =>
          (source === "alle" || g.source === source) &&
          (result === "alle" || g.result === result) &&
          (query === "" ||
            g.opponent.toLowerCase().includes(query.toLowerCase()) ||
            g.opening.toLowerCase().includes(query.toLowerCase()))
      ),
    [allGames, source, result, query]
  );

  const selected: UiGame | undefined =
    filtered.find((g) => g.id === selectedId) ?? filtered[0];

  const runImport = async () => {
    setImporting(true);
    setImportMsg(null);
    try {
      const { games: fetched, summary } = await fetchAll(profile.ccUser, profile.liUser);
      const res = await upsertGames(fetched as GameRecord[]);
      await reload();
      let msg = `${res.inserted} neue Partien · abgerufen: chess.com ${summary.fetched.cc}, Lichess ${summary.fetched.li} · ${deInt(res.total)} in der Datenbank`;
      if (summary.errors.length) msg += ` · Fehler: ${summary.errors.join("; ")}`;
      setImportMsg(msg);
    } catch (e) {
      setImportMsg(`Import fehlgeschlagen: ${e}`);
    } finally {
      setImporting(false);
    }
  };

  const saveNote = async () => {
    if (!selected?.dbId || noteDraft === null) return;
    await setGameNote(selected.dbId, noteDraft);
    setDbGames((gs) =>
      gs ? gs.map((g) => (g.id === selected.id ? { ...g, note: noteDraft || undefined } : g)) : gs
    );
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Partien-Datenbank</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink3">
            {live ? (
              <>
                <Database size={13} className="text-accent" />
                {deInt(allGames.length)} Partien in der lokalen SQLite-Datenbank
              </>
            ) : (
              "Demo-Daten — Import läuft über die Desktop-App"
            )}
          </p>
        </div>
        {backend.mode === "desktop" && (
          <Button primary onClick={runImport}>
            {importing ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Importiere …
              </>
            ) : (
              <>
                <Download size={15} /> Von chess.com & Lichess importieren
              </>
            )}
          </Button>
        )}
      </header>

      {importMsg && (
        <div className="mb-4 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent">
          {importMsg}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative mr-2">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gegner oder Eröffnung suchen …"
            className="w-64 rounded-lg border border-line bg-panel py-1.5 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
        </div>
        {(["alle", "chess.com", "lichess"] as const).map((s) => (
          <Chip key={s} active={source === s} onClick={() => setSource(s)}>
            {s === "alle" ? "Alle Quellen" : s}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-line2" />
        {(
          [
            ["alle", "Alle Ergebnisse"],
            ["win", "Siege"],
            ["loss", "Niederlagen"],
            ["draw", "Remis"],
          ] as const
        ).map(([val, label]) => (
          <Chip key={val} active={result === val} onClick={() => setResult(val)}>
            {label}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[1fr_320px]">
        <Card pad={false}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink3">
                <th className="py-2.5 pl-4 pr-2 font-medium">Datum</th>
                <th className="px-2 font-medium">Quelle</th>
                <th className="px-2 font-medium">Modus</th>
                <th className="px-2 font-medium">Gegner</th>
                <th className="px-2 font-medium">Eröffnung</th>
                <th className="px-2 font-medium">Ergebnis</th>
                <th className="px-2 text-right font-medium">Genauigkeit</th>
                <th className="py-2.5 pl-2 pr-4 text-right font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr
                  key={g.id}
                  onClick={() => {
                    setSelectedId(g.id);
                    setNoteDraft(null);
                  }}
                  className={`cursor-pointer border-b border-line last:border-0 ${
                    selected?.id === g.id ? "bg-panel2" : "hover:bg-panel2/60"
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2 text-ink3">{g.date}</td>
                  <td className="px-2"><SourceBadge source={g.source} /></td>
                  <td className="px-2 text-ink3">{g.tc}</td>
                  <td className="px-2">
                    {g.opponent} <span className="text-ink3">({g.oppElo})</span>
                  </td>
                  <td className="px-2 text-ink2">
                    {g.opening} {g.eco && <span className="text-ink3">· {g.eco}</span>}
                  </td>
                  <td className="px-2"><ResultBadge result={g.result} /></td>
                  <td className="px-2 text-right text-ink2">
                    {g.accuracy != null ? `${de(g.accuracy)} %` : "—"}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      {g.tags.slice(0, 2).map((t) => <Tag key={t}>{t}</Tag>)}
                      {g.note && <StickyNote size={14} className="ml-1 inline text-gold" />}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-ink3">
                    Keine Partien gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {selected && (
          <div className="flex flex-col gap-4">
            <Card pad={false}>
              <div className="flex justify-center p-4 pb-3">
                <Board boardId="games-preview" fen={fenAfter(selected.sans)} width={272} orientation={selected.color} />
              </div>
              <div className="border-t border-line px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-[13.5px] font-medium">
                    {selected.color === "white"
                      ? `${profile.ccUser} – ${selected.opponent}`
                      : `${selected.opponent} – ${profile.ccUser}`}
                  </div>
                  <ResultBadge result={selected.result} />
                </div>
                <div className="mt-1 text-[12px] text-ink3">
                  {selected.opening} {selected.eco && `(${selected.eco})`} · {selected.moves} Züge · {selected.tc}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selected.tags.length > 0
                    ? selected.tags.map((t) => <Tag key={t}>{t}</Tag>)
                    : <span className="text-[12px] text-ink3">Keine Tags</span>}
                  <button className="rounded-md border border-dashed border-line2 px-2 py-0.5 text-[11.5px] text-ink3 hover:text-accent">
                    + Tag
                  </button>
                </div>
              </div>
            </Card>

            <Card title="Notizen">
              <textarea
                key={selected.id}
                defaultValue={selected.note ?? ""}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Gedanken zur Partie festhalten …"
                rows={4}
                className="w-full resize-none rounded-lg border border-line bg-panel2 p-3 text-[13px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
              />
              <div className="mt-3 flex items-center gap-2">
                {selected.dbId ? (
                  <Button primary onClick={saveNote} className="flex-1">
                    <Save size={15} />
                    {noteSaved ? "Gespeichert ✓" : "Notiz speichern"}
                  </Button>
                ) : (
                  <Button primary className="flex-1">
                    {selected.analyzed ? "Analyse öffnen" : "Mit Stockfish analysieren"}
                  </Button>
                )}
                <ExtLink
                  href={
                    selected.url ??
                    (selected.source === "chess.com"
                      ? "https://www.chess.com/games/archive/Torim98"
                      : "https://lichess.org/@/Torim98/all")
                  }
                  label="Original"
                />
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
