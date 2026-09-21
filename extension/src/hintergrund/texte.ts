/**
 * Texte im Hintergrund.
 *
 * ── Warum nicht `oberflaeche/i18n.ts` ──────────────────────────────────────
 * Die Oberflaeche buendelt ihre Kataloge ueber `import.meta.glob`, und das
 * kennt nur Vite. Der Hintergrund wird mit esbuild gebaut; dort gibt es die
 * Funktion nicht, und alle zwanzig Kataloge fest einzubinden hiesse, sie in
 * den Service Worker zu legen, der sie fast nie braucht.
 *
 * Stattdessen liegen sie als Dateien im Paket und werden bei Bedarf gelesen -
 * genau einer davon, genau einmal.
 *
 * ── Warum nicht `chrome.i18n.getMessage` ───────────────────────────────────
 * Das folgt der Sprache des BROWSERS. Die Erweiterung laesst den Nutzer eine
 * eigene waehlen (`einstellungen.sprache`), und eine Warnung in einer anderen
 * Sprache als der Rest der Oberflaeche waere genau dort verwirrend, wo
 * Verwirrung schadet.
 */

import { api } from '../gemeinsam/browser.ts';
import { liesLokal } from '../gemeinsam/speicher.ts';
import { uebersetze, type Katalog } from '../oberflaeche/i18n-kern.ts';
import { holePaketJson } from './regeln.ts';

const RUECKFALL = 'en';
const geladen = new Map<string, Promise<Katalog | null>>();

function ladeKatalog(code: string): Promise<Katalog | null> {
  let merker = geladen.get(code);
  if (!merker) {
    merker = holePaketJson<Katalog>(`i18n/${code}.json`);
    geladen.set(code, merker);
  }
  return merker;
}

/**
 * Eine `t()`-Funktion in der Sprache des Nutzers. Der Aufrufer holt sie
 * einmal und fragt dann synchron ab, damit nicht jeder Satz ein `await` ist.
 */
export async function hintergrundText(): Promise<(schluessel: string, werte?: Record<string, string | number>) => string> {
  const { einstellungen } = await liesLokal('einstellungen');
  const vomBrowser = () => {
    try {
      return (api.i18n?.getUILanguage?.() ?? RUECKFALL).toLowerCase().split('-')[0] ?? RUECKFALL;
    } catch {
      return RUECKFALL;
    }
  };
  /*
   * Erst die Wahl des Nutzers, dann die des Browsers - dieselbe Reihenfolge
   * wie in der Oberflaeche.
   *
   * Hier stand `waehleSprache(einstellungen.sprache, [], vomBrowser)`. Die
   * Funktion sucht die gewuenschte Sprache in der uebergebenen Liste, und die
   * war LEER - sie fand also nie etwas und gab immer den Browser zurueck. Wer
   * AdSilence auf Deutsch stellte und Chrome auf Englisch hatte, bekam seine
   * Benachrichtigungen auf Englisch; der Kommentar daneben behauptete das
   * Gegenteil, und genau deshalb faellt so etwas beim Lesen nicht auf.
   *
   * Statt hier eine Liste der vorhandenen Kataloge zu fuehren - die beim
   * naechsten Sprachwechsel falsch waere (Regel 6.4) - entscheidet der Katalog
   * selbst: Gibt es ihn, gilt die Wahl. `ladeKatalog` merkt sich seine
   * Zusagen, der zweite Aufruf auf denselben Code kostet also nichts.
   */
  const gewuenscht = einstellungen.sprache?.toLowerCase().split('-')[0] || null;
  const gewaehlt = gewuenscht ? await ladeKatalog(gewuenscht) : null;
  const code = gewaehlt && gewuenscht ? gewuenscht : vomBrowser();
  const [katalog, rueckfall] = await Promise.all([ladeKatalog(code), code === RUECKFALL ? Promise.resolve(null) : ladeKatalog(RUECKFALL)]);
  const kataloge: Record<string, Katalog> = {};
  if (katalog) kataloge[code] = katalog;
  if (rueckfall) kataloge[RUECKFALL] = rueckfall;
  return (schluessel, werte) => uebersetze(kataloge, code, RUECKFALL, schluessel, werte);
}
