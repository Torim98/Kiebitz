import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  FileDown,
  FileUp,
  History,
  Loader2,
  FolderOpen,
  Save,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { games as demoGames, profile, type Result, type Source } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { deleteGame, listGames, readPgnFile, setGameNote, setGameTags, upsertGames, writePgnFile, type GameRecord } from "../lib/db";
import { fetchAll } from "../lib/importer";
import { indexPositions } from "../lib/analysis";
import { getSettings } from "../lib/settings";
import { toUi, type GamesFilter, type UiGame } from "../lib/gameUi";
import Board from "../components/Board";
import { Button, Card, Chip, ExtLink, ResultBadge, SourceBadge, Tag } from "../components/ui";
import { de, deInt, fenAfter } from "../lib/util";
import { exportPgn, importPgn } from "../lib/pgn";

const PAGE_SIZE_KEY = "kiebitz.games.pageSize";
const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Gemerkte Seitengröße lesen; beim ersten Öffnen auf 10 (ungültig/leer). */
function readStoredPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if ((PAGE_SIZES as readonly number[]).includes(n)) return n;
  } catch {
    /* Storage nicht verfügbar */
  }
  return 10;
}

export default function Games({
  openAnalysis,
  initialFilter,
}: {
  openAnalysis: (gameId: number) => void;
  initialFilter?: GamesFilter | null;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const [dbGames, setDbGames] = useState<UiGame[] | null>(null);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [pgnPath, setPgnPath] = useState("");
  const [pgnExportPath, setPgnExportPath] = useState("");
  const [pgnPlayer, setPgnPlayer] = useState(profile.ccUser);
  const [pgnBusy, setPgnBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [source, setSource] = useState<Source | "alle">(initialFilter?.source ?? "alle");
  const [result, setResult] = useState<Result | "alle">(initialFilter?.result ?? "alle");
  const [query, setQuery] = useState("");
  // Exakt-Filter (aus dem Dashboard vorbelegt, per Pill wieder entfernbar).
  const [tc, setTc] = useState(initialFilter?.tc ?? "");
  const [dateKey, setDateKey] = useState(initialFilter?.date ?? "");
  const [opponent, setOpponent] = useState(initialFilter?.opponent ?? "");
  const [opening, setOpening] = useState(initialFilter?.opening ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(readStoredPageSize);
  const [page, setPage] = useState(1);
  // Inline-Eingabe zum direkten Springen auf eine bestimmte Seite.
  const [pageInput, setPageInput] = useState<string | null>(null);

  // Gewählte Seitengröße merken (nur UI-Präferenz → localStorage).
  useEffect(() => {
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch {
      /* Storage nicht verfügbar — gilt nur für die Sitzung */
    }
  }, [pageSize]);

  const reload = () =>
    listGames()
      .then((rs) => {
        setRecords(rs);
        setDbGames(rs.map((r) => toUi(r, locale)));
      })
      .catch(() => setDbGames(null));

  useEffect(() => {
    if (backend.mode === "desktop") reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.mode, locale]);

  const databaseLoaded = dbGames !== null;
  const allGames: UiGame[] = databaseLoaded ? dbGames : demoGames;

  const filtered = useMemo(
    () =>
      allGames.filter(
        (g) =>
          (source === "alle" || g.source === source) &&
          (result === "alle" || g.result === result) &&
          (tc === "" || g.tc === tc) &&
          (dateKey === "" || g.date === dateKey) &&
          (opponent === "" || g.opponent === opponent) &&
          (opening === "" || g.opening === opening) &&
          (query === "" ||
            g.opponent.toLowerCase().includes(query.toLowerCase()) ||
            g.opening.toLowerCase().includes(query.toLowerCase()) ||
            g.tags.some((tag) => tag.toLowerCase().includes(query.toLowerCase())))
      ),
    [allGames, source, result, tc, dateKey, opponent, opening, query]
  );

  const selected: UiGame | undefined =
    filtered.find((g) => g.id === selectedId) ?? filtered[0];

  // Paginierung: bei Filter-/Seitengröße-Wechsel zurück auf Seite 1.
  useEffect(() => setPage(1), [source, result, query, pageSize, tc, dateKey, opponent, opening]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeFrom = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeTo = Math.min(safePage * pageSize, filtered.length);

  // Eingetippte Zielseite übernehmen (auf gültigen Bereich begrenzt).
  const commitPageJump = () => {
    const n = parseInt(pageInput ?? "", 10);
    if (!Number.isNaN(n)) setPage(Math.min(Math.max(n, 1), totalPages));
    setPageInput(null);
  };

  const runImport = async (full: boolean) => {
    setImporting(true);
    setImportMsg(full ? t("games.loadingFull") : t("games.loadingLatest"));
    try {
      const settings = await getSettings().catch(() => null);
      const ccUser = settings?.cc_user || profile.ccUser;
      const liUser = settings?.li_user || profile.liUser;
      const { games: fetched, summary } = await fetchAll(ccUser, liUser, {
        full,
        months: settings?.import_months,
        onProgress: (i, n) => setImportMsg(t("games.ccProgress", { i, n })),
      });
      const res = await upsertGames(fetched as GameRecord[]);
      await reload();
      // Positionsindex im Hintergrund auffrischen (für die Stellungssuche).
      indexPositions().catch(() => {});
      let msg = t("games.importResult", {
        ins: res.inserted,
        cc: summary.fetched.cc,
        li: summary.fetched.li,
        total: deInt(res.total),
      });
      if (summary.errors.length) msg += t("games.importErrors", { e: summary.errors.join("; ") });
      setImportMsg(msg);
    } catch (e) {
      setImportMsg(t("games.importFailed", { e: String(e) }));
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

  const saveTags = async (next: string[]) => {
    if (!selected?.dbId) return;
    const saved = await setGameTags(selected.dbId, next);
    setDbGames((gs) => gs?.map((g) => (g.id === selected.id ? { ...g, tags: saved } : g)) ?? gs);
    setRecords((rs) => rs.map((g) => (g.id === selected.dbId ? { ...g, tags: saved } : g)));
  };

  const addTags = async () => {
    if (!selected) return;
    const additions = tagDraft.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
    if (!additions.length) return;
    await saveTags([...selected.tags, ...additions]);
    setTagDraft("");
  };

  const deleteSelected = async () => {
    if (!selected?.dbId || deleting) return;
    if (!window.confirm(t("games.deleteConfirm", { opponent: selected.opponent }))) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const deleted = await deleteGame(selected.dbId);
      if (!deleted) throw new Error(t("games.deleteMissing"));
      setRecords((games) => games.filter((game) => game.id !== selected.dbId));
      setDbGames((games) => games?.filter((game) => game.id !== selected.id) ?? games);
      setSelectedId(null);
      setNoteDraft(null);
      setTagDraft("");
    } catch (e) {
      setDeleteError(t("games.deleteFailed", { e: String(e) }));
    } finally {
      setDeleting(false);
    }
  };

  const choosePgnImport = async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
    });
    if (typeof path === "string") setPgnPath(path);
  };

  const choosePgnExport = async () => {
    const path = await saveDialog({
      defaultPath: "kiebitz-export.pgn",
      filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
    });
    if (path) setPgnExportPath(path.toLowerCase().endsWith(".pgn") ? path : `${path}.pgn`);
  };

  const runPgnImport = async () => {
    if (!pgnPath.trim()) return;
    setPgnBusy(true);
    try {
      const parsed = importPgn(await readPgnFile(pgnPath.trim()), pgnPlayer);
      const res = await upsertGames(parsed);
      await reload();
      indexPositions().catch(() => {});
      setImportMsg(t("games.pgnImported", { n: parsed.length, ins: res.inserted }));
    } catch (e) {
      setImportMsg(t("games.pgnFailed", { e: String(e) }));
    } finally {
      setPgnBusy(false);
    }
  };

  const runPgnExport = async (onlySelected: boolean) => {
    if (!pgnExportPath.trim()) return;
    const chosen = onlySelected && selected?.dbId ? records.filter((g) => g.id === selected.dbId) : records;
    if (!chosen.length) return;
    setPgnBusy(true);
    try {
      await writePgnFile(pgnExportPath.trim(), exportPgn(chosen, pgnPlayer));
      setImportMsg(t("games.pgnExported", { n: chosen.length, path: pgnExportPath.trim() }));
    } catch (e) {
      setImportMsg(t("games.pgnFailed", { e: String(e) }));
    } finally {
      setPgnBusy(false);
    }
  };

  const [myUser, setMyUser] = useState(profile.ccUser);
  useEffect(() => {
    if (backend.mode === "desktop") {
      getSettings()
        .then((s) => {
          setMyUser(s.cc_user || profile.ccUser);
          setPgnPlayer(s.display_name || s.cc_user || profile.ccUser);
        })
        .catch(() => {});
    }
  }, [backend.mode]);

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("games.title")}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink3">
            {databaseLoaded ? (
              <>
                <Database size={13} className="text-accent" />
                {t("games.dbCount", { n: deInt(allGames.length) })}
              </>
            ) : (
              t("games.demoHint")
            )}
          </p>
        </div>
        {backend.mode === "desktop" && (
          <Button onClick={() => setImportOpen((open) => !open)}>
            <Download size={15} /> {t("games.manageImports")}
            {importOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        )}
      </header>

      {importMsg && (
        <div className="mb-4 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent">
          {importMsg}
        </div>
      )}

      {backend.mode === "desktop" && importOpen && (
        <Card title={t("games.importPanelTitle")} className="mb-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-ink2">{t("games.onlineImportTitle")}</div>
              <div className="mt-0.5 text-[11.5px] text-ink3">{t("games.onlineImportHint")}</div>
            </div>
            <div className="grid grid-cols-1 gap-2 min-[460px]:grid-cols-2 sm:flex">
              <Button className="w-full sm:w-auto" onClick={() => !importing && runImport(true)}>
                <History size={15} /> {t("games.importAll")}
              </Button>
              <Button className="w-full sm:w-auto" primary onClick={() => !importing && runImport(false)}>
                {importing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {importing ? t("games.importing") : t("games.importLatest")}
              </Button>
            </div>
          </div>
          <div className="mb-4 border-t border-line" />
          <div className="mb-3 text-[12.5px] font-medium text-ink2">{t("games.pgnTitle")}</div>
          <div className="mb-3 grid max-w-md gap-1.5 sm:grid-cols-[auto_minmax(0,14rem)] sm:items-center">
            <label className="text-[12px] text-ink3" htmlFor="pgn-player">{t("games.pgnPlayer")}</label>
            <input id="pgn-player" value={pgnPlayer} onChange={(e) => setPgnPlayer(e.target.value)} className="min-w-0 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none" />
          </div>
          <p className="mb-3 max-w-3xl text-[11.5px] leading-relaxed text-ink3">{t("games.pgnHint", { user: pgnPlayer })}</p>
          <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-2">
            <section className="min-w-0 rounded-lg border border-line bg-panel2/35 p-3">
              <div className="mb-2 text-[11.5px] font-medium text-ink2">{t("games.pgnImportGroup")}</div>
              <button onClick={choosePgnImport} className="w-full min-w-0 truncate rounded-lg border border-line bg-panel2 px-3 py-2 text-left text-[12.5px] text-ink3 hover:border-line2">
                {pgnPath || t("games.pgnChooseImport")}
              </button>
              <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <Button className="w-full" onClick={choosePgnImport}><FolderOpen size={14} /> {t("games.chooseFile")}</Button>
                <Button className="w-full" primary disabled={!pgnPath || pgnBusy} onClick={() => runPgnImport()}><FileUp size={14} /> {t("common.import")}</Button>
              </div>
            </section>
            <section className="min-w-0 rounded-lg border border-line bg-panel2/35 p-3">
              <div className="mb-2 text-[11.5px] font-medium text-ink2">{t("games.pgnExportGroup")}</div>
              <button onClick={choosePgnExport} className="w-full min-w-0 truncate rounded-lg border border-line bg-panel2 px-3 py-2 text-left text-[12.5px] text-ink3 hover:border-line2">
                {pgnExportPath || t("games.pgnChooseExport")}
              </button>
              <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 min-[620px]:grid-cols-3">
                <Button className="w-full" onClick={choosePgnExport}><FolderOpen size={14} /> {t("games.chooseTarget")}</Button>
                <Button className="w-full" onClick={() => !pgnBusy && runPgnExport(true)} disabled={!pgnExportPath || !selected?.dbId}><FileDown size={14} /> {t("games.pgnSelected")}</Button>
                <Button className="w-full min-[420px]:col-span-2 min-[620px]:col-span-1" onClick={() => !pgnBusy && runPgnExport(false)} disabled={!pgnExportPath}>{t("games.pgnAll")}</Button>
              </div>
            </section>
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative mr-2">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("games.searchPlaceholder")}
            className="w-64 rounded-lg border border-line bg-panel py-1.5 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
        </div>
        {(["alle", "chess.com", "lichess", "manual"] as const).map((s) => (
          <Chip key={s} active={source === s} onClick={() => setSource(s)}>
            {s === "alle" ? t("games.allSources") : s}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-line2" />
        {(
          [
            ["alle", t("games.allResults")],
            ["win", t("games.wins")],
            ["loss", t("games.losses")],
            ["draw", t("games.draws")],
          ] as const
        ).map(([val, label]) => (
          <Chip key={val} active={result === val} onClick={() => setResult(val)}>
            {label}
          </Chip>
        ))}
      </div>

      {(dateKey || tc || opponent || opening) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(
            [
              [dateKey, t("games.filterDate", { v: dateKey }), () => setDateKey("")],
              [tc, t("games.filterMode", { v: tc }), () => setTc("")],
              [opponent, t("games.filterOpponent", { v: opponent }), () => setOpponent("")],
              [opening, t("games.filterOpening", { v: opening }), () => setOpening("")],
            ] as const
          )
            .filter(([val]) => val)
            .map(([val, label, clear]) => (
              <span
                key={label}
                className="flex items-center gap-1.5 rounded-full border border-accent-dim bg-accent-soft py-1 pl-3 pr-1.5 text-[12px] text-accent"
              >
                {label as string}
                <button
                  onClick={clear}
                  aria-label={t("games.clearFilter")}
                  className="rounded-full p-0.5 text-accent/70 transition-colors hover:bg-accent/15 hover:text-accent"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          <button
            onClick={() => {
              setDateKey("");
              setTc("");
              setOpponent("");
              setOpening("");
            }}
            className="text-[12px] text-ink3 transition-colors hover:text-accent"
          >
            {t("games.clearAll")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
        <Card pad={false}>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink3">
                <th className="py-2.5 pl-4 pr-2 font-medium">{t("games.colDate")}</th>
                <th className="px-2 font-medium">{t("games.colSource")}</th>
                <th className="px-2 font-medium">{t("games.colMode")}</th>
                <th className="px-2 font-medium">{t("games.colOpponent")}</th>
                <th className="px-2 font-medium">{t("games.colOpening")}</th>
                <th className="px-2 font-medium">{t("games.colResult")}</th>
                <th className="px-2 text-right font-medium">{t("games.colAccuracy")}</th>
                <th className="w-[112px] py-2.5 pl-2 pr-4 text-right font-medium">{t("games.colTags")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((g) => {
                const filterTo = (e: MouseEvent, fn: () => void) => {
                  e.stopPropagation();
                  fn();
                };
                return (
                <tr
                  key={g.id}
                  onClick={() => {
                    setSelectedId(g.id);
                    setNoteDraft(null);
                    setDeleteError(null);
                  }}
                  className={`cursor-pointer border-b border-line last:border-0 ${
                    selected?.id === g.id ? "bg-panel2" : "hover:bg-panel2/60"
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2">
                    <button
                      onClick={(e) => filterTo(e, () => setDateKey(g.date))}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.date}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setSource(g.source))}
                      className="transition-opacity hover:opacity-80"
                    >
                      <SourceBadge source={g.source} />
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setTc(g.tc))}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.tc}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setOpponent(g.opponent))}
                      className="text-ink transition-colors hover:text-accent"
                    >
                      {g.opponent}
                    </button>{" "}
                    <span className="text-ink3">({g.oppElo})</span>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setOpening(g.opening))}
                      className="text-left text-ink2 transition-colors hover:text-accent"
                    >
                      {g.opening}
                    </button>{" "}
                    {g.eco && <span className="text-ink3">· {g.eco}</span>}
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setResult(g.result))}
                      className="transition-opacity hover:opacity-80"
                    >
                      <ResultBadge result={g.result} />
                    </button>
                  </td>
                  <td className="px-2 text-right text-ink2">
                    {g.accuracy != null ? `${de(g.accuracy)} %` : "—"}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      {g.tags[0] && <span className="inline-block max-w-[68px] truncate align-middle"><Tag>{g.tags[0]}</Tag></span>}
                      {g.tags.length > 1 && <span className="text-[11px] text-ink3">+{g.tags.length - 1}</span>}
                      {g.note && <StickyNote size={14} className="ml-1 inline text-gold" />}
                    </div>
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-ink3">
                    {t("games.noneFound")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12.5px] text-ink3">
            <div className="flex flex-wrap items-center gap-2">
              <span>{t("games.perPage")}</span>
              {PAGE_SIZES.map((n) => (
                <Chip key={n} active={pageSize === n} onClick={() => setPageSize(n)}>
                  {n}
                </Chip>
              ))}
              <span className="ml-1 tabular-nums">
                {t("games.rangeInfo", {
                  from: deInt(rangeFrom),
                  to: deInt(rangeTo),
                  total: deInt(filtered.length),
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={safePage <= 1}
                title={t("games.firstPage")}
                aria-label={t("games.firstPage")}
                className="flex items-center rounded-lg border border-line bg-panel px-2 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronsLeft size={15} />
              </button>
              <button
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                className="flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={15} /> {t("games.prev")}
              </button>
              {pageInput !== null ? (
                <input
                  autoFocus
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={commitPageJump}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitPageJump();
                    else if (e.key === "Escape") setPageInput(null);
                  }}
                  aria-label={t("games.goToPage")}
                  className="w-14 rounded-lg border border-accent-dim bg-panel px-2 py-1 text-center tabular-nums text-ink focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              ) : (
                <button
                  onClick={() => setPageInput(String(safePage))}
                  title={t("games.goToPage")}
                  className="rounded-lg px-1.5 py-1 tabular-nums transition-colors hover:text-accent"
                >
                  {t("games.pageOf", { page: safePage, pages: totalPages })}
                </button>
              )}
              <button
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
                className="flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("games.next")} <ChevronRight size={15} />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={safePage >= totalPages}
                title={t("games.lastPage")}
                aria-label={t("games.lastPage")}
                className="flex items-center rounded-lg border border-line bg-panel px-2 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronsRight size={15} />
              </button>
            </div>
          </div>
        )}
        </div>

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
                      ? `${myUser} – ${selected.opponent}`
                      : `${selected.opponent} – ${myUser}`}
                  </div>
                  <ResultBadge result={selected.result} />
                </div>
                <div className="mt-1 text-[12px] text-ink3">
                  {selected.opening} {selected.eco && `(${selected.eco})`} ·{" "}
                  {t("games.movesTc", { n: selected.moves, tc: selected.tc })}
                </div>
                {selected.analyzed && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {([
                      [t("ins.phase.opening"), selected.accuracyOpening],
                      [t("ins.phase.middlegame"), selected.accuracyMiddlegame],
                      [t("ins.phase.endgame"), selected.accuracyEndgame],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="rounded-md bg-panel2 px-1.5 py-1.5">
                        <div className="text-[10px] text-ink3">{label}</div>
                        <div className="text-[12px] font-medium text-ink2">{value == null ? "—" : `${de(value)} %`}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selected.tags.length > 0
                    ? selected.tags.map((tag) => (
                        <button key={tag} onClick={() => saveTags(selected.tags.filter((v) => v !== tag))} disabled={!selected.dbId} title={t("games.removeTag")}>
                          <Tag>{tag} ×</Tag>
                        </button>
                      ))
                    : <span className="text-[12px] text-ink3">{t("games.noTags")}</span>}
                </div>
                {selected.dbId && (
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addTags();
                      }
                    }}
                    placeholder={t("games.tagPlaceholder")}
                    className="mt-2 w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-[12px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
                  />
                )}
              </div>
            </Card>

            <Card title={t("games.notes")}>
              <textarea
                key={selected.id}
                defaultValue={selected.note ?? ""}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={t("games.notesPlaceholder")}
                rows={4}
                className="w-full resize-none rounded-lg border border-line bg-panel2 p-3 text-[13px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
              />
              <div className="mt-3 grid gap-2 min-[480px]:grid-cols-2">
                {selected.dbId ? (
                  <>
                    <Button primary onClick={saveNote} className="w-full">
                      <Save size={15} />
                      {noteSaved ? t("games.noteSaved") : t("games.saveNote")}
                    </Button>
                    <Button className="w-full" onClick={() => openAnalysis(selected.dbId!)}>
                      {selected.analyzed ? t("games.openAnalysis") : t("games.analyze")}
                    </Button>
                  </>
                ) : (
                  <Button primary className="w-full min-[480px]:col-span-2">
                    {selected.analyzed ? t("games.openAnalysis") : t("games.analyzeStockfish")}
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                {selected.source !== "manual" ? (
                  <ExtLink
                    href={selected.url || (selected.source === "chess.com" ? `https://www.chess.com/games/archive/${myUser}` : `https://lichess.org/@/${myUser}/all`)}
                    label={t("games.original")}
                  />
                ) : (
                  <span />
                )}
                {selected.dbId && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={deleteSelected}
                    className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#713636] bg-[#251515] px-3 py-1.5 text-[12.5px] font-medium text-loss transition-colors hover:border-[#a64b4b] hover:bg-[#321919] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {deleting ? t("games.deleting") : t("games.delete")}
                  </button>
                )}
              </div>
              {deleteError && (
                <div className="mt-3 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12px] text-loss">
                  {deleteError}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
