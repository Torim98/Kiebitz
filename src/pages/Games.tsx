import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  History,
  Loader2,
  Save,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { games as demoGames, profile, type Result, type Source } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { listGames, setGameNote, upsertGames, type GameRecord } from "../lib/db";
import { fetchAll } from "../lib/importer";
import { indexPositions } from "../lib/analysis";
import { getSettings } from "../lib/settings";
import { toUi, type GamesFilter, type UiGame } from "../lib/gameUi";
import Board from "../components/Board";
import { Button, Card, Chip, ExtLink, ResultBadge, SourceBadge, Tag } from "../components/ui";
import { de, deInt, fenAfter } from "../lib/util";

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
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  const [source, setSource] = useState<Source | "alle">(initialFilter?.source ?? "alle");
  const [result, setResult] = useState<Result | "alle">(initialFilter?.result ?? "alle");
  const [query, setQuery] = useState("");
  // Exakt-Filter (aus dem Dashboard vorbelegt, per Pill wieder entfernbar).
  const [tc, setTc] = useState(initialFilter?.tc ?? "");
  const [dateKey, setDateKey] = useState(initialFilter?.date ?? "");
  const [opponent, setOpponent] = useState(initialFilter?.opponent ?? "");
  const [opening, setOpening] = useState(initialFilter?.opening ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const reload = () =>
    listGames()
      .then((rs) => setDbGames(rs.map((r) => toUi(r, locale))))
      .catch(() => setDbGames(null));

  useEffect(() => {
    if (backend.mode === "desktop") reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.mode, locale]);

  const live = dbGames !== null && dbGames.length > 0;
  const allGames: UiGame[] = live ? dbGames! : demoGames;

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
            g.opening.toLowerCase().includes(query.toLowerCase()))
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

  const [myUser, setMyUser] = useState(profile.ccUser);
  useEffect(() => {
    if (backend.mode === "desktop") {
      getSettings()
        .then((s) => setMyUser(s.cc_user || profile.ccUser))
        .catch(() => {});
    }
  }, [backend.mode]);

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("games.title")}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink3">
            {live ? (
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
          <div className="flex gap-2">
            <Button onClick={() => !importing && runImport(true)}>
              <History size={15} /> {t("games.importAll")}
            </Button>
            <Button primary onClick={() => !importing && runImport(false)}>
              {importing ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> {t("games.importing")}
                </>
              ) : (
                <>
                  <Download size={15} /> {t("games.importLatest")}
                </>
              )}
            </Button>
          </div>
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
            placeholder={t("games.searchPlaceholder")}
            className="w-64 rounded-lg border border-line bg-panel py-1.5 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
        </div>
        {(["alle", "chess.com", "lichess"] as const).map((s) => (
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

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
        <Card pad={false}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink3">
                <th className="py-2.5 pl-4 pr-2 font-medium">{t("games.colDate")}</th>
                <th className="px-2 font-medium">{t("games.colSource")}</th>
                <th className="px-2 font-medium">{t("games.colMode")}</th>
                <th className="px-2 font-medium">{t("games.colOpponent")}</th>
                <th className="px-2 font-medium">{t("games.colOpening")}</th>
                <th className="px-2 font-medium">{t("games.colResult")}</th>
                <th className="px-2 text-right font-medium">{t("games.colAccuracy")}</th>
                <th className="py-2.5 pl-2 pr-4 text-right font-medium">{t("games.colTags")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((g) => (
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
                      {g.tags.slice(0, 2).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                      {g.note && <StickyNote size={14} className="ml-1 inline text-gold" />}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-ink3">
                    {t("games.noneFound")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12.5px] text-ink3">
            <div className="flex flex-wrap items-center gap-2">
              <span>{t("games.perPage")}</span>
              {[10, 25, 50, 100].map((n) => (
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
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                className="flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={15} /> {t("games.prev")}
              </button>
              <span className="tabular-nums">
                {t("games.pageOf", { page: safePage, pages: totalPages })}
              </span>
              <button
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
                className="flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("games.next")} <ChevronRight size={15} />
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
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selected.tags.length > 0
                    ? selected.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)
                    : <span className="text-[12px] text-ink3">{t("games.noTags")}</span>}
                  <button className="rounded-md border border-dashed border-line2 px-2 py-0.5 text-[11.5px] text-ink3 hover:text-accent">
                    {t("games.addTag")}
                  </button>
                </div>
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
              <div className="mt-3 flex items-center gap-2">
                {selected.dbId ? (
                  <>
                    <Button primary onClick={saveNote} className="flex-1">
                      <Save size={15} />
                      {noteSaved ? t("games.noteSaved") : t("games.saveNote")}
                    </Button>
                    <Button onClick={() => openAnalysis(selected.dbId!)}>
                      {selected.analyzed ? t("games.openAnalysis") : t("games.analyze")}
                    </Button>
                  </>
                ) : (
                  <Button primary className="flex-1">
                    {selected.analyzed ? t("games.openAnalysis") : t("games.analyzeStockfish")}
                  </Button>
                )}
                <ExtLink
                  href={
                    selected.url ??
                    (selected.source === "chess.com"
                      ? `https://www.chess.com/games/archive/${myUser}`
                      : `https://lichess.org/@/${myUser}/all`)
                  }
                  label={t("games.original")}
                />
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
