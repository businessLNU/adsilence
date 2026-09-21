/**
 * Netz-Waechter (erweiterung.md N4).
 *
 * Ein Werbeblocker sieht jede Adresse, die der Nutzer aufruft. Das ist der
 * Grund, warum die Store-Beschreibung „keine Telemetrie" verspricht, und
 * der Grund, warum dieses Versprechen nicht am Gedaechtnis haengen darf.
 * Diese Datei liest `src/` und faellt um, sobald irgendwo ausserhalb des
 * API-Clients eine Verbindung nach draussen aufgemacht wird.
 *
 * Der Waechter prueft Text, nicht Verhalten. Das ist Absicht: Eine
 * Verhaltenspruefung faende nur, was die Tests auch ausfuehren; ein
 * `sendBeacon` in einem selten betretenen Zweig faende sie nie. Ein Text-
 * waechter findet ihn beim ersten Lauf.
 *
 * ABWEICHUNG von N4, mit Begruendung: `fetch(api.runtime.getURL(...))` ist
 * ausdruecklich erlaubt. `runtime.getURL` erzeugt eine
 * `chrome-extension://`-Adresse auf eine Datei im PAKET; die Anfrage verlaesst
 * den Browser nicht und kann es nicht, weil das Schema fest im Aufruf steht.
 * So liest `regeln.ts` `listen/quellen.json` und `listen/bericht.json`. N4
 * woertlich genommen wuerde also zwei berechtigte Zeilen verbieten und damit
 * seine eigene Abschaltung provozieren. Erlaubt ist deshalb genau diese eine
 * Form; `fetch` mit einer freien Adresse bleibt ueberall ausser in
 * `konto.ts` verboten.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUELLE = join(WURZEL, 'src');

/**
 * Die Dateien, die ins Netz greifen duerfen. ZWEI, und jede aus einem
 * benannten Grund - eine dritte muss hier eingetragen werden und faellt damit
 * jemandem auf.
 *
 * `konto.ts` spricht mit dem Backend (vertrag.md 6): Anmeldung, Lizenz,
 * Abgleich, Meldung. Alles davon hat einen Klick davor.
 *
 * `listenpflege.ts` holt die Filterlisten von ihren Quellen. Das ist eine
 * Ausnahme von Regel 2 („nichts verlaesst den Browser ohne Handgriff"), und
 * sie ist eng: Es sind GET-Anfragen an oeffentliche Dateien, deren Adressen
 * im Paket stehen (`listen/quellen.json`), ohne Kennung, ohne Verweis, ohne
 * Cookie (`credentials: 'omit'`). Sie verraten nichts ueber den Nutzer ausser
 * dass er einen Blocker benutzt - und das weiss die Gegenseite ohnehin, denn
 * sie liefert die Liste aus.
 *
 * Der Gegenwert: Unter Manifest V3 liegen Regeln im Paket, und ohne diesen
 * Abruf sind sie nur so frisch wie das letzte Store-Release.
 */
const NETZ_ERLAUBT = ['src/hintergrund/konto.ts', 'src/hintergrund/listenpflege.ts'];

