/**
 * Wie sich das Kontingent des taeglichen Nachschubs auf die Listen verteilt.
 *
 * ── Wogegen das steht ─────────────────────────────────────────────────────
 * Der Nachschub hat 3000 Regelplaetze; was darueber liegt, faellt weg. Bis zum
 * 10.09.2026 fiel es nach Reihenfolge weg: erst kam, was in `quellen.json`
 * oben stand, und was hinten stand, kam nie an.
 *
 * GEMESSEN am 10.09.2026, einen Tag nach dem Paketbau: 698 neue Regeln, davon
 * 492 aus `urlhaus` (70 %) — Schadadressen mit konkretem Pfad, die taeglich
 * rotieren. Bei dem Tempo waere das Kontingent nach vier Tagen voll gewesen,
 * und weggefallen waeren die Listen, an denen eine Seite SICHTBAR kaputtgeht:
 * EasyList, EasyPrivacy, die Regionallisten — zusammen 206 Regeln am Tag.
 *
 * Deshalb bekommt eine Liste hoechstens ihren Anteil. Der Anteil steht an der
 * Quelle in `listen/quellen.json` (`nachschubAnteil`), nicht hier: Er ist eine
 * Entscheidung ueber DIESE Liste, nicht ueber das Verfahren.
 *
 * Listen ohne Angabe bleiben ungedeckelt — die meisten wachsen langsam, und
 * ein Deckel, den niemand braucht, ist nur eine Zahl mehr, die falsch stehen
 * kann.
 */

/** Eine Regel mit der Liste, aus der sie stammt. */
export type NachschubRegel<T> = { liste: string; regel: T };

/**
 * Der Anteil je Liste, in Regeln — nicht in Prozent: Wer hier rechnet, hat
 * das Budget schon gesehen, und zwei Einheiten in einer Funktion sind eine zu
 * viel.
 */
export type Anteile = ReadonlyMap<string, number>;

/**
 * Aus `nachschubAnteil` (0…1) und dem Budget die Grenze je Liste.
 * Mindestens 1: Ein Anteil, der auf 0 abrundet, waere ein stiller Ausschluss.
 */
export function anteileAusQuellen(
  quellen: ReadonlyArray<{ id: string; nachschubAnteil?: number }>,
  budget: number,
): Map<string, number> {
  const grenzen = new Map<string, number>();
  for (const q of quellen) {
    if (typeof q.nachschubAnteil !== 'number') continue;
    grenzen.set(q.id, Math.max(1, Math.floor(budget * q.nachschubAnteil)));
  }
  return grenzen;
}

/**
 * Die Regeln, die ihren Anteil nicht sprengen — in der Reihenfolge, in der sie
 * kamen. Was ueber die Grenze einer Liste hinausgeht, faellt weg; andere
 * Listen ruecken dadurch NICHT nach vorn, sie kommen nur ueberhaupt noch dran.
 */
export function imRahmenDesAnteils<T>(
  regeln: ReadonlyArray<NachschubRegel<T>>,
  grenzen: Anteile,
): NachschubRegel<T>[] {
  const gezaehlt = new Map<string, number>();
  const behalten: NachschubRegel<T>[] = [];
  for (const r of regeln) {
    const grenze = grenzen.get(r.liste);
    const bisher = gezaehlt.get(r.liste) ?? 0;
    if (grenze !== undefined && bisher >= grenze) continue;
    gezaehlt.set(r.liste, bisher + 1);
    behalten.push(r);
  }
  return behalten;
}
