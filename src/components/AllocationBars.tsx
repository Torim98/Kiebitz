/**
 * Soll gegen Ist: was Kiebitz empfiehlt und was tatsächlich passiert.
 *
 * Das ist die Diagnose des ganzen Reiters auf einem Blick, und sie kommt ohne
 * einen einzigen Satz aus — die Lücke zwischen den beiden Balken *ist* die
 * Aussage. Der Ist-Wert stammt aus den letzten 28 Tagen, damit eine gute oder
 * schlechte Woche ihn nicht kippt.
 */
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/util";
import type { AreaNeed } from "../lib/plan";
import type { Area } from "../lib/study";

const AREA_KEY: Record<Area, Key> = {
  play: "plan.areaPlay",
  tactics: "plan.areaTactics",
  openings: "plan.areaOpenings",
  endgames: "plan.areaEndgames",
  analysis: "plan.areaAnalysis",
};

export default function AllocationBars({
  allocation,
  weeklyMinutes,
}: {
  allocation: AreaNeed[];
  weeklyMinutes: number;
}) {
  const { t } = useI18n();
  // Beide Balken auf derselben Skala · sonst sieht ein Ist von 40 % neben
  // einem Soll von 20 % harmlos aus.
  const max = Math.max(10, ...allocation.flatMap((need) => [need.target, need.actual]));

  return (
    <div className="space-y-3">
      {allocation.map((need) => {
        const gap = need.target - need.actual;
        return (
          <div key={need.area} data-allocation={need.area}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-ink2">{t(AREA_KEY[need.area])}</span>
              <span className="tabular-nums text-ink3">
                {t("plan.allocValue", {
                  target: need.target,
                  actual: need.actual,
                  m: deInt(need.minutes),
                  a: deInt(need.actualMinutes),
                })}
              </span>
            </div>
            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-ink3">
                  {t("plan.allocTarget")}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel3">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(need.target / max) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-ink3">
                  {t("plan.allocActual")}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel3">
                  <div
                    className={`h-full rounded-full ${
                      // Deutlich unter dem Soll ist die Lücke, um die es geht;
                      // deutlich darüber ist kein Fehler, sondern nur Sättigung.
                      gap >= 10 ? "bg-loss" : gap <= -10 ? "bg-gold" : "bg-ink3"
                    }`}
                    style={{ width: `${(need.actual / max) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <p className="border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-ink3">
        {t("plan.allocNote", { m: deInt(weeklyMinutes) })}
      </p>
    </div>
  );
}
