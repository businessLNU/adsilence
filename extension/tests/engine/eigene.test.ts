/**
 * `src/engine/eigene.ts`: das Textfeld der Optionsseite.
 *
 * Der Unterschied zum Listenbau ist die ZEILENNUMMER. Beim Bauen darf eine
 * Regel still wegfallen, sie ist eine von achtzigtausend. Hier hat ein
 * Mensch sie getippt und wartet darauf, dass sie wirkt; faellt sie weg, muss
 * er erfahren, welche Zeile es war und warum. Ein Textfeld, das Eingaben
 * schweigend verwirft, ist dieselbe Falle wie ein Formularfeld, das die
 * Route nicht annimmt (Regel 14 des Repos).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { eigeneRegeln } from '../../src/engine/eigene.ts';
import { zuDnr } from '../../src/engine/dnr.ts';

test('leerer Text ergibt nichts, ohne Fehler', () => {
  assert.deepEqual(eigeneRegeln(''), { regeln: [], fehler: [] });
  assert.deepEqual(eigeneRegeln('\n\n   \n'), { regeln: [], fehler: [] });
});

test('gute Zeilen aller drei Arten kommen durch', () => {
  const { regeln, fehler } = eigeneRegeln(
    ['||werbung.example^', 'shop.example##.banner', 'shop.example##+js(noeval)'].join('\n'),
  );
  assert.deepEqual(fehler, []);
  assert.deepEqual(
    regeln.map((r) => r.typ),
    ['netz', 'kosmetik', 'scriptlet'],
  );
});

test('Kommentare und Leerzeilen verschieben die Zeilennummer nicht', () => {
  const text = ['! ein Kommentar', '', '||gut.example^', '||b.example^$removeparam=x'].join('\n');
  const { regeln, fehler } = eigeneRegeln(text);
  assert.equal(regeln.length, 1);
  assert.equal(fehler.length, 1);
  assert.equal(fehler[0].zeile, 4, 'die Zeilennummer muss die im Textfeld sein');
});

test('jede Fehlerzeile nennt Nummer, Grund und den Text selbst', () => {
  const text = [
    '||a.example^$removeparam=x',
    'shop.example##.x:has-text(y)',
    '##+js(noeval)',
    'shop.example##+js(gibtsnicht)',
    'shop.*##.banner',
    'shop.example#?#.a:has-text(x)',
  ].join('\n');
  const { regeln, fehler } = eigeneRegeln(text);
  assert.deepEqual(regeln, []);
  assert.deepEqual(
    fehler.map((f) => [f.zeile, f.grund]),
    [
      [1, 'optionNichtUmsetzbar'],
      [2, 'selektorUngueltig'],
      [3, 'scriptletOhneDomain'],
      [4, 'scriptletUnbekannt'],
      [5, 'domainUngueltig'],
      [6, 'erweiterteKosmetik'],
    ],
  );
  assert.equal(fehler[0].option, 'removeparam', 'bei einer Option muss dastehen, WELCHE');
  assert.equal(fehler[0].text, '||a.example^$removeparam=x');
  assert.equal(fehler[2].text, '##+js(noeval)');
});

test('eine Netzregel, die DNR nicht ausdruecken kann, wird hier schon gemeldet', () => {
  const { fehler } = eigeneRegeln('$script');
  assert.deepEqual(fehler.map((f) => f.grund), ['leereBedingung']);
});

test('die durchgekommenen Regeln lassen sich unveraendert nach DNR uebersetzen', () => {
  // Der Hintergrund reicht `regeln` genau so an `zuDnr` weiter; was hier
  // durchkam, darf dort nicht doch noch verworfen werden.
  const { regeln, fehler } = eigeneRegeln(['||a.example^', '@@||b.example^$document', '||c.example/x$script'].join('\n'));
  assert.deepEqual(fehler, []);
  const ergebnis = zuDnr(regeln, { startId: 1001, budget: 2999 });
  assert.deepEqual(ergebnis.verworfen, {});
  assert.equal(ergebnis.rules.length, 3);
  assert.equal(ergebnis.rules[0].id, 1001);
});

test('eine sehr lange Eingabe bleibt zeilenweise zuordenbar', () => {
  const zeilen: string[] = [];
  for (let i = 0; i < 200; i += 1) zeilen.push(i === 150 ? '||x.example^$hurz' : `||h${i}.example^`);
  const { regeln, fehler } = eigeneRegeln(zeilen.join('\n'));
  assert.equal(regeln.length, 199);
  assert.deepEqual(fehler.map((f) => f.zeile), [151]);
  assert.equal(fehler[0].option, 'hurz');
});