/** Was eine Verbindung nach draussen aufmacht. */
const VERBOTEN = [
  { name: 'fetch(', muster: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', muster: /\bXMLHttpRequest\b/ },
  { name: 'sendBeacon', muster: /\bsendBeacon\b/ },
  { name: 'WebSocket', muster: /\bnew\s+WebSocket\b|\bWebSocket\s*\(/ },
  { name: 'EventSource', muster: /\bnew\s+EventSource\b/ },
  { name: 'importScripts', muster: /\bimportScripts\s*\(/ },
];

/** Erlaubt: eine Datei aus dem eigenen Paket lesen. */
const PAKETDATEI = /\bfetch\s*\(\s*api\.runtime\.getURL\s*\(/;

/**
 * Die zweite begruendete Ausnahme, und die gegenlaeufige: Die Scriptlet-
 * Bibliothek laeuft nicht in der Erweiterung, sondern IN DER SEITE, und sie
 * stellt keine Anfrage - sie legt sich vor die der Seite, damit die AUSFAELLT
 * (`no-xhr-if`, `json-prune`). Sie greift also den vorhandenen Konstruktor
 * vom Fenster ab, um ihn zu umhuellen.
 *
 * Die Ausnahme ist eng gefasst: erlaubt ist ausschliesslich das ABHOLEN vom
 * Fensterobjekt (`= w.XMLHttpRequest`). Ein `new XMLHttpRequest` faellt
 * weiter um - und dass es das tut, prueft der Test darunter.
 */
const SEITENKONTEXT = 'src/scriptlets/bibliothek.ts';
const ABFANGEN = /=\s*w\.XMLHttpRequest\b/;

function dateien(ordner: string): string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) gefunden.push(...dateien(pfad));
    else if (/\.(ts|tsx)$/.test(eintrag.name)) gefunden.push(pfad);
  }
  return gefunden.sort();
}

/**
 * Zeilen ohne die, die reiner Kommentar sind. Kein vollstaendiger Parser:
 * Wer eine Verbindung in einer Zeile versteckt, die wie ein Kommentar
 * aussieht, hat sie auch nicht ausgefuehrt.
 */
function codezeilen(text: string): { nummer: number; text: string }[] {
  return text
    .split('\n')
    .map((zeile, i) => ({ nummer: i + 1, text: zeile }))
    .filter(({ text: z }) => {
      const geputzt = z.trim();
      return geputzt !== '' && !geputzt.startsWith('//') && !geputzt.startsWith('*') && !geputzt.startsWith('/*');
    });
}

const alle = dateien(QUELLE);

test('es gibt ueberhaupt Quelldateien zu pruefen', () => {
  assert.ok(alle.length > 20, `nur ${alle.length} Dateien unter src/ gefunden`);
});

test('nur die zwei benannten Dateien sprechen mit dem Netz', () => {
  const treffer: string[] = [];
  for (const pfad of alle) {
    const kurz = relative(WURZEL, pfad);
    if (NETZ_ERLAUBT.includes(kurz)) continue;
    for (const { nummer, text } of codezeilen(readFileSync(pfad, 'utf8'))) {
      for (const { name, muster } of VERBOTEN) {
        if (!muster.test(text)) continue;
        // Die eine begruendete Ausnahme: eine Datei aus dem eigenen Paket.
        if (name === 'fetch(' && PAKETDATEI.test(text)) continue;
        // Die zweite: den XHR der Seite umhuellen, um ihn ausfallen zu lassen.
        if (name === 'XMLHttpRequest' && kurz === SEITENKONTEXT && ABFANGEN.test(text)) continue;
        treffer.push(`${kurz}:${nummer} ${name}: ${text.trim()}`);
      }
    }
  }
  assert.deepEqual(
    treffer,
    [],
    `Verbindung nach draussen ausserhalb von ${NETZ_ERLAUBT.join(' und ')}:\n  ${treffer.join('\n  ')}`,
  );
});

/*
 * Eine Ausnahme, die niemand prueft, ist ein Loch mit Kommentar. Diese hier
 * darf genau eine Form durchlassen; alles, was WIRKLICH eine Anfrage stellt,
 * muss weiter umfallen - auch in derselben Datei.
 */
test('die Ausnahme fuer die Scriptlet-Bibliothek laesst keine eigene Anfrage durch', () => {
  const xhr = VERBOTEN.find((v) => v.name === 'XMLHttpRequest')!;

  const abfangen = 'const XHR = w.XMLHttpRequest as { prototype?: object } | undefined;';
  assert.ok(xhr.muster.test(abfangen), 'der Waechter sieht die Zeile ueberhaupt');
  assert.ok(ABFANGEN.test(abfangen), 'das Umhuellen muss durchgehen');

  for (const eigene of [
    'const x = new XMLHttpRequest();',
    'const x = new w.XMLHttpRequest();',
    'send(new XMLHttpRequest());',
  ]) {
    assert.ok(xhr.muster.test(eigene), `der Waechter sieht "${eigene}" nicht`);
    assert.ok(!ABFANGEN.test(eigene), `die Ausnahme laesst "${eigene}" durch - sie ist zu weit`);
  }
});

test('die Listenpflege schickt weder Cookies noch eine Kennung mit', () => {
  // Ein `fetch` mit Anmeldedaten waere aus einer anonymen Abfrage eine
  // wiedererkennbare gemacht - und der ganze Grund fuer die Ausnahme faellt
  // damit weg.
  //
  // Geprueft wird der AUFRUF, nicht die Zeile: Ein mehrzeiliges `fetch(...)`
  // ist der Normalfall, sobald mehr als ein Feld mitgeht.
  const text = readFileSync(join(QUELLE, 'hintergrund', 'listenpflege.ts'), 'utf8');
  const aufrufe = [...text.matchAll(/\bfetch\s*\(([\s\S]*?)\n\s*\}?\);/g)];
  assert.ok(aufrufe.length > 0, 'kein fetch gefunden - ist die Datei noch die richtige?');
  for (const aufruf of aufrufe) {
    assert.match(aufruf[0], /credentials:\s*'omit'/, "ein fetch laedt ohne credentials: 'omit'");
  }
  assert.equal(/headers\s*:/.test(text), false, 'die Listenpflege setzt keine eigenen Kopfzeilen');
  // Und sie spricht nur mit dem eigenen Backend: Die Adressen der Listen holt
  // der Server, nicht der Kunde.
  assert.match(text, /API_BASIS/, 'die Adresse muss aus API_BASIS kommen');
  assert.equal(/https?:\/\/(?!localhost)/.test(text), false, 'keine fremde Adresse im Quelltext');
});

test('die erlaubten Paketzugriffe sind an einer Hand abzuzaehlen', () => {
  // Gezaehlt wird JE DATEI, nicht je Zeilennummer.
  //
  // Zeilennummern waren der erste Versuch, und sie haben genau das getan, was
  // ein zu enger Waechter tut: Jede Aenderung OBERHALB der Stelle faerbte ihn
  // rot, ohne dass sich an den Zugriffen etwas geaendert hatte - dreimal
  // waehrend des Zusammenfuehrens. Wer das ein paarmal erlebt, traegt die neue
  // Zahl ein, ohne hinzusehen, und dann bewacht der Waechter nichts mehr.
  // Die Anzahl je Datei aendert sich dagegen nur, wenn wirklich ein Zugriff
  // dazukommt oder wegfaellt.
  //
  // Aus einem INHALTSSKRIPT steht diese Form ausdruecklich NICHT offen: Chrome
  // laesst eine Paketdatei dort nur lesen, wenn sie unter
  // `web_accessible_resources` steht, und das wollen wir nicht - jede Seite
  // koennte die Erweiterung dann an der Datei erkennen. Ein Inhaltsskript
  // fragt deshalb den Hintergrund (`kosmetik.generisch`), der liest ohne
  // Freigabe. `manifest.test.ts` haelt beide Haelften zusammen.
  const jeDatei: Record<string, number> = {};
  const stellen: string[] = [];
  for (const pfad of alle) {
    const kurz = relative(WURZEL, pfad);
    if (NETZ_ERLAUBT.includes(kurz)) continue;
    for (const { nummer, text } of codezeilen(readFileSync(pfad, 'utf8'))) {
      if (!PAKETDATEI.test(text)) continue;
      jeDatei[kurz] = (jeDatei[kurz] ?? 0) + 1;
      stellen.push(`${kurz}:${nummer}`);
    }
  }
  assert.deepEqual(jeDatei, { 'src/hintergrund/regeln.ts': 2 }, stellen.join(', '));
});

test('konto.ts schickt keine Cookies und keine Anmeldedaten des Browsers mit', () => {
  const text = readFileSync(join(WURZEL, 'src/hintergrund/konto.ts'), 'utf8');
  assert.ok(text.includes("credentials: 'omit'"), "konto.ts muss credentials: 'omit' setzen");
  assert.ok(!/credentials:\s*'(include|same-origin)'/.test(text));
});

/**
 * Erlaubte Hosts in einer ausgeschriebenen Adresse (Repo-Regel 1: nichts
 * Echtes im Code). `localhost` ist der Rueckfall der Entwicklung, alles
 * unter `beispiel.de` ist der erfundene Beispielname des Repos. Ein echter
 * fremder Host faellt damit weiterhin auf, auch in der Vorschau-Attrappe.
 */
const ERLAUBTE_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|([a-z0-9-]+\.)*beispiel\.(de|com))$/;

test('keine fremde Adresse steht im Quelltext; alles laeuft ueber API_BASIS', () => {
  const treffer: string[] = [];
  for (const pfad of alle) {
    const kurz = relative(WURZEL, pfad);
    for (const { nummer, text } of codezeilen(readFileSync(pfad, 'utf8'))) {
      // Adressen in Mustern (`*://host/*`) und `chrome-extension://` sind
      // keine Ziele; gesucht sind ausgeschriebene http(s)-Adressen.
      for (const gefunden of text.matchAll(/['"`]https?:\/\/([^/'"`\s]+)/g)) {
        const host = gefunden[1].replace(/:\d+$/, '').toLowerCase();
        if (ERLAUBTE_HOSTS.test(host)) continue;
        treffer.push(`${kurz}:${nummer} ${host}`);
      }
    }
  }
  assert.deepEqual(treffer, [], `feste fremde Adresse im Quelltext:\n  ${treffer.join('\n  ')}`);
});
