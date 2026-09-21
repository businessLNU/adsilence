/**
 * Warum eine Zeile nicht umgesetzt wurde: EIN geschlossener Satz von Codes,
 * den Build-Bericht, Optionsseite und Tests gemeinsam benutzen.
 *
 * Die Codes sind Maschinenwerte, keine Nutzertexte. Die Oberfläche bildet
 * jeden auf einen i18n-Schlüssel ab (Regel 4 des Repos); für
 * `optionNichtUmsetzbar` steht in `option` zusätzlich der Name der Option,
 * damit die Meldung sagen kann, WELCHE es war.
 */

export const GRUENDE = [
  /** `#?#`, `#$#`, `#%#`: prozedurale Kosmetik, Snippets, CSS-Injektion */
  'erweiterteKosmetik',
  /** `##^`: HTML-Filter, nur mit webRequest-Filtern umsetzbar */
  'htmlFilter',
  /** Zeile ist keine gültige Filtersyntax (leerer Selektor, offenes `+js(`) */
  'syntax',
  /** Selektor ausserhalb der konservativen CSS-Grammatik */
  'selektorUngueltig',
  /** Scriptlet-Name nicht in der Bibliothek */
  'scriptletUnbekannt',
  /** Netzoption, die DNR nicht kennt; `option` sagt welche */
  'optionNichtUmsetzbar',
  /** Domain in `domain=` mit Platzhalter, Nicht-ASCII oder ungültiger Form */
  'domainUngueltig',
  /** Regex mit Lookahead, Lookbehind oder Rückverweis: RE2 kann das nicht */
  'regexNichtRe2',
  /** Regex länger als 200 Zeichen */
  'regexZuLang',
  /**
   * Regex, dessen KOMPILIERTES Programm Chromes 2-kB-Grenze reissen wuerde.
   * Nicht dasselbe wie `regexZuLang`: Die kuerzeste so verworfene Regel hatte
   * 30 Zeichen (`.{100,}` = hundert ausgerollte Punkte). Siehe `regexKosten()`
   * in `dnr.ts`.
   */
  'regexZuTeuer',
  /** Regex-Kontingent der Liste erschöpft (Chrome: 1000 je Erweiterung) */
  'regexBudget',
  /** Muster enthält Zeichen ausserhalb ASCII */
  'nichtAscii',
  /** Muster enthält `|` in der Mitte oder andere Zeichen, die DNR nicht kennt */
  'sonderzeichen',
  /** Muster länger als 500 Zeichen */
  'zuLang',
  /** Weder Muster noch Domain noch Typ: die Regel träfe alles */
  'leereBedingung',
  /** Alle Typen negiert, es bleibt nichts zu blocken */
  'typenLeer',
  /** Regelkontingent der Liste erschöpft */
  'budget',
  /** Identische Regel stand schon weiter oben in der Liste */
  'doppelt',
  /** Scriptlet ohne `domain`: würde auf jeder Seite laufen, das tun wir nicht */
  'scriptletOhneDomain',
  /** `$redirect=<name>`, fuer den es keine Attrappe im Paket gibt. */
  'redirectUnbekannt',
  /** `@@…$redirect=…`: eine Ausnahme, die zugleich umleiten soll. */
  'redirectAnAusnahme',
] as const;

export type Grund = (typeof GRUENDE)[number];

export type Verwerfung = {
  grund: Grund;
  /** Nur bei `optionNichtUmsetzbar`: der Name der Option. */
  option?: string;
};

/**
 * Schlüssel für den Bericht: Optionen zählen unter ihrem eigenen Namen
 * (`popup: 2945` sagt mehr als `optionNichtUmsetzbar: 3400`), alles andere
 * unter dem Code.
 */
export function berichtsSchluessel(v: Verwerfung): string {
  return v.grund === 'optionNichtUmsetzbar' && v.option ? v.option : v.grund;
}

export function zaehle(ziel: Record<string, number>, v: Verwerfung): void {
  const schluessel = berichtsSchluessel(v);
  ziel[schluessel] = (ziel[schluessel] ?? 0) + 1;
}
