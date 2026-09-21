/**
 * `normalisiereHost()`: was das Ausnahmefeld annimmt.
 *
 * Das Feld wirbt im Platzhalter mit „beispiel.de oder
 * https://www.beispiel.de". Diese Reihe haelt das Versprechen fest. Vorher
 * stand unter dem Feld „Nur der Host, zum Beispiel beispiel.de" - eine
 * Einschraenkung, die es nie gab, und niemand haette gemerkt, wenn sie eines
 * Tages wahr geworden waere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalisiereHost } from '../../src/gemeinsam/host.ts';

test('der blanke Host bleibt, wie er ist', () => {
  assert.equal(normalisiereHost('beispiel.de'), 'beispiel.de');
  assert.equal(normalisiereHost('a.b.beispiel.de'), 'a.b.beispiel.de');
  assert.equal(normalisiereHost('localhost'), 'localhost');
});

test('www., Schema, Pfad, Abfrage, Anker und Port fallen weg', () => {
  for (const eingabe of [
    'www.beispiel.de',
    'https://beispiel.de',
    'http://www.beispiel.de',
    'http://www.beispiel.de/pfad?x=1#y',
    'HTTPS://WWW.Beispiel.DE:8443/',
    '  beispiel.de  ',
    'beispiel.de:8080/pfad',
  ]) {
    assert.equal(normalisiereHost(eingabe), 'beispiel.de', eingabe);
  }
});

test('www mitten im Namen bleibt stehen', () => {
  // Nur das FUEHRENDE `www.` ist die Abkuerzung, die jeder mittippt.
  assert.equal(normalisiereHost('wwwbeispiel.de'), 'wwwbeispiel.de');
  assert.equal(normalisiereHost('a.www.beispiel.de'), 'a.www.beispiel.de');
});

test('was kein Host ist, wird abgewiesen', () => {
  for (const eingabe of ['', '   ', 'www.', 'nur text', 'beispiel', 'https://', '.de', 'a..b.de', '-a.de']) {
    assert.equal(normalisiereHost(eingabe), null, eingabe);
  }
});

test('die Grenze liegt bei 253 Zeichen, und zwar genau dort', () => {
  // 253 ist die Laenge eines vollstaendigen Domainnamens nach RFC 1035.
  const genau253 = `${'a'.repeat(250)}.de`;
  assert.equal(genau253.length, 253);
  assert.equal(normalisiereHost(genau253), genau253, '253 geht noch');

  const einesZuViel = `${'a'.repeat(251)}.de`;
  assert.equal(einesZuViel.length, 254);
  assert.equal(normalisiereHost(einesZuViel), null, '254 nicht mehr');

  // Die Laenge des einzelnen LABELS (63) prueft die Funktion NICHT - hier
  // steht ein 250 Zeichen langes Label und kommt durch. Das ist Absicht
  // genug: Der Griff ist ein Filter fuer Vertipper, kein Resolver, und ein
  // unmoeglicher Host in der Ausnahmeliste trifft schlicht nie zu.
});
