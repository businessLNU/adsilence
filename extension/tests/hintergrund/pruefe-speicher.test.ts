/**
 * Speicher-Waechter (erweiterung.md N4, vertrag.md 8).
 *
 * Was die Erweiterung nicht speichert, kann ihr niemand abnehmen: kein
 * Gericht, kein Einbruch, kein spaeterer Eigentuemer. Deshalb steht in
 * `src/gemeinsam/typen.ts`, der einen Datei, die die Form des Speichers
 * beschreibt, steht kein Feld fuer eine besuchte Adresse, kein Verlauf und
 * keinen Besuchszaehler.
 *
 * Der Waechter liest die Feldnamen dieser Datei. Ein neues Feld `letzteUrl`
 * faellt beim ersten Lauf auf, nicht bei der ersten Datenschutzanfrage.
 *
 * ZWEI Ausnahmen, beide benannt und begruendet; mehr duerfen es nicht
 * werden, sonst ist der Waechter eine Liste statt einer Regel:
 *
 *   `sites`             Hosts, die der NUTZER selbst freigestellt hat. Kein
 *                       Verlauf: nur Hostnamen, nur auf Klick, jederzeit
 *                       loeschbar. Ohne sie gaebe es keine Ausnahmen.
 *   `meldung`/`seite`   Die Adresse EINER Seite, die der Nutzer ausdruecklich
 *                       meldet, gekuerzt auf Herkunft und Pfad. Sie wird
 *                       gesendet, nicht gespeichert; die Vorschau zeigt sie
 *                       vorher (N5).
 *
 * Zusaetzlich geduldet ist `verbindenUrl`: die Adresse der EIGENEN Website,
 * wie sie das Backend in der Antwort auf `POST /verbindung` mitschickt. Sie
 * beschreibt keinen Besuch des Nutzers. Als Befund gemeldet, weil N4 sie
 * woertlich nicht vorsieht; ein Name wie `verbindenAdresse` waere klarer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPEN = join(WURZEL, 'src', 'gemeinsam', 'typen.ts');
const text = readFileSync(TYPEN, 'utf8');

/** Was ein Feld nicht heissen darf, egal in welcher Schreibweise. */
const VERBOTEN = ['url', 'verlauf', 'besuch', 'history', 'visit', 'referrer', 'query'];

/** Die geduldeten Namen, jeder mit Grund im Kopf dieser Datei. */
const GEDULDET = new Set(['verbindenUrl']);

/** Typen und Felder, in denen eine Adresse ihren Platz hat. */
const ERLAUBTE_STRUKTUREN = ['sites', 'meldung'];

/**
 * Feldnamen einer Typdefinition: `  name: Typ;` oder `  name?: Typ;`, auch
 * in einer Zeile verschachtelt (`{ code: string; verbindenUrl: string }`).
 * Kommentarzeilen bleiben draussen; sie beschreiben, sie speichern nicht.
 */
function feldnamen(quelle: string): { name: string; zeile: number }[] {
  const gefunden: { name: string; zeile: number }[] = [];
  const zeilen = quelle.split('\n');
  for (let i = 0; i < zeilen.length; i += 1) {
    const zeile = zeilen[i];
    const geputzt = zeile.trim();
    if (geputzt.startsWith('//') || geputzt.startsWith('*') || geputzt.startsWith('/*')) continue;
    for (const treffer of zeile.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g)) {
      gefunden.push({ name: treffer[1], zeile: i + 1 });
    }
  }
  return gefunden;
}

const felder = feldnamen(text);

test('die Typdatei liess sich lesen und hat Felder', () => {
  assert.ok(felder.length > 40, `nur ${felder.length} Felder in src/gemeinsam/typen.ts gefunden`);
  assert.ok(text.includes('SpeicherLokal'), 'die Form des Speichers steht nicht mehr in dieser Datei');
});

