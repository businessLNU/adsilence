/**
 * `src/engine/scriptlets.ts`: `host##+js(name, args)` → Eintraege je Host.
 *
 * Ein Scriptlet laeuft in der MAIN-World der fremden Seite. Alles, was hier
 * durchkommt, wird spaeter in eine Datei geschrieben und ausgefuehrt.
 * Deshalb sind die drei Fragen dieser Datei: Kennen wir den Namen? Kennen
 * wir den Host? Und sind die Argumente harmlos genug, um sie einzubetten?
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseListe } from '../../src/engine/abp.ts';
import { BEKANNT, scriptletName, zuScriptlets } from '../../src/engine/scriptlets.ts';
import type { Scriptlet } from '../../src/engine/scriptlets.ts';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function jeHost(...zeilen: string[]): Record<string, Scriptlet[]> {
  return zuScriptlets(parseListe(zeilen.join('\n')));
}

// ── Namen und Kuerzel ──────────────────────────────────────────────────────

/*
 * Die Namensliste und die gebauten Scriptlets standen bis zum 08.09.2026 an
 * zwei Stellen. Ein Name, der nur in der Liste steht, kommt durch den
 * Konverter, landet im Paket - und tut in der Seite nichts, weil die
 * Bibliothek ihn nicht kennt. Das faellt nirgends auf: keine Fehlermeldung,
 * keine Zahl im Bericht, die Regel gilt als uebernommen.
 *
 * Deshalb wird hier gegen den QUELLTEXT geprueft, nicht gegen eine Zahl.
 */
test('jeder bekannte Name ist in der Bibliothek auch gebaut', async () => {
  const quelle = await readFile(new URL('../../src/scriptlets/bibliothek.ts', import.meta.url), 'utf8');
  const rumpf = quelle.slice(quelle.indexOf('const bibliothek: Record'));
  const gebaut = new Set<string>();
  // Eintraege im Record: `name(args) {` oder `'name'(args) {`.
  for (const treffer of rumpf.matchAll(/^ {4}'?([a-zA-Z][\w-]*)'?\((?:args)?\)/gm)) {
    gebaut.add(treffer[1]!);
  }
  assert.ok(gebaut.size > 0, 'im Quelltext wurde kein einziger Eintrag gefunden - Muster kaputt?');
  assert.deepEqual(
    [...BEKANNT].sort(),
    [...gebaut].sort(),
    'BEKANNT und die gebauten Scriptlets muessen sich decken',
  );
  assert.equal(new Set(BEKANNT).size, BEKANNT.length, 'ein Name steht zweimal in BEKANNT');
});

test('jeder lange Name bildet auf sich selbst ab, mit und ohne `.js`', () => {
  for (const name of BEKANNT) {
    assert.equal(scriptletName(name), name);
    assert.equal(scriptletName(`${name}.js`), name);
    assert.equal(scriptletName(`  ${name}  `), name, 'Leerraum um den Namen');
  }
});

test('die uBO-Kuerzel bilden auf die langen Namen ab', () => {
  assert.equal(scriptletName('aopr'), 'abort-on-property-read');
  assert.equal(scriptletName('aopw'), 'abort-on-property-write');
  assert.equal(scriptletName('acs'), 'abort-current-script');
  assert.equal(scriptletName('acis'), 'abort-current-script');
  assert.equal(scriptletName('abort-current-inline-script'), 'abort-current-script');
  assert.equal(scriptletName('set'), 'set-constant');
  assert.equal(scriptletName('nostif'), 'no-setTimeout-if');
  assert.equal(scriptletName('setTimeout-defuser'), 'no-setTimeout-if');
  assert.equal(scriptletName('nosiif'), 'no-setInterval-if');
  assert.equal(scriptletName('setInterval-defuser'), 'no-setInterval-if');
  assert.equal(scriptletName('aeld'), 'prevent-addEventListener');
  assert.equal(scriptletName('addEventListener-defuser'), 'prevent-addEventListener');
});

test('ein unbekannter Name kommt nicht durch', () => {
  assert.equal(scriptletName('gibtsnicht'), null);
  assert.equal(scriptletName(''), null);
  assert.equal(scriptletName('AOPR'), null, 'Kuerzel sind gross/klein-genau');
  const verworfen: Record<string, number> = {};
  const ergebnis = zuScriptlets(parseListe('shop.example##+js(gibtsnicht, x)'), verworfen);
  assert.deepEqual(ergebnis, {});
  assert.equal(verworfen.scriptletUnbekannt, 1);
});

