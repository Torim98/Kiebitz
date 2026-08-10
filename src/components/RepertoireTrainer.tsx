import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Lightbulb,
} from "lucide-react";
import { repDue, repReview, type DueItem, type RepNode } from "../lib/repertoire";
import Board from "./Board";
import { BOARD_WIDTH } from "../lib/boardLayout";
import { useBoardSelection } from "../lib/boardMoves";
import { Button, Card } from "./ui";
import { useT } from "../lib/i18n";
import { fenAfter } from "../lib/util";
import { useBackendInfo } from "../lib/backend";
import { maybeRequestPlayReview } from "../lib/reviewPrompt";

/** Wie lange die gelöste Stellung stehen bleibt, bevor die nächste Karte kommt. */
const ADVANCE_MS = 1000;
/** Pause, bevor der Gegner antwortet · ohne sie wirkt es wie ein Sprung. */
const REPLY_MS = 550;
/** Höchstzahl eigener Züge je Karte, damit eine Linie nicht endlos läuft. */
const MAX_CHAIN = 6;
/** Antwortzeiten, aus denen die FSRS-Note abgeleitet wird. */
const EASY_MS = 3_000;
const HARD_MS = 10_000;

const EMPTY_SANS: string[] = [];

/** Schach- und Mattzeichen zählen für den Vergleich nicht. */
const bareSan = (san: string) => san.replace(/[+#]/g, "");

/**
 * Note aus der Antwortzeit. Wer sofort zieht, kann die Stellung · wer lange
 * überlegt, hat sie gerade noch zusammenbekommen. Genau diesen Unterschied
 * verarbeitet FSRS, und ohne ihn liefen alle Karten im selben Takt.
 */
export function gradeForAnswer(elapsedMs: number): 1 | 2 | 3 | 4 {
  if (elapsedMs <= EASY_MS) return 4;
  if (elapsedMs <= HARD_MS) return 3;
  return 2;
}

/**
 * Umwandlungsfigur aus den erwarteten Antworten · sonst wäre jede Linie, die
 * nicht in eine Dame umwandelt, unbeantwortbar.
 */
export function promotionFor(answers: { san: string }[]): "q" | "r" | "b" | "n" {
  for (const answer of answers) {
    const match = /=([QRBN])/.exec(answer.san);
    if (match) return match[1].toLowerCase() as "q" | "r" | "b" | "n";
  }
  return "q";
}

interface Answer {
  id: number;
  san: string;
}

/**
 * Repertoire-Training.
 *
 * Eine Karte ist keine Einzelstellung, sondern der Anfang einer Linie: nach der
 * richtigen Antwort zieht der Gegner selbst · bei mehreren Buchantworten
 * gewürfelt · und die Linie läuft weiter, solange das Buch sie kennt. Dadurch
 * trainiert man die Variante und nicht eine Sammlung zusammenhangloser Züge.
 *
 * Bewertet wird jeder eigene Zug einzeln (FSRS), die Note kommt aus der
 * Antwortzeit. Ein Fehler hängt die Karte ans Ende der Sitzung, statt sie erst
 * am nächsten Tag wiederzubringen.
 */
export default function RepertoireTrainer({
  nodes,
  dueLimit,
  newLimit,
  onExit,
}: {
  nodes: RepNode[];
  dueLimit?: number;
  newLimit?: number;
  onExit: () => void;
}) {
  const backend = useBackendInfo();
  const t = useT();
  const [items, setItems] = useState<DueItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [state, setState] = useState<"ask" | "correct" | "wrong">("ask");
  const [shake, setShake] = useState(false);
  const [doneCount, setDoneCount] = useState({ ok: 0, fail: 0 });
  const [viewPly, setViewPly] = useState(0);
  /** Züge nach der Ausgangsstellung · eigene Antworten und Gegnerzüge. */
  const [played, setPlayed] = useState<string[]>([]);
  /** Buchzüge, die an der aktuellen Stelle zählen. */
  const [answers, setAnswers] = useState<Answer[]>([]);

  const failedRef = useRef(false);
  const askedAtRef = useRef(0);
  const chainRef = useRef(0);
  const answeredRef = useRef<Set<number>>(new Set());
  const requeuedRef = useRef<Set<number>>(new Set());
  const itemsRef = useRef<DueItem[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reviewMomentSentRef = useRef(false);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // Der Stapel wird genau einmal gezogen · träfen später geladene Grenzen ein,
  // würde die laufende Sitzung mitten im Zählen neu beginnen.
  const limitsRef = useRef({ dueLimit, newLimit });
  useEffect(() => {
    repDue(limitsRef.current.dueLimit, limitsRef.current.newLimit)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  // Ein laufender Vorlauf darf nicht in eine beendete Sitzung hineinfeuern.
  useEffect(() => clearTimers, [clearTimers]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = useCallback(
    (parentId: number, side: "white" | "black") =>
      nodes.filter((n) => n.parent_id === parentId && n.side === side),
    [nodes]
  );

  const item = items?.[idx] ?? null;
  const promptSans = item?.prompt_sans ?? EMPTY_SANS;
  const lineSans = useMemo(() => [...promptSans, ...played], [promptSans, played]);
  const fen = useMemo(() => fenAfter(lineSans.slice(0, viewPly)), [lineSans, viewPly]);
  const liveFen = useMemo(() => fenAfter(lineSans), [lineSans]);
  /** Steht das Brett auf der Stellung, in der gerade gefragt wird? */
  const atLive = viewPly === lineSans.length;

  itemsRef.current = items ?? [];

  useEffect(() => {
    if (
      items == null ||
      item != null ||
      !backend.info ||
      reviewMomentSentRef.current
    ) {
      return;
    }
    reviewMomentSentRef.current = true;
    void maybeRequestPlayReview(backend.info, {
      kind: "repertoire-session-complete",
      correctAnswers: doneCount.ok,
    });
  }, [backend.info, doneCount.ok, item, items]);

  // Neue Karte: Brett auf die Ausgangsstellung, Kette zurücksetzen und die
  // erlaubten Antworten aus dem Baum holen (das Buch darf hier mehrere kennen).
  useEffect(() => {
    if (!item) return;
    clearTimers();
    setPlayed([]);
    setViewPly(item.prompt_sans.length);
    setState("ask");
    failedRef.current = false;
    chainRef.current = 0;
    askedAtRef.current = Date.now();
    const parentId = byId.get(item.node_id)?.parent_id ?? 0;
    const alternatives = childrenOf(parentId, item.side).filter((n) => n.my_move);
    setAnswers(
      alternatives.length > 0
        ? alternatives.map((n) => ({ id: n.id, san: n.san }))
        : [{ id: item.node_id, san: item.expected_san }]
    );
  }, [item, byId, childrenOf, clearTimers]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setViewPly((value) => Math.max(0, value - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setViewPly((value) => Math.min(lineSans.length, value + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lineSans.length]);

  /** Zur nächsten Karte · schon beantwortete Züge werden übersprungen. */
  const advance = useCallback(() => {
    setIdx((current) => {
      let next = current + 1;
      while (
        next < itemsRef.current.length
        && answeredRef.current.has(itemsRef.current[next].node_id)
      ) {
        next += 1;
      }
      return next;
    });
  }, []);

  const finishCard = useCallback(() => later(advance, ADVANCE_MS), [advance, later]);

  const show = (san: string) => {
    setPlayed((current) => [...current, san]);
    setViewPly((value) => value + 1);
  };

  /**
   * Nach meinem Zug antwortet der Gegner selbst. Kennt das Buch mehrere
   * Antworten, entscheidet der Zufall · sonst übt man immer denselben Pfad
   * durch eine Variante, die in Wahrheit mehrere hat.
   */
  const continueLine = useCallback(
    (nodeId: number, side: "white" | "black") => {
      if (chainRef.current >= MAX_CHAIN) return finishCard();
      const replies = childrenOf(nodeId, side);
      if (replies.length === 0) return finishCard();
      const reply = replies[Math.floor(Math.random() * replies.length)];
      later(() => {
        show(reply.san);
        const mine = childrenOf(reply.id, side).filter((n) => n.my_move);
        if (mine.length === 0) {
          finishCard();
          return;
        }
        chainRef.current += 1;
        setAnswers(mine.map((n) => ({ id: n.id, san: n.san })));
        setState("ask");
        failedRef.current = false;
        askedAtRef.current = Date.now();
      }, REPLY_MS);
    },
    [childrenOf, finishCard, later]
  );

  const accept = (answer: Answer, san: string, side: "white" | "black") => {
    if (!failedRef.current) {
      repReview(answer.id, gradeForAnswer(Date.now() - askedAtRef.current)).catch(() => {});
      setDoneCount((c) => ({ ...c, ok: c.ok + 1 }));
      // Nur sauber Gekonntes gilt als erledigt · ein Fehler soll später in
      // dieser Sitzung noch einmal drankommen.
      answeredRef.current.add(answer.id);
    }
    setState("correct");
    show(san);
    continueLine(answer.id, side);
  };

  const tryMove = (from: string, to: string): boolean => {
    if (!item || state !== "ask" || !atLive) return false;
    let san: string;
    try {
      const chess = new Chess(liveFen);
      san = chess.move({ from, to, promotion: promotionFor(answers) }).san;
    } catch {
      return false;
    }
    const hit = answers.find((a) => bareSan(a.san) === bareSan(san));
    if (hit) {
      accept(hit, san, item.side);
      return true;
    }
    if (!failedRef.current) {
      failedRef.current = true;
      const missed = answers[0];
      repReview(missed.id, 1).catch(() => {});
      setDoneCount((c) => ({ ...c, fail: c.fail + 1 }));
      // Der Zug kommt am Ende der Sitzung wieder · einmal falsch heißt nicht
      // "morgen wieder", sondern "gleich noch einmal".
      if (!requeuedRef.current.has(item.node_id)) {
        requeuedRef.current.add(item.node_id);
        setItems((current) => (current ? [...current, item] : current));
      }
    }
    setState("wrong");
    setShake(true);
    later(() => setShake(false), 600);
    return false;
  };

  /** Buchzug zeigen und die Karte beenden · nach einem Fehler läuft die Linie nicht weiter. */
  const reveal = () => {
    if (!item || state !== "ask") return;
    if (!failedRef.current) {
      failedRef.current = true;
      repReview(answers[0].id, 1).catch(() => {});
      setDoneCount((c) => ({ ...c, fail: c.fail + 1 }));
      if (!requeuedRef.current.has(item.node_id)) {
        requeuedRef.current.add(item.node_id);
        setItems((current) => (current ? [...current, item] : current));
      }
    }
    setState("correct");
    show(answers[0].san);
    finishCard();
  };

  const revealAndNext = () => {
    if (!item) return;
    setState("correct");
    show(answers[0].san);
    finishCard();
  };

  // "h" wie Hinweis · im Training hat man die Hand an der Maus, nicht auf Tab.
  // Der Ref hält die aktuelle Aktion, damit der Listener einmal hängen bleibt.
  const hintRef = useRef<() => void>(() => {});
  hintRef.current = () => {
    if (state === "ask") reveal();
    else if (state === "wrong") revealAndNext();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "h" && event.key !== "H") return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      hintRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trainSelection = useBoardSelection(fen, tryMove, state === "ask" && atLive);

  if (items == null) return null;
  if (!item) {
    return (
      <div className="mx-auto max-w-[480px] rounded-xl border border-line bg-panel px-6 py-10 text-center">
        <GraduationCap size={28} className="mx-auto text-accent" />
        <div className="mt-3 text-[17px] font-semibold">
          {doneCount.ok + doneCount.fail > 0 ? t("rep.trainingDone") : t("rep.nothingDue")}
        </div>
        <div className="mt-1.5 text-[13px] text-ink3">
          {doneCount.ok + doneCount.fail > 0
            ? t("rep.sessionResult", { ok: doneCount.ok, fail: doneCount.fail })
            : t("rep.allLearned")}
        </div>
        <Button primary onClick={onExit} className="mt-5">
          {t("rep.backToRep")}
        </Button>
      </div>
    );
  }

  const askPly = lineSans.length;
  const moveNo = Math.floor(askPly / 2) + 1;
  const previousSan = lineSans[lineSans.length - 1];
  const previousMove = previousSan
    ? `${Math.ceil(askPly / 2)}${askPly % 2 === 1 ? "." : "…"}${previousSan}`
    : t("rep.startPos");
  const expectedLabel = answers.map((a) => a.san).join(" / ");
  const playedSan = played[played.length - 1] ?? expectedLabel;

  return (
    <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[528px_minmax(0,1fr)]">
      <div>
        <div className="mb-3 flex items-center justify-between text-[13px]">
          <span className="font-medium">
            {item.line || t("rep.fallbackLine")} ·{" "}
            {item.side === "white" ? t("common.white") : t("common.black")}
          </span>
          <span className="text-ink3">
            {idx + 1} / {items.length} {item.is_new && t("rep.newTag")}
          </span>
        </div>
        <Board
          boardId="rep-train"
          fen={fen}
          width={BOARD_WIDTH}
          draggable={state === "ask" && atLive}
          onPieceDrop={tryMove}
          onSquareClick={trainSelection.onSquareClick}
          squareStyles={trainSelection.squareStyles}
          orientation={item.side}
          shake={shake}
          mouseDrag
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2">
          <span className="text-[12.5px] text-ink2">{t("rep.lastMove", { move: previousMove })}</span>
          <div className="flex items-center gap-1">
            <Button onClick={() => setViewPly(0)} className="px-2" title={t("rep.firstPosition")}>
              <ChevronFirst size={14} />
            </Button>
            <Button
              onClick={() => setViewPly((value) => Math.max(0, value - 1))}
              className="px-2"
              title={t("rep.previousPosition")}
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="min-w-[54px] text-center text-[11.5px] tabular-nums text-ink3">
              {viewPly} / {lineSans.length}
            </span>
            <Button
              onClick={() => setViewPly((value) => Math.min(lineSans.length, value + 1))}
              className="px-2"
              title={t("rep.nextPosition")}
            >
              <ChevronRight size={14} />
            </Button>
            <Button
              onClick={() => setViewPly(lineSans.length)}
              className="px-2"
              title={t("rep.promptPosition")}
            >
              <ChevronLast size={14} />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex min-h-[52px] items-center">
          {state === "correct" ? (
            <div className="flex w-full items-center gap-2 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[13.5px] font-medium text-accent">
              <Check size={17} /> {t("rep.correct", { san: playedSan })}
            </div>
          ) : state === "wrong" ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5">
              <span className="text-[13.5px] text-loss">
                {t("rep.bookMoveIs", { san: expectedLabel })}
              </span>
              <Button onClick={revealAndNext} title={t("rep.revealShortcut")}>
                {t("rep.showAndNext")}
              </Button>
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] text-ink3">
                {t("rep.whatToPlay", {
                  n: moveNo,
                  side: item.side === "white" ? t("common.white") : t("common.black"),
                })}
              </span>
              <Button onClick={reveal} title={t("rep.revealShortcut")}>
                <Lightbulb size={14} /> {t("rep.reveal")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex max-w-[420px] flex-col gap-4">
        <Card title={t("rep.session")}>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-win">{t("rep.nCorrect", { n: doneCount.ok })}</span>
            <span className="text-loss">{t("rep.nWrong", { n: doneCount.fail })}</span>
            <span className="text-ink3">{t("rep.nLeft", { n: items.length - idx })}</span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-panel3">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${(idx / items.length) * 100}%` }}
            />
          </div>
          {chainRef.current > 0 && (
            <div className="mt-3 border-t border-line pt-2.5 text-[12px] text-ink3">
              {t("rep.lineDepth", { n: chainRef.current + 1 })}
            </div>
          )}
        </Card>
        <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
          {t("rep.trainerHint")}
        </div>
        <Button onClick={onExit}>{t("rep.endTraining")}</Button>
      </div>
    </div>
  );
}