test('kein Feldname traegt url, verlauf oder besuch', () => {
  const treffer: string[] = [];
  for (const { name, zeile } of felder) {
    if (GEDULDET.has(name)) continue;
    const klein = name.toLowerCase();
    for (const wort of VERBOTEN) {
      if (klein.includes(wort)) treffer.push(`typen.ts:${zeile} ${name} (enthaelt „${wort}")`);
    }
  }
  assert.deepEqual(
    treffer,
    [],
    `Feld mit Adressbezug in src/gemeinsam/typen.ts:\n  ${treffer.join('\n  ')}`,
  );
});

test('die geduldeten Namen sind genau die im Kopf begruendeten', () => {
  // Waechst diese Liste ohne Begruendung, ist der Waechter ausgehebelt.
  assert.deepEqual([...GEDULDET], ['verbindenUrl']);
  for (const name of GEDULDET) {
    assert.ok(felder.some((f) => f.name === name), `${name} steht gar nicht mehr in typen.ts, raus damit`);
  }
});

test('die beiden erlaubten Strukturen gibt es und sie heissen noch so', () => {
  assert.ok(/\bSites\b/.test(text), 'die Ausnahmeliste `sites` fehlt');
  assert.ok(/\bMeldungVorschau\b/.test(text), 'die Meldung fehlt');
  for (const name of ERLAUBTE_STRUKTUREN) {
    assert.ok(text.toLowerCase().includes(name), `${name} kommt in typen.ts nicht vor`);
  }
});

test('die Adresse der Meldung heisst `seite` und traegt keine Query', () => {
  // Query und Fragment tragen Sitzungen, Suchbegriffe und Token. Der Name
  // `seite` haelt fest, dass hier eine gekuerzte Adresse steht.
  assert.ok(/seite:\s*string/.test(text), 'MeldungVorschau.seite fehlt oder heisst anders');
  const pruefung = readFileSync(join(WURZEL, 'src', 'hintergrund', 'pruefung.ts'), 'utf8');
  assert.ok(
    pruefung.includes('seiteOhneQuery'),
    'die Kuerzung auf Herkunft und Pfad fehlt; ohne sie stuende der Suchbegriff in der Meldung',
  );
});

test('der Zaehler haengt am Tab, nicht an einer Adresse', () => {
  // `TabZustand.blockiert` wird vom Badge gelesen und lebt nur so lange wie
  // das Popup. Ein Zaehler je Host waere ein Verlauf mit anderem Namen.
  //
  // `'amSymbol'` gehoert dazu: Chrome gibt statt der Zahl den Platzhalter
  // `<<declarativeNetRequestActionCount>>` heraus (siehe `hintergrund/badge.ts`).
  // Auch dieser Wert haengt am Tab und wird nirgends gespeichert.
  assert.ok(/blockiert:\s*number \| 'amSymbol' \| null/.test(text), 'TabZustand.blockiert hat eine andere Form als erwartet');
  assert.ok(!/zaehlerJeHost|besucheJeHost|statistik/i.test(text));
});

test('der Speicher nennt nur die Schluessel aus vertrag.md 8', () => {
  const block = /export type SpeicherLokal = \{([^}]*)\}/s.exec(text);
  assert.ok(block, 'SpeicherLokal nicht gefunden');
  // `version` steht mit drin, weil `stand: { version: number }` in derselben
  // Zeile geschrieben ist; das ist ein Feld des Standes, kein Speicherschluessel.
  const namen = feldnamen(block[1]).map((f) => f.name);
  assert.deepEqual(namen.sort(), [
    'abgleich',
    'eigeneRegeln',
    'einstellungen',
    'konto',
    'kontoHinweis',
    'lizenz',
    'sites',
    'stand',
    'verbindungOffen',
    'version',
  ]);
});

test('storage.sync kommt in der ganzen Erweiterung nicht vor', () => {
  // Was ein Konto ueber Geraete teilt, laeuft ueber den Abgleich des
  // Backends, nicht ueber den Browserhersteller.
  const speicher = readFileSync(join(WURZEL, 'src', 'gemeinsam', 'speicher.ts'), 'utf8');
  assert.ok(!/storage\.sync/.test(speicher.replace(/\/\*\*[\s\S]*?\*\//g, '')));
});