// ── Hosts ──────────────────────────────────────────────────────────────────

test('ein Scriptlet ohne Domain wuerde auf jeder Seite laufen und faellt weg', () => {
  const verworfen: Record<string, number> = {};
  assert.deepEqual(zuScriptlets(parseListe('##+js(noeval)'), verworfen), {});
  assert.equal(verworfen.scriptletOhneDomain, 1);
});

test('eine unbrauchbare Domain zaehlt getrennt vom fehlenden Host', () => {
  const verworfen: Record<string, number> = {};
  assert.deepEqual(zuScriptlets(parseListe('shop.*##+js(noeval)'), verworfen), {});
  assert.equal(verworfen.domainUngueltig, 1);
  assert.equal(verworfen.scriptletOhneDomain, undefined);
});

test('Kuerzel und langer Name auf demselben Host sind EIN Eintrag', () => {
  const ergebnis = jeHost('shop.example##+js(aopr, adblock)', 'shop.example##+js(abort-on-property-read, adblock)');
  assert.deepEqual(ergebnis, { 'shop.example': [{ name: 'abort-on-property-read', args: ['adblock'] }] });
});

test('`host#@#+js(name, args)` nimmt genau diesen Eintrag zurueck', () => {
  const ergebnis = jeHost(
    'shop.example##+js(noeval)',
    'shop.example##+js(nowebrtc)',
    'shop.example#@#+js(noeval)',
  );
  assert.deepEqual(ergebnis, { 'shop.example': [{ name: 'nowebrtc', args: [] }] });
});

test('`host#@#+js()` ohne Namen nimmt alle Eintraege des Hosts zurueck', () => {
  const ergebnis = jeHost('shop.example##+js(noeval)', 'markt.example##+js(noeval)', 'shop.example#@#+js()');
  assert.deepEqual(ergebnis, { 'markt.example': [{ name: 'noeval', args: [] }] });
});

test('Hosts kommen sortiert, Eintraege in Listenreihenfolge', () => {
  const ergebnis = jeHost('zeta.example##+js(noeval)', 'alpha.example##+js(nowebrtc)', 'alpha.example##+js(noeval)');
  assert.deepEqual(Object.keys(ergebnis), ['alpha.example', 'zeta.example']);
  assert.deepEqual(
    ergebnis['alpha.example'].map((e) => e.name),
    ['nowebrtc', 'noeval'],
  );
});

// ── Argumente ──────────────────────────────────────────────────────────────

/**
 * Die Form, in der ein Argument gefahrlos zur Seite gelangt.
 *
 * Ein Argument wird NIE per Textverkettung in Code geschrieben. Zur Laufzeit
 * reicht `src/hintergrund/scriptlets.ts` die Eintraege strukturiert an
 * `scripting.executeScript({ func, args })` durch, und wer je Tupel eine
 * Datei erzeugt (Katalog 32, Regel 4), schreibt sie mit `JSON.stringify`
 * hinein. Geprueft wird deshalb: ein String, kein Steuerzeichen, kein
 * Zeilentrenner U+2028/U+2029, keine einsame Ersatzzeichen-Haelfte,
 * hoechstens 1000 Zeichen.
 * Klammern, Schraegstriche und Anfuehrungszeichen sind erlaubt, weil sie
 * erlaubt sein MUESSEN; leer ist erlaubt, weil `aeld, , needle` in uBO
 * „jedes Ereignis" heisst und die Bibliothek genau so damit rechnet
 * (`args[0] ?? ''`). Die Laengengrenze ist ein Deckel gegen Unfug, kein
 * Mass: Das laengste echte Argument (`json-prune` mit neun Pfaden auf
 * art19.com) hat 296 Zeichen.
 *
 * GEMESSEN am 03.09.2026, als dieser Test zum ersten Mal ueber ALLE Listen
 * aus `listen/quellen.json` lief statt ueber die ersten fuenf: Die
 * uBlock-Listen und Fanboy's Annoyances tragen 97 Argumente mit Klammern
 * oder Schraegstrichen wie `/^(mouseout|mouseleave)$/` oder `()` und 78
 * leere - Regex-Nadeln und Codestuecke, an denen `no-setTimeout-if` und
 * `prevent-addEventListener` den Timer oder Lauscher erkennen. Die alte
 * Regel (nur Wortzeichen, Punkt, Dollar, Bindestrich, nicht leer) haette sie
 * alle verworfen und die Bibliothek um genau die Faelle gebracht, fuer die
 * `passt()` in `bibliothek.ts` einen Regex baut. Die Regel stammte aus einer Zeit, in der noch niemand Argumente in
 * Code verkettet oder gemessen hatte; sie beschrieb eine Angst, kein Risiko.
 */
