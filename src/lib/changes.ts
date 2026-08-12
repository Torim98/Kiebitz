/** Fachbereiche, deren persistente Daten sich ändern können. */
export type DataChangeTopic =
  | "games"
  | "analysis"
  | "puzzles"
  | "endgame"
  | "repertoire"
  | "study"
  | "database";

const ALL_TOPICS: readonly DataChangeTopic[] = [
  "games",
  "analysis",
  "puzzles",
  "endgame",
  "repertoire",
  "study",
  "database",
];
const CHANGE_EVENT = "kiebitz:data-change";

type ChangeDetail = { topics: DataChangeTopic[] };

let batchDepth = 0;
const pendingTopics = new Set<DataChangeTopic>();

function dispatch(topics: Iterable<DataChangeTopic>): void {
  if (typeof window === "undefined") return;
  const detail: ChangeDetail = { topics: [...new Set(topics)] };
  if (detail.topics.length === 0) return;
  window.dispatchEvent(new CustomEvent<ChangeDetail>(CHANGE_EVENT, { detail }));
}

/**
 * Signalisiert eine lokale Änderung. Ohne Thema gilt die Änderung für alle
 * Bereiche, etwa nach Datenbank-Wiederherstellung oder Geräte-Sync.
 */
export function emitDataChange(...topics: DataChangeTopic[]): void {
  const changed = topics.length > 0 ? topics : ALL_TOPICS;
  if (batchDepth > 0) {
    changed.forEach((topic) => pendingTopics.add(topic));
    return;
  }
  dispatch(changed);
}

/**
 * Fasst die Signale einer synchronen oder asynchronen Mehrfachoperation zu
 * genau einem Ereignis zusammen. Verschachtelte Batches werden unterstützt.
 */
export async function batchDataChanges<T>(operation: () => T | Promise<T>): Promise<T> {
  batchDepth += 1;
  try {
    return await operation();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0 && pendingTopics.size > 0) {
      const topics = [...pendingTopics];
      pendingTopics.clear();
      dispatch(topics);
    }
  }
}

/** Abonniert nur die benötigten Datenbereiche; ohne Filter werden alle gehört. */
export function onDataChange(
  cb: (topics: ReadonlySet<DataChangeTopic>) => void,
  topics: readonly DataChangeTopic[] = ALL_TOPICS
): () => void {
  if (typeof window === "undefined") return () => {};
  const selected = new Set(topics);
  const listener = (event: Event) => {
    const changed = new Set((event as CustomEvent<ChangeDetail>).detail?.topics ?? ALL_TOPICS);
    if ([...changed].some((topic) => selected.has(topic))) cb(changed);
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
