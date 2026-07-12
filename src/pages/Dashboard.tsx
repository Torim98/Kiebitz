import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, BookOpen, Cpu, Puzzle } from "lucide-react";
import { games, profile, ratings, ratingHistory, repertoireStats, puzzleStats } from "../data/demo";
import { Card, ExtLink, ResultBadge, SourceBadge, Spark, Button } from "../components/ui";
import { chart, DarkTooltip } from "../components/chartTheme";
import { de } from "../lib/util";
import type { PageId } from "../App";

export default function Dashboard({ go }: { go: (p: PageId) => void }) {
  const recent = games.slice(0, 5);
  const unanalyzed = games.filter((g) => !g.analyzed).length;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Guten Abend, {profile.name}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            Samstag, 12. Juli 2026 · Zuletzt synchronisiert {profile.lastSync}
          </p>
        </div>
        <div className="flex gap-2">
          <ExtLink href="https://www.chess.com/member/Torim98" label="chess.com" />
          <span className="text-line2">·</span>
          <ExtLink href="https://lichess.org/@/Torim98" label="lichess" />
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-4 min-[1100px]:grid-cols-4">
        {ratings.map((r) => (
          <a
            key={r.id}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="group rounded-xl border border-line bg-panel p-4 transition-colors hover:border-line2"
          >
            <div className="mb-2 flex items-center justify-between">
              <SourceBadge source={r.platform} />
              <span className="text-[11.5px] text-ink3">{r.tc}</span>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-[26px] font-semibold leading-none tracking-tight">{r.value}</div>
                <div
                  className="mt-1.5 flex items-center gap-1 text-[12px]"
                  style={{ color: r.delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
                >
                  {r.delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta} · 30 Tage
                </div>
              </div>
              <Spark data={r.spark} color={r.platform === "chess.com" ? chart.cc : chart.li} />
            </div>
          </a>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        <Card title="Rating-Verlauf · Rapid · 26 Wochen" className="min-[1100px]:col-span-2">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={ratingHistory} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="week" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} interval={4} />
              <YAxis domain={[1340, 1560]} tick={chart.tick} tickLine={false} axisLine={false} />
              <Tooltip content={<DarkTooltip />} cursor={{ stroke: chart.axis }} />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="plainline"
                formatter={(v) => <span className="text-[12px] text-ink2">{v}</span>}
              />
              <Line type="monotone" dataKey="cc" name="chess.com" stroke={chart.cc} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="li" name="lichess" stroke={chart.li} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <BookOpen size={15} className="text-accent" /> Repertoire-Training
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {repertoireStats.dueToday}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">fällige Wiederholungen</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">Serie: {repertoireStats.streak} Tage</div>
              </div>
              <Button primary onClick={() => go("repertoire")}>Trainieren</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Cpu size={15} className="text-violet" /> Analyse-Warteschlange
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {unanalyzed}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">Partien ohne Analyse</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">Stockfish 17 · Tiefe 24</div>
              </div>
              <Button onClick={() => go("analysis")}>Starten</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Puzzle size={15} className="text-gold" /> Tagesziel Puzzles
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {puzzleStats.todaySolved}
                  <span className="text-[15px] font-normal text-ink3"> / {puzzleStats.todayGoal}</span>
                </div>
                <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-panel3">
                  <div
                    className="h-full rounded-full bg-gold"
                    style={{ width: `${(puzzleStats.todaySolved / puzzleStats.todayGoal) * 100}%` }}
                  />
                </div>
              </div>
              <Button onClick={() => go("puzzles")}>Lösen</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Letzte Partien" className="mt-4" pad={false}
        action={<button onClick={() => go("games")} className="text-[12.5px] text-ink3 hover:text-accent">Alle anzeigen →</button>}
      >
        <table className="w-full text-[13px]">
          <tbody>
            {recent.map((g) => (
              <tr key={g.id} className="border-b border-line last:border-0 hover:bg-panel2">
                <td className="py-2.5 pl-4 pr-2 text-ink3">{g.date}</td>
                <td className="px-2"><SourceBadge source={g.source} /></td>
                <td className="px-2 text-ink3">{g.tc}</td>
                <td className="px-2">
                  <span className="text-ink">{g.opponent}</span>
                  <span className="ml-1.5 text-ink3">({g.oppElo})</span>
                </td>
                <td className="px-2 text-ink2">{g.opening}</td>
                <td className="px-2"><ResultBadge result={g.result} /></td>
                <td className="px-2 text-right text-ink2">
                  {g.accuracy != null ? `${de(g.accuracy)} %` : "—"}
                </td>
                <td className="py-2.5 pl-2 pr-4 text-right">
                  <ExtLink
                    href={g.source === "chess.com" ? "https://www.chess.com/games/archive/Torim98" : "https://lichess.org/@/Torim98/all"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
