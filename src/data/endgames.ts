/**
 * Kuratierte Endspiel-Drills für den Endspiel-Trainer. Die IDs sind stabil ·
 * sie landen als drill_id in der Datenbank (endgame_attempts).
 *
 * Jede Aufgabe ist ein theoretisch eindeutiges Lehrbuch-Endspiel: Ziel „win“
 * heißt, der Spieler muss gegen beste Verteidigung mattsetzen; Ziel „draw“
 * heißt, er muss gegen beste Angriffe das Remis halten (Patt, Zugwiederholung,
 * 50-Züge-Regel oder ungenügendes Material zählen als Erfolg).
 */
import type { Locale } from "../lib/i18n";

/** `random` sind erzeugte Stellungen (siehe lib/randomEndgame.ts). */
export type EndgameCategory = "mates" | "pawn" | "rook" | "queen" | "minor" | "random";

/**
 * Text eines Drills in allen Oberflächensprachen.
 *
 * Diese Texte stehen bewusst nicht im Haupt-Wörterbuch: Name und Hinweis
 * gehören zur Aufgabe und werden zusammen mit ihr gepflegt. Englisch ist
 * Pflicht und dient als Rückfallebene, falls eine Sprache noch fehlt.
 */
export type DrillText = { en: string } & Partial<Record<Locale, string>>;

export function drillText(text: DrillText, locale: Locale): string {
  return text[locale] ?? text.en;
}

export interface EndgameDrill {
  id: string;
  category: EndgameCategory;
  /** Seite, die der Spieler führt. */
  side: "white" | "black";
  goal: "win" | "draw";
  fen: string;
  name: DrillText;
  hint: DrillText;
}

