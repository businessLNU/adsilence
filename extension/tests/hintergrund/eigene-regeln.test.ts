/**
 * `eigeneDnr()` uebersetzt das Textfeld der Optionsseite in DNR-Regeln und
 * liefert die Zahl, die dort unter dem Feld steht.
 *
 * Der Kern dieser Datei ist die ZAHL, nicht die Uebersetzung - die prueft
 * `tests/engine/dnr.test.ts`. Hier geht es darum, dass die Zahl dasselbe
 * bedeutet wie das, was der Nutzer getippt hat.
 *
 * GEMESSEN am 03.09.2026 an der in Chrome for Testing geladenen Erweiterung:
 * Zwei Zeilen im Feld ergaben EINE dynamische Regel, weil der Konverter reine
 * Host-Blocks zu einer Regel mit mehreren `requestDomains` zusammenlegt. Die
 * Optionsseite meldete daraufhin „1 Regel aktiv". Beide Regeln wirkten; nur
 * die Zahl stimmte nicht. Seither zaehlt `anzahl` die QUELLZEILEN.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installiereApi } from './attrappe.ts';

installiereApi();
const { eigeneDnr } = await import('../../src/hintergrund/regeln.ts');
const { ID_EIGENE_VON, BUDGET_EIGENE } = await import('../../src/gemeinsam/konstanten.ts');

test('leerer Text ergibt nichts, ohne Fehler', () => {
  for (const text of ['', '   ', '\n\n']) {
    const e = eigeneDnr(text);
    assert.deepEqual(e.rules, []);
    assert.equal(e.anzahl, 0);
    assert.deepEqual(e.fehler, []);
  }
});

/*
 * Bis zum 08.09.2026 verlangte dieser Test, dass zwei Host-Regeln zu EINER
 * DNR-Regel verschmelzen. Seit `EINZELN_BIS` (engine/dnr.ts) bleiben Gruppen
 * bis zehn Hosts einzeln — und fuer EIGENE Regeln ist das genau richtig: Wer
 * `||werbung.beispiel.de^` tippt, soll im Popup „werbung.beispiel.de" lesen,
 * nicht „eine von mehreren Domains". Der Kern des Tests bleibt: `anzahl`
 * nennt die getippten Zeilen, egal wie viele DNR-Regeln daraus werden.
 */
test('zwei Host-Regeln zaehlen als zwei und behalten je ihren Namen', () => {
  const e = eigeneDnr('||werbung.beispiel.de^\n||tracker.beispiel.de^');
  assert.equal(e.anzahl, 2, 'die Zahl unter dem Feld muss die getippten Zeilen nennen');
  assert.equal(e.rules.length, 2, 'unter EINZELN_BIS bleibt jeder Host eine eigene Regel');
  assert.deepEqual(
    e.rules.map((r) => r.condition.requestDomains),
    [['werbung.beispiel.de'], ['tracker.beispiel.de']],
  );
  assert.deepEqual(e.fehler, []);
});

test('eine unbrauchbare Zeile wird gemeldet und zaehlt nicht mit', () => {
  const e = eigeneDnr('||gut.beispiel.de^\n||schlecht.beispiel.de^$removeparam=x');
  assert.equal(e.anzahl, 1);
  assert.equal(e.fehler.length, 1);
  assert.match(e.fehler[0]!, /^2: /, 'die Fehlerzeile nennt die Zeilennummer');
});

test('die IDs liegen im Bereich der eigenen Regeln', () => {
  const zeilen: string[] = [];
  for (let i = 0; i < 40; i += 1) zeilen.push(`/werbung${i}/anzeige.js`);
  const e = eigeneDnr(zeilen.join('\n'));
  assert.ok(e.rules.length > 0);
  for (const r of e.rules) {
    assert.ok(
      r.id >= ID_EIGENE_VON && r.id < ID_EIGENE_VON + BUDGET_EIGENE,
      `id ${r.id} ausserhalb ${ID_EIGENE_VON}..${ID_EIGENE_VON + BUDGET_EIGENE - 1}`,
    );
  }
});

test('kaputter Text wirft nicht, sondern wird zur Fehlerzeile', () => {
  // Ein ungueltiger Selektor faellt beim Lesen auf und steht in `fehler`.
  // `@@@@` und `$$$` liest der Parser dagegen als Netzregeln mit sehr kurzem
  // Muster - unsinnig, aber syntaktisch nichts, worueber er stolpert. Wichtig
  // ist hier nur: Der Aufruf wirft nicht, und der Nutzer bekommt zu der Zeile,
  // die wirklich unbrauchbar ist, eine Meldung. Ein Service Worker, der an
  // einem Textfeld stirbt, nimmt das Blocken mit.
  const e = eigeneDnr('##[[[[\n@@@@\n$$$');
  assert.ok(e.fehler.some((f) => f.startsWith('1: ')), 'die ungueltige Zeile 1 muss gemeldet werden');
  assert.equal(typeof e.anzahl, 'number');
});
