/**
 * Der reine Kern der Uebersetzung: keine Browser-API, kein React, kein
 * Import eines Katalogs. Deshalb laeuft er unveraendert in `node --test`
 * (`tests/oberflaeche/i18n.test.ts`) und in der Oberflaeche.
 *
 * `i18n.ts` daneben buendelt die Kataloge und haelt die aktive Sprache;
 * hier stehen nur die Regeln.
 */

export type Katalog = Record<string, string>;
export type Werte = Record<string, string | number>;

/**
 * Arabisch und Persisch laufen von rechts nach links.
 *
 * Beide werden zurzeit NICHT ausgeliefert — die Erweiterung führt seit dem
 * 07.09.2026 dieselben zehn Sprachen wie die Website. Die Menge bleibt
 * trotzdem: Sie ist eine Aussage über die SCHRIFTRICHTUNG dieser Sprachen,
 * nicht über das Angebot. Dieselbe Begründung, aus der `sprachen.ts` alle
 * Namen behält — sie beschriftet auch die regionalen Filterlisten.
 *
 * Hier stand „sonst niemand der 20". Die Zahl war seit der Reduktion falsch,
 * und eine Zahl in einem Kommentar zieht niemand nach.
 */
export const RTL_SPRACHEN: ReadonlySet<string> = new Set(['ar', 'fa']);

export function richtung(code: string): 'ltr' | 'rtl' {
  return RTL_SPRACHEN.has(code.toLowerCase().split('-')[0] ?? '') ? 'rtl' : 'ltr';
}

/**
 * Ersetzt `{name}` durch den Wert. Ein Platzhalter ohne Wert bleibt stehen,
 * damit er im Bildschirm auffaellt, statt still zu verschwinden.
 */
export function fuellePlatzhalter(text: string, werte?: Werte): string {
  if (!werte) return text;
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (ganz, name: string) => {
    const wert = werte[name];
    return wert === undefined ? ganz : String(wert);
  });
}

/**
 * Zerlegt einen Text an seinen Platzhaltern. Fuer Saetze, in denen ein
 * Platzhalter ein Link wird (Zustimmungssatz): Das Bauteil setzt fuer jeden
 * `{ platzhalter }` ein eigenes Element ein, die Textstuecke bleiben Text.
 */
export type TextTeil = string | { platzhalter: string };

export function zerlegePlatzhalter(text: string): TextTeil[] {
  const teile: TextTeil[] = [];
  let letzter = 0;
  for (const m of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const start = m.index ?? 0;
    if (start > letzter) teile.push(text.slice(letzter, start));
    teile.push({ platzhalter: m[1]! });
    letzter = start + m[0].length;
  }
  if (letzter < text.length) teile.push(text.slice(letzter));
  return teile;
}

/**
 * Sucht den Schluessel in der aktiven Sprache, dann im Rueckfall, und gibt
 * zuletzt den Schluessel selbst zurueck. Ein sichtbarer Schluessel ist der
 * ehrlichere Fehler als ein leerer Knopf.
 */
export function uebersetze(
  kataloge: Record<string, Katalog>,
  sprache: string,
  rueckfall: string,
  schluessel: string,
  werte?: Werte,
): string {
  const text = kataloge[sprache]?.[schluessel] ?? kataloge[rueckfall]?.[schluessel] ?? schluessel;
  return fuellePlatzhalter(text, werte);
}

/**
 * Welche Sprache gilt: die gewuenschte, wenn es sie gibt; sonst die des
 * Browsers (der Aufrufer reicht `browserSprache` aus `bausteine/i18n.ts`
 * herein, damit dieser Kern `navigator` nie anfassen muss).
 *
 * `de-AT` findet `de`: verglichen wird auf dem Grundcode.
 */
export function waehleSprache(
  gewuenscht: string | null | undefined,
  verfuegbar: readonly string[],
  vomBrowser: () => string,
): string {
  if (gewuenscht) {
    const grund = gewuenscht.toLowerCase().split('-')[0] ?? '';
    const treffer = verfuegbar.find((v) => v.toLowerCase() === grund);
    if (treffer) return treffer;
  }
  return vomBrowser();
}

/**
 * Listen-IDs tragen Bindestriche (`regional-de`), Schluessel duerfen das
 * nicht. `regional-de` wird zu `regionalDe`.
 */
export function schluesselAusId(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, z: string) => z.toUpperCase());
}
