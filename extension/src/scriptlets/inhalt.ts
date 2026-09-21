/**
 * Das REGISTRIERTE Scriptlet-Skript: eines je Liste, gebaut aus
 * `scriptlets/<id>.json`.
 *
 * ── Warum es diese Datei gibt ─────────────────────────────────────────────
 * Scriptlets liefen bis zum 08.09.2026 über `scripting.executeScript` aus dem
 * Service Worker, ausgelöst von `webNavigation.onCommitted`. Das ist ein
 * Wettlauf gegen das erste Seitenskript, und er wird verloren:
 *
 *   GEMESSEN in echtem Chrome (`npm run probe:erkennung`):
 *     vor dem ersten Seitenskript (70 ms):  NEIN
 *     nach 400 ms:                          ja
 *
 * Und zwar kalt wie warm. Ein schlafender Worker muss geweckt werden, Module
 * laden, Speicher lesen — in dieser Zeit hat der Detektor der Seite längst
 * gelesen, was er lesen wollte, und das Overlay steht.
 *
 * Ein REGISTRIERTES Inhaltsskript (`scripting.registerContentScripts` mit
 * `runAt: 'document_start'`) injiziert der Browser selbst, ohne den Worker zu
 * fragen. Deshalb muss diese Datei alles mitbringen, was sie braucht: die
 * Host-Karte steht als JSON-Text davor, der Build setzt sie ein.
 *
 * ── Warum die Karte ein STRING ist und kein Objektliteral ────────────────
 * `ublock.json` ist 211 kB. Als Objektliteral müsste die JavaScript-Maschine
 * das auf JEDER Seite parsen — auch auf den 99 von 100, für die kein einziger
 * Eintrag gilt. Als String kostet es fast nichts: Der Text wird geladen, ein
 * paar `indexOf` entscheiden, ob überhaupt etwas für diesen Host da ist, und
 * nur dann läuft `JSON.parse`.
 *
 * ── Was hier NICHT geht ──────────────────────────────────────────────────
 * `chrome.storage` und `chrome.runtime` gibt es in der Hauptwelt nicht. Diese
 * Datei kann also nicht fragen, ob AdSilence gerade aus ist oder ob für diese
 * Seite eine Ausnahme gilt. Beides entscheidet der Hintergrund VOR der
 * Registrierung: Ist AdSilence aus, wird gar nichts registriert; für Seiten
 * mit Ausnahme sorgt `excludeMatches`. Genau so macht es die generische
 * Kosmetik seit jeher (`hintergrund/regeln.ts`).
 */

import { scriptletLoader, type ScriptletEintrag } from './bibliothek.ts';

type Karte = Record<string, ScriptletEintrag[]>;

/**
 * Der Build schreibt vor diese Datei:
 *
 *     var __ADSILENCE_KARTE = '{"beispiel.de":[...]}';
 *
 * Kein Import, kein Abruf — der Text steht in derselben Datei.
 */
declare const __ADSILENCE_KARTE: string | undefined;

/**
 * Host und alle Domains darüber, spezifischste zuerst. Wortgleich mit
 * `hostKette()` in `hintergrund/ausnahmen.ts`; hier noch einmal, weil diese
 * Datei nichts importieren darf, was den Hintergrund kennt.
 */
function kette(host: string): string[] {
  const teile = host.split('.').filter(Boolean);
  const raus: string[] = [];
  for (let i = 0; i < teile.length - 1; i += 1) raus.push(teile.slice(i).join('.'));
  if (raus.length === 0 && host) raus.push(host);
  return raus;
}

(function () {
  const roh = typeof __ADSILENCE_KARTE === 'string' ? __ADSILENCE_KARTE : '';
  if (!roh) return;

  const host = location.hostname.toLowerCase();
  if (!host) return;
  const hosts = kette(host);

  /*
   * Der Schnelltest, bevor irgendetwas geparst wird.
   *
   * Steht keiner der in Frage kommenden Hostnamen im Text, gibt es für diese
   * Seite nichts zu tun — und das ist der Normalfall. Der Vergleich schliesst
   * die Anführungszeichen mit ein, damit `beispiel.de` nicht auf
   * `nichtbeispiel.de` anschlägt.
   */
  let treffer = false;
  for (const h of hosts) {
    if (roh.indexOf('"' + h + '"') !== -1) {
      treffer = true;
      break;
    }
  }
  if (!treffer) return;

  let karte: Karte;
  try {
    karte = JSON.parse(roh) as Karte;
  } catch {
    return;
  }

  // Vom spezifischsten Host aufwärts, ohne Doppelte — dieselbe Regel wie in
  // `eintraegeAus()` im Hintergrund.
  const gesehen: Record<string, true> = {};
  const eintraege: ScriptletEintrag[] = [];
  for (const h of hosts) {
    const liste = karte[h];
    if (!liste || !liste.length) continue;
    for (const e of liste) {
      if (!e || typeof e.name !== 'string') continue;
      const args = Array.isArray(e.args) ? e.args.map(String) : [];
      const schluessel = e.name + ' ' + args.join(' ');
      if (gesehen[schluessel]) continue;
      gesehen[schluessel] = true;
      eintraege.push({ name: e.name, args });
    }
  }

  if (eintraege.length === 0) return;
  try {
    scriptletLoader(eintraege);
  } catch {
    // Ein Werbeblocker, der Seiten kaputt macht, wird abgeschaltet.
  }
})();
