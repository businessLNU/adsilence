/**
 * Der Kanal zwischen dem isolierten Skript (`inhalt/kosmetik.ts`) und den
 * beiden Hauptwelt-Skripten (`inhalt/fingerabdruck.ts`, `inhalt/schatten.ts`):
 * die Ereignisnamen, der Handschlag und die Form des `detail`-Strings.
 *
 * EINE Quelle fuer beide Seiten. Bis zum 05.09.2026 standen die Namen in
 * jeder Datei noch einmal, mit der Begruendung, die Skripte liefen „in
 * getrennten Welten und koennen sich keine Konstante teilen". Das stimmt fuer
 * die Laufzeit, nicht fuer den Bau: `scripts/build.mjs` buendelt jedes
 * Inhaltsskript mit `bundle: true`, und was hier steht, wird in jedes Buendel
 * KOPIERT. Zwei Stellen fuer denselben Namen hiessen: Wer eine aendert,
 * bricht den Kanal stumm, und kein Test faengt es.
 *
 * ── Warum ein Handschlag ────────────────────────────────────────────────
 * Ein `CustomEvent` der Seite sieht fuer die Hauptwelt genauso aus wie eines
 * des isolierten Skripts: gleicher Name, `isTrusted` bei beiden false. Ohne
 * Geheimnis schaltete jede Seite den Schutz mit EINER Zeile ab, indem sie im
 * `head` selbst `'0'` schickte, bevor der Hintergrund geantwortet hat
 * (GEMESSEN 05.09.2026: zwei frische Canvases exakt der Grundwert ohne
 * Erweiterung, hardwareConcurrency der echte Wert).
 *
 * Deshalb tauschen beide Skripte bei `document_start` ein Zufallsgeheimnis
 * aus. Das geht, weil beide VOR dem ersten Seitenskript laufen: In dieser
 * Zeit gibt es keinen Lauscher der Seite, der ein Ereignis sehen koennte.
 * Die Reihenfolge der beiden Skripte ist NICHT zugesichert (Chrome: erst
 * isoliert, dann Hauptwelt, GEMESSEN 05.09.2026 in Chrome for Testing 148,
 * oberste Seite wie about:blank-Rahmen; Firefox: nicht gemessen), deshalb
 * funktioniert der Handschlag in beiden Richtungen:
 *
 *   isoliert:  lauscht auf FRAGE, schickt sofort ANTWORT(geheimnis)
 *   Hauptwelt: lauscht auf ANTWORT, schickt FRAGE
 *   Hauptwelt: nimmt die ERSTE Antwort, schickt FERTIG
 *   isoliert:  hoert FERTIG, hoert danach auf FRAGE nicht mehr
 *
 * Laeuft das isolierte Skript zuerst, verhallt seine sofortige ANTWORT, und
 * die FRAGE der Hauptwelt holt sie nach. Laeuft die Hauptwelt zuerst,
 * verhallt ihre FRAGE, und die sofortige ANTWORT des isolierten Skripts
 * kommt an. FERTIG schliesst den Handschlag: Eine Seite, die spaeter FRAGE
 * schickt, bekommt keine Antwort mehr, und die Hauptwelt nimmt keine zweite
 * Antwort an. Das Geheimnis steht danach nur in zwei Closures.
 *
 * Das `detail` des eigentlichen Ereignisses beginnt mit dem Geheimnis. Was
 * nicht damit beginnt, ignoriert die Hauptwelt - ohne den Lauscher zu
 * verlieren: `once: true` haette ein Fremdereignis den Lauscher verbrauchen
 * lassen, und die echte Antwort waere bei niemandem angekommen (GEMESSEN
 * 05.09.2026: Ausnahmeseite rauschte weiter, weil ein Kopfskript vorher
 * `detail: 'x'` geschickt hatte).
 *
 * WAS DER HANDSCHLAG NICHT KANN: Ein per Skript erzeugter same-origin
 * `about:blank`-Rahmen bekommt die Skripte asynchron; sein Elternfenster
 * kann vorher einen Lauscher auf das Kind-Dokument setzen und den Handschlag
 * mithoeren. Das steht im Katalog unter „bewusst nicht geschuetzt". Ein
 * unfaelschbarer Kanal ist in MV3 nur ueber den Browser selbst zu haben.
 *
 * `detail` ist immer ein STRING, kein Objekt: Firefox gibt dem Seitenskript
 * fuer ein Objekt aus dem Inhaltsskript ohne `cloneInto` „Permission denied
 * to access property"; der Lauscher wuerfe, und `{ an: false }` kaeme nie an.
 */

/** Der CSS-Text fuer Shadow Roots, vom isolierten Skript an `schatten.ts`. */
export const EREIGNIS_KOSMETIK = 'adsilence:kosmetik';

/** An oder aus, mit Token: vom isolierten Skript an `fingerabdruck.ts`. */
export const EREIGNIS_FINGERABDRUCK = 'adsilence:fingerabdruck';

/** Der Handschlag, drei Schritte (siehe oben). */
export const HANDSCHLAG_FRAGE = 'adsilence:handschlag';
export const HANDSCHLAG_ANTWORT = 'adsilence:handschlag-antwort';
export const HANDSCHLAG_FERTIG = 'adsilence:handschlag-fertig';

export type Fingerabdruck = { an: boolean; token: string | null };

/**
 * Das `detail` fuer EREIGNIS_FINGERABDRUCK: `<geheimnis>:0`, `<geheimnis>:1`
 * oder `<geheimnis>:1:<token>`.
 *
 * Die zweite Form ist absichtlich nicht `1:` mit leerem Token: Aus einem
 * leeren Token rechnete die Hauptwelt einen Seed, der fuer diesen Host in
 * JEDER Sitzung derselbe waere - ein dauerhaftes Merkmal, das Gegenteil des
 * Zwecks.
 */
export function kodiere(geheimnis: string, f: Fingerabdruck): string {
  if (!f.an) return `${geheimnis}:0`;
  return typeof f.token === 'string' && f.token.length > 0 ? `${geheimnis}:1:${f.token}` : `${geheimnis}:1`;
}

/**
 * Liest das `detail` zurueck. `null` fuer alles, was nicht mit dem Geheimnis
 * beginnt oder keine der drei Formen hat - der Aufrufer ignoriert es dann,
 * ohne seinen Lauscher aufzugeben.
 */
export function dekodiere(geheimnis: string, detail: unknown): Fingerabdruck | null {
  if (typeof detail !== 'string' || geheimnis.length === 0) return null;
  const praefix = `${geheimnis}:`;
  if (detail.length <= praefix.length || detail.slice(0, praefix.length) !== praefix) return null;
  const rest = detail.slice(praefix.length);
  if (rest === '0') return { an: false, token: null };
  if (rest === '1') return { an: true, token: null };
  if (rest.length > 2 && rest.charCodeAt(0) === 49 && rest.charCodeAt(1) === 58) return { an: true, token: rest.slice(2) };
  return null;
}
