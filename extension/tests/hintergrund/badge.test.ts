/**
 * `lesbaresMuster` aus `src/hintergrund/badge.ts`: was in der
 * Aufschluesselung des Popups als Name einer Regel steht.
 *
 * Chrome gibt zu einem Treffer nur Regelnummer und Liste heraus, nie die
 * aufgerufene Adresse. Der Name muss also aus der Regel selbst kommen - und
 * darf dabei nichts behaupten, was in ihr nicht steht.
 *
 * Genau daran ist die erste Fassung gescheitert: Sie nahm bei mehreren
 * `requestDomains` die erste und haengte `+N` an. Im Popup stand dann
 * `reporting-api.gannettinnovation.com +999` - eine von tausend Domains,
 * fast sicher nicht die, die wirklich geblockt wurde. In den gebauten
 * Paketen gibt es solche Regeln reichlich (`privatsphaere.json` hat 71 mit
 * bis zu 1000 Domains), und KEINE von ihnen traegt zusaetzlich ein Muster.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lesbaresMuster } from '../../src/hintergrund/badge.ts';
import { SAMMELREGEL } from '../../src/gemeinsam/konstanten.ts';

test('genau eine Domain wird genannt', () => {
  assert.equal(lesbaresMuster({ requestDomains: ['doubleclick.net'] }), 'doubleclick.net');
});

test('mehrere Domains nennen keine davon', () => {
  const viele = Array.from({ length: 1000 }, (_, i) => `t${i}.example`);
  const was = lesbaresMuster({ requestDomains: viele });
  assert.equal(was, SAMMELREGEL);
  assert.ok(!was.includes('+'), 'kein „+999" mehr');
  assert.ok(!was.includes('t0.example'), 'keine geratene Domain');
});

test('schon zwei Domains sind zu viele: es griff genau eine', () => {
  assert.equal(lesbaresMuster({ requestDomains: ['a.example', 'b.example'] }), SAMMELREGEL);
});

test('ein Muster schlaegt die Domainliste, weil es den Kern nennt', () => {
  const was = lesbaresMuster({ urlFilter: '||ads.beispiel.de^', requestDomains: ['a.example', 'b.example'] });
  assert.equal(was, 'ads.beispiel.de');
});

test('`||host^pfad` wird auf den Host eingedampft', () => {
  assert.equal(lesbaresMuster({ urlFilter: '||werbung.example^/pixel.gif' }), 'werbung.example');
});

test('ein langes Muster wird gekuerzt, aber nie leer', () => {
  const was = lesbaresMuster({ regexFilter: 'x'.repeat(120) });
  assert.ok(was.length <= 41, `zu lang: ${was.length}`);
  assert.notEqual(was, SAMMELREGEL);
});

test('ohne Muster und ohne Domain bleibt das Fragezeichen', () => {
  assert.equal(lesbaresMuster({}), '?');
});

/**
 * Der Merkwert MUSS ein Wert sein, den kein echtes Muster je liefert -
 * sonst verschmilzt eine echte Regel im Popup mit der Sammelzeile, und die
 * Zahlen daneben stimmen nicht mehr.
 */
test('kein echtes Muster erzeugt den Merkwert', () => {
  const proben = [
    { urlFilter: '||a.example^' },
    { urlFilter: '/werbung/' },
    { regexFilter: '^https?://ads\\.' },
    { requestDomains: ['a.example'] },
    {},
  ];
  for (const probe of proben) assert.notEqual(lesbaresMuster(probe), SAMMELREGEL);
});
