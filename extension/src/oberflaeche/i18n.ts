/**
 * Texte der Oberflaeche. `t('popup.aktiv')` und sonst nichts; kein Bauteil
 * traegt einen festen Satz (Regel 4, geprueft von `scripts/pruefe-texte.mjs`).
 *
 * Die Kataloge aus `i18n/*.json` werden beim Bauen gebuendelt: `import.meta.glob`
 * nimmt jede Datei, die da ist. Kommen die 18 weiteren Sprachen vom
 * Uebersetzer-Schritt, erscheinen sie hier ohne Codeaenderung.
 *
 * Sprache: `einstellungen.sprache`, sonst die des Browsers. Der Browser wird
 * mit `browserSprache` aus `bausteine/i18n.ts` befragt, derselben Funktion,
 * die das Backend-Frontend nimmt.
 */

import { useSyncExternalStore } from 'react';
import { browserSprache } from 'bausteine/i18n';
import {
  richtung,
  uebersetze,
  waehleSprache,
  zerlegePlatzhalter,
  type Katalog,
  type TextTeil,
  type Werte,
} from './i18n-kern.ts';

const RUECKFALL = 'en';

const roh = import.meta.glob('../../i18n/*.json', { eager: true, import: 'default' }) as Record<
  string,
  Katalog
>;

export const kataloge: Record<string, Katalog> = {};
for (const [pfad, katalog] of Object.entries(roh)) {
  const code = /([a-z]{2})\.json$/.exec(pfad)?.[1];
  if (code) kataloge[code] = katalog;
}

/** Codes, fuer die ein Katalog da ist, in der Reihenfolge von `SPRACHEN`. */
export const verfuegbareSprachen: readonly string[] = Object.keys(kataloge).sort();

let aktiv: string = RUECKFALL;
const zuhoerer = new Set<() => void>();

export function t(schluessel: string, werte?: Werte): string {
  return uebersetze(kataloge, aktiv, RUECKFALL, schluessel, werte);
}

/** Wie `t`, aber zerlegt: fuer Saetze mit Links an Platzhalterstellen. */
export function tTeile(schluessel: string): TextTeil[] {
  return zerlegePlatzhalter(uebersetze(kataloge, aktiv, RUECKFALL, schluessel));
}

/** Gibt es den Schluessel in der aktiven Sprache oder im Rueckfall? */
export function hatText(schluessel: string): boolean {
  return kataloge[aktiv]?.[schluessel] !== undefined || kataloge[RUECKFALL]?.[schluessel] !== undefined;
}

export function sprache(): string {
  return aktiv;
}

/**
 * Setzt die Sprache und traegt `lang` und `dir` am `<html>` ein. Ohne `dir`
 * stuenden bei Arabisch und Persisch Schalter und Haken spiegelverkehrt.
 */
export function setzeSprache(gewuenscht: string | null | undefined): string {
  aktiv = waehleSprache(gewuenscht, verfuegbareSprachen, () =>
    browserSprache(verfuegbareSprachen, RUECKFALL),
  );
  if (typeof document !== 'undefined') {
    document.documentElement.lang = aktiv;
    document.documentElement.dir = richtung(aktiv);
  }
  for (const cb of zuhoerer) cb();
  return aktiv;
}

function abonniere(cb: () => void): () => void {
  zuhoerer.add(cb);
  return () => zuhoerer.delete(cb);
}

/** Bauteile, die bei einem Sprachwechsel neu zeichnen sollen, rufen das. */
export function useSprache(): string {
  return useSyncExternalStore(abonniere, sprache, sprache);
}

/**
 * Datum in der aktiven Sprache. `null` ergibt einen leeren Text, damit ein
 * Bauteil den Fall nicht selbst pruefen muss.
 */
export function formatiereDatum(
  wert: string | number | Date | null | undefined,
  art: 'datum' | 'datumZeit' = 'datum',
): string {
  if (wert === null || wert === undefined || wert === '') return '';
  const datum = wert instanceof Date ? wert : new Date(wert);
  if (Number.isNaN(datum.getTime())) return '';
  const optionen: Intl.DateTimeFormatOptions =
    art === 'datumZeit'
      ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return new Intl.DateTimeFormat(aktiv, optionen).format(datum);
  } catch {
    return datum.toLocaleDateString();
  }
}

/** Zahl mit Tausendertrennung in der aktiven Sprache. */
export function formatiereZahl(wert: number): string {
  try {
    return new Intl.NumberFormat(aktiv).format(wert);
  } catch {
    return String(wert);
  }
}