const ARGUMENT_MAX = 1000;
/** Eine hohe Ersatzzeichen-Haelfte ohne ihre niedrige, oder umgekehrt. */
const EINSAMES_ERSATZZEICHEN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function argumentTauglich(arg: string): boolean {
  if (typeof arg !== 'string') return false;
  if (arg.length > ARGUMENT_MAX) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(arg)) return false;
  // Eine einsame Ersatzzeichen-Haelfte ist kein gueltiger Text. Ein
  // JSON-Rundlauf faengt sie NICHT: `JSON.stringify` schreibt sie seit Node 12
  // als `\udXXX` und `JSON.parse` stellt sie wieder her, der Vergleich ist
  // also fuer jeden String wahr. Diese Zeile stand hier zuerst als
  // `JSON.parse(JSON.stringify(arg)) === arg` und pruefte damit nichts.
  //
  // Als Ausdruck und nicht `String.prototype.isWellFormed()`: Das braucht
  // `lib: es2024`, und die tsconfig dieses Pakets fuer eine Testzeile
  // anzuheben hiesse, die Zielversion aller drei Browser mitzuverschieben.
  return !EINSAMES_ERSATZZEICHEN.test(arg);
}

test('die Argumentform trifft, was sie treffen soll', () => {
  const gut = ['', 'window.canRunAds', 'true', '0', 'ad-slot', '$ad', 'a'.repeat(1000), '{}', "''", '/^(mouseout|mouseleave)$/', '()', 'a b', "a'", 'a<b', 'a/b'];
  for (const g of gut) assert.equal(argumentTauglich(g), true, `${g} sollte tauglich sein`);
  const schlecht = ['a'.repeat(1001), 'a\nb', 'a\u0000b', 'a\u2028b', 'a\ud800b'];
  for (const s of schlecht) assert.equal(argumentTauglich(s), false, `${JSON.stringify(s)} sollte untauglich sein`);
});

test('Argumente werden unveraendert durchgereicht, Leerraum aussen faellt weg', () => {
  const ergebnis = jeHost('shop.example##+js(set-constant,  window.canRunAds , true )');
  assert.deepEqual(ergebnis['shop.example'], [{ name: 'set-constant', args: ['window.canRunAds', 'true'] }]);
});

test('jedes Argument in den gebauten scriptlets/*.json ist einbettbar', () => {
  let geprueft = 0;
  let dateien = 0;
  // Die IDs aus `listen/quellen.json`, nicht von Hand: Eine Liste, die hier
  // fehlt, wird gebaut und ausgeliefert, aber nie geprueft. Genau so standen
  // die fuenf uBlock-Listen monatelang ausserhalb dieses Tests.
  const quellen: { id: string }[] = JSON.parse(readFileSync(join(WURZEL, 'listen', 'quellen.json'), 'utf8'));
  for (const { id } of quellen) {
    const pfad = join(WURZEL, 'scriptlets', `${id}.json`);
    if (!existsSync(pfad)) continue;
    dateien += 1;
    const karte: Record<string, Scriptlet[]> = JSON.parse(readFileSync(pfad, 'utf8'));
    for (const [host, eintraege] of Object.entries(karte)) {
      for (const eintrag of eintraege) {
        assert.ok(
          (BEKANNT as readonly string[]).includes(eintrag.name),
          `${id}.json / ${host}: unbekanntes Scriptlet ${eintrag.name}`,
        );
        for (const arg of eintrag.args) {
          geprueft += 1;
          assert.ok(
            argumentTauglich(arg),
            `${id}.json / ${host} / ${eintrag.name}: Argument nicht einbettbar: ${JSON.stringify(arg)}`,
          );
        }
      }
    }
  }
  assert.equal(dateien, quellen.length, 'nicht alle scriptlets/*.json sind gebaut');
  assert.ok(geprueft > 0, 'keine einzige Scriptlet-Zeile in den gebauten Dateien');
});
