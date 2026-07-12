import { useState } from "react";
import {
  Activity,
  BarChart3,
  Bird,
  BookOpen,
  Database,
  LayoutDashboard,
  Puzzle as PuzzleIcon,
  RefreshCw,
  Settings,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Games from "./pages/Games";
import Analysis from "./pages/Analysis";
import Repertoire from "./pages/Repertoire";
import Puzzles from "./pages/Puzzles";
import Insights from "./pages/Insights";
import { profile } from "./data/demo";

export type PageId = "dashboard" | "games" | "analysis" | "repertoire" | "puzzles" | "insights";

const nav: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "games", label: "Partien", icon: Database },
  { id: "analysis", label: "Analyse", icon: Activity },
  { id: "repertoire", label: "Repertoire", icon: BookOpen },
  { id: "puzzles", label: "Puzzles", icon: PuzzleIcon },
  { id: "insights", label: "Insights", icon: BarChart3 },
];

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard");

  return (
    <div className="flex h-full">
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Bird size={20} />
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Kiebitz</div>
            <div className="text-[11px] text-ink3">Schach-Cockpit</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ${
                page === id
                  ? "bg-panel3 font-medium text-ink"
                  : "text-ink2 hover:bg-panel2 hover:text-ink"
              }`}
            >
              <Icon size={17} className={page === id ? "text-accent" : "text-ink3"} />
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-auto px-3 pb-5">
          <div className="mb-3 rounded-lg border border-line bg-panel2 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12px] text-ink2">
              <RefreshCw size={13} className="text-accent" />
              Synchronisiert
            </div>
            <div className="mt-0.5 text-[11px] text-ink3">{profile.lastSync} · 1.248 Partien</div>
          </div>
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-ink2 transition-colors hover:bg-panel2 hover:text-ink">
            <Settings size={17} className="text-ink3" />
            Einstellungen
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {page === "dashboard" && <Dashboard go={setPage} />}
        {page === "games" && <Games />}
        {page === "analysis" && <Analysis />}
        {page === "repertoire" && <Repertoire />}
        {page === "puzzles" && <Puzzles />}
        {page === "insights" && <Insights />}
      </main>
    </div>
  );
}