export const ENDGAME_DRILLS: EndgameDrill[] = [
  // ── Grundlegende Mattführungen ─────────────────────────────────────────────
  {
    id: "mate-queen",
    category: "mates",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1",
    name: {
      de: "Damenmatt",
      en: "Queen checkmate",
      es: "Mate con dama",
      fr: "Mat avec la dame",
      hi: "वज़ीर से मात",
      ar: "المات بالوزير",
      zh: "后杀王",
    },
    hint: {
      de: "Die Dame hält Springerabstand zum König und drängt ihn an den Rand; der eigene König rückt nach. Vorsicht: kein Patt!",
      en: "Keep the queen a knight's move away from the king and drive him to the edge; bring your own king up. Careful: no stalemate!",
      es: "Mantén la dama a distancia de caballo del rey y empújalo hacia el borde; acerca tu propio rey. Cuidado: ¡nada de ahogado!",
      fr: "Garde la dame à distance de cavalier du roi et pousse-le vers le bord ; fais monter ton propre roi. Attention : pas de pat !",
      hi: "वज़ीर को राजा से घोड़े की दूरी पर रखें और उसे किनारे की ओर धकेलें; अपना राजा भी पास लाएँ। ध्यान रखें: गतिरोध न हो!",
      ar: "أبقِ الوزير على بُعد نقلة حصان من الملك وادفعه نحو الحافة، وقرّب ملكك. انتبه: لا تصنع تعادلاً بالحصار!",
      zh: "让后与对方王保持马步距离，把它逼向边线，同时把自己的王调上来。注意：不要逼和！",
    },
  },
  {
    id: "mate-rook",
    category: "mates",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    name: {
      de: "Turmmatt",
      en: "Rook checkmate",
      es: "Mate con torre",
      fr: "Mat avec la tour",
      hi: "हाथी से मात",
      ar: "المات بالرخ",
      zh: "车杀王",
    },
    hint: {
      de: "Der Turm sperrt eine Reihe, der König erkämpft die Opposition · dann Schach und die nächste Reihe abschneiden (Box-Methode).",
      en: "The rook fences off a rank, your king fights for the opposition · then check and shrink the box.",
      es: "La torre cierra una fila y tu rey conquista la oposición · luego jaque y reduce la caja.",
      fr: "La tour barre une rangée, ton roi conquiert l'opposition · ensuite échec et la boîte rétrécit.",
      hi: "हाथी एक पंक्ति रोकता है, आपका राजा विरोध जीतता है · फिर शह देकर डिब्बा छोटा करें।",
      ar: "يغلق الرخ صفًا ويكسب ملكك المواجهة · ثم كش وتضييق الصندوق.",
      zh: "车封锁一条横线，己方王争夺对王 · 然后将军，把包围圈收窄。",
    },
  },
  {
    id: "mate-bishops",
    category: "mates",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1",
    name: {
      de: "Zwei Läufer",
      en: "Two bishops",
      es: "Dos alfiles",
      fr: "Deux fous",
      hi: "दो ऊँट",
      ar: "الفيلان",
      zh: "双象杀王",
    },
    hint: {
      de: "Die Läufer bilden nebeneinander eine Barriere, der König wird in eine Ecke gedrängt. Der eigene König muss eng mitarbeiten.",
      en: "Side-by-side the bishops form a barrier; drive the king into a corner. Your own king must work closely with them.",
      es: "Juntos, los alfiles forman una barrera; empuja al rey hacia una esquina. Tu propio rey debe colaborar de cerca.",
      fr: "Côte à côte, les fous forment une barrière ; pousse le roi dans un coin. Ton propre roi doit collaborer étroitement.",
      hi: "दोनों ऊँट साथ-साथ एक दीवार बनाते हैं; राजा को कोने में धकेलें। आपका अपना राजा पास रहकर साथ दे।",
      ar: "يشكّل الفيلان جنبًا إلى جنب حاجزًا؛ ادفع الملك إلى الزاوية. وعلى ملكك أن يتعاون عن قرب.",
      zh: "两象并肩构成屏障，把对方王逼进角落。己方王必须紧密配合。",
    },
  },

  // ── Bauernendspiele ────────────────────────────────────────────────────────
  {
    id: "pawn-front",
    category: "pawn",
    side: "white",
    goal: "win",
    fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1",
    name: {
      de: "König vor dem Bauern",
      en: "King in front of the pawn",
      es: "El rey delante del peón",
      fr: "Le roi devant le pion",
      hi: "प्यादे के आगे राजा",
      ar: "الملك أمام البيدق",
      zh: "王在兵前",
    },
    hint: {
      de: "Steht der König vor dem Bauern auf der 6. Reihe, ist es immer gewonnen: erst der König, dann der Bauer. Achtung Patt am Schluss.",
      en: "With the king in front of the pawn on the 6th rank it is always winning: king first, pawn second. Beware the final stalemate.",
      es: "Con el rey delante del peón en la sexta fila siempre se gana: primero el rey, después el peón. Cuidado con el ahogado final.",
      fr: "Avec le roi devant le pion à la 6e rangée, c'est toujours gagné : le roi d'abord, le pion ensuite. Attention au pat final.",
      hi: "छठी पंक्ति पर प्यादे के आगे राजा हो तो जीत निश्चित है: पहले राजा, फिर प्यादा। अंत में गतिरोध से बचें।",
      ar: "إذا وقف الملك أمام البيدق على الصف السادس فالفوز مضمون: الملك أولًا ثم البيدق. احذر التعادل بالحصار في النهاية.",
      zh: "王站在兵前的第六横线上必胜：先走王，后推兵。注意最后不要逼和。",
    },
  },
  {
    id: "pawn-square",
    category: "pawn",
    side: "white",
    goal: "win",
    fen: "8/8/8/8/k7/8/6P1/6K1 w - - 0 1",
    name: {
      de: "Quadratregel",
      en: "The square rule",
      es: "La regla del cuadrado",
      fr: "La règle du carré",
      hi: "वर्ग का नियम",
      ar: "قاعدة المربع",
      zh: "方框规则",
    },
    hint: {
      de: "Steht der gegnerische König außerhalb des Quadrats des Freibauern, läuft er durch. Danach: Damenmatt zu Ende führen.",
      en: "If the defending king is outside the square of the passed pawn, it simply runs. Afterwards: convert the queen checkmate.",
      es: "Si el rey defensor queda fuera del cuadrado del peón pasado, este corona sin más. Después: rematar con el mate de dama.",
      fr: "Si le roi adverse est hors du carré du pion passé, celui-ci passe tout seul. Ensuite : conclure par le mat avec la dame.",
      hi: "यदि बचाव करने वाला राजा मुक्त प्यादे के वर्ग से बाहर है, तो प्यादा बेरोक बढ़ता है। फिर वज़ीर से मात पूरी करें।",
      ar: "إذا خرج الملك المدافع عن مربع البيدق الحر، مضى البيدق وحده. بعدها: أكمل المات بالوزير.",
      zh: "若防守方王在通路兵的方框之外，兵可径直升变。随后：完成后杀王。",
    },
  },
  {
    id: "pawn-rookpawn",
    category: "pawn",
    side: "black",
    goal: "draw",
    fen: "2k5/8/K7/P7/8/8/8/8 b - - 0 1",
    name: {
      de: "Randbauer: Remis halten",
      en: "Rook pawn: hold the draw",
      es: "Peón de torre: mantener las tablas",
      fr: "Pion de tour : tenir la nulle",
      hi: "किनारे का प्यादा: बराबरी बचाएँ",
      ar: "بيدق الرخ: احفظ التعادل",
      zh: "边兵：守住和棋",
    },
    hint: {
      de: "Gegen den Randbauern rettet die Ecke: Erreicht dein König c8/a8, kommt Weiß nie heraus · Patt oder Dauerpendeln.",
      en: "Against a rook pawn the corner saves you: once your king reaches c8/a8, White never gets out · stalemate or endless shuffling.",
      es: "Contra el peón de torre te salva la esquina: en cuanto tu rey llega a c8/a8, las blancas nunca salen · ahogado o vaivén eterno.",
      fr: "Contre un pion de tour, le coin te sauve : dès que ton roi atteint c8/a8, les Blancs ne sortent plus · pat ou va-et-vient sans fin.",
      hi: "किनारे के प्यादे के विरुद्ध कोना बचाता है: जैसे ही आपका राजा c8/a8 पर पहुँचे, सफेद कभी बाहर नहीं आ पाएगा · गतिरोध या अनंत आवाजाही।",
      ar: "أمام بيدق الرخ تنقذك الزاوية: ما إن يبلغ ملكك c8/a8 حتى يعجز الأبيض عن الخروج · تعادل بالحصار أو تكرار بلا نهاية.",
      zh: "对付边兵，角落救命：只要你的王到达 c8/a8，白方永远出不来 · 逼和或无尽周旋。",
    },
  },
  {
    id: "pawn-opposition",
    category: "pawn",
    side: "black",
    goal: "draw",
    fen: "8/4k3/8/4K3/4P3/8/8/8 w - - 0 1",
    name: {
      de: "Opposition halten",
      en: "Keep the opposition",
      es: "Mantener la oposición",
      fr: "Garder l'opposition",
      hi: "विरोध बनाए रखें",
      ar: "احتفظ بالمواجهة",
      zh: "保持对王",
    },
    hint: {
      de: "Bleib vor dem Bauern und nimm die Opposition, sobald der weiße König vorrückt. Weiche nie zur Seite aus, solange es geradeaus geht.",
      en: "Stay in front of the pawn and take the opposition whenever the white king steps up. Never sidestep while you can stay in line.",
      es: "Quédate delante del peón y toma la oposición cada vez que el rey blanco avance. No te apartes mientras puedas seguir en línea.",
      fr: "Reste devant le pion et prends l'opposition chaque fois que le roi blanc avance. Ne t'écarte jamais tant que tu peux rester dans l'axe.",
      hi: "प्यादे के सामने बने रहें और जब भी सफेद राजा आगे बढ़े, विरोध लें। जब तक सीधी रेखा में रह सकें, बगल न हटें।",
      ar: "ابقَ أمام البيدق وخذ المواجهة كلما تقدّم الملك الأبيض. لا تنحرف جانبًا ما دمت قادرًا على البقاء في المحور.",
      zh: "始终站在兵前，白王上前时就取对王。只要还能保持同一直线，就绝不让到旁边。",
    },
  },

  // ── Turmendspiele ──────────────────────────────────────────────────────────
  {
    id: "rook-lucena",
    category: "rook",
    side: "white",
    goal: "win",
    fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    name: {
      de: "Lucena: Brückenbau",
      en: "Lucena: building the bridge",
      es: "Lucena: construir el puente",
      fr: "Lucena : construire le pont",
      hi: "लुसेना: पुल बनाना",
      ar: "لوسينا: بناء الجسر",
      zh: "卢塞纳：搭桥",
    },
    hint: {
      de: "Erst den gegnerischen König einen Schritt weiter abdrängen, dann den Turm auf die 4. Reihe: Der König tritt heraus und die „Brücke“ blockt die Schachs.",
      en: "First push the enemy king one file further away, then rook to the 4th rank: the king steps out and the “bridge” blocks the checks.",
      es: "Primero aleja al rey enemigo una columna más, luego torre a la cuarta fila: el rey sale y el «puente» corta los jaques.",
      fr: "Éloigne d'abord le roi adverse d'une colonne de plus, puis tour à la 4e rangée : le roi sort et le « pont » coupe les échecs.",
      hi: "पहले विरोधी राजा को एक और स्तंभ दूर धकेलें, फिर हाथी चौथी पंक्ति पर: राजा बाहर निकलता है और «पुल» शहों को रोक देता है।",
      ar: "ادفع ملك الخصم عمودًا آخر بعيدًا، ثم انقل الرخ إلى الصف الرابع: يخرج الملك و«الجسر» يقطع الكشوف.",
      zh: "先把对方王再逼开一条直线，然后车到第四横线：王走出来，「桥」挡住将军。",
    },
  },
  {
    id: "rook-philidor",
    category: "rook",
    side: "black",
    goal: "draw",
    fen: "4k3/8/r7/4K3/4P3/8/8/7R b - - 0 1",
    name: {
      de: "Philidor-Verteidigung",
      en: "Philidor defence",
      es: "Defensa Philidor",
      fr: "Défense Philidor",
      hi: "फिलिडोर रक्षा",
      ar: "دفاع فيليدور",
      zh: "菲利多防守",
    },
    hint: {
      de: "Turm auf der 6. Reihe patrouillieren lassen, solange der Bauer nicht dort steht. Rückt er auf die 6. vor: Turm nach unten und Dauerschach von hinten.",
      en: "Keep the rook patrolling the 6th rank while the pawn stays back. Once it advances to the 6th: drop the rook down and check from behind forever.",
      es: "Patrulla con la torre en la sexta fila mientras el peón siga atrás. En cuanto avance a la sexta: baja la torre y jaquea por detrás sin fin.",
      fr: "Fais patrouiller la tour sur la 6e rangée tant que le pion reste en arrière. Dès qu'il atteint la 6e : descends la tour et échecs par-derrière à l'infini.",
      hi: "जब तक प्यादा पीछे है, हाथी को छठी पंक्ति पर गश्त कराएँ। जैसे ही वह छठी पर आए: हाथी नीचे लाकर पीछे से लगातार शह दें।",
      ar: "أبقِ الرخ يجوب الصف السادس ما دام البيدق متأخرًا. فإذا بلغ السادس: أنزل الرخ وكِشّ من الخلف بلا توقف.",
      zh: "只要兵未推进，就让车在第六横线巡逻。一旦兵到第六横线：把车退到底线，从背后连续将军。",
    },
  },

  // ── Damenendspiele ─────────────────────────────────────────────────────────
  {
    id: "queen-pawn",
    category: "queen",
    side: "white",
    goal: "win",
    fen: "8/8/6K1/Q7/8/8/3pk3/8 w - - 0 1",
    name: {
      de: "Dame gegen Umwandlungsbauer",
      en: "Queen vs promoting pawn",
      es: "Dama contra peón en séptima",
      fr: "Dame contre pion à promotion",
      hi: "वज़ीर बनाम बढ़ता प्यादा",
      ar: "الوزير ضد بيدق الترقية",
      zh: "后对抗升变兵",
    },
    hint: {
      de: "Mit Schachs den König vor den Bauern zwingen · jedes Mal, wenn er das Umwandlungsfeld blockiert, rückt dein König einen Schritt näher.",
      en: "Check the king in front of its pawn · every time it blocks the promotion square, your own king gains a step.",
      es: "Da jaques para llevar al rey delante de su peón · cada vez que bloquea la casilla de coronación, tu rey gana un paso.",
      fr: "Donne des échecs pour amener le roi devant son pion · chaque fois qu'il bloque la case de promotion, ton roi gagne un pas.",
      hi: "शह देकर राजा को उसके प्यादे के आगे लाएँ · हर बार जब वह पदोन्नति खाना रोकता है, आपका राजा एक कदम पास आता है।",
      ar: "كِشّ لتُجبر الملك على الوقوف أمام بيدقه · وكلما سدّ خانة الترقية اقترب ملكك خطوة.",
      zh: "连续将军把对方王逼到自己兵前 · 每当它挡住升变格，你的王就能上前一步。",
    },
  },

  // ── Leichtfiguren ──────────────────────────────────────────────────────────
  // Die Materialsignatur in `insights.rs` kennt "minor", "opposite-bishops"
  // und "rook+minor" · ohne Drills dazu könnte der Lernplan eine Schwäche
  // benennen, aber nichts dagegen anbieten.
  {
    id: "minor-opposite-bishops",
    category: "minor",
    side: "black",
    goal: "draw",
    fen: "8/8/4kb2/8/3KP3/5B2/8/8 b - - 0 1",
    name: {
      de: "Ungleichfarbige Läufer",
      en: "Opposite-coloured bishops",
      es: "Alfiles de distinto color",
      fr: "Fous de couleurs opposées",
      hi: "विपरीत रंग के ऊँट",
      ar: "فيلة مختلفة اللون",
      zh: "异色格象",
    },
    hint: {
      de: "Ein Mehrbauer gewinnt hier fast nie: Stell den Läufer so auf, dass er das Umwandlungsfeld deckt, und blockiere den Bauern mit dem König. Der gegnerische Läufer kann dein Feld nie betreten.",
      en: "An extra pawn almost never wins here: put the bishop where it covers the promotion square and block the pawn with the king. The enemy bishop can never touch your colour.",
      es: "Un peón de más casi nunca gana aquí: coloca el alfil de modo que controle la casilla de coronación y bloquea el peón con el rey. El alfil rival nunca podrá pisar tu color.",
      fr: "Un pion de plus ne gagne presque jamais ici : place le fou de façon à couvrir la case de promotion et bloque le pion avec le roi. Le fou adverse ne touchera jamais ta couleur.",
      hi: "यहाँ एक अतिरिक्त प्यादा लगभग कभी नहीं जिताता: ऊँट को ऐसे रखें कि वह पदोन्नति खाना ढके और राजा से प्यादा रोकें। विरोधी ऊँट आपके रंग को कभी छू नहीं सकता।",
      ar: "نادرًا ما يفوز البيدق الزائد هنا: ضع الفيل بحيث يغطي خانة الترقية وأوقف البيدق بالملك. لن يبلغ فيل الخصم لون خاناتك أبدًا.",
      zh: "这里多一个兵几乎从不取胜：把象放在控制升变格的位置，用王封锁兵。对方的象永远踏不上你的格色。",
    },
  },
  {
    id: "minor-bishop-knight-pawn",
    category: "minor",
    side: "white",
    goal: "win",
    fen: "8/8/8/4k3/8/3BKN2/4P3/8 w - - 0 1",
    name: {
      de: "Läufer und Springer schieben den Bauern",
      en: "Bishop and knight escort the pawn",
      es: "Alfil y caballo escoltan al peón",
      fr: "Le fou et le cavalier escortent le pion",
      hi: "ऊँट और घोड़ा प्यादे को आगे बढ़ाते हैं",
      ar: "الفيل والحصان يرافقان البيدق",
      zh: "象马护送兵",
    },
    hint: {
      de: "Der Läufer kontrolliert die Diagonale vor dem Bauern, der Springer nimmt dem gegnerischen König das Blockadefeld. Erst dann rückt der Bauer.",
      en: "The bishop controls the diagonal ahead of the pawn, the knight takes away the blockading square. Only then does the pawn advance.",
      es: "El alfil controla la diagonal por delante del peón, el caballo le quita la casilla de bloqueo al rey rival. Solo entonces avanza el peón.",
      fr: "Le fou contrôle la diagonale devant le pion, le cavalier retire la case de blocage au roi adverse. Ce n'est qu'alors que le pion avance.",
      hi: "ऊँट प्यादे के आगे की तिरछी रेखा संभालता है, घोड़ा विरोधी राजा से रोक-खाना छीन लेता है। तभी प्यादा आगे बढ़े।",
      ar: "يتحكم الفيل في القطر أمام البيدق، ويسلب الحصان ملك الخصم خانة الحصار. عندئذ فقط يتقدم البيدق.",
      zh: "象控制兵前的斜线，马夺走对方王的封锁格。做到这两点，兵才推进。",
    },
  },
  {
    id: "minor-knight-vs-rook-pawn",
    category: "minor",
    side: "black",
    goal: "draw",
    fen: "8/8/8/8/8/5n2/6PK/6k1 b - - 0 1",
    name: {
      de: "Springer hält den Randbauern",
      en: "Knight holds the rook pawn",
      es: "El caballo frena al peón de torre",
      fr: "Le cavalier tient le pion de tour",
      hi: "घोड़ा किनारे के प्यादे को रोकता है",
      ar: "الحصان يوقف بيدق الرخ",
      zh: "马挡住边兵",
    },
    hint: {
      de: "Der Springer muss das Umwandlungsfeld oder das Feld davor im Blick behalten · und der eigene König bleibt in der Nähe, damit der Springer nicht gefangen wird.",
      en: "The knight must keep the promotion square or the one in front of it under control · and your king stays close so the knight is never trapped.",
      es: "El caballo debe vigilar la casilla de coronación o la anterior · y tu rey se mantiene cerca para que el caballo nunca quede atrapado.",
      fr: "Le cavalier doit garder sous contrôle la case de promotion ou celle qui la précède · et ton roi reste proche pour que le cavalier ne soit jamais piégé.",
      hi: "घोड़े को पदोन्नति खाना या उससे पहले वाला खाना नियंत्रण में रखना चाहिए · और आपका राजा पास रहे ताकि घोड़ा कभी फँसे नहीं।",
      ar: "على الحصان أن يبقي خانة الترقية أو الخانة التي قبلها تحت السيطرة · ويظل ملكك قريبًا كي لا يقع الحصان في الأسر.",
      zh: "马必须始终控制升变格或它前面的一格 · 己方王要靠近，别让马被捉死。",
    },
  },

  // ── Turm plus Leichtfigur ──────────────────────────────────────────────────
  {
    id: "rook-minor-vs-rook",
    category: "rook",
    side: "white",
    goal: "win",
    fen: "8/8/8/3k4/8/3K4/8/3RB3 w - - 0 1",
    name: {
      de: "Turm und Läufer gegen Turm",
      en: "Rook and bishop vs rook",
      es: "Torre y alfil contra torre",
      fr: "Tour et fou contre tour",
      hi: "हाथी और ऊँट बनाम हाथी",
      ar: "الرخ والفيل ضد الرخ",
      zh: "车象对车",
    },
    hint: {
      de: "Die Philidor-Stellung ist das Ziel: Turm auf der 7. Reihe, Läufer deckt, der gegnerische König steht in der Ecke der Läuferfarbe. Es ist theoretisch gewonnen, aber zäh · die 50-Züge-Regel läuft mit.",
      en: "Aim for the Philidor position: rook on the 7th, bishop covering, the enemy king in the corner of the bishop's colour. Theoretically won but stubborn · the 50-move rule is ticking.",
      es: "El objetivo es la posición Philidor: torre en la séptima, alfil cubriendo y el rey rival en la esquina del color del alfil. Teóricamente ganado, pero duro · la regla de las 50 jugadas corre.",
      fr: "Vise la position Philidor : tour à la 7e, fou en couverture, le roi adverse dans le coin de la couleur du fou. Théoriquement gagné mais coriace · la règle des 50 coups tourne.",
      hi: "लक्ष्य फिलिडोर स्थिति है: हाथी सातवीं पंक्ति पर, ऊँट कवर करता हुआ, विरोधी राजा ऊँट के रंग वाले कोने में। सैद्धांतिक रूप से जीत, पर कठिन · 50-चाल नियम चलता रहता है।",
      ar: "الهدف وضع فيليدور: الرخ على الصف السابع، والفيل يغطي، وملك الخصم في زاوية بلون الفيل. الفوز نظري لكنه عسير · وقاعدة الخمسين نقلة تسري.",
      zh: "目标是菲利多局面：车在第七横线，象作掩护，对方王被逼到与象同色的角。理论上取胜但极难 · 50 回合规则同时在走。",
    },
  },
  {
    id: "rook-vs-minor",
    category: "rook",
    side: "black",
    goal: "draw",
    fen: "8/8/8/4k3/8/4K3/8/3Rb3 b - - 0 1",
    name: {
      de: "Läufer hält gegen den Turm",
      en: "Bishop holds against the rook",
      es: "El alfil resiste a la torre",
      fr: "Le fou tient contre la tour",
      hi: "ऊँट हाथी के विरुद्ध टिकता है",
      ar: "الفيل يصمد أمام الرخ",
      zh: "象抵挡车",
    },
    hint: {
      de: "Der König strebt in die Ecke, deren Farbe der Läufer *nicht* kontrolliert · dort ist die Stellung remis. Der Läufer bleibt beim König, nie allein im freien Feld.",
      en: "Head for the corner whose colour the bishop does *not* control · that corner is drawn. Keep the bishop next to the king, never loose in the open.",
      es: "Dirige el rey a la esquina cuyo color el alfil *no* controla · ahí la posición es tablas. El alfil se queda junto al rey, nunca suelto en campo abierto.",
      fr: "Dirige le roi vers le coin dont le fou ne contrôle *pas* la couleur · ce coin est nul. Garde le fou près du roi, jamais isolé en plein air.",
      hi: "राजा को उस कोने की ओर ले जाएँ जिसका रंग ऊँट नियंत्रित *नहीं* करता · वहाँ स्थिति बराबरी की है। ऊँट राजा के पास रहे, कभी खुले में अकेला नहीं।",
      ar: "اتجه بالملك إلى الزاوية التي *لا* يتحكم الفيل بلونها · فهي زاوية تعادل. وأبقِ الفيل بجوار الملك، لا وحيدًا في العراء.",
      zh: "把王带向象*不*控制的那种颜色的角 · 那个角是和棋。象要待在王身边，绝不孤零零地暴露在外。",
    },
  },
];

export const CATEGORY_ORDER: EndgameCategory[] = ["mates", "pawn", "rook", "queen", "minor"];

/**
 * Endspieltyp aus der Materialsignatur (`insights.rs`) auf die Drill-Kategorie.
 * Ohne diese Brücke bliebe der Befund „Turmendspiele laufen schlecht" ein
 * Hinweis ohne Übung dahinter.
 */
export const ENDGAME_TYPE_CATEGORY: Record<string, EndgameCategory> = {
  pawn: "pawn",
  rook: "rook",
  "rook+minor": "rook",
  queen: "queen",
  "queen+rook": "queen",
  minor: "minor",
  "opposite-bishops": "minor",
};
